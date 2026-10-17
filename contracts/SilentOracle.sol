// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface ISilentOracle {
    /// @notice Raw quote units per 1e18 raw base units, i.e. quoteAmount = baseAmount * price / 1e18.
    ///         Must revert if the price is unusable (stale, non-positive, etc).
    function price() external view returns (uint256);
}

interface AggregatorV3Interface {
    function decimals() external view returns (uint8);
    function latestRoundData()
        external
        view
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound);
}

/// @title SilentOracle
/// @notice Chainlink-style adapter that turns a BASE/USD feed into a raw base->quote price,
///         assuming the quote token is a USD stablecoin. Reverts on stale or invalid data.
contract SilentOracle is ISilentOracle {
    AggregatorV3Interface public immutable feed;
    uint256 public immutable maxStaleness;
    uint8 public immutable baseDecimals;
    uint8 public immutable quoteDecimals;

    error StalePrice();
    error InvalidPrice();

    constructor(address feed_, uint256 maxStaleness_, uint8 baseDecimals_, uint8 quoteDecimals_) {
        feed = AggregatorV3Interface(feed_);
        maxStaleness = maxStaleness_;
        baseDecimals = baseDecimals_;
        quoteDecimals = quoteDecimals_;
    }

    function price() external view returns (uint256) {
        (, int256 answer,, uint256 updatedAt,) = feed.latestRoundData();
        if (answer <= 0) revert InvalidPrice();
        if (updatedAt == 0 || block.timestamp - updatedAt > maxStaleness) revert StalePrice();

        // price = answer * 10^quoteDec * 1e18 / (10^feedDec * 10^baseDec)
        return (uint256(answer) * 10 ** quoteDecimals * 1e18) / (10 ** (uint256(feed.decimals()) + baseDecimals));
    }
}
