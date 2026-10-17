import{operationError}from'./operation-errors.mjs';
import {BrowserProvider,Contract,ContractFactory,keccak256,isAddress} from 'ethers';
import CONFIG from './config.json';
import ARTIFACTS from './generated-deployment.json';
import PROTOCOL from './generated-protocol.json';
import {displayUnits,maskRuntime} from './client-utils.mjs';
import {feeRecipientAddress,readMarketTerms} from './market-terms.mjs';
import {verifyFeeReceipt} from './fee-container.mjs';
import {marketDeploymentBlock} from './deployment-receipt.mjs';
import {initializeLocalization,localizeTree} from './i18n.mjs';
import {marketContractName} from './market-contract.mjs';
const MARKET_NAME='TapeMicroMarketV2';
const $=id=>document.getElementById(id);let provider,signer,account,prepared=null,busy=false;
initializeLocalization();
const status=s=>{$('deployment-status').textContent=s;localizeTree($('deployment-status'));};
async function checkChain(){if(!provider||!signer)throw Error('请先连接部署钱包');if(BigInt(await provider.send('eth_chainId',[]))!==56n)throw Error('请在钱包中切换到 BSC 主网（56）');if((await signer.getAddress()).toLowerCase()!==account.toLowerCase())throw Error('钱包账户已变化，请重新连接');}
async function verify(name,address){if(!isAddress(address))throw Error('请填写已部署的合约地址');const code=await provider.getCode(address);if(code==='0x'||keccak256(maskRuntime(code,PROTOCOL[name].immutableRanges))!==PROTOCOL[name].runtimeHash)throw Error('运行时代码与本版本不一致');return new Contract(address,ARTIFACTS[name].abi,provider);}
async function verifyVault(){const v=await verify('TapeMicroVault',$('deployed-vault').value.trim());const actual=await Promise.all([v.mining(),v.bem(),v.tapeout(),v.behemoth()]);if(actual.some((v,i)=>v.toLowerCase()!==[CONFIG.mining,CONFIG.bem,CONFIG.tapeout,CONFIG.behemoth][i].toLowerCase()))throw Error('金库绑定的官方地址不符');return v;}
async function prepare(name){await checkChain();prepared=null;$('deployment-preview').classList.add('hidden');
 let container=null;
 if(name===MARKET_NAME){container={address:account};await verifyFeeReceipt(provider,account,account);}
 const args=name==='TapeMicroVault'?[CONFIG.mining,CONFIG.bem,CONFIG.tapeout,CONFIG.behemoth]:[await (await verifyVault()).getAddress(),container.address];
 const a=ARTIFACTS[name],factory=new ContractFactory(a.abi,a.bytecode,signer),request=await factory.getDeployTransaction(...args),gas=await signer.estimateGas(request),fees=await provider.getFeeData();
 prepared={name,args,factory,gasLimit:gas*120n/100n+20000n,account};
 $('deployment-title').textContent=name;$('deployment-details').textContent=JSON.stringify({network:'BSC / 56',deployer:account,constructor:args,...(container?{feeBps:100,initialFeeRecipient:container.address,feeManager:account}:{}),estimatedGas:gas.toString(),estimatedFeeBNB:displayUnits(gas*(fees.maxFeePerGas??fees.gasPrice??0n),18,10),initCodeHash:keccak256(request.data)},null,2);
 $('deployment-preview').classList.remove('hidden');status('仅估算完成。部署将由下方按钮请求钱包签名。');
}
async function sign(){await checkChain();const op=prepared;if(!op||op.account!==account)throw Error('请重新估算');if(op.name===MARKET_NAME){await verifyFeeReceipt(provider,op.args[1],account);}prepared=null;status('等待你在钱包中确认部署…');const c=await op.factory.deploy(...op.args,{gasLimit:op.gasLimit});status(`交易已提交：${c.deploymentTransaction().hash}`);await c.waitForDeployment();const receipt=await c.deploymentTransaction().wait();const a=await c.getAddress();if(op.name===MARKET_NAME)$('market-deployment-tx').value=receipt.hash;await verify(op.name,a);$(op.name==='TapeMicroVault'?'deployed-vault':'deployed-market').value=a;$('deployment-preview').classList.add('hidden');status(`${op.name} 已部署并核验：${a}。请保存地址与交易哈希。`);}
async function exportConfig(){await checkChain();const v=await verifyVault(),m=await verify(MARKET_NAME,$('deployed-market').value.trim());if((await m.vault()).toLowerCase()!==(await v.getAddress()).toLowerCase())throw Error('市场关联的金库错误');if(await m.MARKET_VERSION()!==4n)throw Error('新版市场版本不匹配');const terms=await readMarketTerms(m,account);await verifyFeeReceipt(provider,terms.feeRecipient,account);const hash=$('market-deployment-tx').value.trim();if(!/^0x[0-9a-fA-F]{64}$/.test(hash))throw Error('请填写市场部署交易哈希');const deploymentBlock=marketDeploymentBlock(await provider.getTransactionReceipt(hash),await m.getAddress(),hash);$('deployment-result').value=JSON.stringify({...CONFIG,marketVersion:4,legacyMarkets:[{address:CONFIG.market,marketVersion:CONFIG.marketVersion,deploymentBlock:CONFIG.deploymentBlock,feeManager:CONFIG.feeManager},...(CONFIG.legacyMarkets??[])].filter(row=>row.address.toLowerCase()!==(m.target).toLowerCase()),vault:await v.getAddress(),market:await m.getAddress(),feeRecipient:terms.feeRecipient,feeManager:terms.initialFeeManager,deploymentBlock},null,2);status('合约代码、1% 费率及管理钱包均匹配。请复制配置并重新构建。');}
const actions={'deploy-connect':async()=>{if(!window.ethereum)throw Error('请使用钱包插件或钱包内置浏览器');provider=new BrowserProvider(window.ethereum);await provider.send('eth_requestAccounts',[]);signer=await provider.getSigner();account=await signer.getAddress();await checkChain();$('deploy-account').textContent=`BSC / 56 · ${account}`;$('fee-recipient').value=account;status('钱包已连接。尚未发送任何交易。');},'prepare-vault':()=>prepare('TapeMicroVault'),'prepare-market':()=>prepare(MARKET_NAME),'deployment-sign':sign,'export-config':exportConfig};
document.addEventListener('click',async e=>{const action=actions[e.target.closest('button')?.id];if(!action||busy)return;busy=true;document.querySelectorAll('button').forEach(b=>b.disabled=true);try{await action();}catch(e){prepared=null;$('deployment-preview').classList.add('hidden');status(operationError(e).message);}finally{busy=false;document.querySelectorAll('button').forEach(b=>b.disabled=false);}});
window.ethereum?.on?.('accountsChanged',()=>location.reload());window.ethereum?.on?.('chainChanged',()=>location.reload());
$('fee-recipient').value='';$('deployed-vault').value=CONFIG.vault??'';$('prepare-vault').classList.add('hidden');
