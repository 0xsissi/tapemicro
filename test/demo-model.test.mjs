import test from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../src/simple-demo-model.mjs';
import {planPurchase,chunks,points} from '../src/market-plan.mjs';
const now=100000,s=()=>M.createDemoState(now),id=M.demoId;
const whole=s=>Object.values(s.accounts).reduce((n,a)=>n+Object.values(a.balances).reduce((x,y)=>x+y,0n),0n);
const cash=s=>Object.values(s.accounts).reduce((n,a)=>n+a.bnb+a.proceeds,0n)+s.platformFees;
test('variable original H and NFT zero issue exactly matching, distinct ERC1155 IDs',()=>{
 const a=s(),before=whole(a);let issued=0n;for(const[k,n,h]of [['tapeout',1n,60n],['tapeout',2n,100n],['behemoth',3n,1260n],['tapeout',0n,1n]]){M.approveMiner(a,k,n);M.splitMiner(a,k,n,h,now);issued+=h;assert.equal(M.user(a).balances[id(k,n)],h);}assert.equal(whole(a)-before,issued);assert.equal(M.account(a).micro,68n+issued);assert.notEqual(id('tapeout',1n),id('behemoth',1n));assert.throws(()=>M.splitMiner(a,'tapeout',1n,60n,now));
});
test('initial optimal, unverified and revoked positions cannot enter or trade',()=>{
 const a=s();for(const[k,n]of [['behemoth',4n],['tapeout',5n]]){assert.equal(M.inspect(a,k,n).eligible,false);assert.throws(()=>M.approveMiner(a,k,n));}const p=planPurchase(M.orders(a),100n,{address:M.DEMO_USER,now});assert.equal(p.fills.length,3);assert.ok(p.fills.every(f=>f.assetId!==id('tapeout',1783n)));assert.throws(()=>M.buyBatch(a,[{id:4n,amount:1n,priceWei:5n*10n**14n}],now));
});
test('100H across three originals conserves assets and cash; 1% fee and gross-wei points',()=>{
 const a=s(),initial=whole(a),bnb=cash(a),before=M.account(a).pending,plan=planPurchase(M.orders(a),100n,{address:M.DEMO_USER,now});M.buyBatch(a,plan.fills,now);assert.equal(whole(a),initial);assert.equal(cash(a),bnb);assert.equal(M.account(a).micro,168n);assert.equal(M.account(a).pending,before);assert.equal(plan.gross,116n*10n**15n);assert.equal(plan.total,11716n*10n**13n);assert.equal(M.user(a).tradePoints,plan.gross);assert.equal(M.user(a).boughtVolumeWei,plan.gross);assert.equal(points(plan.gross),'116');assert.equal(a.platformFees,plan.fee);assert.equal(Object.values(a.accounts).reduce((n,x)=>n+x.tradePoints,0n),2n*plan.gross);assert.equal(a.accounts[M.SELLER_A].proceeds,0n);
});
test('one stale fill or insufficient fee rolls back all asset, payout and point changes',()=>{
 const a=s(),before=M.serialize(a);assert.throws(()=>M.buyBatch(a,[{id:1n,amount:3n,priceWei:10n**15n},{id:2n,amount:2n,priceWei:1n}],now));assert.equal(M.serialize(a),before);M.user(a).bnb=10n**16n;const b=M.serialize(a);assert.throws(()=>M.buyBatch(a,[{id:1n,amount:10n,priceWei:10n**15n}],now));assert.equal(M.serialize(a),b);
});
test('unsold listed H accrues per ID; listing/cancelling/splitting do not give points',()=>{
 const a=s(),p=id('tapeout',5438n),before=M.user(a).pending[p],order=M.list(a,p,20n,10n**15n,7,now);M.checkpoint(a,now+100);assert.equal(M.user(a).pending[p]-before,30n*100n*M.RATE);assert.equal(M.user(a).tradePoints,0n);M.cancel(a,order);assert.equal(M.reserved(a,p),0n);
});
test('normal seller receives direct BNB, rejecting seller gets withdrawable proceeds',()=>{
 for(const reject of [false,true]){const a=s(),p=id('tapeout',5438n),order=M.list(a,p,10n,10n**15n,7,now),before=M.user(a).bnb,old=M.user(a).pending[p];M.user(a).rejectPayout=reject;M.simulateBuyer(a,order,3n,now+100);assert.equal(M.user(a).soldVolumeWei,3n*10n**15n);assert.equal(M.user(a).tradePoints,3n*10n**15n);assert.equal(M.user(a).proceeds,reject?3n*10n**15n:0n);assert.equal(M.user(a).bnb,before+(reject?0n:3n*10n**15n));assert.ok(M.user(a).pending[p]>old);if(reject){M.withdraw(a);assert.equal(M.user(a).bnb,before+3n*10n**15n);}}
});
test('selling all and redeeming preserve historical BEM; unrelated fragments cannot redeem',()=>{
 const a=s(),p=id('behemoth',407n),q=id('tapeout',5438n);assert.throws(()=>M.redeem(a,q,149n,now));const before=M.user(a).pending[p];M.redeem(a,p,18n,now);const old=M.positions(a).find(x=>x.id===p);assert.equal(old.balance,0n);assert.equal(old.pending,before);assert.equal(old.active,false);M.claim(a,[p],now);assert.equal(M.user(a).bem,before);M.approveMiner(a,'behemoth',407n);M.splitMiner(a,'behemoth',407n,18n,now);assert.equal(M.user(a).balances[p],18n);
 const b=s(),z=id('tapeout',5438n),order=M.list(b,z,30n,1n,7,now);M.simulateBuyer(b,order,30n,now);assert.ok(M.positions(b).find(p=>p.id===z&&p.balance===0n&&p.pending>0n));
});
test('claim is per ID and chunks >32 IDs; inactive historical rewards remain claimable',()=>{
 const a=s(),p=id('tapeout',1783n),held=M.account(a).micro,old=M.user(a).pending[p],before=M.user(a).bem;assert.equal(M.claim(a,[p],now),old);assert.equal(M.user(a).bem,before+old);assert.equal(M.account(a).micro,held);assert.throws(()=>M.claim(a,[p],now));assert.deepEqual(chunks(Array.from({length:65},(_,i)=>i)).map(x=>x.length),[32,32,1]);assert.throws(()=>M.claim(a,Array(33).fill(p),now));
});
test('saved state preserves BigInt precision and rejects old unified-ID formats',()=>{const a=s();M.user(a).bnb=12345678901234567890123n;assert.equal(M.user(M.restore(M.serialize(a))).bnb,M.user(a).bnb);assert.throws(()=>M.restore('{"version":5}'));});
