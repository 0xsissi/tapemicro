// Public read-only acceptance: TLS validation, exact resource hashes, no secrets.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {request} from 'node:https';
import {lookup} from 'node:dns/promises';
import {isIP} from 'node:net';
import {root} from './chain-helpers.mjs';
const base=new URL(process.argv[2]??'https://tapemicro.top/');
assert.equal(base.protocol,'https:');
const sha=b=>createHash('sha256').update(b).digest('hex');
const addressCache=new Map();
async function get(url){
 assert.equal(url.protocol,'https:');
 if(!addressCache.has(url.hostname))addressCache.set(url.hostname,isIP(url.hostname)?[{address:url.hostname}]:await lookup(url.hostname,{all:true,family:4}));
 const addresses=addressCache.get(url.hostname);let last;
 for(const item of addresses){try{
  const response=await new Promise((resolve,reject)=>{
   const req=request(url,{family:4,autoSelectFamily:false,lookup:(_host,_options,done)=>done(null,item.address,4)},res=>{
    const chunks=[];res.on('data',b=>chunks.push(b));res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body:Buffer.concat(chunks)}));res.on('error',reject);
   });
   req.setTimeout(10000,()=>req.destroy(Error('HTTPS request timed out')));req.on('error',reject);req.end();
  });
  addressCache.set(url.hostname,[item,...addresses.filter(other=>other.address!==item.address)]);return response;
 }catch(error){last=error;}}
 throw last??Error('No DNS address for '+url.hostname);
}
const manifestBytes=await readFile(root+'dist/release-manifest.json');
const manifest=JSON.parse(manifestBytes);
const response=await get(new URL('release-manifest.json',base));
assert.equal(response.status,200);assert.equal(sha(response.body),sha(manifestBytes));
const resources={};
await Promise.all(Object.entries(manifest.files).map(async([file,meta])=>{
 const r=await get(new URL(file,base));assert.equal(r.status,200,file);
 const b=r.body;assert.equal(b.length,meta.bytes,file);assert.equal(sha(b),meta.sha256,file);
 resources[file]={status:r.status,bytes:b.length,sha256:sha(b),contentType:r.headers['content-type'],cacheControl:r.headers['cache-control']};
}));
for(const path of ['.env','config.local.json','contracts/test/Mocks.sol'])assert.ok([403,404].includes((await get(new URL(path,base))).status),path);
let mainnetDeployed=false;
if(manifest.liveContractsConfigured){const proof=JSON.parse(await readFile(root+(process.argv[3]??'output/mainnet-live/chain-verification.json'),'utf8'));assert.equal(proof.passed,true);assert.equal(proof.mainnetDeployed,true);assert.equal(proof.manifestSha256,sha(manifestBytes));const served=JSON.parse((await get(new URL('config.json',base))).body);assert.deepEqual(served,proof.config);mainnetDeployed=true;}
const report={passed:true,date:new Date().toISOString(),url:base.href,tlsVerified:true,resourcesVerified:Object.keys(resources).length+1,manifestSha256:sha(manifestBytes),localBuild:manifest.localBuild,liveContractsConfigured:manifest.liveContractsConfigured,mainnetDeployed,secretPathsAbsent:true,resources};
await mkdir(root+'output/server-deployment',{recursive:true});
await writeFile(root+'output/server-deployment/verification.json',JSON.stringify(report,null,2));
console.log(JSON.stringify({passed:true,url:base.href,resources:report.resourcesVerified,mainnetDeployed}));
