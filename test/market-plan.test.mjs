import test from 'node:test';
import assert from 'node:assert/strict';
import {planPurchase,points,dailyAtCurrentRate} from '../src/market-plan.mjs';
const row=(id,assetId,remaining,priceWei,balance=remaining,seller='0xaa')=>({id:BigInt(id),assetId:BigInt(assetId),remaining:BigInt(remaining),priceWei:BigInt(priceWei),balance:BigInt(balance),seller,tradable:true,approved:true,expiresAt:1000n});
test('matching sorts integer prices, shares seller inventory across orders and enforces 16 fills',()=>{
 const p=planPurchase([row(1,10,10,2,10),row(2,10,10,1,10),row(3,11,8,3)],15n,{now:1});assert.deepEqual(p.fills.map(f=>[f.id,f.amount]),[[2n,10n],[3n,5n]]);assert.equal(p.enough,true);const q=planPurchase(Array.from({length:17},(_,i)=>row(i+1,i+1,1,10)),17n);assert.equal(q.quantity,16n);assert.equal(q.limited,true);assert.equal(q.enough,false);
});
test('matching excludes own, invalid, expired, unapproved and empty positions',()=>{const rows=[row(1,1,10,1),{...row(2,2,10,1),tradable:false},{...row(3,3,10,1),approved:false},{...row(4,4,10,1),expiresAt:0n},row(5,5,10,1,0)];assert.equal(planPurchase(rows,1n,{address:'0xAA'}).quantity,0n);});

test('targeted purchases fill only the chosen listing, including after partial fills or invalidation',()=>{
 const rows=[row(1,10,20,1),row(2,20,8,5,6)];
 const chosen=planPurchase(rows,3n,{orderId:2n,now:1});assert.equal(chosen.enough,true);assert.deepEqual(chosen.fills.map(f=>[f.id,f.assetId,f.amount]),[[2n,20n,3n]]);assert.equal(chosen.gross,15n);
 const short=planPurchase(rows,7n,{orderId:2n,now:1});assert.equal(short.enough,false);assert.equal(short.quantity,6n);assert.equal(short.fills.length,1);
 for(const changed of[[],[rows[0]], [rows[0],{...rows[1],remaining:0n}], [rows[0],{...rows[1],approved:false}], [rows[0],{...rows[1],tradable:false}], [rows[0],{...rows[1],expiresAt:1n}]])assert.equal(planPurchase(changed,1n,{orderId:2n,now:1}).quantity,0n);
 assert.equal(planPurchase(rows,1n,{orderId:2n,address:'0xAA',now:1}).quantity,0n);
 assert.equal(planPurchase(rows,1n,{now:1}).fills[0].id,1n);
});
test('points use gross wei with approved 1000/BNB multiplier and estimates retain integer precision',()=>{assert.equal(points(10n**18n),'1,000');assert.equal(points(1234567890123456789n),'1,234.56789012');assert.equal(points(1n),'<0.00000001');assert.equal(dailyAtCurrentRate(100n,100n,1000n,100n),855360n);assert.equal(dailyAtCurrentRate(1n,100n,0n),null);});
