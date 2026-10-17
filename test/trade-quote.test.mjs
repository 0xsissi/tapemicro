import test from 'node:test';
import assert from 'node:assert/strict';
import {quoteFills,parseBnbPrice,MARKET_FEE_BPS} from '../src/trade-quote.mjs';

test('100 fixed-H units quote an additional 1% BNB fee without reducing received H',()=>{
 assert.deepEqual(quoteFills([{amount:100n,priceWei:parseBnbPrice('0.001')}],MARKET_FEE_BPS),{quantity:100n,gross:100000000000000000n,fee:1000000000000000n,total:101000000000000000n});
});
test('batch rounding is per fill and default quotes use the fixed market fee',()=>{
 const fills=[{amount:1n,priceWei:99n},{amount:1n,priceWei:99n}];assert.equal(quoteFills(fills).fee,0n);assert.equal(quoteFills([{amount:100n,priceWei:100n}]).fee,100n);assert.equal(quoteFills([],100n).total,0n);
});
test('quote inputs preserve wei precision and reject malformed amounts, prices and fees',()=>{
 assert.equal(parseBnbPrice('0.000000000000000001'),1n);assert.equal(parseBnbPrice('123456789.123456789123456789'),123456789123456789123456789n);
 for(const value of ['-1','0','1e3','0.0000000000000000001','abc'])assert.throws(()=>parseBnbPrice(value));
 assert.throws(()=>quoteFills([{amount:0n,priceWei:1n}],100n));assert.throws(()=>quoteFills([{amount:1n,priceWei:1n}],10001n));
});
