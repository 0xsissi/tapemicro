import{connectorsForWallets}from'@rainbow-me/rainbowkit';
import{walletConnectWallet}from'@rainbow-me/rainbowkit/wallets';
export const rememberDisconnect=(factory,onDisconnect)=>context=>{
 const connector=factory(context);
 return{...connector,async disconnect(...args){onDisconnect();return connector.disconnect(...args);}};
};
export function qrWalletConnectors(settings,onDisconnect){
 if(!settings)return[];
 // RainbowKit 2.2.11 emits an alternate AppKit-modal connector, then its own
 // QR connector. Keep the latter, so one wallet flow and modal handles QR.
 const factories=connectorsForWallets([{groupName:'WalletConnect',wallets:[walletConnectWallet]}],settings);
 return factories.slice(-1).map(factory=>rememberDisconnect(factory,onDisconnect));
}
