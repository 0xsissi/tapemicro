import test from 'node:test';
import assert from 'node:assert/strict';
import {discoverOwnedNfts} from '../src/owned-miners.mjs';
const owner='0x1111',other='0x2222';
test('wallet discovery includes token zero, pins ownership, and bounds batch size',async()=>{
 const batches=[];const reader={balanceOf:async()=>2n,nextId:async()=>6n,ownersOf:async(c,ids)=>{batches.push(ids);return ids.map(id=>[0n,4n].includes(id)?owner:other);}};
 const a=await discoverOwnedNfts({owner,collections:['nft'],reader,batchSize:2});assert.deepEqual(a.items.map(x=>x.id),[4n,0n]);assert.equal(a.complete,true);assert.ok(batches.every(b=>b.length<=2));
});
test('empty wallets trigger no owner scan and bounded incomplete scans are explicit',async()=>{
 let calls=0;const reader={balanceOf:async()=>0n,nextId:async()=>{throw Error('should not read');},ownersOf:async()=>{calls++;}};
 assert.equal((await discoverOwnedNfts({owner,collections:['nft'],reader})).items.length,0);assert.equal(calls,0);
 const partial=await discoverOwnedNfts({owner,collections:['nft'],reader:{balanceOf:async()=>1n,nextId:async()=>100n,ownersOf:async(c,ids)=>ids.map(()=>other)},maxScan:3,batchSize:2});assert.equal(partial.scanned,3);assert.equal(partial.complete,false);
});
test('cancelled wallet reads cannot publish stale results',async()=>{
 const controller=new AbortController();const reader={balanceOf:async()=>1n,nextId:async()=>5n,ownersOf:async(c,ids)=>{controller.abort();return ids.map(()=>owner);}};let progress=0;
 await assert.rejects(discoverOwnedNfts({owner,collections:['nft'],reader,signal:controller.signal,onProgress:()=>progress++}));assert.equal(progress,0);
});
