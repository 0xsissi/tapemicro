import test from 'node:test';
import assert from 'node:assert/strict';
import {ZeroAddress} from 'ethers';
import {mkdir,writeFile} from 'node:fs/promises';
import {startAnvil,mockSystem,deploy,at,mine,tx,root} from '../../scripts/chain-helpers.mjs';
let node,p,sys,snapshot;
const regressions={localOnly:true,mainnetWrites:false};
test.before(async()=>{node=await startAnvil();p=node.provider;sys=await mockSystem(p);});
test.after(async()=>{await node?.stop();await mkdir(root+'output/admission-review-rc4',{recursive:true});await writeFile(root+'output/admission-review-rc4/regressions.json',JSON.stringify(regressions,null,2));});
test.beforeEach(async()=>{snapshot=await p.send('evm_snapshot',[]);});
test.afterEach(async()=>{await p.send('evm_revert',[snapshot]);});
const rejects=promise=>assert.rejects(async()=>{const t=await promise;if(t?.wait)await t.wait();});
async function put(owner,id,h,options={}){const c=options.collection??sys.nft;await sys.mintMiner(owner,id,h,options);await tx(sys.vault.connect(owner).deposit(await c.getAddress(),id,h,{gasLimit:6_000_000}));return BigInt(await sys.vault.minerKey(await c.getAddress(),id));}
async function freeze(ids){await tx(sys.mining.setRate(0));await tx(sys.vault.syncRewards(ids,{gasLimit:6_000_000}));}

test('one miner/key per ID and custody; exact 60H,100H,1260H issuance, including NFT zero',async()=>{
 const {signers:[a],addresses:[aa],nft,giant,vault}=sys;let total=0n;const custodians=new Set();
 for(const [id,h,c]of [[0,60,nft],[1,100,nft],[2,1260,giant]]){const asset=await put(a,id,h,{collection:c}),pos=await vault.positions(asset);assert.equal(await vault.balanceOf(aa,asset),BigInt(h));assert.equal(await vault.totalSupply(asset),BigInt(h));assert.equal(await c.ownerOf(id),pos.custody);assert.notEqual(pos.custody,await vault.getAddress());custodians.add(pos.custody);total+=BigInt(h);}
 assert.equal(custodians.size,3);assert.equal(await vault.totalH(),total);assert.equal(await vault.positionCount(),3n);assert.equal(await vault.accountAssetCount(aa),3n);assert.equal((await vault.positionIds(1,2)).length,2);
});

test('optimal, unverified, inactive, wrong collection, known counterexample and stale H are refused',async()=>{
 const {signers:[a],nft,giant,vault,mining,mintMiner}=sys;
 for(const [id,options]of [[1,{optimal:true}],[2,{verified:false}]]){await mintMiner(a,id,60,options);await rejects(vault.deposit(await nft.getAddress(),id,60));}
 const bad=await mintMiner(a,3,60);await tx(mining.setBad(bad,true));await rejects(vault.deposit(await nft.getAddress(),3,60));
 const stopped=await mintMiner(a,4,60);await tx(mining.setState(stopped,3));await rejects(vault.deposit(await nft.getAddress(),4,60));
 await mintMiner(a,5,60);await rejects(vault.deposit(await nft.getAddress(),5,59));await rejects(vault.deposit(ZeroAddress,5,60));await rejects(vault.connect(sys.signers[1]).deposit(await nft.getAddress(),5,60));assert.equal(await vault.totalH(),0n);
});


