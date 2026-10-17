import test from 'node:test';
import assert from 'node:assert/strict';
import {mergeTradeHistory,logWindow} from '../src/trade-history.mjs';
test('history deduplicates an overlapping scan but retains multiple fills in one transaction',()=>{
 const a={hash:'tx',logIndex:1,blockNumber:10},b={hash:'tx',logIndex:2,blockNumber:10};assert.deepEqual(mergeTradeHistory([a],[a,b]),[b,a]);
});
test('history windows respect deployment block and never request a negative range',()=>{
 assert.deepEqual(logWindow(6000,2000),{fromBlock:2000,toBlock:6000});assert.deepEqual(logWindow(9000,2000),{fromBlock:4001,toBlock:9000});assert.equal(logWindow(1999,2000),null);assert.throws(()=>logWindow(-1,0));
});
