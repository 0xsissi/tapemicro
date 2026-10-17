import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {getCreateAddress,ContractFactory,ZeroAddress} from 'ethers';
import {artifact} from '../scripts/chain-helpers.mjs';
import {deploymentPlan} from '../src/deployment.mjs';
import {marketDeploymentBlock} from '../src/deployment-receipt.mjs';
import {verifyFeeReceipt} from '../src/fee-container.mjs';

test('fixed fee recipient must accept a read-only native BNB transfer simulation',async()=>{
 const recipient='0x2222222222222222222222222222222222222222',from='0x1111111111111111111111111111111111111111';let sent;
 const result=await verifyFeeReceipt({call:async request=>{sent=request;return'0x';}},recipient,from);
 assert.deepEqual(sent,{from,to:recipient,value:1n,data:'0x'});assert.equal(result.readOnly,true);
 await assert.rejects(verifyFeeReceipt({call:async()=>{throw Error('reject');}},recipient,from),/BNB/);
});
test('blank deployer produces unsigned vault data, never inventing a marketplace constructor',async()=>{
 const cfg=JSON.parse(await readFile(new URL('../src/config.json',import.meta.url),'utf8'));
 const a={TapeMicroVault:await artifact('TapeMicroVault'),TapeMicroMarket:await artifact('TapeMicroMarket'),TapeMicroMarketV2:await artifact('TapeMicroMarketV2')};
 const blank=await deploymentPlan(cfg,a);assert.equal(blank.deployer,null);assert.equal(blank.addresses,null);assert.equal(blank.broadcast,false);assert.equal(blank.transactions[1].data,null);assert.ok(blank.transactions[0].data.startsWith(a.TapeMicroVault.bytecode));
 const address='0x1111111111111111111111111111111111111111',missing=await deploymentPlan(cfg,a,address,27);assert.ok(missing.transactions[1].data);assert.equal(missing.feeRecipient,address);assert.equal(missing.feeManager,address);
 const recipient='0x2222222222222222222222222222222222222222',p=await deploymentPlan({...cfg,feeRecipient:recipient},a,address,27);
 assert.equal(p.addresses.vault,getCreateAddress({from:address,nonce:27}));assert.equal(p.addresses.market,getCreateAddress({from:address,nonce:28}));assert.equal(p.transactions[1].nonce,28);
 const encoded=await new ContractFactory(a.TapeMicroMarketV2.abi,a.TapeMicroMarketV2.bytecode).getDeployTransaction(p.addresses.vault,address);assert.equal(p.transactions[1].data,encoded.data);assert.equal(p.feeBps,100);assert.equal(p.feeRecipient,address);assert.equal(p.broadcast,false);
 await assert.rejects(deploymentPlan(cfg,a,ZeroAddress,27));
 assert.equal(p.marketVersion,cfg.marketVersion);assert.equal(p.transactions[1].contract,'TapeMicroMarketV2');
 const designated=await deploymentPlan(cfg,a,'0xfa1867bd071fb52b0f2ed73cee30f899093090be',27);assert.equal(designated.deployer.toLowerCase(),'0xfa1867bd071fb52b0f2ed73cee30f899093090be');assert.equal(designated.feeRecipient,designated.deployer);assert.equal(designated.broadcast,false);
});

test('exported scan start must come from the successful creation receipt of this market',()=>{
 const market='0x2222222222222222222222222222222222222222',hash='0x'+'ab'.repeat(32),receipt={status:1,hash,contractAddress:market,blockNumber:128050000};
 assert.equal(marketDeploymentBlock(receipt,market,hash),128050000);
 for(const bad of [null,{...receipt,status:0},{...receipt,contractAddress:null},{...receipt,contractAddress:'0x3333333333333333333333333333333333333333'},{...receipt,hash:'0x'+'cd'.repeat(32)},{...receipt,blockNumber:0}])assert.throws(()=>marketDeploymentBlock(bad,market,hash));
 assert.throws(()=>marketDeploymentBlock(receipt,market,'invalid'));
});
