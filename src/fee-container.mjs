import {Contract} from 'ethers';
import {feeRecipientAddress} from './market-terms.mjs';

// Official TapeKit MainnetAddresses.sol; rechecked by BSC local fork tests.
export const BSC_CONTAINER_OPENER='0x021745DE2f42A7839d96f2d3634d0294487D81F1';
export const BSC_PROCESSOR_FACTORY='0x68224F668083c29e9800Be2a646d42d18cedF7e2';
export const containerAbi=['function token() view returns(uint256 chainId,address tokenContract,uint256 tokenId)','function owner() view returns(address)'];

// Read-only simulation: no BNB is sent. Identity alone does not prove that a
// fixed recipient accepts the empty-calldata native transfer used by the market.
export async function verifyFeeReceipt(provider,recipient,from){
 const address=feeRecipientAddress(recipient),sender=feeRecipientAddress(from);
 try{await provider.call({from:sender,to:address,value:1n,data:'0x'});}catch{throw Error('收款容器未通过 BNB 接收模拟，请核对地址和接收规则');}
 return{address,simulatedWei:'1',readOnly:true};
}

export async function inspectFeeContainer(provider,recipient,{expectedOwner=null}={}){
 const address=feeRecipientAddress(recipient);
 if(await provider.getCode(address)==='0x')throw Error('收款地址不是已开通的容器合约');
 const account=new Contract(address,containerAbi,provider),[token,owner]=await Promise.all([account.token(),account.owner()]);
 if(token.chainId!==56n)throw Error('容器必须绑定 BSC 上的电路');
 const opener=new Contract(BSC_CONTAINER_OPENER,['function accountOf(address,uint256) view returns(address)','function isOpened(address,uint256) view returns(bool)'],provider);
 const factory=new Contract(BSC_PROCESSOR_FACTORY,['function isCPU(address) view returns(bool)'],provider);
 const nft=new Contract(token.tokenContract,['function ownerOf(uint256) view returns(address)'],provider);
 const [derived,opened,official,nftOwner]=await Promise.all([opener.accountOf(token.tokenContract,token.tokenId),opener.isOpened(token.tokenContract,token.tokenId),factory.isCPU(token.tokenContract),nft.ownerOf(token.tokenId)]);
 if(!opened||!official||feeRecipientAddress(derived)!==address)throw Error('地址不是官方已开通的电路容器');
 if(feeRecipientAddress(owner)!==feeRecipientAddress(nftOwner))throw Error('容器所有者与电路持有人不一致');
 if(expectedOwner&&feeRecipientAddress(expectedOwner)!==feeRecipientAddress(owner))throw Error('当前钱包不是容器所绑定电路的持有人');
 return{address,chainId:56,collection:token.tokenContract,tokenId:token.tokenId.toString(),owner};
}
