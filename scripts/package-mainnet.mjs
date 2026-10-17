// Package the verified live release; preserve the separate predeployment ZIPs.
import assert from 'node:assert/strict';
import {readFile,writeFile,readdir,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {root} from './chain-helpers.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex'),json=async p=>JSON.parse(await readFile(root+p,'utf8'));
const proofPath=process.argv[2]??'output/mainnet-live/verification.json';
const proof=await json(proofPath),manifest=await json('dist/release-manifest.json');
assert.equal(proof.passed,true);assert.equal(proof.mainnetDeployed,true);assert.equal(proof.websitePublished,true);assert.equal(manifest.localBuild,false);assert.equal(manifest.liveContractsConfigured,true);
for(const [file,hash]of Object.entries({...proof.sources,...proof.evidence}))assert.equal(sha(await readFile(root+file)),hash,file);
const deweb=Object.entries(manifest.files).map(([name])=>({name,source:root+'dist/'+name}));deweb.push({name:'release-manifest.json',source:root+'dist/release-manifest.json'});
const source=[];async function collect(dir){for(const e of await readdir(root+dir,{withFileTypes:true})){const p=dir+'/'+e.name;if(e.isDirectory())await collect(p);else if(!['src/config.local.json','src/generated-protocol.json','src/generated-deployment.json'].includes(p))source.push({name:'tapemicro/'+p,source:root+p});}}
for(const dir of ['src','scripts','contracts','test','server','deploy'])await collect(dir);
for(const f of ['README.md','DEPLOYMENT.md','SECURITY.md','VERIFICATION.md','主网上线检查RC4.md','推广积分实现说明.md','买单实现说明.md','前端交互与读取优化说明.md','服务器缓存与交互修正.md','读取卡顿修正.md','任意矿机买单与发布记录.md','dist-server/cache-server.mjs','dist-server/kol-worker.mjs','LICENSE','THIRD_PARTY_NOTICES.txt','package.json','package-lock.json','.gitignore','.npmrc','kol/kol-config.example.json','kol/kol-list.example.json',...Object.keys(proof.evidence),proofPath])source.push({name:'tapemicro/'+f,source:root+f});
for(const e of deweb)source.push({name:'tapemicro/dist/'+e.name,source:e.source});
const contracts=[];for(const name of ['TapeMicroVault','TapeMicroMarketV2','TapeMicroCustody','TapeMicroMarket','IPodMining'])contracts.push({name:'artifacts/'+name+'.json',source:root+'artifacts/'+name+'.json'});
for(const f of ['compiler-input.json'])contracts.push({name:'artifacts/'+f,source:root+'artifacts/'+f});
for(const f of ['output/mainnet-live/deployment.json','output/mainnet-live/chain-verification.json','output/mainnet-live/source-verification.json','output/contract-tests-rc4.json','output/contract-tests-rc4.tap','src/config.json','DEPLOYMENT.md'])contracts.push({name:f,source:root+f});
// The original deployment record still proves the unchanged vault/custody.
// A market-only release must also ship its ACTIVE market receipt and sources.
if(proof.marketVersion>=4)for(const f of ['output/any-miner-release/market-deployment.json','output/any-miner-release/source-verification.json','output/any-miner-release/chain-verification.json','output/any-miner-release/legacy-fees.json','src/protocol-legacy.json','任意矿机买单与发布记录.md',proofPath])contracts.push({name:f,source:root+f});
for(const e of contracts.filter(e=>e.name.startsWith('artifacts/')))source.push({name:'tapemicro/'+e.name,source:e.source});
const version=JSON.parse(await readFile(root+'package.json','utf8')).version;
const packages=[['deweb',deweb],['source',source],['contracts',contracts]].map(([name,entries])=>({path:root+`output/tapemicro-mainnet-${name}-${version}.zip`,entries}));
for(const p of packages){assert.equal(new Set(p.entries.map(e=>e.name)).size,p.entries.length);for(const e of p.entries)assert.ok(!e.name.includes('..')&&!/config\.local|kol-state|kol-config\.json|\.env|0xfa1867bd.*\.txt/i.test(e.name),e.name);}
await mkdir(root+'output/mainnet-live',{recursive:true});await writeFile(root+'output/mainnet-live/package-input.json',JSON.stringify(packages));
const code=`import json,zipfile,pathlib,hashlib,sys\npackages=json.loads(pathlib.Path(sys.argv[1]).read_text(encoding='utf-8'))\nresult=[]\nfor p in packages:\n    with zipfile.ZipFile(p['path'],'w',compression=zipfile.ZIP_DEFLATED,compresslevel=9) as z:\n        for e in sorted(p['entries'],key=lambda e:e['name']): z.writestr(e['name'],pathlib.Path(e['source']).read_bytes())\n    with zipfile.ZipFile(p['path']) as z: assert z.testzip() is None and len(z.namelist())==len(set(z.namelist()))\n    b=pathlib.Path(p['path']).read_bytes();result.append({'path':p['path'],'entries':len(p['entries']),'bytes':len(b),'sha256':hashlib.sha256(b).hexdigest()})\nprint(json.dumps({'passed':True,'packages':result}))`;
const run=spawnSync('python',['-c',code,root+'output/mainnet-live/package-input.json'],{encoding:'utf8',windowsHide:true});if(run.status!==0)throw Error(run.stderr||'Python packaging failed');
const result=JSON.parse(run.stdout);await writeFile(root+'output/mainnet-live/archives.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
