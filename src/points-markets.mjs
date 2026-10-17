import{getAddress}from'ethers';
// History is additive; orders and escrow always belong to the active market.
export function pointsMarkets(config){
 const rows=[{address:config.market,marketVersion:config.marketVersion??2,deploymentBlock:config.deploymentBlock??0,feeManager:config.feeManager},...(config.legacyMarkets??[])],seen=new Set();
 return rows.filter(row=>{const address=getAddress(row.address);if(seen.has(address))return false;seen.add(address);if(![2,3,4].includes(row.marketVersion)||!Number.isSafeInteger(row.deploymentBlock)||row.deploymentBlock<0)throw Error('历史市场配置无效');return true;});
}
