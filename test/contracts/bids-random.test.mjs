import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {ZeroAddress} from 'ethers';
import {startAnvil,mockSystem,deploy,tx,mine,root} from '../../scripts/chain-helpers.mjs';
const reports=[];let node,p;
test.before(async()=>{node=await startAnvil();p=node.provider;});
test.after(async()=>{await node?.stop();await mkdir(root+'output/bids-v2',{recursive:true});await writeFile(root+'output/bids-v2/random-ledger.json',JSON.stringify({passed:reports.length===8&&reports.every(r=>r.passed),groups:reports,stepsPerGroup:400,totalSteps:reports.length*400,oracle:'Independent native balances including actual gas; per-wallet unit ledger; integral per-H BEM funding credited to holders, no contract accumulator/debt replication',mainnetWrites:false},null,2));});
for(const initialSeed of [7,81,912,1807,81723,299003,771019,20261017])test('bid/ask independent ledger 400 steps, seed '+initialSeed,{timeout:600000},async()=>{
 let seed=initialSeed;const rand=n=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed%n;};
 const sys=await mockSystem(p),{signers,addresses,nft,vault,mining,bem}=sys,m=await deploy('TapeMicroMarketV2',signers[0],[vault.target,addresses[3]]),h=[await deploy('BidHarness',signers[0]),await deploy('BidHarness',signers[0])];
 await tx(mining.setRate(0));for(const a of h)await tx(a.configure(0,1,ZeroAddress,'0x'));
 const actors=[...addresses.slice(0,3),...h.map(c=>c.target)],all=[...actors,addresses[3]],ids=[];
 for(let n=1;n<=3;n++){await sys.mintMiner(signers[0],n,1000);await tx(vault.deposit(nft.target,n,1000));const id=await vault.assetId(nft.target,n);ids.push(id);for(let a=1;a<5;a++)await tx(vault.safeTransferFrom(actors[0],actors[a],id,200,'0x'));}
 for(let a=0;a<5;a++)if(a<3)await tx(vault.connect(signers[a]).setApprovalForAll(m.target,true));else await tx(h[a-3].exec(vault.target,vault.interface.encodeFunctionData('setApprovalForAll',[m.target,true])));
 const native=new Map(await Promise.all(all.map(async a=>[a.toLowerCase(),await p.getBalance(a)]))),units=actors.map(()=>ids.map(()=>200n)),unpaid=actors.map(()=>ids.map(()=>0n)),paid=actors.map(()=>0n),pending=actors.map(()=>0n),points=actors.map(()=>0n),bids=[],asks=[],counts={bid:0,sale:0,cancel:0,expire:0,ask:0,buy:0,cancelAsk:0,withdraw:0,bemFund:0,bemClaim:0,transfer:0,fees:0};let fees=0n,volume=0n,bemFunded=0n;
 const plus=(who,value)=>native.set(who.toLowerCase(),native.get(who.toLowerCase())+value);
 async function send(a,c,name,args=[],value=0n){let receipt;if(a<3)receipt=await tx(c.connect(signers[a])[name](...args,{value,gasLimit:4_000_000}));else receipt=await tx(h[a-3].exec(c.target,c.interface.encodeFunctionData(name,args),{value,gasLimit:5_000_000}));plus(a<3?actors[a]:actors[0],-receipt.fee-value);return receipt;}
 function payout(a,amount){if(a>=3)pending[a]+=amount;else plus(actors[a],amount);}
 function trade(s,b,k,amount,price){const gross=amount*price,fee=gross/100n;units[s][k]-=amount;units[b][k]+=amount;points[s]+=gross;points[b]+=gross;fees+=fee;volume+=gross;return{gross,fee};}
 const pick=list=>list.length?list[rand(list.length)]:null;
 async function check(step){const escrow=bids.reduce((n,b)=>n+b.left*b.price,0n),proceeds=pending.reduce((a,b)=>a+b,0n);
  const [balance,e,d,f,v,pointsRead,proceedsRead,balances,bemRead,unpaidRead,nativeRead]=await Promise.all([
   p.getBalance(m.target),m.totalBidEscrow(),m.totalProceeds(),m.accruedFees(),m.totalVolumeWei(),Promise.all(actors.map(a=>m.tradePoints(a))),Promise.all(actors.map(a=>m.proceeds(a))),
   vault.balanceOfBatch(actors.flatMap(a=>ids.map(()=>a)),actors.flatMap(()=>ids)),Promise.all(actors.map(a=>bem.balanceOf(a))),Promise.all(actors.flatMap(a=>ids.map(id=>vault.pendingBem(id,a)))),Promise.all(all.map(a=>p.getBalance(a)))
  ]);
  assert.equal(balance,escrow+proceeds+fees,'balance '+step);assert.equal(e,escrow);assert.equal(d,proceeds);assert.equal(f,fees);assert.equal(v,volume);assert.deepEqual([...pointsRead],points);assert.deepEqual([...proceedsRead],pending);assert.deepEqual([...balances],units.flat());assert.deepEqual(bemRead,paid);assert.deepEqual(unpaidRead,unpaid.flat());assert.deepEqual(nativeRead,all.map(a=>native.get(a.toLowerCase())),'native wallet/gas ledger '+step);assert.equal(await bem.balanceOf(vault.target),bemFunded-paid.reduce((a,b)=>a+b,0n));
 }
 for(let step=0;step<400;step++){
  const a=rand(5),k=rand(3),now=(await p.getBlock('latest')).timestamp,kind=step%12;
  if(kind===0){const price=BigInt(1+rand(2000)),amount=BigInt(1+rand(30)),any=step%24===0,ks=any?[0,1,2]:[...new Set([k,rand(3)])],assetIds=any?[]:ks.map(i=>ids[i]).sort((a,b)=>a<b?-1:1),id=await m.nextBidId(),expires=now+(step%24===0?300:60);await send(a,m,'createBid',[assetIds,amount,price,expires],amount*price);bids.push({id,a,ks,left:amount,price,expires});counts.bid++;}
  else if(kind===1){const b=pick(bids.filter(b=>b.a!==a&&b.left>0n&&b.expires>now&&b.ks.some(i=>units[a][i]>0n)));if(b){const kk=pick(b.ks.filter(i=>units[a][i]>0n)),cap=b.left<units[a][kk]?b.left:units[a][kk],amount=1n+BigInt(rand(Number(cap)));await send(a,m,'sellBatch',[[[b.id,ids[kk],amount,b.price]],amount*b.price-amount*b.price/100n,now+10]);const q=trade(a,b.a,kk,amount,b.price);b.left-=amount;payout(a,q.gross-q.fee);counts.sale++;}}
  else if(kind===2&&step%24===2){const b=pick(bids.filter(b=>b.left>0n));if(b){await send(b.a,m,'cancelBid',[b.id]);payout(b.a,b.left*b.price);b.left=0n;counts.cancel++;}}
  else if(kind===3){await mine(p,120);const t=(await p.getBlock('latest')).timestamp,b=pick(bids.filter(b=>b.left>0n&&b.expires<=t));if(b){await send(a,m,'expireBid',[b.id]);payout(b.a,b.left*b.price);b.left=0n;counts.expire++;}}
  else if(kind===4){const reserved=asks.filter(o=>o.a===a&&o.k===k).reduce((n,o)=>n+o.left,0n),free=units[a][k]-reserved;if(free>0n){const amount=1n+BigInt(rand(Number(free<20n?free:20n))),price=BigInt(1+rand(1500)),id=await m.nextListingId();await send(a,m,'createListing',[ids[k],amount,price,now+1000]);asks.push({id,a,k,left:amount,price,expires:now+1000});counts.ask++;}}
  else if(kind===5){const o=pick(asks.filter(o=>o.a!==a&&o.left>0n&&o.expires>now&&units[o.a][o.k]>0n));if(o){const cap=o.left<units[o.a][o.k]?o.left:units[o.a][o.k],amount=1n+BigInt(rand(Number(cap))),gross=amount*o.price,fee=gross/100n;await send(a,m,'buy',[o.id,amount,o.price,now+10],gross+fee);trade(o.a,a,o.k,amount,o.price);o.left-=amount;payout(o.a,gross);counts.buy++;}}
  else if(kind===6){const o=pick(asks.filter(o=>o.left>0n));if(o){await send(o.a,m,'cancelListing',[o.id]);o.left=0n;counts.cancelAsk++;}}
  else if(kind===7){const who=pick(pending.map((n,i)=>n>0n?i:null).filter(i=>i!==null));if(who!==null){const recipient=rand(3),amount=pending[who];await send(who,m,'withdrawProceeds',[actors[recipient]]);pending[who]=0n;plus(actors[recipient],amount);counts.withdraw++;}}
  else if(kind===8){const perH=BigInt(1+rand(11)),amount=1000n*perH;await send(0,bem,'mint',[(await vault.positions(ids[k])).custody,amount]);await send(0,vault,'syncRewards',[[ids[k]]]);for(let i=0;i<5;i++)unpaid[i][k]+=units[i][k]*perH;bemFunded+=amount;counts.bemFund++;}
  else if(kind===9){const who=pick(unpaid.map((v,i)=>v.some(n=>n>0n)?i:null).filter(i=>i!==null));if(who!==null){await send(who,vault,'claimBem',[ids,actors[who]]);paid[who]+=unpaid[who].reduce((a,b)=>a+b,0n);unpaid[who]=[0n,0n,0n];counts.bemClaim++;}}
  else if(kind===10){const target=rand(5);if(target!==a&&units[a][k]>0n){const amount=1n+BigInt(rand(Number(units[a][k]<10n?units[a][k]:10n)));await send(a,vault,'safeTransferFrom',[actors[a],actors[target],ids[k],amount,'0x']);units[a][k]-=amount;units[target][k]+=amount;counts.transfer++;}}
  else if(fees>0n){await send(a,m,'withdrawFees');plus(addresses[3],fees);fees=0n;counts.fees++;}
  await check(step);
  if((step+1)%100===0)console.log('seed '+initialSeed+': '+(step+1)+'/400 ledger steps verified');
 }
 for(const [name,count]of Object.entries(counts))assert.ok(count>0,'random coverage '+name);
 reports.push({seed:initialSeed,steps:400,passed:true,counts});
});
