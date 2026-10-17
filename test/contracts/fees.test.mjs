import test from 'node:test';
import assert from 'node:assert/strict';
import {ZeroAddress} from 'ethers';
import {startAnvil,mockSystem,deploy,tx,mine} from '../../scripts/chain-helpers.mjs';
import {quoteFills} from '../../src/trade-quote.mjs';
import {verifyFeeReceipt} from '../../src/fee-container.mjs';
let node,p,sys,snapshot;
test.before(async()=>{node=await startAnvil();p=node.provider;sys=await mockSystem(p);});
test.after(async()=>{await node?.stop();});
test.beforeEach(async()=>{snapshot=await p.send('evm_snapshot',[]);});
test.afterEach(async()=>{await p.send('evm_revert',[snapshot]);});
const rejects=promise=>assert.rejects(async()=>{const r=await promise;if(r?.wait)await r.wait();});
async function setup(){const {signers:[a],nft,vault,market,mintMiner}=sys;await mintMiner(a,1,100);await tx(vault.deposit(await nft.getAddress(),1,100));const x=await vault.assetId(await nft.getAddress(),1);await tx(vault.setApprovalForAll(await market.getAddress(),true));return{x,end:(await p.getBlock('latest')).timestamp+86400};}
async function invariant(m){assert.equal(await p.getBalance(await m.getAddress()),(await m.totalProceeds())+(await m.accruedFees()));assert.equal(await m.totalFeesAccrued(),(await m.accruedFees())+(await m.totalFeesReleased()));}

test('fixed 1% fee; limited owner authority supports handover and renunciation, no upgrade or user-asset authority',async()=>{
 const {signers:[a],vault,market,addresses}=sys;assert.equal(await market.PROTOCOL_VERSION(),2n);assert.equal(await market.FEE_BPS(),100n);assert.equal(await market.feeRecipient(),addresses[4]);
 for(const recipient of [ZeroAddress,await vault.getAddress()])await rejects(deploy('TapeMicroMarket',a,[await vault.getAddress(),recipient]));
 assert.equal(await market.feeManager(),addresses[0]);
 assert.equal(await market.owner(),addresses[0]);assert.equal(await market.initialFeeManager(),addresses[0]);assert.equal(await market.pendingOwner(),ZeroAddress);
 const names=market.interface.fragments.filter(f=>f.type==='function').map(f=>f.name);for(const name of ['setFeeRecipient','transferOwnership','acceptOwnership','renounceOwnership'])assert.ok(names.includes(name));for(const name of ['setFee','upgradeTo','rescue'])assert.ok(!names.includes(name));
});

test('only current owner initiates handover; only nominee accepts; former and pending owners cannot change recipient',async()=>{
 const {market,addresses:[aa,bb,cc,dd],signers:[a,b,c]}=sys;
 await rejects(market.connect(b).transferOwnership(cc));await rejects(market.connect(b).acceptOwnership());await rejects(market.connect(b).renounceOwnership());
 let receipt=await tx(market.transferOwnership(bb));assert.ok(receipt.logs.some(l=>{try{return market.interface.parseLog(l)?.name==='OwnershipTransferStarted';}catch{return false;}}));
 assert.equal(await market.owner(),aa);assert.equal(await market.pendingOwner(),bb);await rejects(market.connect(b).setFeeRecipient(cc));await rejects(market.connect(c).acceptOwnership());
 await tx(market.setFeeRecipient(cc));receipt=await tx(market.connect(b).acceptOwnership());assert.ok(receipt.logs.some(l=>{try{return market.interface.parseLog(l)?.name==='OwnershipTransferred';}catch{return false;}}));
 assert.equal(await market.owner(),bb);assert.equal(await market.feeManager(),bb);assert.equal(await market.initialFeeManager(),aa);assert.equal(await market.pendingOwner(),ZeroAddress);
 await rejects(market.setFeeRecipient(dd));await rejects(market.transferOwnership(cc));await rejects(market.renounceOwnership());
 await tx(market.connect(b).setFeeRecipient(dd));assert.equal(await market.feeRecipient(),dd);assert.equal(await market.FEE_BPS(),100n);await invariant(market);
});

