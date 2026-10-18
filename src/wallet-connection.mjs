// EIP-6963 discovery, with an EIP-1193 injected-provider fallback.
// Wallet names are untrusted display text. Icons and external URLs are not used.
export function discoverWallets(host=globalThis.window){
 const rows=[],listeners=new Set();let sequence=0;
 function add(provider,name,rdns){if(typeof provider?.request!=='function')return;const old=rows.find(r=>r.provider===provider);if(old){if(name&&old.name!==name||rdns&&old.rdns!==rdns){if(name)old.name=name;if(rdns)old.rdns=rdns;listeners.forEach(f=>f());}return;}if(rows.length>=32)return;rows.push({id:String(++sequence),name:name||'浏览器钱包',rdns:rdns??null,provider});listeners.forEach(f=>f());}
 host?.addEventListener?.('eip6963:announceProvider',event=>{const d=event.detail;if(!d?.info||typeof d.info.name!=='string'||!d.info.name.trim())return;add(d.provider,d.info.name.trim().slice(0,80),typeof d.info.rdns==='string'?d.info.rdns.slice(0,255):null);});
 function legacy(){try{const providers=host?.ethereum?.providers;if(Array.isArray(providers)&&providers.length)providers.forEach(p=>add(p));else add(host?.ethereum);}catch{}}
 function request(){const EventType=host?.Event??globalThis.Event;if(host?.dispatchEvent&&EventType)host.dispatchEvent(new EventType('eip6963:requestProvider'));legacy();}
 request();
 return{list:()=>{legacy();return rows.map(r=>({...r}));},request,subscribe:fn=>{listeners.add(fn);return()=>listeners.delete(fn);}};
}
export function watchWallet(provider,{accountsChanged,chainChanged,disconnected}={}){
 let active=true;const events=[['accountsChanged',accountsChanged],['chainChanged',chainChanged],['disconnect',disconnected]].filter(([,fn])=>fn).map(([event,fn])=>[event,(...args)=>{if(active)fn(...args);}]);
 for(const[event,fn]of events)provider?.on?.(event,fn);
 return()=>{active=false;for(const[event,fn]of events)provider?.removeListener?.(event,fn);};
}
const walletError=(code,message)=>Object.assign(Error(message),{code});
export async function authorizedWalletAccounts(wallet,config){
 if(typeof wallet?.request!=='function')return null;
 const accounts=await wallet.request({method:'eth_accounts'});
 if(!Array.isArray(accounts)||!accounts.length)return null;
 if(BigInt(await wallet.request({method:'eth_chainId'}))!==BigInt(config.chainId))return null;
 return accounts;
}
export async function requestWalletConnection(wallet,config){
 if(typeof wallet?.request!=='function')throw walletError('NO_WALLET','请安装 EVM 钱包插件，或在钱包 App 的浏览器中打开本网站。');
 const accounts=await wallet.request({method:'eth_requestAccounts'});
 if(!Array.isArray(accounts)||!accounts.length)throw walletError('NO_WALLET_ACCOUNT','钱包未提供账户，请在钱包中解锁并授权连接');
 const expected=BigInt(config.chainId),chainId='0x'+expected.toString(16);
 if(BigInt(await wallet.request({method:'eth_chainId'}))!==expected){
  try{await wallet.request({method:'wallet_switchEthereumChain',params:[{chainId}]});}
  catch(error){
   const code=error?.code??error?.data?.originalError?.code;
   if(Number(code)!==4902){if([4200,-32601].includes(Number(code)))throw walletError('WALLET_NETWORK_UNSUPPORTED','钱包不支持自动切换网络，请在钱包中切换到 BSC 主网后重试');throw error;}
   if(expected!==56n)throw error;
   try{await wallet.request({method:'wallet_addEthereumChain',params:[{chainId,chainName:'BNB Smart Chain',nativeCurrency:{name:'BNB',symbol:'BNB',decimals:18},rpcUrls:[...config.rpcUrls],blockExplorerUrls:['https://bscscan.com']}]});await wallet.request({method:'wallet_switchEthereumChain',params:[{chainId}]});}
   catch(addError){if([4200,-32601].includes(Number(addError?.code)))throw walletError('WALLET_NETWORK_UNSUPPORTED','钱包不支持自动切换网络，请在钱包中切换到 BSC 主网后重试');throw addError;}
  }
 }
 if(BigInt(await wallet.request({method:'eth_chainId'}))!==expected)throw walletError('WALLET_WRONG_CHAIN','钱包尚未切换到 BSC 主网，请在钱包中确认后重试');
 return accounts;
}
