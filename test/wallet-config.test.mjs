import test from'node:test';import assert from'node:assert/strict';
import{walletConnectSettings,WALLET_CONNECT_PROJECT_ID,restorationCandidates}from'../src/wallet-config.mjs';
import{qrWalletConnectors,rememberDisconnect}from'../src/wallet-connectors.mjs';
test('WalletConnect uses the authorized public project and canonical TapeMicro metadata',()=>{
 const s=walletConnectSettings({chainId:56});assert.equal(s.projectId,WALLET_CONNECT_PROJECT_ID);assert.match(s.projectId,/^[a-f0-9]{32}$/);assert.equal(s.appUrl,'https://tapemicro.top');assert.equal(new URL(s.appIcon).origin,s.appUrl);assert.equal(s.walletConnectParameters.telemetryEnabled,false);assert.equal(s.walletConnectParameters.customStoragePrefix,'tapemicro-wc');
});
test('RainbowKit exposes exactly one QR connector without a competing AppKit modal',()=>{
 assert.deepEqual(qrWalletConnectors(null,()=>{}),[]);const factories=qrWalletConnectors(walletConnectSettings({chainId:56}),()=>{});assert.equal(factories.length,1);const connector=factories[0]({});assert.equal(connector.rkDetails.id,'walletConnect');assert.equal(connector.rkDetails.showQrModal,undefined);assert.equal(connector.rkDetails.isWalletConnectModalConnector,undefined);assert.equal(typeof connector.rkDetails.qrCode.getUri,'function');
});
test('explicit WalletConnect disconnect persists even if remote cleanup fails',async()=>{
 let disabled=0,connected=0;const factory=rememberDisconnect(()=>({connect(){connected++;},async disconnect(){throw Error('relay offline');}}),()=>disabled++),c=factory({});c.connect();assert.equal(connected,1);assert.equal(disabled,0);await assert.rejects(c.disconnect(),/relay offline/);assert.equal(disabled,1);
});
test('restoring an injected wallet does not initialize WalletConnect or unrelated wallets',()=>{
 const connectors=[{id:'io.rabby',type:'injected'},{id:'walletConnect',type:'walletConnect'},{id:'io.metamask',type:'injected'}];assert.deepEqual(restorationCandidates(connectors,{rdns:'io.rabby'}),[connectors[0]]);assert.deepEqual(restorationCandidates(connectors,{rdns:'walletConnect'}),[connectors[1]]);assert.equal(restorationCandidates(connectors,null).some(c=>c.type==='walletConnect'),false);assert.deepEqual(restorationCandidates(connectors,{rdns:'missing'}),[]);
});
test('local chains do not initialize WalletConnect or request a pairing',()=>{assert.equal(walletConnectSettings({local:true,chainId:56}),null);assert.equal(walletConnectSettings({chainId:31337}),null);assert.equal(walletConnectSettings({chainId:1}),null);});
test('invalid project IDs fail configuration without reading browser overrides',()=>{
 for(const projectId of['','123','YOUR_PROJECT_ID','a'.repeat(64)])assert.throws(()=>walletConnectSettings({chainId:56},{projectId}));
 assert.equal(walletConnectSettings({chainId:56,projectId:'untrusted'}).projectId,WALLET_CONNECT_PROJECT_ID);
});
