// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {ERC1155Holder} from "@openzeppelin/contracts/token/ERC1155/utils/ERC1155Holder.sol";
import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import {IPodMining} from "../interfaces/IPodMining.sol";

contract MockBem is ERC20 {
    constructor() ERC20("Mock BEM (local tests only)","mBEM") {}
    function decimals() public pure override returns(uint8){return 8;}
    function mint(address to,uint256 amount) external {_mint(to,amount);}
}
contract MockMinerNFT is ERC721 {
    constructor(string memory n) ERC721(n,"mNFT") {}
    function mint(address to,uint256 id) external {_mint(to,id);}
}
contract MockMining is IPodMining {
    address public immutable override token;
    mapping(bytes32=>Miner) private _miners;
    mapping(bytes32=>bool) public badCounterexample;
    bool public override paused;
    uint256 public rewardPerH=100;
    uint256 public acc;
    uint256 public last=block.timestamp;
    uint256 public payoutBps=10_000;
    mapping(bytes32=>bool) public failClaim;
    mapping(bytes32=>bool) public exhaustClaimGas;
    mapping(bytes32=>uint256) public claimCalls;
    uint256 public override maxRunGas = 12_000_000;
    mapping(uint32=>uint256) public counterexampleCount;
    bool public burnCounterexampleGas;
    constructor(address token_){token=token_;}
    function key(address c,uint256 id) public pure returns(bytes32){return keccak256(abi.encodePacked(c,id));}
    function _checkpoint() internal {acc+=(block.timestamp-last)*rewardPerH;last=block.timestamp;}
    function register(address c,uint256 id,uint128 h,bool optimal,bool verified,uint32 mult) external {
        _checkpoint();Miner storage m=_miners[key(c,id)];m.circuits=c;m.circuitId=uint64(id);m.taskId=verified?1:0;m.gateCount=uint32(h);m.status=1;m.bstar=uint64(h/mult);m.mult=mult;m.optimal=optimal;m.bonus=optimal?1:0;m.verifWeight=verified?h:0;m.unverWeight=verified?0:h;m.debt=h*acc;
    }
    function getMiner(bytes32 k) external view override returns(Miner memory){return _miners[k];}
    function pending(bytes32 k) public view override returns(uint256){Miner memory m=_miners[k];if(m.status!=1)return 0;uint256 owed=(uint256(m.verifWeight)+m.unverWeight)*(acc+(block.timestamp-last)*rewardPerH);return owed>m.debt?owed-m.debt:0;}
    function claim(bytes32 k) public override {require(!paused&&!failClaim[k],"claim unavailable");if(exhaustClaimGas[k]){assembly{invalid()}}++claimCalls[k];_checkpoint();Miner storage m=_miners[k];require(m.status==1,"inactive");uint256 due=pending(k);m.debt=(uint256(m.verifWeight)+m.unverWeight)*acc;if(due>0)MockBem(token).mint(IERC721(m.circuits).ownerOf(m.circuitId),due*payoutBps/10_000);}
    function claimMany(bytes32[] calldata keys) external override {require(!paused,"paused");for(uint256 i;i<keys.length;++i)if(_miners[keys[i]].status==1)claim(keys[i]);}
    function passesCounterexamples(address c,uint256 id,uint32 taskId,uint32 gateCount,uint256 budget) external view override returns(bool){
        uint256 cost=(50_000+uint256(gateCount)*3_000)*counterexampleCount[taskId];
        if(cost>budget)return false;
        if(burnCounterexampleGas){uint256 start=gasleft();while(start-gasleft()<cost){assembly{pop(keccak256(0,0))}}}
        return !badCounterexample[key(c,id)];
    }
    function setCounterexamples(uint32 taskId,uint256 count,bool burnGas) external {counterexampleCount[taskId]=count;burnCounterexampleGas=burnGas;}
    function setMaxRunGas(uint256 budget) external {maxRunGas=budget;}
    function setBad(bytes32 k,bool b) external {badCounterexample[k]=b;}
    function promote(bytes32 k,uint64 bonus) external {claim(k);Miner storage m=_miners[k];m.optimal=true;m.bonus=bonus;m.verifWeight=uint128((uint256(m.bstar)+bonus)*m.mult);m.debt=uint256(m.verifWeight)*acc;}
    function demote(bytes32 k) external {claim(k);Miner storage m=_miners[k];m.optimal=false;m.bonus=0;m.verifWeight=uint128(uint256(m.bstar)*m.mult);m.debt=uint256(m.verifWeight)*acc;}
    function setFailClaim(bytes32 k,bool value) external {failClaim[k]=value;}
    function setExhaustClaimGas(bytes32 k,bool value) external {exhaustClaimGas[k]=value;}
    function setPayoutBps(uint256 value) external {require(value<=10_000);payoutBps=value;}
    function setState(bytes32 k,uint8 status) external {if(_miners[k].status==1)claim(k);_miners[k].status=status;if(status!=1){_miners[k].verifWeight=0;_miners[k].unverWeight=0;}}
    function setPaused(bool p) external {paused=p;}
    /// @dev Test-only cheap mutation to exercise post-native-callback checks.
    function setStatusWithoutClaim(bytes32 k,uint8 status) external {_miners[k].status=status;}
    function setRate(uint256 r) external {_checkpoint();rewardPerH=r;}
}
interface ITestVault {
    function claimSettledBem(uint256[] calldata ids,address recipient) external returns(uint256);
    function deposit(address c,uint256 id,uint256 h) external;
}
contract ReentryReceiver is ERC1155Holder,IERC721Receiver {
    address public vault;
    bool public reentryBlocked;
    bool public rejectTokens;
    constructor(address v){vault=v;}
    function setReject(bool b) external {rejectTokens=b;}
    function deposit(address c,uint256 id,uint256 h) external {IERC721(c).approve(vault,id);ITestVault(vault).deposit(c,id,h);}
    function onERC1155Received(address,address,uint256 id,uint256,bytes memory) public override returns(bytes4){
        require(!rejectTokens,"reject");uint256[] memory ids=new uint256[](1);ids[0]=id;try ITestVault(vault).claimSettledBem(ids,address(this)){reentryBlocked=false;}catch{reentryBlocked=true;}return this.onERC1155Received.selector;
    }
    function onERC721Received(address,address,uint256,bytes calldata) external pure returns(bytes4){return IERC721Receiver.onERC721Received.selector;}
}

