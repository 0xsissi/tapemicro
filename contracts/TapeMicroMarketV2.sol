// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {TapeMicroMarket} from "./TapeMicroMarket.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/// @notice Two-sided market. Resting bids escrow their full BNB principal.
/// Ask takers pay +1%; bid takers receive principal less 1%. No vault changes.
contract TapeMicroMarketV2 is TapeMicroMarket {
    uint256 public constant MARKET_VERSION = 4;
    uint256 public constant MAX_BID_ASSETS = 32;
    uint8 public constant BID_KIND_SET = 0;
    uint8 public constant BID_KIND_ASSET = 1;
    /// Empty assetIds: the bid accepts shares of any miner that is tradable at fill time.
    uint8 public constant BID_KIND_ANY = 2;
    struct Bid { address bidder; uint128 remaining; uint128 priceWei; uint64 expiresAt; uint8 kind; }
    struct BidFill { uint256 bidId; uint256 assetId; uint256 amount; uint256 expectedPrice; }
    mapping(uint256 => Bid) public bids;
    mapping(uint256 => mapping(uint256 => bool)) public bidAccepts;
    uint256 public nextBidId = 1;
    uint256 public totalBidEscrow;

    event BidCreated(uint256 indexed bidId, address indexed bidder, uint8 kind, uint256[] assetIds, uint256 amount, uint256 priceWei, uint256 expiresAt);
    event BidFilled(uint256 indexed bidId, address indexed seller, address indexed bidder, uint256 assetId, uint256 amount, uint256 priceWei, uint256 fee);
    event BidClosed(uint256 indexed bidId, address indexed bidder, uint256 refundedWei, bool expired);
    error InvalidBid();
    error InvalidBidAssets();
    error NotBidder();
    error AssetNotAccepted();
    error NetBelowMinimum();

    constructor(address vault_, address payable feeRecipient_) TapeMicroMarket(vault_, feeRecipient_) {}

    // Keep ownership mutation under the same lock during BNB/token callbacks.
    function transferOwnership(address next) public override nonReentrant { super.transferOwnership(next); }
    function acceptOwnership() public override nonReentrant { super.acceptOwnership(); }
    function renounceOwnership() public override nonReentrant { super.renounceOwnership(); }

    function quoteSale(uint256 amount, uint256 priceWei) public pure returns (uint256 gross, uint256 fee, uint256 net) {
        if (amount == 0 || amount > type(uint128).max || priceWei == 0 || priceWei > type(uint128).max) revert InvalidAmount();
        gross = amount * priceWei;
        fee = Math.mulDiv(gross, FEE_BPS, BPS_DENOMINATOR);
        net = gross - fee;
    }

    function createBid(uint256[] calldata assetIds, uint256 amount, uint256 priceWei, uint64 expiresAt) external payable nonReentrant returns (uint256 bidId) {
        (uint256 gross,,) = quoteSale(amount, priceWei);
        if (expiresAt <= block.timestamp || expiresAt > block.timestamp + 30 days) revert Expired();
        if (assetIds.length > MAX_BID_ASSETS) revert InvalidBidAssets();
        if (msg.value != gross) revert WrongPayment();
        for (uint256 i; i < assetIds.length; ++i) {
            if (i != 0 && assetIds[i] <= assetIds[i-1]) revert InvalidBidAssets();
            if (!vault.isTradable(assetIds[i])) revert UntradableAsset();
        }
        bidId = nextBidId++;
        uint8 kind = assetIds.length == 0 ? BID_KIND_ANY : assetIds.length == 1 ? BID_KIND_ASSET : BID_KIND_SET;
        bids[bidId] = Bid(msg.sender, uint128(amount), uint128(priceWei), expiresAt, kind);
        for (uint256 i; i < assetIds.length; ++i) bidAccepts[bidId][assetIds[i]] = true;
        totalBidEscrow += gross;
        emit BidCreated(bidId, msg.sender, kind, assetIds, amount, priceWei, expiresAt);
    }

    function cancelBid(uint256 bidId) external nonReentrant {
        Bid storage bid = bids[bidId];
        if (bid.bidder != msg.sender) revert NotBidder();
        _closeBid(bidId, false);
    }

    function expireBid(uint256 bidId) external nonReentrant {
        Bid storage bid = bids[bidId];
        if (bid.bidder == address(0) || bid.remaining == 0 || bid.expiresAt > block.timestamp) revert InvalidBid();
        _closeBid(bidId, true);
    }

    function _closeBid(uint256 bidId, bool expired) private {
        Bid storage bid = bids[bidId];
        if (bid.remaining == 0) revert InvalidBid();
        uint256 refund = uint256(bid.remaining) * bid.priceWei;
        bid.remaining = 0;
        totalBidEscrow -= refund;
        _payOrCredit(bid.bidder, refund, false);
        emit BidClosed(bidId, bid.bidder, refund, expired);
    }

    function sellBatch(BidFill[] calldata fills, uint256 minNetTotal, uint256 deadline) external nonReentrant {
        if (block.timestamp > deadline) revert Expired();
        if (fills.length == 0 || fills.length > MAX_BATCH) revert InvalidAmount();
        uint256 netTotal;
        for (uint256 i; i < fills.length; ++i) netTotal += _sell(fills[i]);
        if (netTotal < minNetTotal) revert NetBelowMinimum();
        _payOrCredit(msg.sender, netTotal, true);
        // Includes changes caused by any token or BNB callback, even to an ID
        // that was processed earlier in this batch.
        for (uint256 i; i < fills.length; ++i) if (!vault.isTradable(fills[i].assetId)) revert UntradableAsset();
    }

    function _sell(BidFill calldata fill) private returns (uint256 net) {
        Bid storage bid = bids[fill.bidId];
        if (bid.bidder == address(0) || bid.bidder == msg.sender || fill.amount == 0 || fill.amount > bid.remaining) revert InvalidBid();
        if (bid.expiresAt <= block.timestamp) revert Expired();
        if (fill.expectedPrice != bid.priceWei) revert StalePrice();
        if (bid.kind != BID_KIND_ANY && !bidAccepts[fill.bidId][fill.assetId]) revert AssetNotAccepted();
        if (!vault.isTradable(fill.assetId)) revert UntradableAsset();
        if (vault.balanceOf(msg.sender, fill.assetId) < fill.amount) revert InsufficientBalance();
        if (!vault.isApprovedForAll(msg.sender, address(this))) revert MissingApproval();
        (uint256 gross, uint256 fee, uint256 payout) = quoteSale(fill.amount, bid.priceWei);
        bid.remaining -= uint128(fill.amount);
        totalBidEscrow -= gross;
        accruedFees += fee;
        totalFeesAccrued += fee;
        tradePoints[msg.sender] += gross;
        tradePoints[bid.bidder] += gross;
        soldVolumeWei[msg.sender] += gross;
        boughtVolumeWei[bid.bidder] += gross;
        soldH[msg.sender] += fill.amount;
        boughtH[bid.bidder] += fill.amount;
        totalSoldH += fill.amount;
        totalVolumeWei += gross;
        vault.safeTransferFrom(msg.sender, bid.bidder, fill.assetId, fill.amount, "");
        emit BidFilled(fill.bidId, msg.sender, bid.bidder, fill.assetId, fill.amount, bid.priceWei, fee);
        return payout;
    }

    function _payOrCredit(address recipient, uint256 amount, bool sale) private {
        (bool paid,) = payable(recipient).call{value:amount, gas:AUTO_PAYOUT_GAS}("");
        if (paid) { if (sale) emit SellerPaid(recipient, amount); }
        else { proceeds[recipient] += amount; totalProceeds += amount; emit ProceedsDeferred(recipient, amount); }
    }
}
