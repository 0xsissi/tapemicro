// Stores a public connector preference, never a signer, key, or authorization.
// Accounts are accepted only after the wallet confirms them with eth_accounts.
const KEY='tapemicro-wallet-session-v1';
export function walletIdentity(provider){
 for(const[name,key]of [['rabby','isRabby'],['okx','isOkxWallet'],['coinbase','isCoinbaseWallet'],['binance','isBinance'],['metamask','isMetaMask']])if(provider?.[key])return name;
 return null;
}
export function walletSession(storage,chainId){
 let memory;
 const read=()=>{try{const row=JSON.parse(storage?.getItem(KEY)??'null');return row?.chainId===chainId?row:memory??null;}catch{return memory??null;}};
 const write=row=>{memory=row;try{storage?.setItem(KEY,JSON.stringify(row));}catch{}};
 return{
  read,
  remember(row){write({chainId,enabled:true,rdns:row?.rdns??null,legacy:walletIdentity(row?.provider),name:row?.name??'浏览器钱包'});},
  disable(){write({chainId,enabled:false});},
  select(rows){
   const previous=read();if(previous?.enabled===false)return null;
   if(!previous)return rows.length===1?rows[0]:null;
   const candidates=previous.rdns?rows.filter(r=>r.rdns===previous.rdns):previous.legacy?rows.filter(r=>walletIdentity(r.provider)===previous.legacy):rows.filter(r=>r.name===previous.name);
   return candidates.length===1?candidates[0]:null;
  }
 };
}
