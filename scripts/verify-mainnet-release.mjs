// Assemble scoped deployment, publication and UI evidence without mainnet writes.
import assert from 'node:assert/strict';
import {readFile,writeFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {root} from './chain-helpers.mjs';
const dir='output/mainnet-live/',json=async f=>JSON.parse(await readFile(root+f,'utf8')),sha=b=>createHash('sha256').update(b).digest('hex');
const [chain,server,installed,origin,browser,layouts,consoleLog,manifest]=await Promise.all([dir+'chain-verification.json','output/server-deployment/verification.json',dir+'installed.json',dir+'origin-verification.json',dir+'ui/browser-checks.json',dir+'ui/layouts.json',dir+'ui/console.json','dist/release-manifest.json'].map(json));
assert.equal(chain.passed,true);assert.equal(chain.mainnetDeployed,true);assert.equal(chain.sourceVerified,true);assert.equal(chain.contractTests,58);assert.equal(chain.frontendTests,74);
const fingerprint=sha(await readFile(root+'dist/release-manifest.json'));
assert.equal(manifest.localBuild,false);assert.equal(manifest.liveContractsConfigured,true);
for(const row of [chain,server,installed,origin])assert.equal(row.manifestSha256,fingerprint);
for(const row of [server,installed,origin])assert.equal(row.mainnetDeployed,true);
assert.equal(server.passed,true);assert.equal(server.resourcesVerified,25);assert.equal(server.tlsVerified,true);assert.equal(installed.installed,true);assert.equal(installed.nginxConfigsUnchanged,true);assert.equal(origin.passed,true);assert.equal(origin.originalPrivateAppAndAccessRulesPreserved,true);
for(const [file,hash]of Object.entries(chain.sources))assert.equal(sha(await readFile(root+file)),hash,file);
assert.equal(browser.localBuildAgainstMainnet,true);assert.equal(browser.mainnetTransactionsFromBrowser,0);assert.equal(browser.layouts,16);assert.equal(browser.recheckedPointsTitle,'交易积分');assert.equal(layouts.length,16);
const titles={en:{'#deposit':'Split an original miner','#market':'Trade Micro miners','#rewards':'Claim BEM','#points':'Trading points'},'zh-CN':{'#deposit':'拆分原矿机','#market':'交易微矿机','#rewards':'领取 BEM','#points':'交易积分'}};
for(const row of layouts){assert.equal(row.scrollWidth,row.clientWidth);assert.equal(row.title,titles[row.language][row.route]);assert.equal(row.noticeHidden,true);}
for(const language of ['en','zh-CN'])for(const width of [375,1265])assert.equal(new Set(layouts.filter(x=>x.language===language&&x.clientWidth===width).map(x=>x.route)).size,4);
assert.equal(consoleLog.filter(x=>!x.url?.startsWith('chrome-extension://')).length,0);
const sources={},evidence={};async function bind(map,f){map[f]=sha(await readFile(root+f));}
async function walk(d){for(const e of await readdir(root+d,{withFileTypes:true})){const f=d+'/'+e.name;if(e.isDirectory())await walk(f);else if(!['src/config.local.json','src/generated-protocol.json','src/generated-deployment.json'].includes(f))await bind(sources,f);}}
for(const d of ['src','scripts','contracts','test'])await walk(d);
for(const f of ['README.md','DEPLOYMENT.md','SECURITY.md','VERIFICATION.md','主网上线检查RC4.md','推广积分实现说明.md','买单实现说明.md','LICENSE','THIRD_PARTY_NOTICES.txt','package.json','package-lock.json','.gitignore','.npmrc','kol/kol-config.example.json','kol/kol-list.example.json','dist/release-manifest.json','artifacts/compiler-input.json'])await bind(sources,f);
for(const f of ['deployment.json','config.json','source-verification.json','chain-verification.json','chain-before-loading-message.json','frontend-tests.txt','installed.json','origin-verification.json','prepared.json','predeployment-verification.json','prepare-server.py','update-server.py','record-domain.py','ui/browser-checks.json','ui/layouts.json','ui/console.json','ui/market-zh.png','ui/market-en-mobile.png'])await bind(evidence,dir+f);
for(const f of ['output/contract-tests-rc4.json','output/contract-tests-rc4.tap','output/server-deployment/verification.json'])await bind(evidence,f);
const report={date:new Date().toISOString(),passed:true,mainnetDeployed:true,deploymentComplete:true,websitePublished:true,url:'https://tapemicro.top/',manifestSha256:fingerprint,version:manifest.version,protocolVersion:2,marketVersion:3,contractTests:58,contractTestScope:'Retained after exact source, compiler-input and init-bytecode comparison',frontendTests:74,browserLayoutChecks:16,browserScope:'Local copy of the exact published build reads real BSC; no wallet signatures. Public browser navigation timed out. Public hosting separately verified by valid TLS and 25 exact resource hashes.',realAssetAcceptancePerformed:false,realAssetAcceptanceRemaining:['deposit real NFT','fill ask and bid with real wallets','claim BEM','redeem NFT','withdraw actual fee'],sourceVerification:'Sourcify creation/runtime exact_match for vault, market and custody implementation',sources,evidence};
await writeFile(root+dir+'verification.json',JSON.stringify(report,null,2));
console.log(JSON.stringify({passed:true,mainnetDeployed:true,websitePublished:true,frontendTests:74,contractTests:58,layouts:16,realAssetAcceptancePerformed:false}));