test('owner can replace or cancel a pending handover; sending transferOwnership to zero only cancels, never renounces',async()=>{
 const {market,addresses:[aa,bb,cc],signers:[a,b,c]}=sys;
 await tx(market.transferOwnership(bb));await tx(market.transferOwnership(cc));await rejects(market.connect(b).acceptOwnership());
 await tx(market.transferOwnership(ZeroAddress));assert.equal(await market.owner(),aa);assert.equal(await market.pendingOwner(),ZeroAddress);await rejects(market.connect(c).acceptOwnership());
 await tx(market.transferOwnership(bb));await tx(market.connect(b).acceptOwnership());assert.equal(await market.owner(),bb);
});

test('renunciation clears pending handover, permanently locks recipient; fee collection, trades, BEM and redemption remain usable',async()=>{
 const {x,end}=await setup(),{market,vault,nft,bem,addresses:[aa,bb,cc,dd],signers:[a,b,c]}=sys;
 await tx(market.setFeeRecipient(dd));await tx(market.createListing(x,100,1000,end));await tx(market.connect(b).buy(1,2,1000,end,{value:2020}));
 await tx(market.transferOwnership(bb));const before=await p.getBalance(dd),fees=await market.accruedFees(),shares=await vault.balanceOf(bb,x);
 const r=await tx(market.renounceOwnership());assert.ok(r.logs.some(l=>{try{const e=market.interface.parseLog(l);return e?.name==='OwnershipTransferred'&&e.args.newOwner===ZeroAddress;}catch{return false;}}));
 assert.equal(await market.owner(),ZeroAddress);assert.equal(await market.feeManager(),ZeroAddress);assert.equal(await market.initialFeeManager(),aa);assert.equal(await market.pendingOwner(),ZeroAddress);assert.equal(await market.feeRecipient(),dd);assert.equal(await market.accruedFees(),fees);assert.equal(await vault.balanceOf(bb,x),shares);
 for(const s of [a,b,c]){await rejects(market.connect(s).setFeeRecipient(cc));await rejects(market.connect(s).transferOwnership(cc));await rejects(market.connect(s).acceptOwnership());await rejects(market.connect(s).renounceOwnership());}
 await tx(market.connect(c).withdrawFees());assert.equal(await p.getBalance(dd)-before,20n);
 await mine(p,50);await tx(market.connect(b).buy(1,98,1000,end,{value:98980}));assert.equal(await vault.balanceOf(bb,x),100n);await tx(vault.connect(b).claimBem([x],bb));assert.ok(await bem.balanceOf(bb)>0n);
 await tx(vault.connect(b).redeem(x,bb,100));assert.equal(await nft.ownerOf(1),bb);await tx(market.connect(c).withdrawFees());assert.equal(await p.getBalance(dd)-before,1000n);await invariant(market);
});

test('only deployer changes recipient; accrued and future fees follow the change, without touching seller funds or BEM',async()=>{
 const {x,end}=await setup(),{signers:[a,b,c],addresses:[aa,bb,cc],vault,market,bem}=sys;
 const manager=await deploy('TapeMicroMarket',a,[vault.target,aa]);assert.equal(await manager.feeRecipient(),aa);assert.equal(await manager.feeManager(),aa);
 await tx(vault.setApprovalForAll(manager.target,true));await tx(manager.createListing(x,10,1000,end));await tx(manager.connect(b).buy(1,2,1000,end,{value:2020}));
 const before={shares:await vault.balanceOf(bb,x),bem:await bem.balanceOf(vault.target),fees:await manager.accruedFees(),proceeds:await manager.totalProceeds()};
 await rejects(manager.connect(b).setFeeRecipient(cc));for(const address of [ZeroAddress,vault.target,manager.target,aa])await rejects(manager.setFeeRecipient(address));
 const receipt=await tx(manager.setFeeRecipient(cc));assert.ok(receipt.logs.some(l=>{try{return manager.interface.parseLog(l)?.name==='FeeRecipientChanged';}catch{return false;}}));
 assert.equal(await manager.FEE_BPS(),100n);assert.equal(await manager.feeManager(),aa);assert.equal(await manager.accruedFees(),before.fees);assert.equal(await manager.totalProceeds(),before.proceeds);assert.equal(await vault.balanceOf(bb,x),before.shares);assert.equal(await bem.balanceOf(vault.target),before.bem);
 const old=await p.getBalance(cc);await tx(manager.connect(b).withdrawFees());assert.equal(await p.getBalance(cc)-old,20n);await tx(manager.connect(b).buy(1,1,1000,end,{value:1010}));await tx(manager.connect(b).withdrawFees());assert.equal(await p.getBalance(cc)-old,30n);await invariant(manager);
});

