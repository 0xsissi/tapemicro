import {getAddress,isHexString} from 'ethers';

// Derive the scan start from a successful CREATE receipt, never from a guessed
// block or the current head. This also supports resuming the operator tool.
export function marketDeploymentBlock(receipt,market,expectedHash){
 if(!isHexString(expectedHash,32))throw Error('请填写市场部署交易哈希');
 if(!receipt||receipt.status!==1)throw Error('市场部署交易尚未成功确认');
 if(!receipt.hash||receipt.hash.toLowerCase()!==expectedHash.toLowerCase())throw Error('部署回执的交易哈希不匹配');
 if(!receipt.contractAddress||getAddress(receipt.contractAddress)!==getAddress(market))throw Error('该部署交易创建的不是当前市场合约');
 if(!Number.isSafeInteger(receipt.blockNumber)||receipt.blockNumber<=0)throw Error('部署回执区块无效');
 return receipt.blockNumber;
}
