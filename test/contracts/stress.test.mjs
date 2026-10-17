import test from 'node:test';
import assert from 'node:assert/strict';
import {writeFile,mkdir} from 'node:fs/promises';
import {startAnvil,mockSystem,tx,root} from '../../scripts/chain-helpers.mjs';
test('70 miners exceed old cap; one-ID gas stays bounded; 16 distinct IDs trade in one transaction',async()=>{
 const node=await startAnvil(),p=node.provider;try{
  const {signers:[a,b],addresses:[aa,bb],nft,mining,vault,market,mintMiner}=await mockSystem(p);await tx(mining.setRate(0));const ids=[];let firstGas;
  for(let id=1;id<=70;id++){await mintMiner(a,id,10);await tx(vault.deposit(await nft.getAddress(),id,10,{gasLimit:5_000_000}));ids.push(await vault.assetId(await nft.getAddress(),id));if(id===1){await tx(vault.safeTransferFrom(aa,bb,ids[0],1,'0x'));firstGas=(await tx(vault.safeTransferFrom(aa,bb,ids[0],1,'0x'))).gasUsed;}}
  assert.equal(await vault.minerCount(),70n);assert.equal(await vault.totalH(),700n);const laterGas=(await tx(vault.safeTransferFrom(aa,bb,ids[0],1,'0x'))).gasUsed;assert.ok(laterGas<=firstGas+5000n,`${firstGas} -> ${laterGas}`);
  await tx(vault.setApprovalForAll(await market.getAddress(),true));const end=(await p.getBlock('latest')).timestamp+86400;for(let i=0;i<16;i++)await tx(market.createListing(ids[i],2,1000,end));const r=await tx(market.connect(b).buyBatch(ids.slice(0,16).map((_,i)=>[i+1,1,1000]),16160,end,{value:16160,gasLimit:15_000_000}));assert.ok(r.gasUsed<15_000_000n);assert.equal(await market.accruedFees(),160n);assert.equal(await market.totalProceeds(),0n);assert.equal(await market.tradePoints(bb),16000n);
  await mkdir(root+'output',{recursive:true});await writeFile(root+'output/mock-gas-rc4.json',JSON.stringify({note:'Mock upstream; not a future BSC worst-case guarantee',miners:70,idsPerTrade:16,oneIdGasAt1Miner:String(firstGas),oneIdGasAt70Miners:String(laterGas),batchGas:String(r.gasUsed)},null,2));
 }finally{await node.stop();}
});

test('75 mixed multi-ID actions preserve supply, per-ID reward attribution and actual BEM solvency',async()=>{
 const node=await startAnvil(),p=node.provider;try{
  const {signers,addresses,nft,mining,vault,bem,mintMiner}=await mockSystem(p);await tx(mining.setRate(0));const ids=[],supplies=[101n,60n,12n];for(let i=0;i<3;i++){await mintMiner(signers[0],i+1,supplies[i]);await tx(vault.deposit(await nft.getAddress(),i+1,supplies[i]));ids.push(await vault.assetId(await nft.getAddress(),i+1));}
  let seed=81723;const rand=n=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed%n;};
  for(let i=0;i<75;i++){
   const a=rand(5),b=rand(5),id=ids[rand(3)],bal=await vault.balanceOf(addresses[a],id);
   if(i%3===0){await tx(bem.mint((await vault.positions(id)).custody,1+rand(100)));await tx(vault.syncRewards([id],{gasLimit:3_000_000}));}
   else if(i%7===0){if(await vault.pendingBem(id,addresses[a])>0n)await tx(vault.connect(signers[a]).claimBem([id],addresses[a],{gasLimit:3_000_000}));}
   else{const amount=bal===0n?0n:BigInt(rand(Number(bal)+1));await tx(vault.connect(signers[a]).safeBatchTransferFrom(addresses[a],addresses[b],[id,id],[amount/2n,amount-amount/2n],'0x',{gasLimit:3_000_000}));}
   for(let k=0;k<3;k++){const amounts=await Promise.all(addresses.map(w=>vault.balanceOf(w,ids[k]))),pending=await Promise.all(addresses.map(w=>vault.pendingBem(ids[k],w)));assert.equal(amounts.reduce((a,b)=>a+b,0n),supplies[k]);assert.ok(pending.reduce((a,b)=>a+b,0n)+(await vault.bemPaid(ids[k]))<=await vault.bemReceived(ids[k]));}
   assert.equal(await vault.accountedBem(),await bem.balanceOf(await vault.getAddress()));assert.equal(await vault.accountedBem(),(await vault.totalBemReceived())-(await vault.totalBemPaid()));
  }
 }finally{await node.stop();}
});
