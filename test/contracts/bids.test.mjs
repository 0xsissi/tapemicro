import test from 'node:test';
import assert from 'node:assert/strict';
import {ZeroAddress} from 'ethers';
import {startAnvil,mockSystem,deploy,tx,mine} from '../../scripts/chain-helpers.mjs';
let node,p,sys,market,ids,end,snapshot;
const rejects=promise=>assert.rejects(async()=>{const r=await promise;if(r?.wait)await r.wait();});
test.before(async()=>{node=await startAnvil();p=node.provider;sys=await mockSystem(p);market=await deploy('TapeMicroMarketV2',sys.signers[0],[sys.vault.target,sys.addresses[4]]);ids=[];for(let n=1;n<=3;n++){await sys.mintMiner(sys.signers[0],n,100);await tx(sys.vault.deposit(sys.nft.target,n,100));ids.push(await sys.vault.assetId(sys.nft.target,n));}await tx(sys.vault.setApprovalForAll(market.target,true));end=(await p.getBlock('latest')).timestamp+86400;});
test.after(async()=>{await node?.stop();});
test.beforeEach(async()=>{snapshot=await p.send('evm_snapshot',[]);});
test.afterEach(async()=>{await p.send('evm_revert',[snapshot]);});
const sorted=a=>[...a].sort((x,y)=>x<y?-1:x>y?1:0);
async function bid({who=1,assets=[ids[0]],amount=20n,price=1000n}={}){const id=await market.nextBidId();await tx(market.connect(sys.signers[who]).createBid(sorted(assets),amount,price,end,{value:amount*price}));return id;}
async function invariant(){assert.equal(await p.getBalance(market.target),await market.totalBidEscrow()+await market.totalProceeds()+await market.accruedFees());assert.equal(await market.totalFeesAccrued(),await market.totalFeesReleased()+await market.accruedFees());}
async function harness(){return deploy('BidHarness',sys.signers[0]);}
const exec=(h,c,name,args=[],value=0n)=>tx(h.exec(c.target,c.interface.encodeFunctionData(name,args),{value,gasLimit:5_000_000}));

