// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {TapeMicroVault} from "./TapeMicroVault.sol";

/// @notice Non-custodial, partial-fill BNB order book. Buyers pay an additional
/// fixed 1%; sellers receive their full listed price. No upgrade or fee setter.
/// The owner can change ONLY the project-fee recipient, transfer this limited
/// authority in two steps, or renounce it permanently.
/// ERC1155 transfers outside this market do not pay this market's fee.
contract TapeMicroMarket is ReentrancyGuard, Ownable2Step {
    uint256 public constant PROTOCOL_VERSION = 2;
    TapeMicroVault public immutable vault;
    address payable public feeRecipient;
    /// @notice Immutable deployment identity; never used as an access grant.
    address public immutable initialFeeManager;
    uint256 public constant FEE_BPS = 100;
    uint256 public constant BPS_DENOMINATOR = 10_000;
    uint256 public constant MAX_BATCH = 16;
    uint256 public constant AUTO_PAYOUT_GAS = 50_000;
    uint256 public nextListingId = 1;
    struct Listing { address seller; uint256 assetId; uint128 remaining; uint128 priceWei; uint64 expiresAt; }
    struct Fill { uint256 id; uint256 amount; uint256 expectedPrice; }
    mapping(uint256 => Listing) public listings;
    mapping(address => mapping(uint256 => uint256)) public reserved;
    mapping(address => uint256) public proceeds;
    uint256 public totalProceeds;
    uint256 public accruedFees;
    uint256 public totalFeesAccrued;
    uint256 public totalFeesReleased;
    /// @notice Points use gross BNB volume in wei, excluding fees and gas.
    /// Both sides accrue exact raw units; display conversion is done separately.
    mapping(address => uint256) public tradePoints;
    mapping(address => uint256) public boughtVolumeWei;
    mapping(address => uint256) public soldVolumeWei;
    mapping(address => uint256) public boughtH;
    mapping(address => uint256) public soldH;
    uint256 public totalVolumeWei;
    uint256 public totalSoldH;

    event Listed(uint256 indexed id, address indexed seller, uint256 assetId, uint256 amount, uint256 priceWei, uint256 expiresAt);
    event Cancelled(uint256 indexed id, address indexed seller, uint256 remaining);
    event Filled(uint256 indexed id, address indexed seller, address indexed buyer, uint256 assetId, uint256 amount, uint256 priceWei);
    event SellerPaid(address indexed seller, uint256 amount);
    event ProceedsDeferred(address indexed seller, uint256 amount);
    event ProceedsWithdrawn(address indexed seller, address indexed recipient, uint256 amount);
    event FeeAccrued(uint256 indexed id, address indexed buyer, uint256 amount);
    event FeesWithdrawn(address indexed caller, address indexed recipient, uint256 amount);
    event FeeRecipientChanged(address indexed previousRecipient, address indexed newRecipient);

    error InvalidListing();
    error InvalidAmount();
    error NotSeller();
    error Expired();
    error StalePrice();
    error WrongPayment();
    error InsufficientBalance();
    error MissingApproval();
    error UntradableAsset();
    error InvalidRecipient();
    error PaymentFailed();

    constructor(address vault_, address payable feeRecipient_) Ownable(msg.sender) {
        if (vault_.code.length == 0 || feeRecipient_ == address(0) || feeRecipient_ == address(this) || feeRecipient_ == vault_) revert InvalidRecipient();
        if (TapeMicroVault(vault_).PROTOCOL_VERSION() != PROTOCOL_VERSION) revert InvalidRecipient();
        vault = TapeMicroVault(vault_);
        feeRecipient = feeRecipient_;
        initialFeeManager = msg.sender;
    }

    /// @notice Compatibility getter: the CURRENT owner, zero after renouncing.
    function feeManager() external view returns (address) { return owner(); }

    /// @notice Only changes the destination of project fees, including fees not
    /// yet withdrawn. Cannot change the rate, seller proceeds, NFT or BEM rights.
    function setFeeRecipient(address payable recipient) external onlyOwner nonReentrant {
        if (recipient == address(0) || recipient == address(this) || recipient == address(vault) || recipient == feeRecipient) revert InvalidRecipient();
        address previous = feeRecipient; feeRecipient = recipient;
        emit FeeRecipientChanged(previous, recipient);
    }

    /// @notice Rounded down per fill, just like buy/buyBatch. No fee is taken
    /// from the purchased H or from seller proceeds. Network gas is separate.
    function quotePayment(uint256 amount, uint256 priceWei) public pure returns (uint256 gross, uint256 fee, uint256 total) {
        if (amount == 0 || amount > type(uint128).max || priceWei == 0 || priceWei > type(uint128).max) revert InvalidAmount();
        gross = amount * priceWei;
        fee = Math.mulDiv(gross, FEE_BPS, BPS_DENOMINATOR);
        total = gross + fee;
    }

    function createListing(uint256 assetId, uint256 amount, uint256 priceWei, uint64 expiresAt) external nonReentrant returns (uint256 id) {
        if (amount == 0 || amount > type(uint128).max || priceWei == 0 || priceWei > type(uint128).max) revert InvalidAmount();
        if (expiresAt <= block.timestamp || expiresAt > block.timestamp + 30 days) revert Expired();
        if (!vault.isTradable(assetId)) revert UntradableAsset();
        if (vault.balanceOf(msg.sender, assetId) < reserved[msg.sender][assetId] + amount) revert InsufficientBalance();
        if (!vault.isApprovedForAll(msg.sender, address(this))) revert MissingApproval();
        id = nextListingId++;
        listings[id] = Listing(msg.sender, assetId, uint128(amount), uint128(priceWei), expiresAt);
        reserved[msg.sender][assetId] += amount;
        emit Listed(id, msg.sender, assetId, amount, priceWei, expiresAt);
    }

    function cancelListing(uint256 id) external nonReentrant {
        Listing storage order = listings[id];
        if (order.seller != msg.sender) revert NotSeller();
        uint256 amount = order.remaining;
        if (amount == 0) revert InvalidListing();
        order.remaining = 0;
        reserved[msg.sender][order.assetId] -= amount;
        emit Cancelled(id, msg.sender, amount);
    }

    /// @notice Anyone may clean an expired listing; funds remain with its owner.
    function expireListing(uint256 id) external nonReentrant {
        Listing storage order = listings[id];
        if (order.remaining == 0 || order.expiresAt > block.timestamp) revert InvalidListing();
        uint256 amount = order.remaining;
        order.remaining = 0;
        reserved[order.seller][order.assetId] -= amount;
        emit Cancelled(id, order.seller, amount);
    }

    function buy(uint256 id, uint256 amount, uint256 expectedPrice, uint256 deadline) external payable nonReentrant {
        if (block.timestamp > deadline) revert Expired();
        uint256 cost = _fill(id, amount, expectedPrice);
        if (msg.value != cost) revert WrongPayment();
    }

    function buyBatch(Fill[] calldata fills, uint256 maxTotal, uint256 deadline) external payable nonReentrant {
        if (block.timestamp > deadline) revert Expired();
        if (fills.length == 0 || fills.length > MAX_BATCH) revert InvalidAmount();
        uint256 total;
        for (uint256 i; i < fills.length; ++i) total += _fill(fills[i].id, fills[i].amount, fills[i].expectedPrice);
        if (total > maxTotal || msg.value != total) revert WrongPayment();
    }

    function _fill(uint256 id, uint256 amount, uint256 expectedPrice) internal returns (uint256 cost) {
        Listing storage order = listings[id];
        if (order.seller == address(0) || order.seller == msg.sender || amount == 0 || amount > order.remaining) revert InvalidListing();
        if (block.timestamp >= order.expiresAt) revert Expired();
        if (expectedPrice != order.priceWei) revert StalePrice();
        if (!vault.isTradable(order.assetId)) revert UntradableAsset();
        if (vault.balanceOf(order.seller, order.assetId) < amount) revert InsufficientBalance();
        if (!vault.isApprovedForAll(order.seller, address(this))) revert MissingApproval();
        (uint256 gross, uint256 fee, uint256 total) = quotePayment(amount, order.priceWei);
        cost = total;
        order.remaining -= uint128(amount);
        reserved[order.seller][order.assetId] -= amount;
        accruedFees += fee;
        totalFeesAccrued += fee;
        tradePoints[order.seller] += gross;
        tradePoints[msg.sender] += gross;
        soldVolumeWei[order.seller] += gross;
        boughtVolumeWei[msg.sender] += gross;
        soldH[order.seller] += amount;
        boughtH[msg.sender] += amount;
        totalSoldH += amount;
        totalVolumeWei += gross;
        vault.safeTransferFrom(order.seller, msg.sender, order.assetId, amount, "");
        // Limit gas so a refusing/gas-burning seller falls back to pull payment.
        (bool paid,) = payable(order.seller).call{value:gross, gas:AUTO_PAYOUT_GAS}("");
        if (paid) emit SellerPaid(order.seller, gross);
        else { proceeds[order.seller] += gross; totalProceeds += gross; emit ProceedsDeferred(order.seller, gross); }
        if (!vault.isTradable(order.assetId)) revert UntradableAsset();
        emit Filled(id, order.seller, msg.sender, order.assetId, amount, order.priceWei);
        emit FeeAccrued(id, msg.sender, fee);
    }

    function withdrawProceeds(address payable recipient) external nonReentrant {
        if (recipient == address(0) || recipient == address(this)) revert InvalidRecipient();
        uint256 amount = proceeds[msg.sender];
        if (amount == 0) revert InvalidAmount();
        proceeds[msg.sender] = 0;
        totalProceeds -= amount;
        (bool ok,) = recipient.call{value: amount}("");
        if (!ok) revert PaymentFailed();
        emit ProceedsWithdrawn(msg.sender, recipient, amount);
    }

    /// @notice Anyone may pay gas to collect project fees, but cannot choose
    /// the destination or touch seller proceeds. A rejecting recipient rolls
    /// back only this withdrawal; purchases and seller withdrawals stay usable.
    function withdrawFees() external nonReentrant {
        uint256 amount = accruedFees;
        if (amount == 0) revert InvalidAmount();
        accruedFees = 0;
        totalFeesReleased += amount;
        address payable recipient = feeRecipient;
        (bool ok,) = recipient.call{value: amount}("");
        if (!ok) revert PaymentFailed();
        emit FeesWithdrawn(msg.sender, recipient, amount);
    }
}
