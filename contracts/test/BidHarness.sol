// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {ERC1155Holder} from "@openzeppelin/contracts/token/ERC1155/utils/ERC1155Holder.sol";

/// @dev Test-only recipient with independent token and native callbacks.
contract BidHarness is ERC1155Holder {
    address public immutable operator = msg.sender;
    uint256 public tokenMode;
    uint256 public nativeMode;
    address public target;
    bytes public attack;
    bool public reentryBlocked;
    function configure(uint256 tokenMode_, uint256 nativeMode_, address target_, bytes calldata attack_) external {
        require(msg.sender == operator); tokenMode=tokenMode_;nativeMode=nativeMode_;target=target_;attack=attack_;
    }
    function exec(address to, bytes calldata data) external payable returns(bytes memory) {
        require(msg.sender == operator);(bool ok,bytes memory result)=to.call{value:msg.value}(data);require(ok,"exec failed");return result;
    }
    function onERC1155Received(address,address,uint256,uint256,bytes memory) public override returns(bytes4) {
        require(tokenMode != 1,"reject Micro");
        if(tokenMode == 2){(bool ok,)=target.call(attack);reentryBlocked=!ok;}
        return this.onERC1155Received.selector;
    }
    receive() external payable {
        if(nativeMode == 1)revert("reject BNB");
        if(nativeMode == 2){assembly{invalid()}}
        if(nativeMode == 3){(bool ok,)=target.call(attack);reentryBlocked=!ok;}
    }
}