test('deployer can recover pending fees from a rejecting destination and switch to a container',async()=>{
 const {x,end}=await setup(),{signers:[a,b],addresses:[aa,bb],vault,market}=sys;const host=await deploy('MockMinerNFT',a,['host']);await tx(host.mint(aa,1));const container=await deploy('MockFeeContainer',a,[host.target,1]);
 await tx(market.setFeeRecipient(container.target));await tx(container.setReject(true));await tx(market.createListing(x,10,1000,end));await tx(market.connect(b).buy(1,2,1000,end,{value:2020}));await rejects(market.withdrawFees());assert.equal(await market.accruedFees(),20n);
 await tx(market.setFeeRecipient(bb));const before=await p.getBalance(bb);await tx(market.withdrawFees());assert.equal(await p.getBalance(bb)-before,20n);assert.equal(await market.accruedFees(),0n);
 await tx(container.setReject(false));await tx(market.setFeeRecipient(container.target));await tx(market.connect(b).buy(1,1,1000,end,{value:1010}));await tx(market.withdrawFees());assert.equal(await p.getBalance(container.target),10n);await invariant(market);
});

test('quote equals frontend integer calculation, including fee dust and overflow rejection',async()=>{
 const {market}=sys;for(const [amount,priceWei]of [[100n,10n**15n],[3n,1000n],[1n,99n],[1n,100n],[10n**24n,2n**128n-1n]]){const q=quoteFills([{amount,priceWei}]);assert.deepEqual([...(await market.quotePayment(amount,priceWei))],[q.gross,q.fee,q.total]);}
 for(const [amount,price]of [[0n,1n],[1n,0n],[2n**128n,1n],[1n,2n**128n],[2n**128n-1n,2n**128n-1n]])await rejects(market.quotePayment(amount,price));
});

test('buyer receives full quantity, pays +1%; seller gets full BNB immediately and retains past BEM',async()=>{
 const {x,end}=await setup(),{signers:[a,b],addresses:[aa,bb],vault,market}=sys;await tx(market.createListing(x,50,1000,end));await mine(p,100);
 const beforeSeller=await p.getBalance(aa),beforeBuyer=await p.getBalance(bb),r=await tx(market.connect(b).buy(1,5,1000,end,{value:5050,gasLimit:5_000_000}));
 assert.equal((await p.getBalance(aa))-beforeSeller,5000n);assert.equal(beforeBuyer-(await p.getBalance(bb)),5050n+r.fee);assert.equal(await market.proceeds(aa),0n);assert.equal(await vault.balanceOf(bb,x),5n);assert.equal(await vault.pendingBem(x,bb),0n);assert.ok(await vault.pendingBem(x,aa)>0n);assert.equal(await market.accruedFees(),50n);assert.equal(await market.tradePoints(aa),5000n);assert.equal(await market.tradePoints(bb),5000n);assert.equal(await market.boughtVolumeWei(bb),5000n);assert.equal(await market.soldVolumeWei(aa),5000n);await invariant(market);
});

