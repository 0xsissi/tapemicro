// Bind the current owner/renunciation regression evidence to the exact release.
// Reads local test outputs only; never signs or sends transactions.
import assert from 'node:assert/strict';
import {readFile,writeFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {keccak256,ZeroAddress} from 'ethers';
import {root} from './chain-helpers.mjs';
const dir='output/ownership-rc4/',sha=b=>createHash('sha256').update(b).digest('hex');
const json=async name=>JSON.parse(await readFile(root+name,'utf8'));
const [verified,front,fork,production,browser,chain,cfg]=await Promise.all([
 'output/contract-tests-rc4.json','output/frontend-integration-rc4.json','output/fork-integration-rc4.json',
 'output/mainnet-readiness-20261017/production-path-fork.json',dir+'browser-checks.json',dir+'ui-chain-state.json','src/config.json'
].map(json));
assert.equal(verified.passed,true);assert.equal(verified.tests,36);assert.equal(verified.failedCount,0);
assert.equal(front.passed,true);assert.equal(front.mainnetWrites,false);assert.ok(front.checks.some(s=>s.includes('owner handover')));
assert.match(await readFile(root+dir+'frontend-tests.txt','utf8'),/tests\s+49\b/);
assert.match(await readFile(root+dir+'frontend-tests.txt','utf8'),/fail\s+0\b/);
assert.equal(fork.localOnly,true);assert.ok(Object.values(fork.checks).every(Boolean));
assert.equal(production.mainnetBroadcast,false);assert.equal(production.checks.ownerHandoverAndRenunciationDoNotFreezeProductionGateway,true);
for(const [name,field]of [['TapeMicroVault','vaultInitCodeHash'],['TapeMicroMarket','marketInitCodeHash'],['TapeMicroCustody','custodyInitCodeHash']]){
 const a=await json('artifacts/'+name+'.json'),hash=keccak256(a.bytecode);
 assert.equal(verified.build[name],hash);assert.equal(fork.build[field],hash);
}
for(const [file,hash]of Object.entries({...verified.sources,...front.sources}))assert.equal(sha(await readFile(root+file)),hash,file);
assert.equal(sha(await readFile(root+'artifacts/compiler-input.json')),verified.compilerInputSha256);
for(const key of ['localOnly','previewEnabled','editedAddressInvalidatesPreview','oldOwnerRetainsControlUntilAcceptance','pendingOwnerCannotAcceptAsOldWallet','cancelWorks','formerOwnerCannotChangeRecipient','nomineeCanAccept','feeCollectionAfterRenounce','managementDisabledAfterRenounce'])assert.equal(browser[key],true,key);
assert.equal(browser.mainnetWrites,false);assert.equal(browser.renouncedOwner,ZeroAddress);assert.equal(browser.console.length,0);
assert.equal(browser.englishMobile.unexpectedChinese,false);assert.equal(browser.englishMobile.scrollWidth,browser.englishMobile.viewport);
assert.equal(chain.owner,ZeroAddress);assert.equal(chain.pendingOwner,ZeroAddress);assert.equal(chain.feeRecipient,browser.finalRecipient);assert.equal(chain.accruedFees,'0');assert.equal(chain.containerBalance,'10000000000000');
assert.equal(cfg.vault,null);assert.equal(cfg.market,null);assert.equal(cfg.deploymentBlock,null);
const sources={},evidence={};
async function bind(map,file){map[file]=sha(await readFile(root+file));}
async function walk(path){for(const e of await readdir(root+path,{withFileTypes:true})){const file=path+'/'+e.name;if(e.isDirectory())await walk(file);else if(!['src/config.local.json','src/generated-protocol.json','src/generated-deployment.json','src/app.js'].includes(file))await bind(sources,file);}}
for(const path of ['contracts','scripts','src','test'])await walk(path);
for(const file of ['README.md','VERIFICATION.md','SECURITY.md','交易设计.md','合约改版RC4.md','前端改版RC4.md','主网上线检查RC4.md','现有功能完善RC4.md','方案确认记录.md','矿机准入与失效.md','DEPLOYMENT.md','LICENSE','THIRD_PARTY_NOTICES.txt','package.json','package-lock.json','.npmrc','.gitignore','.gitattributes','dist/release-manifest.json'])await bind(sources,file);
for(const name of ['TapeMicroVault.json','TapeMicroMarket.json','TapeMicroCustody.json','IPodMining.json','MockBem.json','MockMinerNFT.json','MockMining.json','SellerHarness.json','ReentryReceiver.json','MockFeeContainer.json','compiler-input.json'])await bind(sources,'artifacts/'+name);
for(const name of ['unsigned-plan.json','TapeMicroVault.json','TapeMicroMarket.json','TapeMicroCustody.json','compiler-input.json'])await bind(sources,'output/deployment/'+name);
for(const file of ['output/contract-tests-rc4.json','output/contract-tests-rc4.tap','output/frontend-integration-rc4.json','output/fork-integration-rc4.json','output/mock-gas-rc4.json','output/mainnet-readiness-20261017/production-path-fork.json','output/mainnet-readiness-20261017/upstream.json'])await bind(evidence,file);
for(const file of ['contract-tests.txt','frontend-tests.txt','core-fork.txt','production-fork.txt','browser-checks.json','ui-fixture.mjs','ui-fixture.json','ui-chain-state.json','owner-renounce-preview.png','owner-renounced-zh.png','owner-en-mobile.png'])await bind(evidence,dir+file);
const feePolicy={rateBps:100,rateMutable:false,initialOwner:'actual deployer',identityAnchor:'immutable initialFeeManager; config.feeManager stores initial deployer',currentManager:'owner(); feeManager() aliases current owner',authority:['setFeeRecipient','transferOwnership / acceptOwnership','renounceOwnership'],managerRotatable:true,twoStepAcceptance:true,renouncePermanently:true,renounceDestination:ZeroAddress,feeRecipientAfterRenounce:'last configured nonzero recipient, unchanged',recipientMutable:'current owner only; permanently fixed after renunciation',uncollectedFees:'follow the current recipient',vaultAdmin:false,upgradeable:false};
const report={date:'2026-10-17',version:cfg.version,protocolVersion:2,passed:true,contractTests:36,frontendTests:49,ownerTransferAndRenunciation:true,mainnetWrites:false,privateKeysRead:false,productionLaunchReady:false,feePolicy,forkBlock:fork.fork.forkConfig.forkBlockNumber,productionForkBlock:production.forkBlock,checks:[
 'Only current owner can change recipient; pending and former owner cannot',
 'Only current owner initiates/replaces/cancels handover; only nominated wallet accepts',
 'transferOwnership(0) cancels handover; renounceOwnership permanently clears owner and pendingOwner',
 'Renunciation leaves fee recipient unchanged; fee collection, trading, BEM claims and NFT redemption stay usable',
 'Runtime/deployer identity remains pinned; website reads current owner and continues after handover or renunciation',
 'Chinese browser flow and English mobile layout tested using isolated loopback Anvil',
 'Earlier admission, harvest failure, 70-miner and 16-fill stress cases remain covered by current test suite'
 ],limitations:['No mainnet deployment, real wallet extension signing, independent audit or real project-container withdrawal acceptance','Historical reports retain their original source hashes and describe earlier permission versions'],sources,evidence,verifiedAt:new Date().toISOString()};
await writeFile(root+dir+'verification.json',JSON.stringify(report,null,2));
const readiness=await json('output/mainnet-readiness-20261017/summary.json');
Object.assign(readiness,{contractTests:{passed:36,failed:0},frontendAndToolTests:{passed:49,failed:0},upstreamForkBlock:report.forkBlock,productionAdapterForkBlock:production.forkBlock,build:verified.build,feePolicy,ownerManagementFollowUp:{report:dir+'verification.json',contractTests:36,frontendTests:49,mainnetWrites:false},sources,evidence:{...evidence,[dir+'verification.json']:sha(await readFile(root+dir+'verification.json'))}});
readiness.remaining=readiness.remaining.map(s=>s.replace('including actual project-container withdrawal','and initial wallet fee receipt; project-container withdrawal is required before a later container switch'));
await writeFile(root+'output/mainnet-readiness-20261017/summary.json',JSON.stringify(readiness,null,2));
console.log(JSON.stringify({passed:report.passed,contractTests:36,frontendTests:49,forkBlock:report.forkBlock,productionForkBlock:production.forkBlock,mainnetWrites:false,sources:Object.keys(sources).length,evidence:Object.keys(evidence).length}));
