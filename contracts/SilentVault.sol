// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title SilentVault
/// @notice Custodies user funds for Silent Fill. Users deposit and withdraw freely;
///         authorized auctions can lock balances behind sealed orders and settle fills.
contract SilentVault is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// user => token => total balance (includes locked)
    mapping(address => mapping(address => uint256)) public balanceOf;
    /// user => token => locked balance
    mapping(address => mapping(address => uint256)) public lockedOf;
    /// contracts allowed to lock and move balances
    mapping(address => bool) public isAuction;
    /// token => max total deposits (0 = uncapped). Launch guardrail.
    mapping(address => uint256) public depositCap;
    /// token => total deposited across all users
    mapping(address => uint256) public totalDeposits;

    event Deposit(address indexed user, address indexed token, uint256 amount);
    event Withdraw(address indexed user, address indexed token, uint256 amount);
    event AuctionSet(address indexed auction, bool allowed);
    event DepositCapSet(address indexed token, uint256 cap);

    error NotAuction();
    error InsufficientAvailable();
    error InsufficientLocked();
    error CapExceeded();
    error ZeroAmount();

    modifier onlyAuction() {
        if (!isAuction[msg.sender]) revert NotAuction();
        _;
    }

    constructor(address owner_) Ownable(owner_) {}

    // ------------------------------------------------------------------ admin

    function setAuction(address auction, bool allowed) external onlyOwner {
        isAuction[auction] = allowed;
        emit AuctionSet(auction, allowed);
    }

    function setDepositCap(address token, uint256 cap) external onlyOwner {
        depositCap[token] = cap;
        emit DepositCapSet(token, cap);
    }

    // ------------------------------------------------------------------ users

    function deposit(address token, uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        uint256 before = IERC20(token).balanceOf(address(this));
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        uint256 received = IERC20(token).balanceOf(address(this)) - before;

        uint256 cap = depositCap[token];
        if (cap != 0 && totalDeposits[token] + received > cap) revert CapExceeded();

        totalDeposits[token] += received;
        balanceOf[msg.sender][token] += received;
        emit Deposit(msg.sender, token, received);
    }

    function withdraw(address token, uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        if (available(msg.sender, token) < amount) revert InsufficientAvailable();
        balanceOf[msg.sender][token] -= amount;
        totalDeposits[token] -= amount;
        IERC20(token).safeTransfer(msg.sender, amount);
        emit Withdraw(msg.sender, token, amount);
    }

    function available(address user, address token) public view returns (uint256) {
        return balanceOf[user][token] - lockedOf[user][token];
    }

    // --------------------------------------------------------------- auctions

    function lock(address user, address token, uint256 amount) external onlyAuction {
        if (available(user, token) < amount) revert InsufficientAvailable();
        lockedOf[user][token] += amount;
    }

    function unlock(address user, address token, uint256 amount) external onlyAuction {
        if (lockedOf[user][token] < amount) revert InsufficientLocked();
        lockedOf[user][token] -= amount;
    }

    /// @notice Move locked funds out of `from` into `to`'s free balance.
    function transferLocked(address from, address to, address token, uint256 amount) external onlyAuction {
        if (lockedOf[from][token] < amount) revert InsufficientLocked();
        lockedOf[from][token] -= amount;
        balanceOf[from][token] -= amount;
        balanceOf[to][token] += amount;
    }

    /// @notice Move free funds between internal balances (used by the auction's clearing account).
    function transfer(address from, address to, address token, uint256 amount) external onlyAuction {
        if (available(from, token) < amount) revert InsufficientAvailable();
        balanceOf[from][token] -= amount;
        balanceOf[to][token] += amount;
    }
}
