import test from 'node:test';import assert from 'node:assert/strict';
import {planSale,quoteSales,lowestAskForAssets,hasCrossedQuotes,assertUnlistedSale} from '../src/bid-plan.mjs';
const asset=(id,balance)=>({id:BigInt(id),balance:BigInt(balance),tradable:true});
test('sale submission checks aggregate unlisted inventory across multiple fills of the same miner',()=>{
 const fills=[{assetId:1n,amount:2n},{assetId:1n,amount:1n}];
 assert.doesNotThrow(()=>assertUnlistedSale(fills,[{...asset(1,5),reserved:2n}]));
 assert.throws(()=>assertUnlistedSale(fills,[{...asset(1,5),reserved:3n}]),/先撤单/);
 assert.throws(()=>assertUnlistedSale(fills,[]));
 assert.throws(()=>assertUnlistedSale(fills,[{...asset(1,5),tradable:false}]));
});
const bid=(id,ids,remaining,price)=>({id:BigInt(id),assetIds:ids.map(BigInt),remaining:BigInt(remaining),priceWei:BigInt(price),expiresAt:100n,bidder:'buyer',valid:true,receivable:true});
test('sale matcher preserves scarce inventory across overlapping accepted sets while filling best prices first',()=>{
 const p=planSale([bid(1,[1,2],5,1000),bid(2,[1],5,900)],[asset(1,5),asset(2,5)],10n,{now:1,address:'seller'});assert.equal(p.enough,true);assert.equal(p.quantity,10n);assert.equal(p.gross,9500n);assert.equal(p.net,9405n);assert.equal(p.fills.find(f=>f.bidId===1n).assetId,2n);
 const small=planSale([bid(1,[1,2],5,1000),bid(2,[1],5,900)],[asset(1,5),asset(2,5)],6n,{now:1});assert.equal(small.gross,5900n);
});
test('sale matcher rejects own, expired, inactive or rejected bids and never oversells a wallet or bid',()=>{
 const rows=[bid(1,[1,2],6,100),bid(2,[1],6,90),{...bid(3,[1],9,1000),bidder:'me'},{...bid(4,[2],9,2000),receivable:false},{...bid(5,[1],9,3000),valid:false},{...bid(6,[1],9,4000),expiresAt:0n}];
 const p=planSale(rows,[asset(1,4),asset(2,3),{...asset(3,100),tradable:false}],99n,{address:'me',now:1});assert.equal(p.quantity,7n);assert.equal(p.enough,false);assert.equal(p.gross,690n);for(const id of [1n,2n])assert.ok(p.fills.filter(f=>f.assetId===id).reduce((n,f)=>n+f.amount,0n)<=(id===1n?4n:3n));
});
test('sale quotes round fees per fill, keep wei precision, enforce the 16-fill budget and zero-input behavior',()=>{
 assert.deepEqual(quoteSales([{amount:1n,priceWei:99n},{amount:1n,priceWei:99n}]),{quantity:2n,gross:198n,fee:0n,net:198n});
 const rows=Array.from({length:17},(_,i)=>bid(i+1,[1],1,100+i)),p=planSale(rows,[asset(1,30)],17n,{now:1});assert.equal(p.fills.length,16);assert.equal(p.quantity,16n);assert.equal(p.limited,true);assert.equal(p.enough,false);
 assert.equal(planSale(rows,[asset(1,30)],0n).quantity,0n);assert.throws(()=>planSale([],[],-1n));
});
const ask=(assetId,price)=>({assetId:BigInt(assetId),priceWei:BigInt(price),tradable:true,approved:true,balance:10n,remaining:10n,expiresAt:100n,seller:'seller'});
test('bid crossing guard compares only executable asks in the selected acceptance set',()=>{
 const asks=[ask(1,800),ask(2,1000),ask(3,1200)];
 assert.equal(lowestAskForAssets(asks,[2n,3n],{now:1}),1000n);
 assert.equal(900n>=lowestAskForAssets(asks,[2n,3n],{now:1}),false);
 assert.equal(900n>=lowestAskForAssets(asks,[1n],{now:1}),true);
 assert.equal(lowestAskForAssets(asks,[4n],{now:1}),null);
 assert.equal(lowestAskForAssets([{...ask(1,1),approved:false},{...ask(2,1),balance:0n},{...ask(3,1),expiresAt:1n}],[1n,2n,3n],{now:1}),null);
});
test('book crossing requires compatible assets, equality counts, and closed/rejected/self quotes do not',()=>{
 const asks=[ask(1,800),ask(2,1000)];
 assert.equal(hasCrossedQuotes(asks,[bid(1,[2],10,900)],{now:1}),false);
 assert.equal(hasCrossedQuotes(asks,[bid(1,[2],10,1000)],{now:1}),true);
 assert.equal(hasCrossedQuotes(asks,[bid(1,[1,2],10,900)],{now:1}),true);
 assert.equal(hasCrossedQuotes(asks,[{...bid(1,[1],10,900),expiresAt:1n},{...bid(2,[1],10,900),receivable:false},{...bid(3,[1],10,900),bidder:'seller'},{...bid(4,[1],0,900)}],{now:1}),false);
});
test('immediate sale preserves listed inventory even when it could receive a higher price',()=>{
 const p=planSale([bid(1,[1],5,1000),bid(2,[2],5,900)],[{...asset(1,5),reserved:5n},asset(2,5)],5n,{now:1});
 assert.equal(p.enough,true);assert.equal(p.gross,4500n);assert.equal(p.reservedQuantity,0n);assert.deepEqual(p.fills.map(f=>f.assetId),[2n]);
});
test('immediate sale cannot consume listed shares even when the requested quantity exceeds free stock',()=>{
 const assets=[{...asset(1,10),reserved:8n}],orders=[bid(1,[1],2,1000),bid(2,[1],4,900)];
 const free=planSale(orders,assets,2n,{now:1});assert.equal(free.reservedQuantity,0n);
 const mixed=planSale(orders,assets,6n,{now:1});assert.equal(mixed.quantity,2n);assert.equal(mixed.enough,false);assert.equal(mixed.reservedQuantity,0n);assert.equal(mixed.gross,2000n);
 const overReserved=planSale([bid(1,[1],5,1000)],[{...asset(1,5),reserved:8n}],5n,{now:1});assert.equal(overReserved.quantity,0n);assert.equal(overReserved.reservedQuantity,0n);
});
test('free-stock priority still reassigns overlapping acceptance sets instead of unnecessarily consuming reserves',()=>{
 const assets=[{...asset(1,7),reserved:2n},asset(2,5)],orders=[bid(1,[1,2],5,1000),bid(2,[1],5,900)];
 const p=planSale(orders,assets,10n,{now:1});assert.equal(p.enough,true);assert.equal(p.reservedQuantity,0n);assert.equal(p.gross,9500n);assert.equal(p.fills.find(f=>f.bidId===1n).assetId,2n);
 const partial=planSale([bid(1,[1],7,1000),bid(2,[2],5,900)],assets,12n,{now:1});assert.equal(partial.quantity,10n);assert.equal(partial.enough,false);assert.equal(partial.reservedQuantity,0n);assert.equal(partial.gross,9500n);
});
