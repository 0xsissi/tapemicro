// Public application identifier, not a signing key. No cloud-admin credentials.
export const WALLET_CONNECT_PROJECT_ID='0c8f8955535c492a5f7a990b773b72fb';
export const WALLET_APP_URL='https://tapemicro.top';
export function walletConnectSettings(site,{projectId=WALLET_CONNECT_PROJECT_ID}={}){
 if(site.local||site.chainId!==56)return null;
 if(!/^[a-f0-9]{32}$/i.test(projectId))throw Error('WalletConnect Project ID 配置无效');
 return{appName:'TapeMicro',projectId,appDescription:'TapeMicro miners, trading and BEM rewards on BNB Smart Chain',appUrl:WALLET_APP_URL,appIcon:WALLET_APP_URL+'/wallet-icon.svg',walletConnectParameters:{customStoragePrefix:'tapemicro-wc',disableProviderPing:true,telemetryEnabled:false}};
}
export function restorationCandidates(connectors,preference){return preference?.rdns?connectors.filter(c=>c.id===preference.rdns):connectors.filter(c=>c.type!=='walletConnect');}