/// @dev Test-only seller exercising bounded payout, rejection and reentrancy.
contract SellerHarness is ERC1155Holder {
    address public immutable owner=msg.sender;
    uint256 public mode;
    address public target;
    bytes public attack;
    bool public reentryBlocked;
    function configure(uint256 mode_,address target_,bytes calldata attack_) external {require(msg.sender==owner);mode=mode_;target=target_;attack=attack_;}
    function exec(address to,bytes calldata data) external payable returns(bytes memory) {require(msg.sender==owner);(bool ok,bytes memory result)=to.call{value:msg.value}(data);require(ok,"exec failed");return result;}
    receive() external payable {
        if(mode==1)revert("no BNB");
        if(mode==2){assembly{invalid()}}
        if(mode==3){(bool ok,)=target.call(attack);reentryBlocked=!ok;}
    }
}

/// @dev Local-only token-bound fee receiver. Not an implementation of the
/// official DeWEB container; official BSC compatibility is checked on a fork.
contract MockFeeContainer {
    IERC721 public immutable host;
    uint256 public immutable hostId;
    bool public rejectPayments;
    address public attackTarget;
    bytes public attackData;
    bool public reentryBlocked;
    constructor(address host_, uint256 id_) { host = IERC721(host_); hostId = id_; }
    function owner() public view returns (address) { return host.ownerOf(hostId); }
    function setReject(bool reject_) external { require(msg.sender == owner()); rejectPayments = reject_; }
    function setAttack(address target, bytes calldata data) external { require(msg.sender == owner()); attackTarget = target; attackData = data; }
    function withdraw(address payable recipient, uint256 amount) external {
        require(msg.sender == owner(), "not host owner");
        (bool ok,) = recipient.call{value:amount}(""); require(ok);
    }
    receive() external payable {
        require(!rejectPayments, "reject");
        if (attackTarget != address(0)) {
            (bool ok,) = attackTarget.call(attackData); reentryBlocked = !ok;
        }
    }
}
