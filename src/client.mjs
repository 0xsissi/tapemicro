import{selectSiteConfig}from'./site-config.mjs';
import DEFAULT from './config.json';
import PROTOCOL from './generated-protocol.json';
import {LiveGateway} from './live-gateway.mjs';
import {mountApp} from './app-controller.mjs';
import {CacheClient,useCache} from './cache-client.mjs';
import {ReferralClient} from './referral-client.mjs';
import{lazyWalletUI}from'./wallet-ui-loader.mjs';
const LOCAL=__LOCAL_CONFIG__;
let config=selectSiteConfig(DEFAULT,{legacyMarket:new URLSearchParams(location.search).get('legacyMarket')});
if(new URLSearchParams(location.search).get('network')==='local'){
 if(!LOCAL||!['localhost','127.0.0.1'].includes(location.hostname))throw Error('本地模式需要本机专用构建');
 config={...LOCAL};
}
// Network, RPCs and contracts come only from the shipped site config.
// Old saved connection overrides are never read.
const referrals=new ReferralClient({config});
const gateway=new LiveGateway(config,PROTOCOL,{referrals});
if(config.cacheApi&&!config.local)gateway.cache=useCache(gateway,new CacheClient({config}));
const walletModuleUrl=__WALLET_MODULE_URL__;
const walletUi=config.local?null:lazyWalletUI(()=>import(walletModuleUrl),config);
mountApp(gateway,{walletUi});