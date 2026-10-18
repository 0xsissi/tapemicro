// One total for the header, rewards page and its asset rows. `pending` includes
// a successful upstream harvest preview; `funded` alone does not.
export function rewardSummary(assets=[]){
 return assets.reduce((sum,asset)=>{
  const funded=BigInt(asset.funded??0n),pending=BigInt(asset.pending??funded);
  sum.pending+=pending;sum.funded+=funded;
  if(!asset.fresh&&(BigInt(asset.balance??0n)>0n||pending>0n))sum.fresh=false;
  return sum;
 },{pending:0n,funded:0n,fresh:true});
}