test('V3 keeps vault protocol 2, market version 4, fixed fee, transferable owner; no receive/fallback or asset rescue',async()=>{
 assert.equal(await market.PROTOCOL_VERSION(),2n);assert.equal(await market.MARKET_VERSION(),4n);assert.equal(await market.BID_KIND_ANY(),2n);assert.equal(await market.MAX_BID_ASSETS(),32n);assert.equal(await market.FEE_BPS(),100n);
 const types=market.interface.fragments.map(f=>f.type);assert.ok(!types.includes('receive')&&!types.includes('fallback'));await rejects(sys.signers[0].sendTransaction({to:market.target,value:1}));
 await tx(market.transferOwnership(sys.addresses[1]));await tx(market.connect(sys.signers[1]).acceptOwnership());await rejects(market.setFeeRecipient(sys.addresses[2]));await tx(market.connect(sys.signers[1]).setFeeRecipient(sys.addresses[2]));await tx(market.connect(sys.signers[1]).renounceOwnership());assert.equal(await market.owner(),ZeroAddress);await invariant();
});
test('bid admission validates exact principal, uint128 bounds, duration, empty ANY or sorted unique 1–32 live IDs and kind event',async()=>{
 const m=market.connect(sys.signers[1]),x=ids[0],ascending=sorted(ids.slice(0,2));
 for(const list of [Array(33).fill(x),[x,x],[ascending[1],ascending[0]],[123n]])await rejects(m.createBid(list,1,100,end,{value:100}));
 for(const value of [99,101])await rejects(m.createBid([x],1,100,end,{value}));
 for(const [amount,price]of [[0n,1n],[1n,0n],[2n**128n,1n],[1n,2n**128n]])await rejects(m.createBid([x],amount,price,end,{value:0}));
 await rejects(m.createBid([x],1,100,0,{value:100}));await rejects(m.createBid([x],1,100,end+31*86400,{value:100}));
 const r=await tx(m.createBid(ascending,20,100,end,{value:2000})),e=r.logs.map(l=>{try{return market.interface.parseLog(l);}catch{}}).find(l=>l?.name==='BidCreated');assert.equal(e.args.kind,0n);assert.deepEqual([...e.args.assetIds],ascending);assert.equal(await market.bidAccepts(1,ascending[0]),true);
 await bid();assert.equal((await market.bids(2)).kind,1n);assert.equal(await market.totalBidEscrow(),22000n);assert.equal(await market.accruedFees(),0n);assert.equal(await market.tradePoints(sys.addresses[1]),0n);await invariant();
});
test('wrong asset, self fill, closed/stale bid, missing approval, balance, deadline and minNet are rejected without state drift',async()=>{
 const id=await bid(),fill=[[id,ids[0],1,1000]];
 await rejects(market.sellBatch([[id,ids[1],1,1000]],990,end));await rejects(market.connect(sys.signers[1]).sellBatch(fill,990,end));await rejects(market.sellBatch([[id,ids[0],1,999]],990,end));await rejects(market.sellBatch(fill,991,end));await rejects(market.sellBatch(fill,990,0));await rejects(market.sellBatch([],0,end));await rejects(market.sellBatch(Array(17).fill(fill[0]),0,end));await rejects(market.sellBatch([[id,ids[0],21,1000]],0,end));await rejects(market.connect(sys.signers[2]).sellBatch(fill,0,end));
 await tx(sys.vault.setApprovalForAll(market.target,false));await rejects(market.sellBatch(fill,990,end));await tx(sys.vault.setApprovalForAll(market.target,true));
 await tx(market.connect(sys.signers[1]).cancelBid(id));const replacement=await bid({price:1100n});await rejects(market.sellBatch(fill,990,end));await rejects(market.sellBatch([[replacement,ids[0],1,1000]],990,end));assert.equal((await market.bids(replacement)).remaining,20n);assert.equal(await market.accruedFees(),0n);await invariant();
});
test('multiple sellers and IDs fill one bid in parts; seller receives gross less fee and both sides earn gross-volume points',async()=>{
 const id=await bid({assets:ids.slice(0,2)}),[aa,bb,cc]=sys.addresses;await tx(sys.vault.safeTransferFrom(aa,cc,ids[1],10,'0x'));await tx(sys.vault.connect(sys.signers[2]).setApprovalForAll(market.target,true));
 let before=await p.getBalance(aa),r=await tx(market.sellBatch([[id,ids[0],3,1000]],2970,end));assert.equal(await p.getBalance(aa)-before+r.fee,2970n);
 before=await p.getBalance(cc);r=await tx(market.connect(sys.signers[2]).sellBatch([[id,ids[1],2,1000]],1980,end));assert.equal(await p.getBalance(cc)-before+r.fee,1980n);
 assert.equal((await market.bids(id)).remaining,15n);assert.equal(await market.totalBidEscrow(),15000n);assert.equal(await market.accruedFees(),50n);assert.equal(await sys.vault.balanceOf(bb,ids[0]),3n);assert.equal(await sys.vault.balanceOf(bb,ids[1]),2n);assert.equal(await market.tradePoints(bb),5000n);assert.equal(await market.tradePoints(aa),3000n);assert.equal(await market.tradePoints(cc),2000n);await invariant();
});
test('16-fill batch succeeds; any one failing fill atomically restores BNB, shares, escrow, points and bid quantities',async()=>{
 const id=await bid({amount:40n}),fills=Array(16).fill([id,ids[0],1,1000]);await tx(market.sellBatch(fills,15840,end,{gasLimit:15_000_000}));assert.equal((await market.bids(id)).remaining,24n);assert.equal(await market.totalBidEscrow(),24000n);
 const before={shares:await sys.vault.balanceOf(sys.addresses[1],ids[0]),fees:await market.accruedFees(),points:await market.tradePoints(sys.addresses[1]),balance:await p.getBalance(market.target)};
 await rejects(market.sellBatch([...fills.slice(0,15),[id,ids[1],1,1000]],15840,end,{gasLimit:15_000_000}));assert.equal(await sys.vault.balanceOf(sys.addresses[1],ids[0]),before.shares);assert.equal(await market.accruedFees(),before.fees);assert.equal(await market.tradePoints(sys.addresses[1]),before.points);assert.equal(await p.getBalance(market.target),before.balance);assert.equal((await market.bids(id)).remaining,24n);await invariant();
});
test('closed and expired bids refund exactly the unfilled principal; outsiders cannot cancel or expire early',async()=>{
 const id=await bid();await tx(market.sellBatch([[id,ids[0],3,1000]],2970,end));await rejects(market.cancelBid(id));await rejects(market.expireBid(id));let before=await p.getBalance(sys.addresses[1]);const r=await tx(market.connect(sys.signers[1]).cancelBid(id));assert.equal(await p.getBalance(sys.addresses[1])-before+r.fee,17000n);await rejects(market.connect(sys.signers[1]).cancelBid(id));
 const next=await bid();await mine(p,86401);await rejects(market.sellBatch([[next,ids[0],1,1000]],990,end+86400));before=await p.getBalance(sys.addresses[1]);await tx(market.connect(sys.signers[2]).expireBid(next));assert.equal(await p.getBalance(sys.addresses[1])-before,20000n);assert.equal(await market.totalBidEscrow(),0n);await invariant();
});
test('rejecting/gas-burning seller and bidder receive recoverable pending balances; withdrawal supports another recipient',async()=>{
 const h=await harness(),aa=sys.addresses[0],cc=sys.addresses[2];await tx(sys.vault.safeTransferFrom(aa,h.target,ids[0],10,'0x'));await exec(h,sys.vault,'setApprovalForAll',[market.target,true]);const id=await bid();
 for(const mode of [1,2]){await tx(h.configure(0,mode,ZeroAddress,'0x'));await exec(h,market,'sellBatch',[[[id,ids[0],1,1000]],990,end]);}assert.equal(await market.proceeds(h.target),1980n);
 await exec(h,market,'createBid',[[ids[1]],5,1000,end],5000n);const hid=(await market.nextBidId())-1n;await exec(h,market,'cancelBid',[hid]);assert.equal(await market.proceeds(h.target),6980n);
 await exec(h,market,'createBid',[[ids[1]],2,1000,end],2000n);const expired=(await market.nextBidId())-1n;await mine(p,86401);await tx(market.expireBid(expired));assert.equal(await market.proceeds(h.target),8980n);const before=await p.getBalance(cc);await exec(h,market,'withdrawProceeds',[cc]);assert.equal(await p.getBalance(cc)-before,8980n);assert.equal(await market.proceeds(h.target),0n);await invariant();
});
test('bidder rejection rolls back only that fill; token callback cannot reenter market or vault',async()=>{
 const h=await harness();await exec(h,market,'createBid',[[ids[0]],10,1000,end],10000n);const id=1n;await tx(h.configure(1,0,ZeroAddress,'0x'));await rejects(market.sellBatch([[id,ids[0],1,1000]],990,end,{gasLimit:5_000_000}));assert.equal((await market.bids(id)).remaining,10n);
 const other=await bid();await tx(market.sellBatch([[other,ids[0],1,1000]],990,end));
 for(const [target,data]of [[market,market.interface.encodeFunctionData('cancelBid',[id])],[sys.vault,sys.vault.interface.encodeFunctionData('claimSettledBem',[[ids[0]],h.target])]]){
  await tx(h.configure(2,0,target.target,data));await tx(market.sellBatch([[id,ids[0],1,1000]],990,end));assert.equal(await h.reentryBlocked(),true);
 }await invariant();
});
test('BNB callbacks cannot reenter settlement or owner mutation; owner nomination acceptance itself is guarded',async()=>{
 const h=await harness();await tx(sys.vault.safeTransferFrom(sys.addresses[0],h.target,ids[0],10,'0x'));await exec(h,sys.vault,'setApprovalForAll',[market.target,true]);await tx(market.transferOwnership(h.target));await exec(h,market,'acceptOwnership');const id=await bid();
 for(const [name,args]of [['renounceOwnership',[]],['setFeeRecipient',[sys.addresses[2]]],['sellBatch',[[[id,ids[0],1,1000]],990,end]]]){await tx(h.configure(0,3,market.target,market.interface.encodeFunctionData(name,args)));await exec(h,market,'sellBatch',[[[id,ids[0],1,1000]],990,end]);assert.equal(await h.reentryBlocked(),true);assert.equal(await market.owner(),h.target);}await invariant();
});
test('revocation before or during token/BNB callback rolls back sale and accounting; healthy other bid stays usable',async()=>{
 const badKey='0x'+ids[0].toString(16).padStart(64,'0'),id=await bid(),h=await harness();await tx(sys.mining.setState(badKey,2));await rejects(market.sellBatch([[id,ids[0],1,1000]],990,end));
 const good=await bid({assets:[ids[1]]});await tx(market.sellBatch([[good,ids[1],1,1000]],990,end));
 await exec(h,market,'createBid',[[ids[1]],10,1000,end],10000n);const hid=(await market.nextBidId())-1n,key='0x'+ids[1].toString(16).padStart(64,'0');await tx(h.configure(2,0,sys.mining.target,sys.mining.interface.encodeFunctionData('setState',[key,2])));
 await rejects(market.sellBatch([[hid,ids[1],1,1000]],990,end,{gasLimit:5_000_000}));assert.equal((await market.bids(hid)).remaining,10n);assert.equal(await sys.vault.isTradable(ids[1]),true);await invariant();
});
test('sale fee dust is per fill; fee withdrawal cannot take bid escrow or deferred payouts after recipient/owner changes',async()=>{
 for(const price of [1n,99n,100n,101n]){const [gross,fee,net]=await market.quoteSale(1,price);assert.equal(net+fee,gross);assert.equal(fee,price/100n);}
 const id=await bid({price:101n});await tx(market.sellBatch([[id,ids[0],1,101],[id,ids[0],1,101]],200,end));const escrow=await market.totalBidEscrow(),pending=await market.totalProceeds();await tx(market.setFeeRecipient(sys.addresses[3]));const before=await p.getBalance(sys.addresses[3]);await tx(market.withdrawFees());assert.equal(await p.getBalance(sys.addresses[3])-before,2n);assert.equal(await market.totalBidEscrow(),escrow);assert.equal(await market.totalProceeds(),pending);await tx(market.renounceOwnership());await tx(market.sellBatch([[id,ids[0],1,101]],100,end));await tx(market.withdrawFees());assert.equal(await p.getBalance(sys.addresses[3])-before,3n);await invariant();
});
test('BEM before bid fill remains with seller; only subsequent production belongs to bidder',async()=>{
 const id=await bid(),[aa,bb]=sys.addresses;await mine(p,100);await tx(market.sellBatch([[id,ids[0],10,1000]],9900,end));assert.equal(await sys.vault.pendingBem(ids[0],bb),0n);const past=await sys.vault.pendingBem(ids[0],aa);assert.ok(past>0n);await mine(p,10);await tx(sys.vault.connect(sys.signers[1]).claimBem([ids[0]],bb));assert.ok(await sys.bem.balanceOf(bb)>0n);assert.ok(await sys.vault.pendingBem(ids[0],aa)>=past);await invariant();
});

