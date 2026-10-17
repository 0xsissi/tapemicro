import {getAddress,ZeroAddress} from 'ethers';
import {MARKET_FEE_BPS} from './trade-quote.mjs';

export function feeRecipientAddress(value){
 const address=getAddress(value);
 if(address===ZeroAddress)throw Error('手续费收款地址不能为零地址');
 return address;
}

export async function readMarketTerms(market,expectedManager){
 // Config pins the immutable deployment identity, not the mutable owner.
 if(!expectedManager)throw Error('请先配置初始管理钱包');
 const expected=feeRecipientAddress(expectedManager);
 const [feeBps,recipient,initial,owner,pending]=await Promise.all([market.FEE_BPS(),market.feeRecipient(),market.initialFeeManager(),market.owner(),market.pendingOwner()]);
 if(feeBps!==MARKET_FEE_BPS)throw Error('市场合约费率与本版本不匹配');
 if(feeRecipientAddress(initial)!==expected)throw Error('初始管理钱包与配置不匹配');
 const feeManager=getAddress(owner),pendingOwner=getAddress(pending);
 return{feeBps,feeRecipient:feeRecipientAddress(recipient),initialFeeManager:expected,feeManager,pendingOwner,renounced:feeManager===ZeroAddress};
}
