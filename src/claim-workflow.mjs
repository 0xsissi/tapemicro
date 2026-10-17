import {operationError} from './operation-errors.mjs';
import {chunks} from './market-plan.mjs';
export function createClaimQueue(ids,who,settled=false){return{who,groups:chunks([...new Set(ids.map(String))]).map(ids=>({ids,settled})),done:0,failed:[],pendingHash:null,paused:false};}
export function completeClaimGroup(q,ids){if(q?.groups[0]?.ids.join(',')!==ids.map(String).join(','))return false;q.groups.shift();q.done++;q.pendingHash=null;return true;}
// Only estimation/contract failures are isolated. Transport errors keep the queue intact.
export async function prepareClaimHead(q,prepare,errorName=()=>null){
 while(q.groups.length){const group=q.groups[0],ids=group.ids.map(BigInt);try{return{group,prepared:await prepare({kind:'claim',ids,settled:group.settled})};}catch(error){
  const name=errorName(error),kind=operationError(error,name).kind;
  if(name==='NothingToClaim'){q.groups.shift();continue;}
  if(!['gas','contract'].includes(kind))throw error;
  if(ids.length>1){const half=Math.ceil(ids.length/2);q.groups.splice(0,1,...chunks(group.ids,half).map(ids=>({ids,settled:group.settled})));continue;}
  q.failed=q.failed.filter(f=>f.id!==group.ids[0]);q.failed.push({id:group.ids[0],settled:group.settled,reason:operationError(error,name).message});q.groups.shift();
 }}return null;
}