test('32 accepted IDs are supported with no on-chain array; every selected ID is enforced',async()=>{
 const all=[...ids];for(let n=4;n<=32;n++){await sys.mintMiner(sys.signers[0],n,1);await tx(sys.vault.deposit(sys.nft.target,n,1));all.push(await sys.vault.assetId(sys.nft.target,n));}
 const id=await bid({assets:all,amount:1n,price:100n});for(const x of all)assert.equal(await market.bidAccepts(id,x),true);assert.equal((await market.bids(id)).kind,0n);await invariant();
});

test('post-payment check catches an ID becoming inactive in the seller native callback and reverts the payout',async()=>{
 const h=await harness();await tx(sys.vault.safeTransferFrom(sys.addresses[0],h.target,ids[0],5,'0x'));await exec(h,sys.vault,'setApprovalForAll',[market.target,true]);
 const id=await bid(),key='0x'+ids[0].toString(16).padStart(64,'0');await tx(h.configure(0,3,sys.mining.target,sys.mining.interface.encodeFunctionData('setStatusWithoutClaim',[key,2])));
 await rejects(exec(h,market,'sellBatch',[[[id,ids[0],1,1000]],990,end]));assert.equal((await market.bids(id)).remaining,20n);assert.equal(await sys.vault.isTradable(ids[0]),true);assert.equal(await sys.vault.balanceOf(h.target,ids[0]),5n);assert.equal(await market.accruedFees(),0n);await invariant();
});

