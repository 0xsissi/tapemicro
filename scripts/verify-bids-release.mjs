// Bind current tests, fork and browser evidence to this exact two-sided release.
// No signer, private key access or chain writes are used here.
import assert from 'node:assert/strict';
import {readFile,writeFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {keccak256} from 'ethers';
import {root} from './chain-helpers.mjs';
const dir='output/bids-v2/',sha=b=>createHash('sha256').update(b).digest('hex');
const json=async file=>JSON.parse(await readFile(root+file,'utf8'));
const [verified,front,adapter,fork,random,browser,chain,layouts,consoleLog,cfg,baseline,server,plan,preflight]=await Promise.all([
 'output/contract-tests-rc4.json','output/frontend-integration-rc4.json',dir+'frontend-integration.json',dir+'fork.json',dir+'random-ledger.json',dir+'browser-checks.json',dir+'ui-chain-state.json',dir+'layout-checks.json',dir+'console.json','src/config.json',dir+'unchanged-baseline.json','output/server-deployment/verification.json','output/deployment/unsigned-plan.json','output/deployment/mainnet-preflight.json'
].map(json));
assert.equal(verified.passed,true);assert.equal(verified.tests,58);assert.equal(verified.failedCount,0);
assert.equal(front.passed,true);assert.equal(front.mainnetWrites,false);assert.equal(adapter.passed,true);assert.equal(adapter.marketVersion,3);assert.equal(adapter.mainnetWrites,false);
const frontendLog=await readFile(root+dir+'frontend-tests.txt','utf8');
for(const pattern of [/tests\s+61\b/,/pass\s+61\b/,/fail\s+0\b/])assert.match(frontendLog,pattern);
const review=await json(dir+'review-checks.json'),reviewLayouts=await json(dir+'review-layouts.json'),reviewConsole=await json(dir+'review-console.json');
assert.equal(review.passed,true);assert.equal(review.mainnetWrites,false);
assert.equal(review.manifestSha256,sha(await readFile(root+'dist/release-manifest.json')));
for(const [file,hash]of Object.entries(review.sources))assert.equal(sha(await readFile(root+file)),hash,file);
for(const value of Object.values(review.checks))assert.ok(typeof value==='boolean'?value:Object.values(value).every(Boolean));
for(const key of ['unrelatedCheaperAskAllowed','compatibleEqualAskBlocked','unrelatedBookCrossWarningHidden','mobileEnglishSale','finalEnglishUnlistedCaption'])assert.equal(review.checks[key],true);
for(const key of ['src/bid-plan.mjs','src/app-controller.mjs','src/bid-ui.mjs','src/i18n.mjs'])assert.ok(review.sources[key]);
assert.equal(reviewLayouts.length,16);for(const row of reviewLayouts){assert.equal(row.scrollWidth,row.clientWidth);assert.equal(row.unexpectedChinese,false);}
for(const size of ['mobile','desktop'])for(const language of ['en','zh-CN']){const rows=reviewLayouts.filter(r=>r.size===size&&r.language===language);assert.equal(new Set(rows.map(r=>r.route)).size,4);assert.equal(new Set(rows.map(r=>r.navLeft)).size,1);}
assert.equal(reviewConsole.filter(row=>!row.url?.startsWith('chrome-extension://')).length,0);
const cancelled=adapter.cancellation;assert.equal(cancelled.localOnly,true);assert.equal(cancelled.chainId,31337);assert.equal(cancelled.originalH,'20');assert.equal(cancelled.filledH,'7');assert.equal(cancelled.refundedH,'13');assert.equal(cancelled.remainingH,'0');assert.equal(cancelled.escrowAfterWei,'0');
assert.equal(BigInt(cancelled.refundWei),BigInt(cancelled.refundedH)*BigInt(cancelled.priceWei));assert.equal(BigInt(cancelled.balanceAfterWei)-BigInt(cancelled.balanceBeforeWei)+BigInt(cancelled.gasFeeWei),BigInt(cancelled.refundWei));
for(const [file,hash]of Object.entries({...verified.sources,...front.sources}))assert.equal(sha(await readFile(root+file)),hash,file);
assert.equal(sha(await readFile(root+'artifacts/compiler-input.json')),verified.compilerInputSha256);
for(const name of ['TapeMicroVault','TapeMicroMarket','TapeMicroMarketV2','TapeMicroCustody'])assert.equal(keccak256((await json('artifacts/'+name+'.json')).bytecode),verified.build[name]);
assert.equal(fork.passed,true);assert.equal(fork.localOnly,true);assert.equal(fork.mainnetWrites,false);assert.equal(fork.marketVersion,3);assert.ok(Object.values(fork.checks).every(Boolean));assert.equal(fork.marketInitCodeHash,verified.build.TapeMicroMarketV2);
for(const name of ['TapeMicroVault','TapeMicroCustody']){assert.equal((await json('artifacts/'+name+'.json')).bytecode,baseline[name+'InitBytecode']);assert.equal(sha(await readFile(root+'contracts/'+name+'.sol')),baseline['contracts/'+name+'.sol']);}
assert.equal(random.passed,true);assert.equal(random.groups.length,8);for(const group of random.groups){assert.equal(group.passed,true);assert.equal(group.steps,400);assert.ok(Object.values(group.counts).every(n=>n>0));}
const admission=await json('output/admission-review-rc4/regressions.json');assert.equal(admission.localOnly,true);assert.equal(admission.mainnetWrites,false);assert.equal(admission.largeMiner.upstreamCheckCalls,1);assert.equal(admission.largeMiner.negativeOldBudgetRejected,true);assert.ok(BigInt(admission.largeMiner.gasUsed)<BigInt(admission.largeMiner.transactionGasLimit));assert.ok(Object.values(admission.redemption).every(Boolean));assert.equal(admission.failedHarvest.conservation,true);
assert.equal(browser.passed,true);assert.equal(browser.mainnetWrites,false);assert.ok(Object.values(browser.checks).every(Boolean));assert.equal(chain.localOnly,true);assert.equal(chain.marketVersion,3);
assert.equal(BigInt(chain.marketBalance),BigInt(chain.totalBidEscrow)+BigInt(chain.totalProceeds)+BigInt(chain.accruedFees));
assert.equal(chain.bids.find(b=>b.id==='3').remaining,'0');assert.equal(chain.points[0],'7050000000000000');assert.equal(chain.bemBalances[0],'14040000');
assert.equal(layouts.length,16);for(const item of layouts){assert.equal(item.scrollWidth,item.viewport);if(item.language==='en')assert.equal(item.unexpectedChinese,false);}
for(const size of ['mobile','desktop'])for(const language of ['en','zh'])assert.equal(new Set(layouts.filter(x=>x.size===size&&x.language===language).map(x=>x.navLeft)).size,1);
const appConsole=consoleLog.filter(item=>!item.url?.startsWith('chrome-extension://'));assert.equal(appConsole.length,0);
for(const key of ['vault','market','deploymentBlock','feeManager','feeRecipient'])assert.equal(cfg[key],null);assert.equal(cfg.marketVersion,3);
assert.equal(plan.broadcast,false);assert.equal(plan.marketVersion,3);assert.equal(plan.deployer.toLowerCase(),'0xfa1867bd071fb52b0f2ed73cee30f899093090be');assert.equal(plan.feeRecipient,plan.deployer);assert.equal(preflight.readOnly,true);assert.equal(preflight.mainnetBroadcast,false);
assert.equal(server.passed,true);assert.equal(server.tlsVerified,true);assert.equal(server.resourcesVerified,23);assert.equal(server.mainnetDeployed,false);assert.equal(server.manifestSha256,sha(await readFile(root+'dist/release-manifest.json')));
const domain=await json('output/server-deployment/domain-verification.json');assert.equal(domain.passed,true);assert.ok(Object.values(domain.checks).every(Boolean));assert.equal(domain.primaryUrl,'https://tapemicro.top/');assert.equal(server.url,domain.primaryUrl);assert.equal(domain.manifestSha256,server.manifestSha256);
const sources={},evidence={};
async function bind(map,file){map[file]=sha(await readFile(root+file));}
async function walk(path){for(const e of await readdir(root+path,{withFileTypes:true})){const file=path+'/'+e.name;if(e.isDirectory())await walk(file);else if(!['src/config.local.json','src/generated-protocol.json','src/generated-deployment.json','src/app.js'].includes(file))await bind(sources,file);}}
for(const path of ['contracts','scripts','src','test'])await walk(path);
for(const file of ['README.md','VERIFICATION.md','SECURITY.md','交易设计.md','合约改版RC4.md','前端改版RC4.md','主网上线检查RC4.md','买单实现说明.md','现有功能完善RC4.md','方案确认记录.md','矿机准入与失效.md','DEPLOYMENT.md','LICENSE','THIRD_PARTY_NOTICES.txt','package.json','package-lock.json','.npmrc','.gitignore','.gitattributes','dist/release-manifest.json'])await bind(sources,file);
for(const name of ['TapeMicroVault.json','TapeMicroMarket.json','TapeMicroMarketV2.json','TapeMicroCustody.json','IPodMining.json','MockBem.json','MockMinerNFT.json','MockMining.json','SellerHarness.json','ReentryReceiver.json','BidHarness.json','MockFeeContainer.json','compiler-input.json'])await bind(sources,'artifacts/'+name);
for(const name of ['unsigned-plan.json','TapeMicroVault.json','TapeMicroMarket.json','TapeMicroMarketV2.json','TapeMicroCustody.json','compiler-input.json','mainnet-preflight.json'])await bind(sources,'output/deployment/'+name);
for(const file of ['output/contract-tests-rc4.json','output/contract-tests-rc4.tap','output/frontend-integration-rc4.json','output/fork-integration-rc4.json','output/mock-gas-rc4.json','output/admission-review-rc4/regressions.json','output/mainnet-readiness-20261017/production-path-fork.json','output/mainnet-readiness-20261017/upstream.json'])await bind(evidence,file);
for(const file of ['contract-tests.txt','frontend-tests.txt','fork-tests.txt','fork.json','random-ledger.json','frontend-integration.json','unchanged-baseline.json','browser-checks.json','layout-checks.json','console.json','ui-fixture.mjs','ui-fixture.json','ui-chain-state.json'])await bind(evidence,dir+file);
for(const file of ['review-checks.json','review-layouts.json','review-console.json','DEVELOPMENT-NOTES.md','prepare-server.py','complete-review.mjs'])await bind(evidence,dir+file);
for(const file of await readdir(root+dir+'ui'))if(file.endsWith('.png'))await bind(evidence,dir+'ui/'+file);
for(const file of ['prepared.json','verification.json','DEPLOYED.md','tapemicro.conf','domain.conf','legacy-redirect.conf','tapemicro-cert-renew.service','tapemicro-cert-renew.timer','domain-verification.json','record-domain.py'])await bind(evidence,'output/server-deployment/'+file);
for(const file of ['installed.json','origin-verification.json','update.py','domain-before-bid-review.json'])await bind(evidence,'output/server-deployment/'+file);
const report={date:new Date().toISOString(),version:cfg.version,protocolVersion:2,marketVersion:3,passed:true,contractTests:58,frontendTests:61,randomLedgerSteps:3200,bidReviewFollowUp:true,ownerTransferAndRenunciation:true,vaultAndCustodyUnchanged:true,mainnetWrites:false,privateKeysRead:false,websitePublished:true,productionLaunchReady:false,forkBlock:fork.forkBlock,build:verified.build,appConsoleErrors:appConsole.length,walletExtensionIssuesObserved:consoleLog.length>0,checks:['Exact principal escrow and refunds; independent native+gas+unit+BEM ledger','Production gateway and real BSC miner bid lifecycle verified on an owned local fork','Default-empty acceptance, partial fills, both trading directions, crossed-price prompts and points checked in browser','Four routes in Chinese and English on desktop and mobile, without overflow or navigation jumps','All public HTTPS resource hashes match this build; existing server access rules remain outside the dedicated public static host','User-designated public deployer supported; unsigned plan only, no key read or mainnet broadcast'],limitations:['Wallet extension injection conflicts observed; actual signing compatibility not yet accepted','Mainnet deployments, verified source publication and small real-asset acceptance remain pending','Final DeWEB origin acceptance not completed; user reports independent contract audit passed','Historical reports retain their original scope; fresh follow-up UI and cancellation evidence cover this frontend revision'],sources,evidence};
await writeFile(root+dir+'verification.json',JSON.stringify(report,null,2));
const readiness=await json('output/mainnet-readiness-20261017/summary.json');
Object.assign(readiness,{marketVersion:3,contractTests:{passed:58,failed:0},frontendAndToolTests:{passed:61,failed:0},upstreamForkBlock:fork.forkBlock,build:verified.build,bidMarketFollowUp:{report:dir+'verification.json',contractTests:58,frontendTests:61,randomLedgerSteps:3200,mainnetWrites:false},websitePublished:true,websiteUrl:server.url,productionLaunchReady:false,mainnetBroadcast:false,remaining:['User wallet signatures for vault and V2 market deployments; receipt/runtime/source verification and actual configuration','Small mainnet split, bid/ask fill, BEM claim, refund, redemption and initial wallet fee receipt','Final DeWEB origin acceptance if selected'],sources,evidence:{...evidence,[dir+'verification.json']:sha(await readFile(root+dir+'verification.json'))}});
await writeFile(root+'output/mainnet-readiness-20261017/summary.json',JSON.stringify(readiness,null,2));
console.log(JSON.stringify({passed:true,contractTests:58,frontendTests:61,randomLedgerSteps:3200,forkBlock:fork.forkBlock,websitePublished:true,mainnetWrites:false,sources:Object.keys(sources).length,evidence:Object.keys(evidence).length}));