test('1240-gate valid miner with registered counterexamples uses the upstream budget once and fits one transaction',async()=>{
 const {signers:[a],addresses:[aa],vault,mining,nft,mintMiner}=sys;await mintMiner(a,99,1240);const id=await vault.assetId(nft.target,99);
 // One counterexample already exceeds the old 2M budget; three consume 11.31M.
 await tx(mining.setCounterexamples(1,1,true));assert.equal(await mining.passesCounterexamples(nft.target,99,1,1240,2_000_000),false);assert.equal(await vault.previewDeposit(nft.target,99,{gasLimit:15_000_000}),1240n);
 await tx(mining.setMaxRunGas(2_000_000));await rejects(vault.previewDeposit(nft.target,99));await tx(mining.setMaxRunGas(12_000_000));await tx(mining.setCounterexamples(1,3,true));
 const receipt=await tx(vault.deposit(nft.target,99,1240,{gasLimit:15_000_000}));assert.ok(receipt.gasUsed>11_310_000n);assert.ok(receipt.gasUsed<15_000_000n);assert.equal(await vault.balanceOf(aa,id),1240n);
 const trace=await p.send('debug_traceTransaction',[receipt.hash,{tracer:'callTracer'}]);const selector=mining.interface.getFunction('passesCounterexamples').selector;let checks=0;const walk=call=>{if(call.to?.toLowerCase()===mining.target.toLowerCase()&&call.input?.startsWith(selector))checks++;for(const child of call.calls??[])walk(child);};walk(trace);assert.equal(checks,1);
 regressions.largeMiner={gateCount:1240,registeredCounterexamples:3,modeledCost:11310000,gasUsed:String(receipt.gasUsed),transactionGasLimit:15000000,upstreamCheckCalls:checks,issuedH:'1240',negativeOldBudgetRejected:true};
 await mintMiner(a,100,1240);await tx(mining.setCounterexamples(1,4,false));await rejects(vault.previewDeposit(nft.target,100));await tx(mining.setCounterexamples(1,1,false));await tx(mining.setBad(await mining.key(nft.target,100),true));await rejects(vault.deposit(nft.target,100,1240));
});

test('NFT pre-deposit BEM goes to original owner, not its future Micro buyer',async()=>{
 const {signers:[a],addresses:[aa],nft,vault,bem,mintMiner}=sys;await mintMiner(a,1,100);await mine(p,100);const before=await bem.balanceOf(aa);await tx(vault.deposit(await nft.getAddress(),1,100));const id=await vault.assetId(await nft.getAddress(),1);assert.ok(await bem.balanceOf(aa)>before);assert.equal(await vault.pendingBem(id,aa),0n);
});

test('external upstream claims already sitting in custody are attributed only to their own ID',async()=>{
 const {signers:[a,b,c],addresses:[aa,bb],vault,mining,bem}=sys;const x=await put(a,1,100),y=await put(b,2,60);await freeze([x,y]);
 const cx=(await vault.positions(x)).custody,cy=(await vault.positions(y)).custody;
 await tx(bem.mint(cx,500));await tx(bem.mint(cy,200));await tx(mining.connect(c).claim('0x'+x.toString(16).padStart(64,'0')));
 const beforeX=await vault.pendingBem(x,aa),beforeY=await vault.pendingBem(y,bb);await tx(vault.syncRewards([x]));assert.equal((await vault.pendingBem(x,aa))-beforeX,500n);assert.equal(await vault.pendingBem(y,bb),beforeY);assert.equal(await bem.balanceOf(cy),200n);assert.equal(await bem.balanceOf(cx),0n);
});

test('transfer settles full seller history, buyer starts at zero, and sold-out IDs remain discoverable',async()=>{
 const {signers:[a,b],addresses:[aa,bb],vault,bem}=sys;const x=await put(a,1,100);await freeze([x]);const before=await vault.pendingBem(x,aa);await tx(bem.mint((await vault.positions(x)).custody,1000));await rejects(vault.safeTransferFrom(aa,bb,x,100,'0x',{gasLimit:700_000}));assert.equal(await vault.balanceOf(aa,x),100n);await tx(vault.safeTransferFrom(aa,bb,x,100,'0x'));
 assert.equal((await vault.pendingBem(x,aa))-before,1000n);assert.equal(await vault.pendingBem(x,bb),0n);assert.equal(await vault.balanceOf(aa,x),0n);assert.deepEqual([...(await vault.accountAssetIds(aa,0,100))],[x]);
 const old=await bem.balanceOf(aa);await tx(vault.claimBem([x],aa));assert.ok(await bem.balanceOf(aa)>old);await tx(bem.mint((await vault.positions(x)).custody,200));await tx(vault.connect(b).claimBem([x],bb));assert.equal(await bem.balanceOf(bb),200n);
});

