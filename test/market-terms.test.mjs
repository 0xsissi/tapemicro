import test from 'node:test';
import assert from 'node:assert/strict';
import {ZeroAddress} from 'ethers';
import {readMarketTerms,feeRecipientAddress} from '../src/market-terms.mjs';
const recipient='0x2222222222222222222222222222222222222222';
const market=(bps=100n,address=recipient,owner=recipient,pending=ZeroAddress)=>({FEE_BPS:async()=>bps,feeRecipient:async()=>address,initialFeeManager:async()=>recipient,owner:async()=>owner,pendingOwner:async()=>pending});
test('live integration pins immutable deployment identity and fixed 1% fee',async()=>{
 assert.deepEqual(await readMarketTerms(market(),recipient),{feeBps:100n,feeRecipient:recipient,initialFeeManager:recipient,feeManager:recipient,pendingOwner:ZeroAddress,renounced:false});
 await assert.rejects(readMarketTerms(market(),null));await assert.rejects(readMarketTerms(market(0n),recipient));
 await assert.rejects(readMarketTerms(market(),'0x3333333333333333333333333333333333333333'));assert.throws(()=>feeRecipientAddress('0x0000000000000000000000000000000000000000'));
});

test('live owner changes and renunciation do not invalidate deployment bindings or fee collection',async()=>{
 const next='0x3333333333333333333333333333333333333333';
 let terms=await readMarketTerms(market(100n,recipient,recipient,next),recipient);assert.equal(terms.pendingOwner,next);assert.equal(terms.feeManager,recipient);
 terms=await readMarketTerms(market(100n,recipient,next),recipient);assert.equal(terms.feeManager,next);assert.equal(terms.initialFeeManager,recipient);assert.equal(terms.renounced,false);
 terms=await readMarketTerms(market(100n,recipient,ZeroAddress),recipient);assert.equal(terms.feeManager,ZeroAddress);assert.equal(terms.renounced,true);assert.equal(terms.feeRecipient,recipient);
});

test('legitimate recipient changes are read live without pinning the old destination',async()=>{
 const changed='0x3333333333333333333333333333333333333333';const terms=await readMarketTerms(market(100n,changed),recipient);assert.equal(terms.feeRecipient,changed);assert.equal(terms.feeManager,recipient);
});