test('any-miner bid: empty list accepts every tradable ID, mixes IDs and sellers, still blocks untradable IDs and keeps escrow exact',async()=>{
 const m=market.connect(sys.signers[1]),r=await tx(m.createBid([],30,1000,end,{value:30000})),e=r.logs.map(l=>{try{return market.interface.parseLog(l);}catch{}}).find(l=>l?.name==='BidCreated');
 const id=e.args.bidId;assert.equal(e.args.kind,2n);assert.deepEqual([...e.args.assetIds],[]);const b=await market.bids(id);assert.equal(b.kind,2n);assert.equal(b.remaining,30n);
 for(const x of ids)assert.equal(await market.bidAccepts(id,x),false,'no per-ID flags stored for ANY');
 await rejects(m.createBid([],1,100,end,{value:99}));
 const [aa,,cc]=sys.addresses;await tx(sys.vault.safeTransferFrom(aa,cc,ids[2],10,'0x'));await tx(sys.vault.connect(sys.signers[2]).setApprovalForAll(market.target,true));
 const before=await p.getBalance(aa),rr=await tx(market.sellBatch([[id,ids[0],4,1000],[id,ids[1],6,1000]],9900,end));assert.equal(await p.getBalance(aa)-before+rr.fee,9900n);
 await tx(market.connect(sys.signers[2]).sellBatch([[id,ids[2],5,1000]],4950,end));
 assert.equal(await sys.vault.balanceOf(sys.addresses[1],ids[0]),4n);assert.equal(await sys.vault.balanceOf(sys.addresses[1],ids[1]),6n);assert.equal(await sys.vault.balanceOf(sys.addresses[1],ids[2]),5n);
 assert.equal((await market.bids(id)).remaining,15n);assert.equal(await market.totalBidEscrow(),15000n);assert.equal(await market.accruedFees(),150n);
 await rejects(market.sellBatch([[id,123n,1,1000]],0,end));
 const badKey='0x'+ids[0].toString(16).padStart(64,'0');await tx(sys.mining.setState(badKey,2));await rejects(market.sellBatch([[id,ids[0],1,1000]],0,end));
 await rejects(market.connect(sys.signers[1]).sellBatch([[id,ids[1],1,1000]],0,end));
 await rejects(market.sellBatch([[id,ids[1],16,1000]],0,end));
 const bal=await p.getBalance(sys.addresses[1]),cr=await tx(m.cancelBid(id));assert.equal(await p.getBalance(sys.addresses[1])-bal+cr.fee,15000n);assert.equal(await market.totalBidEscrow(),0n);await invariant();
});


