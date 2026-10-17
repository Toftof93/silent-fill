// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {SilentVault} from "./SilentVault.sol";
import {ISilentOracle} from "./SilentOracle.sol";

/// @title SilentAuction
/// @notice Sealed-bid batch auction for one BASE/QUOTE market. Every batch:
///   1. Whisper (commit): traders post hash(order) and lock a flat bond. Nothing about side/size is public.
///   2. Unseal (reveal):  traders reveal; order funds get locked in the vault. No new orders can enter.
///   3. The Fill (clear): anyone settles the batch at one oracle midpoint price. Eligible orders are
///      matched; the larger side is filled pro-rata. Unrevealed commitments forfeit their bond.
contract SilentAuction is Ownable, Pausable, ReentrancyGuard {
    uint256 public constant MAX_ORDERS_PER_BATCH = 100;
    uint256 public constant MAX_FEE_BPS = 100; // 1%
    uint256 private constant PRICE_SCALE = 1e18;
    uint256 private constant BPS = 10_000;

    struct Order {
        address trader;
        bool revealed;
        bool isBuy;
        bytes32 commitment;
        uint128 amount; // base units
        uint128 limitPrice; // quote per 1e18 base (same scale as oracle)
        uint256 locked; // funds locked at reveal (base for sells, quote for buys)
    }

    SilentVault public immutable vault;
    address public immutable base;
    address public immutable quote;
    uint256 public immutable genesis;
    uint256 public immutable commitDuration;
    uint256 public immutable revealDuration;

    ISilentOracle public oracle;
    address public feeRecipient;
    uint256 public feeBps;
    uint256 public bond; // quote units locked per commitment

    mapping(uint256 => Order[]) internal _orders;
    mapping(uint256 => bool) public cleared;
    mapping(uint256 => uint256) public clearingPrice;

    event Committed(uint256 indexed batchId, uint256 indexed index, address indexed trader);
    event Revealed(uint256 indexed batchId, uint256 indexed index, address indexed trader, bool isBuy, uint256 amount, uint256 limitPrice);
    event Filled(uint256 indexed batchId, uint256 indexed index, address indexed trader, bool isBuy, uint256 baseAmount, uint256 quoteAmount);
    event BondSlashed(uint256 indexed batchId, uint256 indexed index, address indexed trader, uint256 amount);
    event BatchCleared(uint256 indexed batchId, uint256 price, uint256 matchedBase, bool cancelled);
    event ParamsUpdated(address oracle, address feeRecipient, uint256 feeBps, uint256 bond);

    error NotCommitPhase();
    error NotRevealPhase();
    error BatchFull();
    error NotYourOrder();
    error AlreadyRevealed();
    error BadReveal();
    error InvalidOrder();
    error BatchNotOver();
    error AlreadyCleared();
    error FeeTooHigh();

    constructor(
        address owner_,
        SilentVault vault_,
        address base_,
        address quote_,
        ISilentOracle oracle_,
        address feeRecipient_,
        uint256 commitDuration_,
        uint256 revealDuration_,
        uint256 bond_
    ) Ownable(owner_) {
        vault = vault_;
        base = base_;
        quote = quote_;
        oracle = oracle_;
        feeRecipient = feeRecipient_;
        commitDuration = commitDuration_;
        revealDuration = revealDuration_;
        bond = bond_;
        genesis = block.timestamp;
    }

    // ------------------------------------------------------------------ admin

    function setParams(ISilentOracle oracle_, address feeRecipient_, uint256 feeBps_, uint256 bond_) external onlyOwner {
        if (feeBps_ > MAX_FEE_BPS) revert FeeTooHigh();
        oracle = oracle_;
        feeRecipient = feeRecipient_;
        feeBps = feeBps_;
        bond = bond_;
        emit ParamsUpdated(address(oracle_), feeRecipient_, feeBps_, bond_);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    // ------------------------------------------------------------------ timing

    function period() public view returns (uint256) {
        return commitDuration + revealDuration;
    }

    function currentBatch() public view returns (uint256) {
        return (block.timestamp - genesis) / period();
    }

    function batchStart(uint256 batchId) public view returns (uint256) {
        return genesis + batchId * period();
    }

    function revealStart(uint256 batchId) public view returns (uint256) {
        return batchStart(batchId) + commitDuration;
    }

    function batchEnd(uint256 batchId) public view returns (uint256) {
        return batchStart(batchId) + period();
    }

    // ------------------------------------------------------------------ views

    function computeCommitment(
        address trader,
        uint256 batchId,
        bool isBuy,
        uint128 amount,
        uint128 limitPrice,
        bytes32 salt
    ) public view returns (bytes32) {
        return keccak256(abi.encode(block.chainid, address(this), trader, batchId, isBuy, amount, limitPrice, salt));
    }

    function orderCount(uint256 batchId) external view returns (uint256) {
        return _orders[batchId].length;
    }

    function getOrder(uint256 batchId, uint256 index) external view returns (Order memory) {
        return _orders[batchId][index];
    }

    // ------------------------------------------------------------------ whisper

    function commit(bytes32 commitment) external whenNotPaused nonReentrant returns (uint256 batchId, uint256 index) {
        batchId = currentBatch();
        if (block.timestamp >= revealStart(batchId)) revert NotCommitPhase();
        Order[] storage orders = _orders[batchId];
        if (orders.length >= MAX_ORDERS_PER_BATCH) revert BatchFull();

        vault.lock(msg.sender, quote, bond);
        index = orders.length;
        orders.push(Order({
            trader: msg.sender,
            revealed: false,
            isBuy: false,
            commitment: commitment,
            amount: 0,
            limitPrice: 0,
            locked: 0
        }));
        emit Committed(batchId, index, msg.sender);
    }

    // ------------------------------------------------------------------ unseal

    function reveal(uint256 batchId, uint256 index, bool isBuy, uint128 amount, uint128 limitPrice, bytes32 salt)
        external
        nonReentrant
    {
        if (block.timestamp < revealStart(batchId) || block.timestamp >= batchEnd(batchId)) revert NotRevealPhase();
        Order storage o = _orders[batchId][index];
        if (o.trader != msg.sender) revert NotYourOrder();
        if (o.revealed) revert AlreadyRevealed();
        if (computeCommitment(msg.sender, batchId, isBuy, amount, limitPrice, salt) != o.commitment) revert BadReveal();
        if (amount == 0 || limitPrice == 0) revert InvalidOrder();

        uint256 toLock;
        if (isBuy) {
            uint256 maxCost = Math.mulDiv(amount, limitPrice, PRICE_SCALE, Math.Rounding.Ceil);
            toLock = maxCost + _fee(maxCost);
        } else {
            toLock = amount;
        }

        vault.unlock(msg.sender, quote, bond);
        vault.lock(msg.sender, isBuy ? quote : base, toLock);

        o.revealed = true;
        o.isBuy = isBuy;
        o.amount = amount;
        o.limitPrice = limitPrice;
        o.locked = toLock;
        emit Revealed(batchId, index, msg.sender, isBuy, amount, limitPrice);
    }

    // ------------------------------------------------------------------ the fill

    function clear(uint256 batchId) external nonReentrant {
        if (block.timestamp < batchEnd(batchId)) revert BatchNotOver();
        if (cleared[batchId]) revert AlreadyCleared();
        cleared[batchId] = true;

        Order[] storage orders = _orders[batchId];
        uint256 n = orders.length;

        // A broken oracle cancels the batch instead of trapping funds.
        uint256 p;
        try oracle.price() returns (uint256 px) {
            p = px;
        } catch {}

        // Pass 1: total eligible size on each side.
        uint256 totalBuy;
        uint256 totalSell;
        if (p != 0) {
            for (uint256 i; i < n; ++i) {
                Order storage o = orders[i];
                if (!o.revealed) continue;
                if (o.isBuy && o.limitPrice >= p) totalBuy += o.amount;
                else if (!o.isBuy && o.limitPrice <= p) totalSell += o.amount;
            }
        }
        uint256 matched = Math.min(totalBuy, totalSell);

        uint256[] memory fills = _collect(batchId, orders, p, matched, totalBuy, totalSell);
        _payOut(batchId, orders, fills, p);

        // Fees, rounding dust and slashed bonds go to the fee recipient.
        uint256 dust = vault.available(address(this), quote);
        if (dust != 0) vault.transfer(address(this), feeRecipient, quote, dust);

        clearingPrice[batchId] = p;
        emit BatchCleared(batchId, p, matched, p == 0);
    }

    /// @dev Pass 2: pull what each trader owes into this contract's vault account, release the rest.
    function _collect(
        uint256 batchId,
        Order[] storage orders,
        uint256 p,
        uint256 matched,
        uint256 totalBuy,
        uint256 totalSell
    ) internal returns (uint256[] memory fills) {
        uint256 n = orders.length;
        fills = new uint256[](n);
        uint256 cumBuy;
        uint256 cumSell;
        for (uint256 i; i < n; ++i) {
            Order storage o = orders[i];
            if (!o.revealed) {
                vault.transferLocked(o.trader, address(this), quote, bond);
                emit BondSlashed(batchId, i, o.trader, bond);
                continue;
            }

            bool eligible = matched != 0 && (o.isBuy ? o.limitPrice >= p : o.limitPrice <= p);
            if (!eligible) {
                vault.unlock(o.trader, o.isBuy ? quote : base, o.locked);
                continue;
            }

            // Telescoping pro-rata: fills on each side sum to exactly `matched`, and each fill <= amount.
            uint256 fill;
            if (o.isBuy) {
                uint256 prev = Math.mulDiv(cumBuy, matched, totalBuy);
                cumBuy += o.amount;
                fill = Math.mulDiv(cumBuy, matched, totalBuy) - prev;
                uint256 cost = Math.mulDiv(fill, p, PRICE_SCALE, Math.Rounding.Ceil);
                uint256 pay = cost + _fee(cost);
                vault.transferLocked(o.trader, address(this), quote, pay);
                vault.unlock(o.trader, quote, o.locked - pay);
            } else {
                uint256 prev = Math.mulDiv(cumSell, matched, totalSell);
                cumSell += o.amount;
                fill = Math.mulDiv(cumSell, matched, totalSell) - prev;
                vault.transferLocked(o.trader, address(this), base, fill);
                vault.unlock(o.trader, base, o.locked - fill);
            }
            fills[i] = fill;
        }
    }

    /// @dev Pass 3: buyers get base, sellers get quote (rounded down, minus fee).
    function _payOut(uint256 batchId, Order[] storage orders, uint256[] memory fills, uint256 p) internal {
        for (uint256 i; i < fills.length; ++i) {
            uint256 fill = fills[i];
            if (fill == 0) continue;
            Order storage o = orders[i];
            if (o.isBuy) {
                vault.transfer(address(this), o.trader, base, fill);
                emit Filled(batchId, i, o.trader, true, fill, Math.mulDiv(fill, p, PRICE_SCALE, Math.Rounding.Ceil));
            } else {
                uint256 proceeds = Math.mulDiv(fill, p, PRICE_SCALE);
                uint256 net = proceeds - _fee(proceeds);
                vault.transfer(address(this), o.trader, quote, net);
                emit Filled(batchId, i, o.trader, false, fill, net);
            }
        }
    }

    function _fee(uint256 amount) internal view returns (uint256) {
        return Math.mulDiv(amount, feeBps, BPS, Math.Rounding.Ceil);
    }
}
