// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {ERC1155} from "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {IPodMining} from "./interfaces/IPodMining.sol";
import {TapeMicroCustody} from "./TapeMicroCustody.sol";

/// @notice One ERC1155 ID per NFT, fixed admitted H, separate actual BEM.
/// No owner, upgrade, discretionary mint, global coverage gate or miner cap.
contract TapeMicroVault is ERC1155, ReentrancyGuard {
    using SafeERC20 for IERC20;
    uint256 public constant PROTOCOL_VERSION = 2;
    uint256 public constant ACC = 1e27;
    uint256 public constant MAX_POSITION_H = 1e24;
    uint256 public constant MAX_BATCH = 32;
    uint256 public constant MAX_PAGE = 100;
    string public constant name = "TapeMicro";
    string public constant symbol = "MICRO";
    IPodMining public immutable mining;
    IERC20 public immutable bem;
    address public immutable tapeout;
    address public immutable behemoth;
    address public immutable custodyImplementation;
    struct Position { address collection; uint256 tokenId; address custody; uint128 hashrate; bool active; }
    mapping(uint256 => Position) public positions;
    mapping(uint256 => uint256) private _supply;
    uint256[] private _positionIds;
    mapping(uint256 => bool) private _known;
    mapping(address => uint256[]) private _accountIds;
    mapping(address => mapping(uint256 => bool)) private _seen;
    mapping(uint256 => uint256) public accBemPerH;
    mapping(uint256 => mapping(address => uint256)) public userIndex;
    mapping(uint256 => mapping(address => uint256)) public earned;
    mapping(uint256 => mapping(address => uint256)) public fractionalReward;
    mapping(uint256 => uint256) public bemReceived;
    mapping(uint256 => uint256) public bemPaid;
    mapping(uint256 => uint256) public unallocatedBem;
    uint256 public minerCount;
    uint256 public totalH;
    uint256 public totalBemReceived;
    uint256 public totalBemPaid;
    uint256 public accountedBem;
    event Deposited(address indexed user, uint256 indexed id, address indexed collection, uint256 tokenId, uint256 hashrate, address custody);
    event Redeemed(address indexed user, uint256 indexed id, address indexed recipient, uint256 hashrate);
    event RewardsSynced(uint256 indexed id, uint256 received, uint256 index);
    event BemClaimed(address indexed user, address indexed recipient, uint256 amount);
    error InvalidAddress(); error InvalidAsset(); error IneligibleMiner(); error AdmissionCheckFailed();
    error NotOwner(); error AlreadyDeposited(); error InvalidReceiver(); error InvalidAmount();
    error Slippage(); error NothingToClaim(); error BalanceMismatch();
    constructor(address mining_, address bem_, address tapeout_, address behemoth_) ERC1155("") {
        if (mining_.code.length == 0 || bem_.code.length == 0 || tapeout_.code.length == 0 || behemoth_.code.length == 0 || tapeout_ == behemoth_) revert InvalidAddress();
        if (IPodMining(mining_).token() != bem_) revert InvalidAsset();
        mining = IPodMining(mining_); bem = IERC20(bem_); tapeout = tapeout_; behemoth = behemoth_;
        custodyImplementation = address(new TapeMicroCustody(address(this), mining_, bem_));
    }
    function minerKey(address collection, uint256 tokenId) public pure returns (bytes32) { return keccak256(abi.encodePacked(collection, tokenId)); }
    function assetId(address collection, uint256 tokenId) public pure returns (uint256) { return uint256(minerKey(collection, tokenId)); }
    function totalSupply(uint256 id) external view returns (uint256) { return _supply[id]; }
    function positionCount() external view returns (uint256) { return _positionIds.length; }
    function accountAssetCount(address user) external view returns (uint256) { return _accountIds[user].length; }
    function positionIds(uint256 offset, uint256 limit) external view returns (uint256[] memory) { return _page(_positionIds, offset, limit); }
    /// @notice Keeps IDs after selling/redeeming all units, for historical BEM.
    function accountAssetIds(address user, uint256 offset, uint256 limit) external view returns (uint256[] memory) { return _page(_accountIds[user], offset, limit); }
    function _page(uint256[] storage ids, uint256 offset, uint256 limit) private view returns (uint256[] memory out) {
        if (limit == 0 || limit > MAX_PAGE) revert InvalidAmount();
        uint256 n = offset < ids.length ? Math.min(limit, ids.length - offset) : 0;
        out = new uint256[](n); for (uint256 i; i < n; ++i) out[i] = ids[offset + i];
    }
    function previewDeposit(address collection, uint256 tokenId) public view returns (uint256) { return _admissible(collection, tokenId).verifWeight; }
    function _ordinaryMiner(address collection, uint256 tokenId) private view returns (IPodMining.Miner memory m) {
        if (collection != tapeout && collection != behemoth) revert InvalidAsset();
        m = mining.getMiner(minerKey(collection, tokenId));
        if (m.circuits != collection || uint256(m.circuitId) != tokenId || m.status != 1 || m.taskId == 0 || m.optimal || m.bonus != 0 || m.verifWeight == 0 || m.unverWeight != 0 || uint256(m.bstar) * m.mult != m.verifWeight) revert IneligibleMiner();
    }
    function _admissible(address collection, uint256 tokenId) private view returns (IPodMining.Miner memory m) {
        m = _ordinaryMiner(collection, tokenId);
        uint256 budget = mining.maxRunGas();
        try mining.passesCounterexamples{gas:budget + 100_000}(collection, tokenId, m.taskId, m.gateCount, budget) returns (bool ok) {
            if (!ok) revert AdmissionCheckFailed();
        } catch { revert AdmissionCheckFailed(); }
    }
    function deposit(address collection, uint256 tokenId, uint256 expectedH) external nonReentrant {
        uint256 id = assetId(collection, tokenId);
        if (positions[id].active || _supply[id] != 0) revert AlreadyDeposited();
        IPodMining.Miner memory admitted = _admissible(collection, tokenId);
        uint256 h = admitted.verifWeight;
        if (expectedH == 0 || h != expectedH || h > MAX_POSITION_H) revert Slippage();
        if (IERC721(collection).ownerOf(tokenId) != msg.sender) revert NotOwner();
        mining.claim(bytes32(id)); // Before custody changes: original owner's BEM.
        address custody = Clones.clone(custodyImplementation);
        TapeMicroCustody(custody).initialize(collection, tokenId, msg.sender);
        IERC721(collection).safeTransferFrom(msg.sender, custody, tokenId);
        // Recheck state after external calls, without running the expensive
        // counterexample evaluation a second time in the same transaction.
        IPodMining.Miner memory current = _ordinaryMiner(collection, tokenId);
        if (IERC721(collection).ownerOf(tokenId) != custody || current.verifWeight != h || current.taskId != admitted.taskId || current.gateCount != admitted.gateCount) revert IneligibleMiner();
        positions[id] = Position(collection, tokenId, custody, uint128(h), true);
        if (!_known[id]) { _known[id] = true; _positionIds.push(id); }
        ++minerCount;
        // Index and personal rewards survive a complete redemption/redeposit.
        _mint(msg.sender, id, h, "");
        emit Deposited(msg.sender, id, collection, tokenId, h, custody);
    }
    /// @notice Later extra rewards never mint units or require a new asset type.
    function isTradable(uint256 id) external view returns (bool) {
        Position memory p = positions[id]; if (!p.active || _supply[id] != p.hashrate) return false;
        try mining.getMiner(bytes32(id)) returns (IPodMining.Miner memory m) {
            if (m.status != 1 || m.taskId == 0 || m.unverWeight != 0 || m.circuits != p.collection || uint256(m.circuitId) != p.tokenId || uint256(m.bstar) * m.mult != p.hashrate || m.verifWeight < p.hashrate || (uint256(m.bstar) + m.bonus) * m.mult != m.verifWeight) return false;
            try IERC721(p.collection).ownerOf(p.tokenId) returns (address owner) { return owner == p.custody; } catch { return false; }
        } catch { return false; }
    }
    /// @notice All units of THIS id redeem its NFT, including an inactive NFT.
    function redeem(uint256 id, address recipient, uint256 expectedH) external nonReentrant {
        Position memory p = positions[id];
        if (recipient == address(0) || recipient == address(this) || recipient == p.custody) revert InvalidReceiver();
        if (!p.active || expectedH == 0 || p.hashrate != expectedH || _supply[id] != expectedH) revert Slippage();
        _burn(msg.sender, id, expectedH); positions[id].active = false; --minerCount;
        TapeMicroCustody(p.custody).release(recipient); emit Redeemed(msg.sender, id, recipient, expectedH);
    }
    function syncRewards(uint256[] calldata ids) external nonReentrant {
        _checkBatch(ids.length); for (uint256 i; i < ids.length; ++i) _sync(ids[i]);
    }
    /// @notice Simulate with eth_call to read both actual funded BEM and whether
    /// the upstream harvest succeeded. An on-chain call only synchronizes BEM.
    function previewBem(uint256 id, address user) external nonReentrant returns (uint256 amount, bool harvested) {
        harvested = _sync(id); amount = pendingBem(id, user);
    }
    function _sync(uint256 id) private returns (bool harvested) {
        Position memory p = positions[id]; if (!p.active) return true;
        uint256 beforeBalance = bem.balanceOf(address(this));
        harvested = TapeMicroCustody(p.custody).collect();
        uint256 afterBalance = bem.balanceOf(address(this));
        if (afterBalance < beforeBalance) revert BalanceMismatch();
        uint256 received = afterBalance - beforeBalance; if (received == 0) return harvested;
        accountedBem += received; totalBemReceived += received; bemReceived[id] += received;
        if (_supply[id] == 0) unallocatedBem[id] += received;
        else accBemPerH[id] += Math.mulDiv(received, ACC, _supply[id]);
        emit RewardsSynced(id, received, accBemPerH[id]);
    }
    function _delta(uint256 id, address user) private view returns (uint256 whole, uint256 fraction) {
        uint256 change = accBemPerH[id] - userIndex[id][user];
        uint256 balance = balanceOf(user, id);
        whole = Math.mulDiv(balance, change, ACC);
        fraction = mulmod(balance, change, ACC) + fractionalReward[id][user];
        whole += fraction / ACC; fraction %= ACC;
    }
    function pendingBem(uint256 id, address user) public view returns (uint256) {
        if (user == address(0)) return 0;
        (uint256 delta,) = _delta(id, user); return earned[id][user] + delta;
    }
    function _settle(uint256 id, address user) private {
        if (user == address(0)) return;
        (uint256 delta, uint256 fraction) = _delta(id, user);
        earned[id][user] += delta; fractionalReward[id][user] = fraction; userIndex[id][user] = accBemPerH[id];
    }
    function claimBem(uint256[] calldata ids, address recipient) external nonReentrant returns (uint256) { return _claim(ids, recipient, true); }
    /// @notice Funded rewards can be withdrawn without calling a broken upstream.
    function claimSettledBem(uint256[] calldata ids, address recipient) external nonReentrant returns (uint256) { return _claim(ids, recipient, false); }
    function _claim(uint256[] calldata ids, address recipient, bool harvest) private returns (uint256 amount) {
        if (recipient == address(0) || recipient == address(this)) revert InvalidReceiver();
        _checkBatch(ids.length);
        for (uint256 i; i < ids.length; ++i) {
            uint256 id = ids[i]; if (harvest) _sync(id); _settle(id, msg.sender);
            uint256 due = earned[id][msg.sender]; earned[id][msg.sender] = 0; bemPaid[id] += due; amount += due;
        }
        if (amount == 0) revert NothingToClaim();
        accountedBem -= amount; totalBemPaid += amount; bem.safeTransfer(recipient, amount);
        if (bem.balanceOf(address(this)) < accountedBem) revert BalanceMismatch();
        emit BemClaimed(msg.sender, recipient, amount);
    }
    function _checkBatch(uint256 n) private pure { if (n == 0 || n > MAX_BATCH) revert InvalidAmount(); }
    function _touch(address user, uint256 id) private {
        if (user != address(0) && !_seen[user][id]) { _seen[user][id] = true; _accountIds[user].push(id); }
    }
    function safeTransferFrom(address from, address to, uint256 id, uint256 value, bytes memory data) public override nonReentrant {
        if (to == address(this)) revert InvalidReceiver(); super.safeTransferFrom(from, to, id, value, data);
    }
    function safeBatchTransferFrom(address from, address to, uint256[] memory ids, uint256[] memory values, bytes memory data) public override nonReentrant {
        if (to == address(this)) revert InvalidReceiver(); super.safeBatchTransferFrom(from, to, ids, values, data);
    }
    function _update(address from, address to, uint256[] memory ids, uint256[] memory values) internal override {
        _checkBatch(ids.length); if (ids.length != values.length) revert InvalidAmount();
        for (uint256 i; i < ids.length; ++i) {
            if (!_known[ids[i]]) revert InvalidAsset();
            _sync(ids[i]); _settle(ids[i], from); if (from != to) _settle(ids[i], to);
            if (values[i] != 0) { _touch(from, ids[i]); _touch(to, ids[i]); }
        }
        super._update(from, to, ids, values);
        for (uint256 i; i < ids.length; ++i) {
            if (from == address(0)) { _supply[ids[i]] += values[i]; totalH += values[i]; }
            if (to == address(0)) { _supply[ids[i]] -= values[i]; totalH -= values[i]; }
        }
    }
    function uri(uint256 id) public view override returns (string memory) {
        if (!_known[id]) revert InvalidAsset();
        return string.concat("data:application/json;base64,", Base64.encode(bytes(string.concat('{"name":"TapeMicro #', Strings.toString(id), '","description":"Fixed admitted base-H units of one custodial miner. BEM output varies. Different IDs have separate backing and rewards."}'))));
    }
}