test('ANY bids accept an NFT deposited after the bid, and post-payment invalidation rolls the entire fill back',async()=>{
 const m=market.connect(sys.signers[1]),r=await tx(m.createBid([],3,1000,end,{value:3000})),id=r.logs.map(l=>{try{return market.interface.parseLog(l);}catch{}}).find(e=>e?.name==='BidCreated').args.bidId;
 await sys.mintMiner(sys.signers[0],77,10);await tx(sys.vault.deposit(sys.nft.target,77,10));const fresh=await sys.vault.assetId(sys.nft.target,77),h=await deploy('BidHarness',sys.signers[0]);await tx(sys.vault.safeTransferFrom(sys.addresses[0],h.target,fresh,2,'0x'));await exec(h,sys.vault,'setApprovalForAll',[market.target,true]);
 const key='0x'+fresh.toString(16).padStart(64,'0');await tx(h.configure(0,3,sys.mining.target,sys.mining.interface.encodeFunctionData('setStatusWithoutClaim',[key,2])));await rejects(exec(h,market,'sellBatch',[[[id,fresh,1,1000]],990,end]));assert.equal(await sys.vault.isTradable(fresh),true);assert.equal((await market.bids(id)).remaining,3n);
 await tx(h.configure(0,0,sys.vault.target,'0x'));await exec(h,market,'sellBatch',[[[id,fresh,1,1000]],990,end]);assert.equal(await sys.vault.balanceOf(sys.addresses[1],fresh),1n);await tx(m.cancelBid(id));await invariant();
});