test('only the affected ID stops trading; healthy minting, transfers, claims and redemption continue',async()=>{
 const {signers:[a,b],addresses:[aa,bb],vault,mining,nft,market,bem}=sys;const x=await put(a,1,100),y=await put(b,2,60);await mine(p,100);await tx(mining.setState('0x'+x.toString(16).padStart(64,'0'),2));
 assert.equal(await vault.isTradable(x),false);assert.equal(await vault.isTradable(y),true);await put(a,3,100);
 await tx(vault.connect(b).setApprovalForAll(await market.getAddress(),true));const end=(await p.getBlock('latest')).timestamp+1000;await tx(market.connect(b).createListing(y,10,1000,end));await tx(market.buy(1,1,1000,end,{value:1010}));
 await tx(vault.claimBem([x],aa));assert.ok(await bem.balanceOf(aa)>0n);await tx(vault.redeem(x,aa,100));assert.equal(await nft.ownerOf(1),aa);assert.equal(await vault.isTradable(y),true);
});

test('failed harvest keeps transfers/trades/redemption live; funded history stays, unharvested BEM follows units',async()=>{
 const {signers:[a,b,c],addresses:[aa,bb,cc],vault,mining,bem,nft,market}=sys;const x=await put(a,1,100),key='0x'+x.toString(16).padStart(64,'0');await freeze([x]);
 await tx(bem.mint((await vault.positions(x)).custody,1000));await tx(vault.syncRewards([x]));const history=await vault.pendingBem(x,aa);
 await tx(mining.setRate(100));await mine(p,100);await tx(mining.setRate(0));const unsynced=await mining.pending(key);assert.equal(unsynced,1_000_000n);
 await tx(mining.setFailClaim(key,true));await tx(bem.mint((await vault.positions(x)).custody,200));
 const preview=await vault.previewBem.staticCall(x,aa);assert.equal(preview.harvested,false);assert.equal(preview.amount,history+200n);
 await tx(vault.safeTransferFrom(aa,bb,x,40,'0x'));assert.equal(await vault.pendingBem(x,bb),0n);assert.equal(await vault.pendingBem(x,aa),history+200n);
 await tx(vault.setApprovalForAll(market.target,true));const end=(await p.getBlock('latest')).timestamp+1000;await tx(market.createListing(x,10,1000,end));await tx(market.connect(c).buy(1,10,1000,end,{value:10100,gasLimit:3_000_000}));
 assert.equal(await vault.balanceOf(cc,x),10n);assert.equal(await vault.pendingBem(x,cc),0n);
 await tx(mining.setFailClaim(key,false));await tx(vault.syncRewards([x]));assert.equal(await vault.pendingBem(x,bb),400_000n);assert.equal(await vault.pendingBem(x,cc),100_000n);assert.equal(await vault.pendingBem(x,aa),history+200n+500_000n);
 await tx(vault.connect(b).safeTransferFrom(bb,aa,x,40,'0x'));await tx(vault.connect(c).safeTransferFrom(cc,aa,x,10,'0x'));await tx(mining.setFailClaim(key,true));
 await tx(vault.redeem(x,aa,100,{gasLimit:3_000_000}));assert.equal(await nft.ownerOf(1),aa);assert.equal(await vault.totalSupply(x),0n);
 for(const [signer,address]of [[a,aa],[b,bb],[c,cc]])await tx(vault.connect(signer).claimSettledBem([x],address));assert.equal(await vault.accountedBem(),0n);
 regressions.failedHarvest={transfer:true,marketFill:true,redemption:true,creditedRewardsStayWithSeller:true,unsyncedBem:'1000000',buyer40Percent:'400000',buyer10Percent:'100000',conservation:true};
});

