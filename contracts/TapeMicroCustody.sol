// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import {IPodMining} from "./interfaces/IPodMining.sol";

/// @notice Fixed-function custody for ONE NFT. Clones have independent balances.
contract TapeMicroCustody is IERC721Receiver {
    using SafeERC20 for IERC20;
    address public immutable vault;
    IPodMining public immutable mining;
    IERC20 public immutable bem;
    address public collection;
    uint256 public tokenId;
    bytes32 public key;
    address private _depositor;
    bool private _initialized;
    bool private _received;
    uint256 public constant HARVEST_GAS_LIMIT = 1_000_000;
    event HarvestSkipped(bytes32 indexed key);
    error Unauthorized(); error InvalidReceipt(); error InsufficientHarvestGas();
    modifier onlyVault() { if (msg.sender != vault) revert Unauthorized(); _; }
    constructor(address vault_, address mining_, address bem_) {
        vault = vault_; mining = IPodMining(mining_); bem = IERC20(bem_);
        _initialized = true; // Disable initialization of the implementation.
    }
    function initialize(address collection_, uint256 id_, address depositor_) external onlyVault {
        if (_initialized) revert InvalidReceipt();
        _initialized = true; collection = collection_; tokenId = id_;
        key = keccak256(abi.encodePacked(collection_, id_)); _depositor = depositor_;
    }
    /// @dev Includes rewards received BEFORE this call via external claims or
    /// state changes. Never use only the immediate claim's balance difference.
    /// @return harvested False means upstream rewards remain attached to the
    /// NFT and follow its units (or its recipient after full redemption).
    /// Already received BEM is always swept before balances change. Only the
    /// upstream claim is optional: BEM accounting/transfer failures still revert.
    function collect() external onlyVault returns (bool harvested) {
        // Do not let a caller deliberately underfund a healthy harvest and move
        // its past rewards to the next holder. Also prevents gas estimation from
        // treating an underfunded, skipped claim as the cheapest successful path.
        if (gasleft() < HARVEST_GAS_LIMIT + 100_000) revert InsufficientHarvestGas();
        // Bound a reverting/gas-burning upstream so the local settlement retains
        // gas. Anyone may still claim upstream directly to this custody account.
        harvested = _harvest();
        if (!harvested) emit HarvestSkipped(key);
        uint256 amount = bem.balanceOf(address(this));
        if (amount != 0) bem.safeTransfer(vault, amount);
    }
    function _harvest() private returns (bool) {
        try mining.paused() returns (bool stopped) { if (stopped) return false; } catch { return false; }
        try mining.getMiner(key) returns (IPodMining.Miner memory m) { if (m.status != 1) return true; } catch { return false; }
        try mining.claim{gas:HARVEST_GAS_LIMIT}(key) { return true; } catch { return false; }
    }
    function release(address recipient) external onlyVault {
        IERC721(collection).safeTransferFrom(address(this), recipient, tokenId);
    }
    function onERC721Received(address operator, address from, uint256 id, bytes calldata) external returns (bytes4) {
        if (_received || msg.sender != collection || operator != vault || from != _depositor || id != tokenId) revert InvalidReceipt();
        _received = true; _depositor = address(0);
        return IERC721Receiver.onERC721Received.selector;
    }
}
