import{selectSiteConfig}from'./site-config.mjs';
import {isAddress} from 'ethers';
import DEFAULT from './config.json';
import PROTOCOL from './generated-protocol.json';
import {LiveGateway} from './live-gateway.mjs';
import {mountApp} from './app-controller.mjs';
import {escapeHtml as esc,validateRpc} from './client-utils.mjs';
import {feeRecipientAddress} from './market-terms.mjs';
import {CacheClient,useCache} from './cache-client.mjs';
import {ReferralClient} from './referral-client.mjs';
const LOCAL=__LOCAL_CONFIG__;
let config=selectSiteConfig(DEFAULT,{legacyMarket:new URLSearchParams(location.search).get('legacyMarket')});
if(new URLSearchParams(location.search).get('network')==='local'){
 if(!LOCAL||!['localhost','127.0.0.1'].includes(location.hostname))throw Error('本地模式需要本机专用构建');
 config={...LOCAL};
}
const settingsKey=['tapemicro-connection',config.chainId,config.market].join('-');
try{const saved=JSON.parse(localStorage.getItem(settingsKey)||'null');if(saved&&!config.legacyReadOnly)config={...config,...saved,rpcUrls:[...new Set([validateRpc(saved.rpc,{local:config.local}),...(config.local?[]:DEFAULT.rpcUrls)])]};}catch{}
const referrals=new ReferralClient({config});
const gateway=new LiveGateway(config,PROTOCOL,{referrals});
if(config.cacheApi&&!config.local)gateway.cache=useCache(gateway,new CacheClient({config}));
mountApp(gateway,{onSettings:({modal})=>{
 modal('连接设置',`<label for="setting-rpc">RPC 节点</label><input id="setting-rpc" value="${esc(config.rpcUrls[0])}"><label for="setting-vault">RC4 金库地址</label><input id="setting-vault" value="${esc(config.vault??'')}"><label for="setting-market">RC4 市场地址</label><input id="setting-market" value="${esc(config.market??'')}"><label for="setting-fee">初始管理钱包（部署钱包）</label><input id="setting-fee" value="${esc(config.feeManager??'')}"><label for="setting-block">市场部署区块</label><input id="setting-block" inputmode="numeric" value="${config.deploymentBlock??0}"><p class="field-note">保存后重新加载，并核验合约版本、字节码、绑定和收款地址。</p>`,()=>{
  const value=id=>document.getElementById(id).value.trim(),rpc=validateRpc(value('setting-rpc'),{local:config.local}),vault=value('setting-vault')||null,market=value('setting-market')||null,fee=value('setting-fee')||null,block=value('setting-block');
  if(Boolean(vault)!==Boolean(market)||[vault,market].some(a=>a&&!isAddress(a)))throw Error('请填写完整、有效的金库和市场地址');
  if(vault&&!fee)throw Error('需要填写经核验的手续费管理钱包');
  if(!/^\d+$/.test(block)||!Number.isSafeInteger(Number(block)))throw Error('部署区块必须为非负整数');
  localStorage.setItem(settingsKey,JSON.stringify({rpc,vault,market,feeManager:fee?feeRecipientAddress(fee):null,deploymentBlock:Number(block)}));location.reload();
 },'保存并重新连接');
}});