test('a gas-burning upstream cannot consume the gas needed for local transfers and full redemption',async()=>{
 const {signers:[a,b],addresses:[aa,bb],vault,mining,nft}=sys;const x=await put(a,1,100),key='0x'+x.toString(16).padStart(64,'0');await tx(mining.setExhaustClaimGas(key,true));
 const transfer=await tx(vault.safeTransferFrom(aa,bb,x,100,'0x',{gasLimit:3_000_000}));assert.ok(transfer.gasUsed<2_000_000n);assert.equal(await vault.balanceOf(bb,x),100n);
 await tx(vault.connect(b).redeem(x,bb,100,{gasLimit:3_000_000}));assert.equal(await nft.ownerOf(1),bb);regressions.gasBurningHarvest={transfer:true,redemption:true,transferGasUsed:String(transfer.gasUsed),upstreamGasLimit:1000000};
});

test('redemption during failed harvest preserves funded BEM; unharvested reward follows the NFT recipient',async()=>{
 const {signers:[a,b],addresses:[aa,bb],vault,mining,nft,bem}=sys;const x=await put(a,1,100),key='0x'+x.toString(16).padStart(64,'0');await freeze([x]);
 const funded=await vault.pendingBem(x,aa);await tx(mining.setRate(100));await mine(p,100);await tx(mining.setRate(0));const unsynced=await mining.pending(key);await tx(mining.setFailClaim(key,true));
 await tx(vault.redeem(x,bb,100));assert.equal(await nft.ownerOf(1),bb);assert.equal(await vault.pendingBem(x,aa),funded);await tx(mining.setFailClaim(key,false));await tx(mining.claim(key));assert.equal(await bem.balanceOf(bb),unsynced);
 if(funded>0n)await tx(vault.claimSettledBem([x],aa));assert.equal(await bem.balanceOf((await vault.positions(x)).custody),0n);regressions.redemption={fundedHistoryPreserved:true,unharvestedBemFollowsNftRecipient:true};
});

test('pausing upstream does not trap already received BEM or funded claims',async()=>{
 const {signers:[a],addresses:[aa],vault,mining,bem}=sys;const x=await put(a,1,100);await freeze([x]);await tx(bem.mint((await vault.positions(x)).custody,500));await tx(mining.setPaused(true));const old=await bem.balanceOf(aa);await tx(vault.claimBem([x],aa));assert.ok((await bem.balanceOf(aa))-old>=500n);
});

test('all shares of selected ID are required; other IDs cannot substitute; no forced buyout',async()=>{
 const {signers:[a,b],addresses:[aa,bb],vault,nft}=sys;const x=await put(a,1,100),y=await put(a,2,100);await tx(vault.safeTransferFrom(aa,bb,x,1,'0x'));
 await rejects(vault.redeem(x,aa,100));await rejects(vault.redeem(y,aa,99));await tx(vault.redeem(y,aa,100));assert.equal(await nft.ownerOf(2),aa);await tx(vault.connect(b).safeTransferFrom(bb,aa,x,1,'0x'));await tx(vault.redeem(x,aa,100));assert.equal(await nft.ownerOf(1),aa);assert.equal(await vault.totalH(),0n);assert.equal(await vault.minerCount(),0n);
});

test('redemption/redeposit of same NFT never resets past rewards or gives them to its new holder',async()=>{
 const {signers:[a,b],addresses:[aa,bb],vault,bem,nft}=sys;const x=await put(a,1,100);await freeze([x]);await tx(bem.mint((await vault.positions(x)).custody,1000));await tx(vault.redeem(x,bb,100));const past=await vault.pendingBem(x,aa),index=await vault.accBemPerH(x);assert.ok(past>=1000n);
 await tx(nft.connect(b).approve(await vault.getAddress(),1));await tx(vault.connect(b).deposit(await nft.getAddress(),1,100));assert.equal(await vault.accBemPerH(x),index);assert.equal(await vault.pendingBem(x,bb),0n);assert.equal(await vault.pendingBem(x,aa),past);assert.equal(await vault.positionCount(),1n);await tx(vault.claimBem([x],aa));
});

