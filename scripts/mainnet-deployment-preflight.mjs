// Read-only BSC preflight. This script has no signer and cannot broadcast.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {JsonRpcProvider,Contract,getAddress,keccak256,formatEther} from 'ethers';
import {deploymentPlan} from '../src/deployment.mjs';
import {artifact,root} from './chain-helpers.mjs';
const address=getAddress(process.argv[2]??'0xfa1867bd071fb52b0f2ed73cee30f899093090be');
const cfg=JSON.parse(await readFile(root+'src/config.json','utf8'));
const artifacts=Object.fromEntries(await Promise.all(['TapeMicroVault','TapeMicroMarketV2'].map(async n=>[n,await artifact(n)])));
let report,plan,last;
for(const rpc of cfg.rpcUrls){
 const provider=new JsonRpcProvider(rpc,56,{staticNetwork:true,cacheTimeout:-1});
 try{
  assert.equal(BigInt(await provider.send('eth_chainId',[])),56n);
  const block=await provider.getBlock('latest');
  const [balance,nonce,gasPrice,code,official]=await Promise.all([
   provider.getBalance(address),provider.getTransactionCount(address,'pending'),provider.send('eth_gasPrice',[]),provider.getCode(address),
   Promise.all(['mining','bem','tapeout','behemoth'].map(async name=>({name,address:cfg[name],codeHash:keccak256(await provider.getCode(cfg[name]))})))
  ]);
  assert.equal(code,'0x','Designated deployment wallet must be an EOA');
  const mining=new Contract(cfg.mining,['function owner() view returns(address)','function isSealed() view returns(bool)','function paused() view returns(bool)','function token() view returns(address)','function maxRunGas() view returns(uint256)'],provider);
  const [owner,sealed,paused,token,maxRunGas]=await Promise.all([mining.owner(),mining.isSealed(),mining.paused(),mining.token(),mining.maxRunGas()]);
  assert.equal(paused,false,'Upstream mining is paused');assert.equal(token.toLowerCase(),cfg.bem.toLowerCase(),'Upstream BEM binding changed');
  plan=await deploymentPlan(cfg,artifacts,address,nonce);
  const vaultGas=await provider.estimateGas({from:address,data:plan.transactions[0].data,value:0n});
  const vaultGasBudget=vaultGas*120n/100n+20000n;
  // The market constructor reads the new vault, which does not yet exist on mainnet.
  // Re-estimate it in deploy.html after the vault receipt. This is a budget, not an estimate.
  const marketGasBudget=4500000n,price=BigInt(gasPrice),budget=(vaultGasBudget+marketGasBudget)*price;
  report={date:new Date().toISOString(),readOnly:true,mainnetBroadcast:false,privateKeysRead:false,chainId:56,rpc,block:block.number,deployer:address,balanceWei:String(balance),balanceBNB:formatEther(balance),pendingNonce:nonce,gasPriceWei:String(price),vaultEstimatedGas:String(vaultGas),vaultGasBudget:String(vaultGasBudget),marketGasBudget:String(marketGasBudget),marketGasEstimatePendingVaultReceipt:true,combinedBudgetBNB:formatEther(budget),balanceCoversBudget:balance>=budget,official,upstream:{owner,sealed,paused,token,maxRunGas:String(maxRunGas)},predictedAddresses:plan.addresses,feeBps:100,initialOwner:address,initialFeeRecipient:address,marketVersion:3,build:Object.fromEntries(Object.entries(artifacts).map(([n,a])=>[n,keccak256(a.bytecode)])),requires:['Recheck pending nonce, chain and gas price immediately before signing','User wallet signs the vault deployment, then market deployment','Verify both receipts, source and deployed runtime; rebuild frontend with actual addresses','Run small mainnet deposit, trade, claim, refund and fee acceptance before opening public trading']};
  break;
 }catch(error){last=error;}finally{provider.destroy();}
}
if(!report)throw last??Error('No usable BSC RPC');
await mkdir(root+'output/deployment',{recursive:true});
await writeFile(root+'output/deployment/unsigned-plan.json',JSON.stringify(plan,null,2));
await writeFile(root+'output/deployment/mainnet-preflight.json',JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
