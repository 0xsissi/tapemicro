import{getAddress}from'ethers';
export function selectSiteConfig(base,{legacyMarket=null}={}){
 if(!legacyMarket)return{...base};let address;try{address=getAddress(legacyMarket);}catch{throw Error('历史市场地址无效');}
 const row=(base.legacyMarkets??[]).find(m=>getAddress(m.address)===address);if(!row)throw Error('该地址不在历史市场清单中');
 return{...base,market:row.address,marketVersion:row.marketVersion,feeManager:row.feeManager,deploymentBlock:row.deploymentBlock,legacyReadOnly:true,legacyMarkets:[{address:base.market,marketVersion:base.marketVersion,feeManager:base.feeManager,deploymentBlock:base.deploymentBlock},...(base.legacyMarkets??[]).filter(m=>getAddress(m.address)!==address)]};
}
