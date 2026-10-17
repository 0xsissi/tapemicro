import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
import {deflateRawSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {keccak256} from 'ethers';
import {root} from './chain-helpers.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
const version=JSON.parse(await readFile(root+'package.json','utf8')).version;
if(version!=='1.0.0-rc.4')throw Error('Review release gates for a new protocol version');
const manifest=JSON.parse(await readFile(root+'dist/release-manifest.json','utf8'));
if(manifest.localBuild||manifest.uiProtocolVersion!==2||!manifest.contractUiReady)throw Error('A production RC4 frontend build is required');
const current=JSON.parse(await readFile(root+'output/kol-referrals/verification.json','utf8'));
if(!current.passed||current.mainnetWrites||current.marketVersion!==3||current.contractTests!==58||current.frontendTests!==74||!current.ownerTransferAndRenunciation||!current.bidReviewFollowUp||!current.referralFollowUp||current.referralMode!=='open')throw Error('Current two-sided market verification with scoped crossing, free-stock priority and refund recheck required');
for(const [name,hash]of Object.entries({...current.sources,...current.evidence}))if(sha(await readFile(root+name))!==hash)throw Error('Current referral release evidence changed: '+name);
const bidFork=JSON.parse(await readFile(root+'output/bids-v2/fork.json','utf8'));
if(!bidFork.passed||!bidFork.localOnly||bidFork.mainnetWrites||bidFork.marketVersion!==3||!Object.values(bidFork.checks).every(Boolean)||bidFork.marketInitCodeHash!==keccak256(JSON.parse(await readFile(root+'artifacts/TapeMicroMarketV2.json','utf8')).bytecode))throw Error('Current V2 fork verification required');
// Prior UI/fault-injection reports retain their original hashes and scope.
// A changed file must be explicitly covered by the current regression report;
// never rewrite a historical report to imply it tested new contract behavior.
async function historicalHashes(entries,label){for(const [name,hash]of Object.entries(entries)){const actual=sha(await readFile(root+name));if(actual!==hash&&current.sources[name]!==actual&&current.evidence[name]!==actual)throw Error(label+': '+name);}}
const priorBids=JSON.parse(await readFile(root+'output/kol-referrals/previous-bids-verification.json','utf8'));
if(!priorBids.passed||priorBids.frontendTests!==61||priorBids.contractTests!==58)throw Error('Prior audited bid baseline required');
await historicalHashes({...priorBids.sources,...priorBids.evidence},'Uncovered prior bid change');
const routing=JSON.parse(await readFile(root+'output/fee-routing-rc4/verification.json','utf8'));
if(!routing.passed||routing.mainnetWrites||routing.contractTests!==33||routing.frontendTests!==48)throw Error('Historical fee-routing verification required');
await historicalHashes({...routing.sources,...routing.evidence},'Uncovered historical fee-routing change');
const hardening=JSON.parse(await readFile(root+'output/admission-review-rc4/verification.json','utf8'));
if(!hardening.passed||hardening.mainnetWrites||hardening.contractTests!==31||hardening.frontendTests!==47)throw Error('Historical admission/harvest verification required');
await historicalHashes({...hardening.sources,...hardening.evidence},'Uncovered historical admission/harvest change');
const verified=JSON.parse(await readFile(root+'output/contract-tests-rc4.json','utf8')),fork=JSON.parse(await readFile(root+'output/fork-integration-rc4.json','utf8')),front=JSON.parse(await readFile(root+'output/frontend-integration-rc4.json','utf8')),ui=JSON.parse(await readFile(root+'output/ui-qa-rc4/verification.json','utf8'));
if(!verified.passed||verified.failedCount!==0||fork.version!==version||!fork.localOnly||!Object.values(fork.checks).every(Boolean)||!front.passed||front.version!==version||front.mainnetWrites||!ui.passed||ui.protocolVersion!==2||ui.mainnetWrites)throw Error('Successful current contract, fork, adapter and UI verification required');
for(const [name,field]of [['TapeMicroVault','vaultInitCodeHash'],['TapeMicroMarket','marketInitCodeHash'],['TapeMicroCustody','custodyInitCodeHash']]){const hash=keccak256(JSON.parse(await readFile(root+'artifacts/'+name+'.json','utf8')).bytecode);if(hash!==fork.build[field]||hash!==verified.build[name])throw Error('Fork verification mismatch: '+name);}
for(const [name,hash]of Object.entries({...verified.sources,...front.sources}))if(sha(await readFile(root+name))!==hash)throw Error('Verified source changed: '+name);
await historicalHashes(ui.sources,'Uncovered historical UI source change');
for(const [name,hash]of Object.entries(ui.screenshots))if(sha(await readFile(root+'output/ui-qa-rc4/'+name))!==hash)throw Error('UI screenshot changed: '+name);
const readiness=JSON.parse(await readFile(root+'output/mainnet-readiness-20261017/summary.json','utf8'));
const polish=JSON.parse(await readFile(root+'output/ui-polish-rc4/verification.json','utf8'));
if(!polish.passed||polish.mainnetWrites||polish.frontendTests!==42)throw Error('Current UI recovery verification required');
await historicalHashes({...polish.sources,...polish.evidence},'Uncovered historical polish change');
const feedback=JSON.parse(await readFile(root+'output/ui-feedback-rc4/verification.json','utf8'));
if(!feedback.passed||feedback.mainnetWrites||feedback.frontendTests!==42)throw Error('Current presentation verification required');
await historicalHashes({...feedback.sources,...feedback.evidence},'Uncovered historical presentation change');
const design=JSON.parse(await readFile(root+'output/ui-design-rc4/verification.json','utf8'));
if(!design.passed||design.mainnetWrites||design.frontendTests!==42)throw Error('Current visual design verification required');
await historicalHashes({...design.sources,...design.evidence},'Uncovered historical design change');
const bilingual=JSON.parse(await readFile(root+'output/ui-i18n-rc4/verification.json','utf8'));
if(!bilingual.passed||bilingual.mainnetWrites||bilingual.frontendTests!==46)throw Error('Current bilingual and route-layout verification required');
await historicalHashes({...bilingual.sources,...bilingual.evidence},'Uncovered historical bilingual change');
const prelaunch=JSON.parse(await readFile(root+'output/prelaunch-review-20261017/report.json','utf8'));
if(!prelaunch.coreValidationPassed||prelaunch.mainnetWrites)throw Error('Current local-only prelaunch review required');
await historicalHashes({...prelaunch.sources,...prelaunch.evidence},'Uncovered historical prelaunch change');
if(readiness.version!==version||readiness.functionalValidation!=='passed'||readiness.mainnetBroadcast)throw Error('Current local-only readiness evidence required');
for(const [name,hash]of Object.entries({...readiness.sources,...readiness.evidence}))if(sha(await readFile(root+name))!==hash)throw Error('Readiness evidence changed: '+name);
if(sha(await readFile(root+'artifacts/compiler-input.json'))!==verified.compilerInputSha256)throw Error('Compiler input changed');
const deweb=[];
for(const [name,meta]of Object.entries(manifest.files)){
 const bytes=await readFile(root+'dist/'+name);
 if(bytes.length!==meta.bytes||createHash('sha256').update(bytes).digest('hex')!==meta.sha256)throw Error('Release resource changed: '+name);
 deweb.push({name,bytes});
}
deweb.push({name:'release-manifest.json',bytes:await readFile(root+'dist/release-manifest.json')});
// Portable ZIP writer: UTF-8 names, CRC32, deflate; fixed timestamps for repeatable archives.
const table=Array.from({length:256},(_,n)=>{for(let k=0;k<8;k++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
function crc32(b){let c=0xffffffff;for(const x of b)c=table[(c^x)&255]^(c>>>8);return(c^0xffffffff)>>>0;}
function zip(entries){const chunks=[],central=[];let offset=0;
 for(const {name,bytes}of [...entries].sort((a,b)=>a.name.localeCompare(b.name))){
  if(name.startsWith('/')||name.includes('..')||name.includes('\\'))throw Error('Invalid archive path');
  const n=Buffer.from(name),data=deflateRawSync(bytes),crc=crc32(bytes),h=Buffer.alloc(30);
  h.writeUInt32LE(0x04034b50);h.writeUInt16LE(20,4);h.writeUInt16LE(0x800,6);h.writeUInt16LE(8,8);h.writeUInt16LE(33,12);h.writeUInt32LE(crc,14);h.writeUInt32LE(data.length,18);h.writeUInt32LE(bytes.length,22);h.writeUInt16LE(n.length,26);
  chunks.push(h,n,data);const c=Buffer.alloc(46);c.writeUInt32LE(0x02014b50);c.writeUInt16LE(20,4);c.writeUInt16LE(20,6);c.writeUInt16LE(0x800,8);c.writeUInt16LE(8,10);c.writeUInt16LE(33,14);c.writeUInt32LE(crc,16);c.writeUInt32LE(data.length,20);c.writeUInt32LE(bytes.length,24);c.writeUInt16LE(n.length,28);c.writeUInt32LE(offset,42);central.push(c,n);offset+=h.length+n.length+data.length;
 }
 const c=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);end.writeUInt32LE(c.length,12);end.writeUInt32LE(offset,16);return Buffer.concat([...chunks,c,end]);
}
const source=[];
async function collect(dir){for(const e of await readdir(root+dir,{withFileTypes:true})){const name=dir+'/'+e.name;if(e.isDirectory())await collect(name);else if(!['src/config.local.json','src/generated-protocol.json','src/generated-deployment.json','src/app.js'].includes(name))source.push({name:'tapemicro/'+name,bytes:await readFile(root+name)});}}
for(const dir of ['contracts','scripts','src','test'])await collect(dir);
for(const file of ['kol/kol-config.example.json','kol/kol-list.example.json',...Object.keys(current.sources).filter(p=>p.startsWith('交付/KOL推广返积分/'))])source.push({name:'tapemicro/'+file,bytes:await readFile(root+file)});
for(const f of ['README.md','VERIFICATION.md','SECURITY.md','交易设计.md','合约改版RC4.md','前端改版RC4.md','主网上线检查RC4.md','买单实现说明.md','推广积分实现说明.md','现有功能完善RC4.md','方案确认记录.md','矿机准入与失效.md','DEPLOYMENT.md','LICENSE','THIRD_PARTY_NOTICES.txt','package.json','package-lock.json','.npmrc','.gitignore','.gitattributes'])source.push({name:'tapemicro/'+f,bytes:await readFile(root+f)});
for(const e of deweb)source.push({name:'tapemicro/dist/'+e.name,bytes:e.bytes});
for(const name of ['TapeMicroVault.json','TapeMicroMarket.json','TapeMicroMarketV2.json','TapeMicroCustody.json','IPodMining.json','MockBem.json','MockMinerNFT.json','MockMining.json','SellerHarness.json','ReentryReceiver.json','BidHarness.json','MockFeeContainer.json','compiler-input.json'])source.push({name:'tapemicro/artifacts/'+name,bytes:await readFile(root+'artifacts/'+name)});
for(const name of ['contract-tests-rc4.json','contract-tests-rc4.tap','fork-integration-rc4.json','mock-gas-rc4.json','frontend-integration-rc4.json','ui-qa-rc4/verification.json'])source.push({name:'tapemicro/output/'+name,bytes:await readFile(root+'output/'+name)});
for(const file of ['market-desktop.png','market-mobile.png','deposit-desktop.png','deposit-mobile.png','rewards-desktop.png','rewards-mobile.png','points-desktop.png','points-mobile.png','live-points.png','live-claim-batch.png','live-split.png','live-seller-points.png','live-redeemed.png','browser-observations.json'])source.push({name:'tapemicro/output/ui-qa-rc4/'+file,bytes:await readFile(root+'output/ui-qa-rc4/'+file)});
for(const file of ['summary.json','upstream.json','production-path-fork.json','dependency-audit.json','compiler-review.json','operator-ui.json','operator-ui.png'])source.push({name:'tapemicro/output/mainnet-readiness-20261017/'+file,bytes:await readFile(root+'output/mainnet-readiness-20261017/'+file)});
for(const file of ['verification.json','frontend-tests.tap','fixtures.json','layout-checks.json','chain-final-state.json','book-complete.png','transaction-pending.png','transaction-confirmed.png','claim-isolated-preview.png','claim-isolated-result.png','expired-cleanup.png'])source.push({name:'tapemicro/output/ui-polish-rc4/'+file,bytes:await readFile(root+'output/ui-polish-rc4/'+file)});
for(const file of ['verification.json','frontend-tests.txt','layout-checks.json','deposit-default.png','toast-desktop.png','toast-mobile.png','market-desktop.png','market-mobile.png','rewards-desktop.png','rewards-mobile.png'])source.push({name:'tapemicro/output/ui-feedback-rc4/'+file,bytes:await readFile(root+'output/ui-feedback-rc4/'+file)});
for(const file of ['verification.json','frontend-tests.txt','static-tests.txt','layout-checks.json','interaction-checks.json','market-desktop.png','market-mobile.png','deposit-desktop.png','deposit-mobile.png','rewards-desktop.png','rewards-mobile.png','points-desktop.png','points-mobile.png','claim-preview.png','sell-preview.png','toast-mobile.png','large-miner-mobile.png','formal-desktop.png'])source.push({name:'tapemicro/output/ui-design-rc4/'+file,bytes:await readFile(root+'output/ui-design-rc4/'+file)});
for(const file of ['footer-proof.png','footer-checks.json'])source.push({name:'tapemicro/output/ui-design-rc4/'+file,bytes:await readFile(root+'output/ui-design-rc4/'+file)});
for(const file of ['verification.json','frontend-tests.txt','layout-checks.json','interaction-checks.json','market-en-desktop.png','market-en-mobile.png','deposit-en-desktop.png','deposit-en-mobile.png','rewards-en-desktop.png','rewards-en-mobile.png','points-en-desktop.png','points-en-mobile.png','market-zh-desktop.png','market-zh-mobile.png','deposit-zh-desktop.png','deposit-zh-mobile.png','rewards-zh-desktop.png','rewards-zh-mobile.png','points-zh-desktop.png','points-zh-mobile.png','points-en-history.png','claim-en-preview.png','sell-en-preview.png','deploy-en.png','fees-en.png'])source.push({name:'tapemicro/output/ui-i18n-rc4/'+file,bytes:await readFile(root+'output/ui-i18n-rc4/'+file)});
for(const file of ['report.json','build.txt','frontend-tests.txt','contract-tests.txt','contract-tests-initial-failure.txt','production-fork.txt','core-fork.txt','dependency-audit.json','rpc-capabilities.json','replacement-rpc-probe.json','replacement-rpc-rejected.json'])source.push({name:'tapemicro/output/prelaunch-review-20261017/'+file,bytes:await readFile(root+'output/prelaunch-review-20261017/'+file)});
for(const file of ['verification.json','upstream.json','regressions.json','contract-tests.txt','contract-tests-input-change.txt','frontend-tests.txt','core-fork.txt','production-fork.txt','browser-checks.json','rewards-zh.png','rewards-en.png','deposit-en.png','market-en.png','redeem-notice-zh.png','rewards-en-mobile.png','rewards-zh-mobile.png','deposit-en-mobile.png','deposit-zh-mobile.png'])source.push({name:'tapemicro/output/admission-review-rc4/'+file,bytes:await readFile(root+'output/admission-review-rc4/'+file)});
for(const file of ['verification.json','contract-tests.txt','frontend-tests.txt','core-fork.txt','production-fork.txt','browser-checks.json','ui-fixture.mjs','ui-fixture.json','fees-wallet-to-container.png','fees-en-mobile.png'])source.push({name:'tapemicro/output/fee-routing-rc4/'+file,bytes:await readFile(root+'output/fee-routing-rc4/'+file)});
for(const file of ['verification.json','contract-tests.txt','frontend-tests.txt','core-fork.txt','production-fork.txt','browser-checks.json','ui-fixture.mjs','ui-fixture.json','ui-chain-state.json','owner-renounce-preview.png','owner-renounced-zh.png','owner-en-mobile.png'])source.push({name:'tapemicro/output/ownership-rc4/'+file,bytes:await readFile(root+'output/ownership-rc4/'+file)});
for(const name of ['unsigned-plan.json','TapeMicroVault.json','TapeMicroMarket.json','TapeMicroMarketV2.json','TapeMicroCustody.json','compiler-input.json','mainnet-preflight.json'])source.push({name:'tapemicro/output/deployment/'+name,bytes:await readFile(root+'output/deployment/'+name)});
for(const file of new Set(['output/kol-referrals/verification.json',...Object.keys(current.evidence).filter(name=>name.startsWith('output/bids-v2/')||name.startsWith('output/kol-referrals/')||name.startsWith('output/server-deployment/'))]))source.push({name:'tapemicro/'+file,bytes:await readFile(root+file)});
await mkdir(root+'output',{recursive:true});const checksums={};
for(const [type,entries]of [['deweb',deweb],['source',source]]){const filename=`tapemicro-${type}-${version}.zip`,bytes=zip(entries);await writeFile(root+'output/'+filename,bytes);checksums[filename]={sha256:createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length,entries:entries.length};}
await writeFile(root+'output/release-checksums.json',JSON.stringify(checksums,null,2));console.log(JSON.stringify(checksums,null,2));