test('extra actual BEM uses ordinary settlement, without issuing extra Micro or special exit',async()=>{
 const {signers:[a],addresses:[aa],vault,mining,bem,nft}=sys;const x=await put(a,1,100),k='0x'+x.toString(16).padStart(64,'0');await mine(p,100);await tx(mining.promote(k,100));await mine(p,100);await tx(mining.demote(k));await tx(vault.syncRewards([x]));assert.equal(await vault.totalSupply(x),100n);assert.equal(await vault.isTradable(x),true);assert.ok(await vault.pendingBem(x,aa)>0n);assert.equal(await bem.balanceOf((await vault.positions(x)).custody),0n);await tx(vault.redeem(x,aa,100));assert.equal(await nft.ownerOf(1),aa);
});

test('actual mint clipping is accounted, never upstream debt differences',async()=>{
 const {signers:[a],addresses:[aa],vault,mining,bem}=sys;const x=await put(a,1,100);await freeze([x]);await tx(mining.setPayoutBps(5000));await tx(mining.setRate(100));await mine(p,100);await tx(mining.claim('0x'+x.toString(16).padStart(64,'0')));await tx(mining.setRate(0));await tx(mining.claim('0x'+x.toString(16).padStart(64,'0')));const custody=(await vault.positions(x)).custody,received=await bem.balanceOf(custody),old=await vault.bemReceived(x);await tx(vault.syncRewards([x]));assert.equal((await vault.bemReceived(x))-old,received);assert.ok((await vault.pendingBem(x,aa))<=await vault.bemReceived(x));
});

test('custody has no public sweep, NFT release, reinitialization or arbitrary execution',async()=>{
 const {signers:[a,b],addresses:[aa,bb],vault,nft}=sys;const x=await put(a,1,100),pos=await vault.positions(x),c=await at('TapeMicroCustody',pos.custody,b),collection=await nft.getAddress();
 const unauthorized=error=>error.code==='CALL_EXCEPTION'&&error.data===c.interface.getError('Unauthorized').selector;
 // Start each rejected call only after its rejection handler is attached.
 for(const call of [()=>c.collect(),()=>c.release(bb),()=>c.initialize(collection,1,bb)])await assert.rejects(call,unauthorized);
 const implementation=await at('TapeMicroCustody',await vault.custodyImplementation(),a);await assert.rejects(()=>implementation.initialize(collection,1,aa),unauthorized);assert.equal(await nft.ownerOf(1),pos.custody);
});

test('receiver reentry is blocked, refusal rolls back transfer and reward settlement',async()=>{
 const {signers:[a],addresses:[aa],vault}=sys;const x=await put(a,1,100),r=await deploy('ReentryReceiver',a,[await vault.getAddress()]);await tx(vault.safeTransferFrom(aa,await r.getAddress(),x,5,'0x'));assert.equal(await r.reentryBlocked(),true);await tx(r.setReject(true));await rejects(vault.safeTransferFrom(aa,await r.getAddress(),x,5,'0x'));assert.equal(await vault.balanceOf(await r.getAddress(),x),5n);
});

test('duplicate-ID batch transfers preserve subatomic fractions; invalid size and destinations fail',async()=>{
 const {signers:[a,b],addresses:[aa,bb],vault,bem}=sys;const x=await put(a,1,3);await freeze([x]);for(let i=0;i<12;i++){await tx(bem.mint((await vault.positions(x)).custody,1));await tx(vault.connect(i%2?b:a).safeBatchTransferFrom(i%2?bb:aa,i%2?aa:bb,[x,x],[0,1],'0x',{gasLimit:3_000_000}));}
 // Block timestamps may change the upstream checkpoint SSTORE after estimate.
 await tx(vault.syncRewards([x]));for(const [s,who]of [[a,aa],[b,bb]])if(await vault.pendingBem(x,who)>0n)await tx(vault.connect(s).claimBem([x],who,{gasLimit:3_000_000}));assert.ok(await vault.totalBemPaid()<=await vault.totalBemReceived());assert.equal(await vault.accountedBem(),await bem.balanceOf(await vault.getAddress()));await rejects(vault.syncRewards([]));await rejects(vault.syncRewards(Array(33).fill(x)));await rejects(vault.positionIds(0,101));await rejects(vault.safeTransferFrom(aa,await vault.getAddress(),x,1,'0x'));
});
