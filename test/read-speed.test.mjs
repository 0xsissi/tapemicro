import test from 'node:test';import assert from 'node:assert/strict';
import {ReadRpcPool}from'../src/rpc-pool.mjs';
import {discoverOwnedNfts,walletMinerCache}from'../src/owned-miners.mjs';
import {CoalescedRead,readDeadline}from'../src/read-workflow.mjs';
import {setHTML,restoreWriteLocks,lockWrites}from'../src/dom-updates.mjs';
const rpc={jsonrpc:'2.0',id:7,method:'eth_blockNumber',params:[]};
const response=(body,chain='0x38',value='0x123')=>({ok:true,json:async()=>JSON.parse(body).map(x=>({jsonrpc:'2.0',id:x.id,result:x.method==='eth_chainId'?chain:value}))});
test('slow reads hedge to a second RPC and transaction submission is refused without sending',async()=>{
 const seen=[];const pool=new ReadRpcPool(['slow','fast'],56,{hedgeMs:10,timeoutMs:200,fetcher:async(url,options)=>{seen.push(url);await new Promise((resolve,reject)=>{const timer=setTimeout(resolve,url==='slow'?100:2);options.signal.addEventListener('abort',()=>{clearTimeout(timer);reject(Error('aborted'));},{once:true});});return response(options.body,'0x38',url);}});
 assert.equal((await pool.send([rpc]))[0].result,'fast');assert.deepEqual(seen,['slow','fast']);assert.ok(pool.nodes[0].cooldown>Date.now());const count=seen.length;await assert.rejects(pool.send({...rpc,method:'eth_sendRawTransaction'}),/refuses/);assert.equal(seen.length,count);
});
test('a wrong-chain or failing RPC cannot win and is quarantined on the next read',async()=>{
 const seen=[];const pool=new ReadRpcPool(['wrong','right'],56,{fetcher:async(url,o)=>{seen.push(url);return response(o.body,url==='wrong'?'0x1':'0x38');}});
 assert.equal((await pool.send([rpc]))[0].result,'0x123');assert.ok(pool.nodes[0].cooldown>Date.now());seen.length=0;assert.equal((await pool.send([rpc]))[0].result,'0x123');assert.deepEqual(seen,['right']);
});
test('browser fetch keeps its global receiver when called through the RPC pool',async()=>{
 const pool=new ReadRpcPool(['rpc'],56,{fetcher:async function(url,options){assert.equal(this,globalThis);return response(options.body);}});assert.equal((await pool.send([rpc]))[0].result,'0x123');
});
test('cached NFT zero is revalidated; equal balances with changed ownership trigger a scan',async()=>{
 const values=new Map(),storage={getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v)},cache=walletMinerCache(storage,56,'alice');cache.write('nft',['0']);let scans=0;
 const reader={balanceOf:async()=>1n,nextId:async()=>{scans++;return 8n;},ownersOf:async(c,ids)=>ids.map(id=>id===0n?'alice':'bob')};
 const warm=await discoverOwnedNfts({owner:'alice',collections:['nft'],reader,cache});assert.equal(scans,0);assert.deepEqual(warm.items,[{collection:'nft',id:0n}]);
 reader.ownersOf=async(c,ids)=>ids.map(id=>id===7n?'alice':'bob');const changed=await discoverOwnedNfts({owner:'alice',collections:['nft'],reader,cache});assert.equal(scans,1);assert.deepEqual(changed.items,[{collection:'nft',id:7n}]);assert.deepEqual(cache.read('nft'),['7']);assert.deepEqual(walletMinerCache(storage,1,'alice').read('nft'),[]);
});
test('NFT scans overlap batches, preserve global bounds and report explicit incomplete results',async()=>{
 let active=0,peak=0;const progress=[];const r=await discoverOwnedNfts({owner:'alice',collections:['a','b'],batchSize:2,concurrency:3,maxScan:11,onProgress:p=>progress.push(p),reader:{balanceOf:async()=>1n,nextId:async()=>100n,ownersOf:async(c,ids)=>{active++;peak=Math.max(peak,active);await new Promise(r=>setTimeout(r,2));active--;return ids.map(()=>null);}}});assert.ok(peak>1);assert.equal(r.scanned,11);assert.equal(r.complete,false);assert.ok(progress.every(p=>p.scanned<=11));
});
test('ordinary refreshes share one read and repeated fresh requests add exactly one follow-up',async()=>{
 const queue=new CoalescedRead();let release,calls=0;const first=queue.run(async()=>{calls++;await new Promise(r=>release=r);return'old';});await Promise.resolve();const joined=queue.run(()=>{throw Error('duplicate read');}),fresh=queue.run(async()=>{calls++;return'new';},{fresh:true}),same=queue.run(()=>{throw Error('extra fresh');},{fresh:true});release();assert.equal(await first,'old');assert.equal(await joined,'old');assert.equal(await fresh,'new');assert.equal(await same,'new');assert.equal(calls,2);
});
test('read cancellation and deadline finish explicitly; unchanged translated markup is retained',async()=>{
 const abort=new AbortController();const p=readDeadline(()=>new Promise(()=>{}),{signal:abort.signal});abort.abort();await assert.rejects(p,e=>e.code==='UI_CANCELLED');await assert.rejects(readDeadline(()=>new Promise(()=>{}),{timeoutMs:5}),e=>e.code==='READ_TIMEOUT');
 let writes=0,html='';const host={get innerHTML(){return html;},set innerHTML(value){writes++;html=value;}};assert.equal(setHTML(host,'<p>领取</p>'),true);html='<p>Claim</p>';assert.equal(setHTML(host,'<p>领取</p>'),false);assert.equal(writes,1);assert.equal(setHTML(host,'<p>已确认</p>'),true);
});
test('a confirmed transaction unlocks reused buttons while intrinsic unavailable buttons stay disabled',()=>{
 const buy={disabled:false},unavailable={disabled:true};lockWrites([buy,unavailable]);lockWrites([buy]);assert.equal(buy.disabled,true);restoreWriteLocks();assert.equal(buy.disabled,false);assert.equal(unavailable.disabled,true);lockWrites([buy]);restoreWriteLocks();assert.equal(buy.disabled,false);
});