test('cross-ID multi-seller partial fills, ID-local reservations and volume points',async()=>{
 const {x,end}=await setup(),{signers:[a,b,c],addresses:[aa,bb,cc],nft,vault,market,mintMiner}=sys;
 await mintMiner(b,2,60);await tx(vault.connect(b).deposit(await nft.getAddress(),2,60));const y=await vault.assetId(await nft.getAddress(),2);await tx(vault.connect(b).setApprovalForAll(await market.getAddress(),true));
 await tx(market.createListing(x,50,1000,end));await tx(market.connect(b).createListing(y,30,1200,end));assert.equal(await market.tradePoints(aa),0n);assert.equal(await market.reserved(aa,x),50n);assert.equal(await market.reserved(aa,y),0n);
 await tx(market.connect(c).buyBatch([[1,3,1000],[2,2,1200]],5454,end,{value:5454}));assert.equal(await vault.balanceOf(cc,x),3n);assert.equal(await vault.balanceOf(cc,y),2n);assert.equal(await market.tradePoints(cc),5400n);assert.equal(await market.tradePoints(aa),3000n);assert.equal(await market.tradePoints(bb),2400n);assert.equal(await market.boughtH(cc),5n);assert.equal(await market.totalVolumeWei(),5400n);await tx(market.cancelListing(1));assert.equal(await market.reserved(aa,x),0n);assert.equal(await market.tradePoints(aa),3000n);await invariant(market);
});

test('underpayment, stale price, expired/self order and failed batch revert payouts, fees, points and transfers',async()=>{
 const {x,end}=await setup(),{signers:[a,b],addresses:[aa,bb],vault,market}=sys;await tx(market.createListing(x,50,1000,end));const originalNative=await p.getBalance(aa);
 for(const [fills,cap,value]of [[[[1,5,1000]],5000,5050],[[[1,5,1000]],5050,5000],[[[1,5,1000]],5050,5051],[[[1,5,1000],[999,1,1000]],6060,6060],[[[1,5,1000],[1,50,1000]],55550,55550],[[[1,5,1001]],5055,5055]]){
  await rejects(market.connect(b).buyBatch(fills,cap,end,{value,gasLimit:5_000_000}));assert.equal(await market.tradePoints(bb),0n);assert.equal(await vault.balanceOf(bb,x),0n);assert.equal((await market.listings(1)).remaining,50n);assert.equal(await p.getBalance(aa),originalNative);await invariant(market);
 }
 await rejects(market.buy(1,1,1000,end,{value:1010}));await rejects(market.connect(b).buy(1,1,1000,0,{value:1010}));await rejects(market.connect(b).buyBatch(Array(17).fill([1,1,1000]),17170,end,{value:17170}));
});

test('one inactive ID cannot trade, while another remains fillable and cancelable',async()=>{
 const {x,end}=await setup(),{signers:[a,b],nft,vault,market,mining,mintMiner}=sys;await mintMiner(a,2,60);await tx(vault.deposit(await nft.getAddress(),2,60));const y=await vault.assetId(await nft.getAddress(),2);await tx(market.createListing(x,10,1000,end));await tx(market.createListing(y,10,1000,end));await tx(mining.setState('0x'+x.toString(16).padStart(64,'0'),2));await rejects(market.connect(b).buy(1,1,1000,end,{value:1010}));await tx(market.connect(b).buy(2,1,1000,end,{value:1010}));await tx(market.cancelListing(1));assert.equal(await market.reserved(await a.getAddress(),x),0n);
});

test('rejecting and gas-burning sellers fall back to funded withdrawals without blocking batch fills',async()=>{
 const {x,end}=await setup(),{signers:[a,b],addresses:[aa,bb],vault,market}=sys;const harness=await deploy('SellerHarness',a),ha=await harness.getAddress();
 await tx(vault.safeTransferFrom(aa,ha,x,20,'0x'));await tx(harness.exec(await vault.getAddress(),vault.interface.encodeFunctionData('setApprovalForAll',[await market.getAddress(),true])));await tx(harness.exec(await market.getAddress(),market.interface.encodeFunctionData('createListing',[x,20,1000,end])));
 for(const mode of [1,2]){await tx(harness.configure(mode,ZeroAddress,'0x'));await tx(market.connect(b).buy(1,3,1000,end,{value:3030,gasLimit:5_000_000}));}assert.equal(await market.proceeds(ha),6000n);assert.equal(await market.totalProceeds(),6000n);assert.equal(await vault.balanceOf(bb,x),6n);await invariant(market);
 const old=await p.getBalance(bb);await tx(harness.exec(await market.getAddress(),market.interface.encodeFunctionData('withdrawProceeds',[bb])));assert.equal((await p.getBalance(bb))-old,6000n);assert.equal(await market.proceeds(ha),0n);await invariant(market);
});

