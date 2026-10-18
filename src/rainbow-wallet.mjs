import React,{useEffect,useState}from'react';
import{createRoot}from'react-dom/client';
import{RainbowKitProvider,useConnectModal,useAccountModal,useChainModal}from'@rainbow-me/rainbowkit';
import{WagmiProvider,createConfig,createStorage,http,fallback,useAccount}from'wagmi';
import{injected}from'wagmi/connectors';
import{reconnect,getConnectors}from'@wagmi/core';
import{bsc,mainnet}from'viem/chains';
import{QueryClient,QueryClientProvider}from'@tanstack/react-query';
import{walletSession}from'./wallet-session.mjs';
import{walletIdentity}from'./wallet-session.mjs';
import{readLanguage}from'./i18n.mjs';
import{walletConnectSettings,restorationCandidates}from'./wallet-config.mjs';
import{qrWalletConnectors}from'./wallet-connectors.mjs';
import'@rainbow-me/rainbowkit/styles.css';

// Installed wallets and the configured WalletConnect QR connector share one UI.
// No chain or project overrides are accepted from browser storage.
const fallbackIcon='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#131518"/><path d="M7 10h18v14H7zM8 8h15" stroke="#F3F3F1" fill="none" stroke-width="2"/></svg>');
export function createRainbowWalletUI(site){
 if(bsc.id!==56||mainnet.id!==1)throw Error('钱包网络定义加载失败，请刷新重试');
 let storage;try{storage=localStorage;}catch{}
 const session=walletSession(storage,site.chainId),listeners=new Set();let state={status:'disconnected'},modalHooks={},lastConnector=null,serial=0,restoring=null,setLocale,readyResolve,readyReject;
 const ready=new Promise((resolve,reject)=>{readyResolve=resolve;readyReject=reject;}),chain={...bsc,rpcUrls:{default:{http:[...site.rpcUrls]}}};
 const announced=new Set(),remember=e=>announced.add(e.detail?.provider);window.addEventListener('eip6963:announceProvider',remember);window.dispatchEvent(new Event('eip6963:requestProvider'));window.removeEventListener('eip6963:announceProvider',remember);
 const providers=window.ethereum?.providers??[window.ethereum],names={metamask:'MetaMask',rabby:'Rabby',okx:'OKX Wallet',coinbase:'Coinbase Wallet',binance:'Binance Wallet'};
 const legacy=[...new Set(providers)].filter(p=>p?.request&&!announced.has(p)).map((provider,i)=>injected({target:{id:'tapemicro.'+(walletIdentity(provider)??'injected'+i),name:names[walletIdentity(provider)]??'Browser wallet',icon:fallbackIcon,provider},shimDisconnect:true}));
 const wcSettings=walletConnectSettings(site),remote=qrWalletConnectors(wcSettings,()=>session.disable());
 const config=createConfig({chains:[chain],connectors:[...legacy,...remote],multiInjectedProviderDiscovery:true,
  storage:createStorage({key:'tapemicro-rainbowkit',storage}),
  transports:{[chain.id]:fallback(site.rpcUrls.map(url=>http(url,{timeout:6000,retryCount:0})),{retryCount:1})}});
 const emit=value=>{state=value;for(const fn of listeners)fn(value);};
 async function publish(account){
  const epoch=++serial;
  if(account.status==='connected'){
   const provider=await account.connector.getProvider();if(epoch!==serial)return;
   lastConnector=account.connector;
   session.remember({rdns:account.connector.id,name:account.connector.name,provider});
   emit({status:'connected',address:account.address,chainId:account.chainId,provider,connectorId:account.connector.uid});
  }else if(account.status==='disconnected'){
   // Wagmi's disconnect shim is set by the user's Disconnect action, not
   // by a temporary provider outage. Preserve that choice across reloads.
   const manual=lastConnector&&await config.storage?.getItem(`${lastConnector.id}.disconnected`);
   if(epoch!==serial)return;if(manual)session.disable();emit({status:'disconnected',manual:Boolean(manual)});
  }else emit({status:account.status});
 }
 function Bridge(){
  const account=useAccount(),connect=useConnectModal(),current=useAccountModal(),network=useChainModal();
  modalHooks={connect:connect.openConnectModal,account:current.openAccountModal,chain:network.openChainModal};
  useEffect(()=>{publish(account).catch(()=>emit({status:'disconnected'}));},[account.status,account.address,account.chainId,account.connector]);
  useEffect(()=>{readyResolve();},[]);return null;
 }
 function WalletHelp({Text}){return React.createElement(Text,null,readLanguage()==='en'?'Use an installed wallet, or choose WalletConnect to scan with your mobile wallet.':'使用已安装的钱包，或选择 WalletConnect，用手机钱包扫码连接。');}
 function Root(){const[locale,update]=useState(readLanguage()==='en'?'en-US':'zh-CN');setLocale=update;
  return React.createElement(WagmiProvider,{config,reconnectOnMount:false},React.createElement(QueryClientProvider,{client:query},React.createElement(RainbowKitProvider,{theme:null,initialChain:chain,locale,modalSize:'compact',showRecentTransactions:false,appInfo:{appName:'TapeMicro',disclaimer:WalletHelp}},React.createElement(Bridge))));
 }
 class Boundary extends React.Component{state={failed:false};static getDerivedStateFromError(){return{failed:true};}componentDidCatch(){const error=Error('钱包组件加载失败，请刷新网页重试');emit({status:'unavailable'});readyReject(error);}render(){return this.state.failed?null:this.props.children;}}
 const query=new QueryClient({defaultOptions:{queries:{retry:1,refetchOnWindowFocus:false}}});
 const host=document.createElement('div');host.id='rainbowkit-root';host.setAttribute('data-no-i18n','');document.body.append(host);const root=createRoot(host);root.render(React.createElement(Boundary,null,React.createElement(Root)));
 async function restore(){
  await ready;if(restoring)return restoring;if(session.read()?.enabled===false||state.status==='connected'||state.status==='connecting')return;
  restoring=(async()=>{const rows=await Promise.all(restorationCandidates(getConnectors(config),session.read()).map(async connector=>({id:connector.uid,rdns:connector.id,name:connector.name,provider:await connector.getProvider(),connector})));const row=session.select(rows.filter(r=>r.provider));if(row)await reconnect(config,{connectors:[row.connector]});})().finally(()=>restoring=null);return restoring;
 }
 ready.then(()=>restore()).catch(()=>{});
 return{ready,restore,destroy(){++serial;listeners.clear();root.unmount();host.remove();query.clear();},getState:()=>state,subscribe(fn){listeners.add(fn);fn(state);return()=>listeners.delete(fn);},setLanguage:lang=>setLocale?.(lang==='en'?'en-US':'zh-CN'),async open(mode='connect'){await ready;if(state.status==='unavailable')throw Error('钱包组件加载失败，请刷新网页重试');const open=modalHooks[mode]??modalHooks.connect;if(!open)throw Error('钱包组件正在准备，请稍后重试');open();}};
}
