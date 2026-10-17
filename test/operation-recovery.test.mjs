import test from 'node:test';
import assert from 'node:assert/strict';
import {operationError} from '../src/operation-errors.mjs';
import {ReadRecovery} from '../src/read-recovery.mjs';
import {TransactionJournal,transactionScope,isPending,waitForTransaction} from '../src/transaction-journal.mjs';
import {createClaimQueue,prepareClaimHead,completeClaimGroup} from '../src/claim-workflow.mjs';
const hash='0x'+'11'.repeat(32),other='0x'+'22'.repeat(32);
const memory=()=>{const map=new Map();return{getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,v)};};
test('pending transaction survives reload, remains scoped, and cannot be overwritten by a second journal record',()=>{
 const storage=memory(),config={chainId:56,vault:'0xAb',market:'0xCD'},key=transactionScope(config,'0xEF'),first=new TransactionJournal(storage,key);
 first.put({hash,status:'pending',nonce:7,action:{kind:'claim',ids:['1']}});
 const reloaded=new TransactionJournal(storage,key);assert.equal(reloaded.read().filter(isPending).length,1);assert.equal(new TransactionJournal(storage,transactionScope(config,'0x00')).read().length,0);
 reloaded.put({hash,status:'confirmed'});assert.equal(reloaded.read().length,1);assert.equal(reloaded.read().filter(isPending).length,0);assert.equal(reloaded.read()[0].nonce,7);
 reloaded.put({hash,status:'pending'});assert.equal(reloaded.read()[0].status,'confirmed','a late polling response must not roll back confirmation');
});
test('storage disabled retains transaction in memory and reports persistence limit',()=>{const journal=new TransactionJournal({getItem:()=>null,setItem:()=>{throw Error('quota');}},'test');journal.put({hash,status:'pending'});assert.equal(journal.durable,false);assert.equal(journal.read()[0].hash,hash);journal.put({hash,status:'failed'});assert.equal(journal.read()[0].status,'failed');});
test('broadcast callback fires before waiting; timeout keeps submitted hash and never resends',async()=>{
 const events=[];const sent={hash,nonce:1,from:'alice',to:'vault',data:'0x1234',value:0n,wait:async()=>{events.push('wait');throw Object.assign(Error('timeout'),{code:'TIMEOUT'});}};
 await assert.rejects(waitForTransaction(sent,{onSubmitted:t=>{events.push('submitted');assert.equal(t.hash,hash);assert.equal(t.data,'0x1234');}}),e=>e.code==='TX_PENDING'&&e.submittedHash===hash);assert.deepEqual(events,['submitted','wait']);
});
test('speed-up receipt succeeds, cancellation does not report success, reverted receipt fails',async()=>{
 const receipt={hash:other,status:1},sent={hash,wait:async()=>{throw{code:'TRANSACTION_REPLACED',receipt,replacement:{hash:other},cancelled:false};}};
 let replacement;assert.equal(await waitForTransaction(sent,{onReplaced:t=>replacement=t}),receipt);assert.equal(replacement.replacementHash,other);
 await assert.rejects(waitForTransaction({...sent,wait:async()=>{throw{code:'TRANSACTION_REPLACED',receipt,cancelled:true};}}),e=>e.code==='TX_CANCELLED');
 await assert.rejects(waitForTransaction({hash,wait:async()=>({status:0})}),e=>e.code==='TX_REVERTED');
});
test('wallet cancellation, funds, network, stale order and mined revert have distinct messages',()=>{
 assert.equal(operationError({code:4001}).kind,'cancelled');assert.equal(operationError({code:'INSUFFICIENT_FUNDS'}).kind,'funds');assert.equal(operationError({code:'TIMEOUT'}).kind,'network');assert.equal(operationError({},'InvalidListing').kind,'market');assert.equal(operationError({receipt:{status:0}},'InvalidListing').kind,'reverted');
 assert.equal(operationError({code:'CALL_EXCEPTION',info:{error:{message:'rate limit',code:429}}}).kind,'network');
});
test('concurrent failed reads share one node switch; contract failures do not rotate',async()=>{
 let current='primary',switches=0,calls=0;const states=[];const recovery=new ReadRecovery({current:()=>current,attempts:2,onState:s=>states.push(s),rotate:async()=>{switches++;current='backup';return true;}});
 const read=()=>recovery.run(async()=>{calls++;if(current==='primary')throw{code:'NETWORK_ERROR'};return'fresh';});assert.deepEqual(await Promise.all([read(),read()]),['fresh','fresh']);assert.equal(switches,1);assert.equal(calls,4);assert.ok(states.includes('recovered'));
 await assert.rejects(recovery.run(async()=>{throw{code:'CALL_EXCEPTION'};}));assert.equal(switches,1);
});
test('bad miner is isolated in preflight, healthy groups finish and queue can be serialized and resumed',async()=>{
 const q=createClaimQueue([1n,2n,3n,4n],'wallet'),seen=[];const prepare=async a=>{if(a.ids.includes(2n))throw Object.assign(Error('claim reverted'),{code:'CALL_EXCEPTION'});seen.push(a.ids);return{action:a};};
 let head;while(head=await prepareClaimHead(q,prepare)){assert.ok(!head.group.ids.includes('2'));completeClaimGroup(q,head.group.ids);}
 assert.equal(q.failed.length,1);assert.equal(q.failed[0].id,'2');assert.equal(q.groups.length,0);assert.deepEqual(seen.flat(),[1n,3n,4n]);
 const restored=JSON.parse(JSON.stringify(q));assert.equal(restored.failed[0].id,'2');assert.equal(completeClaimGroup(restored,['1']),false);
});
test('node outage does not mark miners bad or discard queue; gas splits and zero rewards skip safely',async()=>{
 const q=createClaimQueue([1n,2n],'wallet');await assert.rejects(prepareClaimHead(q,async()=>{throw{code:'TIMEOUT'};}));assert.equal(q.groups.length,1);assert.equal(q.failed.length,0);
 const head=await prepareClaimHead(q,async a=>{if(a.ids.length>1)throw{code:'GAS_BUDGET'};if(a.ids[0]===1n)throw{revert:{name:'NothingToClaim'}};return a;},e=>e.revert?.name);assert.deepEqual(head.group.ids,['2']);assert.equal(q.failed.length,0);
});
