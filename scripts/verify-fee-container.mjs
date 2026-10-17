import {JsonRpcProvider} from 'ethers';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {inspectFeeContainer,verifyFeeReceipt} from '../src/fee-container.mjs';
import {root} from './chain-helpers.mjs';
const args=process.argv.slice(2),option=n=>{const i=args.indexOf(n);return i<0?null:args[i+1];};
const recipient=option('--address');if(!recipient)throw Error('Provide the public container address with --address 0x… (no private key).');
const config=JSON.parse(await readFile(root+'src/config.json','utf8'));
const provider=new JsonRpcProvider(config.rpcUrls[0],56,{staticNetwork:true,batchMaxCount:1});
try{
 if(BigInt(await provider.send('eth_chainId',[]))!==56n)throw Error('Not BSC');
 const container=await inspectFeeContainer(provider,recipient,{expectedOwner:option('--owner')});
 const receipt=await verifyFeeReceipt(provider,container.address,container.owner);
 const result={readOnly:true,receiptSimulation:receipt,withdrawalVerified:false,projectConfigurationChanged:false,block:await provider.getBlockNumber(),verifiedAt:new Date().toISOString(),...container};
 await mkdir(root+'output/deployment',{recursive:true});await writeFile(root+'output/deployment/fee-container-check.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
}finally{provider.destroy();}
