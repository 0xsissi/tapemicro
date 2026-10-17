// Publish only already-public Solidity input; no signer or credentials.
import {readFile,writeFile} from 'node:fs/promises';
import {root,artifact} from './chain-helpers.mjs';
const dir=root+'output/mainnet-live/';
const state=JSON.parse(await readFile(dir+'deployment.json','utf8'));
if(!state.complete)throw Error('Complete deployment required');
const input=JSON.parse(await readFile(root+'artifacts/compiler-input.json','utf8'));
let report;try{report=JSON.parse(await readFile(dir+'source-verification.json','utf8'));}catch{report={service:'https://sourcify.dev/server',chainId:56,contracts:{}};}
for(const name of ['TapeMicroVault','TapeMicroMarketV2','TapeMicroCustody']){
 const a=await artifact(name),address=state.contracts[name].address;
 const row=report.contracts[name]??={address};
 const creation=state.transactions.find(t=>t.contract===(name==='TapeMicroCustody'?'TapeMicroVault':name));
 try{
  if(!row.verificationId){
   const r=await fetch(`https://sourcify.dev/server/v2/verify/56/${address}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({stdJsonInput:input,compilerVersion:a.metadata.compiler.version,contractIdentifier:a.sourceName+':'+name,creationTransactionHash:creation.hash}),signal:AbortSignal.timeout(60000)});
   const result=await r.json();row.submitStatus=r.status;row.submit=result;row.verificationId=result.verificationId;
  }
  if(row.verificationId){const r=await fetch('https://sourcify.dev/server/v2/verify/'+row.verificationId,{signal:AbortSignal.timeout(30000)});row.result=await r.json();}
 }catch(e){row.error=e.message;}
 await writeFile(dir+'source-verification.json',JSON.stringify(report,null,2));
 console.log(JSON.stringify({name,...row}));
}
