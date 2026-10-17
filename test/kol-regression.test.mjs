import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import path from 'node:path';
import {startAnvil,mockSystem,deploy,tx} from '../scripts/chain-helpers.mjs';
import {run,applyBatch,emptyState} from '../scripts/kol-points.mjs';import {appendRef} from '../src/referral.mjs';
test('open-mode accounting preserves the first referrer and accumulates sub-wei point fractions across fills',()=>{
 const k='0x'+'11'.repeat(20),other='0x'+'22'.repeat(20),u='0x'+'33'.repeat(20),state=emptyState('x');
 const batch={referralMode:'open',kols:[],rules:{kolShareBps:1},txs:[{from:u,hash:'a',block:1,txIndex:0,timestamp:1,data:appendRef('0x12345678',k)},{from:u,hash:'b',block:2,txIndex:0,timestamp:2,data:appendRef('0x12345678',other)}],fills:Array.from({length:10},(_,i)=>({hash:'b',block:2,txIndex:0,logIndex:i,timestamp:2,parties:[u],gross:1n}))};
 applyBatch(state,batch);assert.equal(state.wallets[u].kol,k);assert.equal(state.kols[k].pointsRaw,'1');assert.equal(state.kols[k].volumeWei,'10');assert.equal(state.kols[other],undefined);
});
test('successful calls without logs prevent late binding; checkpoints detect reorgs, changed targets and wrong networks',{timeout:120000},async()=>{
 const node=await startAnvil(),dir=await mkdtemp(path.join(tmpdir(),'kol-regression-'));try{
  const sys=await mockSystem(node.provider),{signers:[a,b,c],addresses,vault}=sys,market=await deploy('TapeMicroMarketV2',a,[vault.target,addresses[4]]),provider=node.provider;
  const list=path.join(dir,'list.json'),file=path.join(dir,'config.json');await writeFile(list,JSON.stringify({mode:'open',kols:[]}));
  const cfg={chainId:31337,vault:vault.target,markets:[market.target],deploymentBlock:1,kolList:list,statePath:path.join(dir,'state.json'),outPath:path.join(dir,'points.json'),confirmations:0,logChunk:9,concurrency:3};
  const silent=await tx(vault.connect(b).syncRewards([123]));assert.equal(silent.logs.length,0);
  await tx(b.sendTransaction({to:vault.target,data:appendRef(vault.interface.encodeFunctionData('setApprovalForAll',[market.target,true]),addresses[4])}));
  await tx(c.sendTransaction({to:vault.target,data:appendRef(vault.interface.encodeFunctionData('setApprovalForAll',[market.target,true]),addresses[4])}));
  await writeFile(file,JSON.stringify(cfg));const out=await run({configPath:file,provider,log:()=>{}});assert.equal(out.referralMode,'open');assert.equal(out.referees.length,1);assert.equal(out.referees[0].address,addresses[2]);
  const initial=await readFile(cfg.statePath,'utf8');await assert.rejects(run({configPath:file,toBlock:out.toBlock-1,provider,log:()=>{}}),/--full/);cfg.markets=[sys.market.target];await writeFile(file,JSON.stringify(cfg));await assert.rejects(run({configPath:file,provider,log:()=>{}}),/--full/);assert.equal(await readFile(cfg.statePath,'utf8'),initial);
  cfg.markets=[market.target];cfg.chainId=56;await writeFile(file,JSON.stringify(cfg));await assert.rejects(run({configPath:file,provider,log:()=>{}}),/chainId/);
  cfg.chainId=31337;await writeFile(file,JSON.stringify(cfg));const saved=JSON.parse(initial);saved.lastBlockHash='0x'+'00'.repeat(32);await writeFile(cfg.statePath,JSON.stringify(saved));await assert.rejects(run({configPath:file,provider,log:()=>{}}),/reorganized/);
 }finally{await node.stop();await rm(dir,{recursive:true,force:true});}
});
