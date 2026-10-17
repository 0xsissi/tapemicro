import{operationError}from'./operation-errors.mjs';
import {JsonRpcProvider,BrowserProvider,Contract,keccak256,ZeroAddress,getAddress} from 'ethers';
import DEFAULT from './config.json';
import PROTOCOL from './generated-protocol.json';
import {maskRuntime,validateRpc,displayUnits} from './client-utils.mjs';
import {readMarketTerms,feeRecipientAddress} from './market-terms.mjs';
import {inspectFeeContainer,verifyFeeReceipt} from './fee-container.mjs';
import {initializeLocalization,localizeTree} from './i18n.mjs';
import {marketProtocolName} from './market-contract.mjs';
const LOCAL=__LOCAL_CONFIG__,$=id=>document.getElementById(id),status=s=>{$('fees-status').textContent=s;localizeTree($('fees-status'));};
initializeLocalization();
const config=new URLSearchParams(location.search).get('network')==='local'&&LOCAL&&['localhost','127.0.0.1'].includes(location.hostname)?LOCAL:DEFAULT;
let provider,market,signer,account=null,terms=null,busy=false,prepared=null,preparedOwner=null;
const bnb=v=>displayUnits(v,18,18)+' BNB',same=(a,b)=>String(a??'').toLowerCase()===String(b??'').toLowerCase();
function buttons(){
 const isOwner=!!account&&!!terms&&!terms.renounced&&same(account,terms.feeManager);
 $('fees-collect').disabled=busy||!signer||!market;
 $('fees-preview-recipient').disabled=busy||!signer||!market||!isOwner;
 $('fees-change-recipient').disabled=busy||!prepared||!isOwner;
 $('fees-preview-owner').disabled=busy||!signer||!market||!isOwner;
 $('fees-transfer-owner').disabled=busy||preparedOwner?.kind!=='transfer'||!isOwner;
 $('fees-cancel-owner').disabled=busy||!isOwner||terms?.pendingOwner===ZeroAddress;
 $('fees-accept-owner').disabled=busy||!account||!terms||terms.renounced||!same(account,terms.pendingOwner);
 $('fees-preview-renounce').disabled=busy||!isOwner||$('fees-renounce-word').value!=='RENOUNCE';
 $('fees-renounce-owner').disabled=busy||preparedOwner?.kind!=='renounce'||!isOwner||$('fees-renounce-word').value!=='RENOUNCE';
 localizeTree();
}
async function refresh(){
 if(!market)return;
 terms=await readMarketTerms(market,config.feeManager);
 const [pending,released,balance]=await Promise.all([market.accruedFees(),market.totalFeesReleased(),provider.getBalance(terms.feeRecipient)]);
 $('fee-container').textContent=terms.feeRecipient;$('fee-manager').textContent=terms.feeManager;
 $('fee-initial-manager').textContent=terms.initialFeeManager;$('fee-pending-manager').textContent=terms.pendingOwner;
 $('fee-management-state').textContent=terms.renounced?'已弃权：收款地址永久固定':'管理权限有效';
 $('fees-renounce-destination').textContent=terms.feeRecipient;
 $('fee-pending').textContent=bnb(pending);$('fee-released').textContent=bnb(released);$('fee-balance').textContent=bnb(balance);
 $('fee-owner').textContent='—';
 if(!config.local&&await provider.getCode(terms.feeRecipient)!=='0x')try{const c=await inspectFeeContainer(provider,terms.feeRecipient);$('fee-owner').textContent=c.owner;}catch{$('fee-owner').textContent='非官方容器或暂不可读';}
 buttons();
}
async function initialize(){
 if(!config.market||!config.feeManager){status('主网尚未部署。部署时默认使用部署钱包收款。');return;}
 for(const rpc of config.rpcUrls){let p;try{p=new JsonRpcProvider(validateRpc(rpc,{local:config.local}),config.chainId,{staticNetwork:true,cacheTimeout:-1});if(BigInt(await p.send('eth_chainId',[]))!==BigInt(config.chainId))throw Error();if(config.local&&!String(await p.send('web3_clientVersion',[])).toLowerCase().includes('anvil'))throw Error();provider=p;break;}catch{p?.destroy();}}
 if(!provider)throw Error('连接节点失败');
 const code=await provider.getCode(config.market);if(code==='0x'||keccak256(maskRuntime(code,PROTOCOL[marketProtocolName(config)].immutableRanges))!==PROTOCOL[marketProtocolName(config)].runtimeHash)throw Error('市场代码与本版本不匹配');
 const candidate=new Contract(config.market,PROTOCOL[marketProtocolName(config)].abi,provider);await readMarketTerms(candidate,config.feeManager);if((await candidate.vault()).toLowerCase()!==config.vault?.toLowerCase())throw Error('金库绑定不匹配');
 market=candidate;$('fee-market').textContent=config.market;await refresh();status('合约与管理钱包已核验，操作需要你在钱包中确认。');
}
async function checkWallet(){if(!signer||!market)throw Error('请先连接钱包');if(BigInt(await signer.provider.send('eth_chainId',[]))!==BigInt(config.chainId)||!same(await signer.getAddress(),account))throw Error('钱包网络或账户已变化，请重新连接');}
async function connect(){
 if(!market)throw Error('请先完成合约与管理钱包配置');
 if(config.local)signer=await provider.getSigner(0);
 else{if(!window.ethereum)throw Error('请使用钱包浏览器');const wallet=new BrowserProvider(window.ethereum);await wallet.send('eth_requestAccounts',[]);if(BigInt(await wallet.send('eth_chainId',[]))!==BigInt(config.chainId))throw Error('请切换到 BSC');signer=await wallet.getSigner();}
 account=await signer.getAddress();prepared=null;preparedOwner=null;$('fees-wallet').textContent='当前钱包：'+account;await refresh();
}
async function collect(){
 await checkWallet();await readMarketTerms(market,config.feeManager);if(await market.accruedFees()===0n)throw Error('当前没有待归集手续费');
 const estimate=await market.connect(signer).withdrawFees.estimateGas();status('等待钱包确认：归集到链上当前收款地址。');
 const t=await market.connect(signer).withdrawFees({gasLimit:estimate*130n/100n+20000n});status('归集交易已提交：'+t.hash);await t.wait();await refresh();status('手续费已归集到当前收款地址。交易：'+t.hash);
}
async function checkDestination(address){
 if(!same(address,account)&&!config.local&&await provider.getCode(address)!=='0x')await inspectFeeContainer(provider,address,{expectedOwner:account});
 await verifyFeeReceipt(provider,address,account);
}
async function previewRecipient(){
 prepared=null;await checkWallet();await refresh();if(!same(account,terms.feeManager))throw Error('只有当前 owner 能修改收款地址');
 const address=feeRecipientAddress($('fees-new-recipient').value.trim());await checkDestination(address);
 const gas=await market.connect(signer).setFeeRecipient.estimateGas(address);
 prepared={address,account,previous:terms.feeRecipient,gasLimit:gas*130n/100n+20000n};
 $('fees-recipient-preview').textContent=terms.feeRecipient+' → '+address;
 status('接收模拟通过。请核对新地址；确认后，尚未归集和未来手续费都会发往新地址。');
}
async function changeRecipient(){
 await checkWallet();const op=prepared;if(!op||!same(account,op.account)||!same($('fees-new-recipient').value.trim(),op.address))throw Error('请重新预览收款地址');
 const latest=await readMarketTerms(market,config.feeManager);if(!same(latest.feeManager,account)||!same(latest.feeRecipient,op.previous))throw Error('收款地址或 owner 已变化，请重新预览');
 await checkDestination(op.address);prepared=null;status('等待钱包确认：仅修改手续费收款地址。');
 const t=await market.connect(signer).setFeeRecipient(op.address,{gasLimit:op.gasLimit});status('修改收款地址交易已提交：'+t.hash);await t.wait();await refresh();$('fees-recipient-preview').textContent='';status('收款地址已修改，网站自动读取链上地址。');
}
async function ownerTerms(){await checkWallet();await refresh();if(terms.renounced||!same(account,terms.feeManager))throw Error('只有当前 owner 能管理手续费权限');return terms;}
async function previewOwner(kind){
 preparedOwner=null;const current=await ownerTerms();let address=ZeroAddress;
 if(kind==='transfer'){
  address=getAddress($('fees-new-owner').value.trim());if([ZeroAddress,account,config.market,config.vault].some(v=>same(v,address)))throw Error('新 owner 必须是其他可操作的钱包或多签地址');
 }else if($('fees-renounce-word').value!=='RENOUNCE')throw Error('请输入 RENOUNCE 确认永久弃权');
 const method=kind==='transfer'?'transferOwnership':'renounceOwnership',args=kind==='transfer'?[address]:[],gas=await market.connect(signer)[method].estimateGas(...args);
 preparedOwner={kind,address,account,recipient:current.feeRecipient,pending:current.pendingOwner,gasLimit:gas*130n/100n+20000n};
 $(kind==='transfer'?'fees-owner-preview':'fees-renounce-preview').textContent=account+' → '+address;
 status(kind==='transfer'?'请核对新 owner。对方接受之前，当前 owner 仍有管理权限。':'弃权不可恢复。当前收款地址将永久固定，仍收取 1% 并可归集手续费。');
}
async function commitOwner(kind){
 await checkWallet();const op=preparedOwner;if(!op||op.kind!==kind||!same(account,op.account))throw Error('请重新预览 owner 操作');
 const current=await readMarketTerms(market,config.feeManager);
 if(!same(current.feeManager,op.account)||!same(current.feeRecipient,op.recipient)||!same(current.pendingOwner,op.pending))throw Error('链上管理状态已变化，请重新预览');
 if(kind==='transfer'&&!same($('fees-new-owner').value.trim(),op.address)||kind==='renounce'&&$('fees-renounce-word').value!=='RENOUNCE')throw Error('请重新预览 owner 操作');
 preparedOwner=null;const t=kind==='transfer'?await market.connect(signer).transferOwnership(op.address,{gasLimit:op.gasLimit}):await market.connect(signer).renounceOwnership({gasLimit:op.gasLimit});
 status('管理权限交易已提交：'+t.hash);await t.wait();prepared=null;$('fees-owner-preview').textContent='';$('fees-renounce-preview').textContent='';$('fees-renounce-word').value='';await refresh();
 status(kind==='transfer'?'移交已发起，请新 owner 连接自己的钱包并接受。':'已永久弃权。手续费收款地址已固定，归集和用户功能仍可使用。');
}
async function acceptOwner(){
 await checkWallet();await refresh();if(terms.renounced||!same(account,terms.pendingOwner))throw Error('只有待接收的新 owner 能接受移交');
 const gas=await market.connect(signer).acceptOwnership.estimateGas(),t=await market.connect(signer).acceptOwnership({gasLimit:gas*130n/100n+20000n});
 status('管理权限交易已提交：'+t.hash);await t.wait();prepared=null;preparedOwner=null;await refresh();status('已接受 owner 权限，旧 owner 不再有管理权限。');
}
async function cancelOwner(){
 await ownerTerms();if(terms.pendingOwner===ZeroAddress)throw Error('当前没有待接受的移交');
 const gas=await market.connect(signer).transferOwnership.estimateGas(ZeroAddress),t=await market.connect(signer).transferOwnership(ZeroAddress,{gasLimit:gas*130n/100n+20000n});
 status('管理权限交易已提交：'+t.hash);await t.wait();preparedOwner=null;await refresh();status('待接受的移交已取消，当前 owner 不变。');
}
const actions={'fees-refresh':refresh,'fees-connect':connect,'fees-collect':collect,'fees-preview-recipient':previewRecipient,'fees-change-recipient':changeRecipient,'fees-preview-owner':()=>previewOwner('transfer'),'fees-transfer-owner':()=>commitOwner('transfer'),'fees-accept-owner':acceptOwner,'fees-cancel-owner':cancelOwner,'fees-preview-renounce':()=>previewOwner('renounce'),'fees-renounce-owner':()=>commitOwner('renounce')};
document.addEventListener('click',async e=>{const action=actions[e.target.closest('button')?.id];if(!action||busy)return;busy=true;buttons();try{await action();}catch(e){prepared=null;preparedOwner=null;status(operationError(e).message);}finally{busy=false;buttons();}});
$('fees-new-recipient').addEventListener('input',()=>{prepared=null;$('fees-recipient-preview').textContent='';buttons();});
for(const id of ['fees-new-owner','fees-renounce-word'])$(id).addEventListener('input',()=>{preparedOwner=null;$('fees-owner-preview').textContent='';$('fees-renounce-preview').textContent='';buttons();});
function disconnected(text){signer=null;account=null;prepared=null;preparedOwner=null;$('fees-wallet').textContent=text;buttons();}
window.ethereum?.on?.('accountsChanged',()=>disconnected('账户已变化，请重新连接'));window.ethereum?.on?.('chainChanged',()=>disconnected('网络已变化，请重新连接'));
initialize().catch(e=>{market=null;buttons();status(operationError(e).message);});
