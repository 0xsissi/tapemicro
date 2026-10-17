import {Contract} from 'ethers';
import {isReadFailure} from './operation-errors.mjs';
export const MULTICALL3='0xcA11bde05977b3631167028862bE2a173976CA11';
const multicallAvailability=new WeakMap();
export async function boundedMap(items,fn,size=8){const out=[];for(let i=0;i<items.length;i+=size)out.push(...await Promise.all(items.slice(i,i+size).map(fn)));return out;}
export async function batchRead(provider,calls,{blockTag,multicall=MULTICALL3,batchSize=120,signal}={}){
 if(!calls.length)return[];
 const options=blockTag===undefined?{}:{blockTag};let checks=multicallAvailability.get(provider);if(!checks){checks=new Map();multicallAvailability.set(provider,checks);}let check=checks.get(multicall);
 if(!check){check=provider.getCode(multicall).then(code=>code!=='0x').catch(error=>{checks.delete(multicall);throw error;});checks.set(multicall,check);}let usable=await check;
 const out=[];
 for(let offset=0;offset<calls.length;offset+=batchSize){if(signal?.aborted)throw Error('钱包读取已取消');const batch=calls.slice(offset,offset+batchSize);let results;
  if(usable)try{const mc=new Contract(multicall,['function aggregate3(tuple(address target,bool allowFailure,bytes callData)[] calls) payable returns(tuple(bool success,bytes returnData)[] returnData)'],provider);const rows=await mc.aggregate3.staticCall(batch.map(c=>[c.contract.target,true,c.contract.interface.encodeFunctionData(c.method,c.args??[])]),{...options,gasLimit:15_000_000});results=rows.map((r,i)=>{if(!r.success)return undefined;try{const d=batch[i].contract.interface.decodeFunctionResult(batch[i].method,r.returnData);return d.length===1?d[0]:d;}catch{return undefined;}});}catch(error){if(isReadFailure(error))throw error;usable=false;}
  if(!results)results=await boundedMap(batch,async c=>{try{return await c.contract[c.method].staticCall(...(c.args??[]),options);}catch(e){if(isReadFailure(e))throw e;return undefined;}});
  for(let i=0;i<batch.length;i++)if(results[i]===undefined&&!batch[i].optional)throw Error('链上读取暂不可用：'+batch[i].method);
  out.push(...results);
 }
 return out;
}
export async function accountIds(vault,user,{blockTag,signal,onProgress=()=>{},limit=Infinity,count:knownCount}={}){
 const opts=blockTag===undefined?{}:{blockTag},count=knownCount??await vault.accountAssetCount(user,opts),out=[];
 for(let offset=0n;offset<count&&out.length<limit;offset+=100n){if(signal?.aborted)throw Error('钱包读取已取消');const page=await vault.accountAssetIds(user,offset,100,opts);out.push(...page);onProgress(out.length,count);}
 return{ids:out.slice(0,limit),complete:BigInt(out.slice(0,limit).length)>=count,count};
}