test('seller payout callback cannot reenter settlement or cancel its order',async()=>{
 const {x,end}=await setup(),{signers:[a,b],addresses:[aa],vault,market}=sys;const harness=await deploy('SellerHarness',a),ha=await harness.getAddress();await tx(vault.safeTransferFrom(aa,ha,x,10,'0x'));await tx(harness.exec(await vault.getAddress(),vault.interface.encodeFunctionData('setApprovalForAll',[await market.getAddress(),true])));await tx(harness.exec(await market.getAddress(),market.interface.encodeFunctionData('createListing',[x,10,1000,end])));await tx(harness.configure(3,await market.getAddress(),market.interface.encodeFunctionData('cancelListing',[1])));await tx(market.connect(b).buy(1,3,1000,end,{value:3030,gasLimit:5_000_000}));assert.equal(await harness.reentryBlocked(),true);assert.equal((await market.listings(1)).remaining,7n);await invariant(market);
});

test('fee-container rejection/reentry affects only fee release, and destination stays fixed',async()=>{
 const {x,end}=await setup(),{signers:[a,b,c],addresses:[aa,bb,cc],vault}=sys;const host=await deploy('MockMinerNFT',a,['host']);await tx(host.mint(aa,1));const container=await deploy('MockFeeContainer',a,[await host.getAddress(),1]),market=await deploy('TapeMicroMarket',a,[await vault.getAddress(),await container.getAddress()]);await tx(vault.setApprovalForAll(await market.getAddress(),true));await tx(market.createListing(x,50,1000,end));await tx(container.setReject(true));await assert.rejects(verifyFeeReceipt(p,container.target,aa),/BNB/);await tx(market.connect(b).buy(1,5,1000,end,{value:5050}));await rejects(market.connect(c).withdrawFees({gasLimit:1_000_000}));assert.equal(await market.accruedFees(),50n);await tx(market.connect(b).buy(1,5,1000,end,{value:5050}));await tx(container.setReject(false));await verifyFeeReceipt(p,container.target,aa);assert.equal(await p.getBalance(container.target),0n);await tx(container.setAttack(await market.getAddress(),market.interface.encodeFunctionData('withdrawFees')));await tx(market.connect(c).withdrawFees());assert.equal(await container.reentryBlocked(),true);assert.equal(await p.getBalance(await container.getAddress()),100n);assert.equal(await market.totalFeesReleased(),100n);await rejects(container.connect(c).withdraw(cc,100));await invariant(market);
});

test('fee dust rounds per fill; volume points aggregate wei without per-fill point rounding',async()=>{
 const {x,end}=await setup(),{signers:[a,b],addresses:[aa,bb],market}=sys;await tx(market.createListing(x,10,99,end));await tx(market.createListing(x,10,101,end));await tx(market.connect(b).buyBatch([[1,1,99],[1,1,99],[2,1,101]],300,end,{value:300}));assert.equal(await market.accruedFees(),1n);assert.equal(await market.tradePoints(aa),299n);assert.equal(await market.tradePoints(bb),299n);await invariant(market);
});

test('approval revocation or external transfer makes orders unfillable; expiry releases reservations',async()=>{
 const {x,end}=await setup(),{signers:[a,b],addresses:[aa,bb],market,vault}=sys;await tx(market.createListing(x,100,1000,end));await tx(vault.setApprovalForAll(await market.getAddress(),false));await rejects(market.connect(b).buy(1,1,1000,end,{value:1010}));await tx(vault.setApprovalForAll(await market.getAddress(),true));await tx(vault.safeTransferFrom(aa,bb,x,100,'0x'));await rejects(market.connect(b).buy(1,1,1000,end,{value:1010}));await mine(p,86401);await tx(market.connect(b).expireListing(1));assert.equal(await market.reserved(aa,x),0n);assert.equal(await market.tradePoints(aa),0n);
});
