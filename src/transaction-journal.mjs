export const isPending=t=>['pending','unknown'].includes(t.status);
export const transactionScope=(config,who)=>['tapemicro-v2-transactions',config.chainId,config.vault??'',config.market??'',who??''].join('-').toLowerCase();
const hashOK=h=>/^0x[0-9a-f]{64}$/i.test(h??'');
export function actionSummary(a){const out={kind:a.kind};for(const key of ['assetId','tokenId','sourceKey','hashrate','id','settled'])if(a[key]!==undefined)out[key]=typeof a[key]==='bigint'?String(a[key]):a[key];if(a.ids)out.ids=a.ids.map(String);if(a.assetIds)out.assetIds=a.assetIds.map(String);return out;}
export class TransactionJournal{
 constructor(storage,key){this.storage=storage;this.key=key;this.memory=[];this.durable=true;}
 read(){if(!this.durable)return this.memory;try{const rows=JSON.parse(this.storage?.getItem(this.key)||'[]');this.memory=rows.filter(t=>hashOK(t.hash)&&['pending','unknown','confirmed','failed','cancelled','replaced'].includes(t.status));}catch{this.durable=false;}return this.memory;}
 put(record){const rows=this.read(),old=rows.find(t=>t.hash===record.hash);if(old&&!isPending(old)&&isPending(record))record={...record,status:old.status,note:old.note};const next=old?rows.map(t=>t.hash===record.hash?{...t,...record}:t):[record,...rows];this.memory=[...next.filter(isPending),...next.filter(t=>!isPending(t)).slice(0,30)];try{if(!this.storage)throw Error();this.storage.setItem(this.key,JSON.stringify(this.memory,(_,v)=>typeof v==='bigint'?String(v):v));}catch{this.durable=false;}return this.memory;}
}
export async function waitForTransaction(sent,{onSubmitted=()=>{},onReplaced=()=>{},timeout=90000}={}){
 // A UI/storage callback failure must never be confused with a failed broadcast.
 try{onSubmitted({hash:sent.hash,nonce:sent.nonce,from:sent.from,to:sent.to,data:sent.data,value:String(sent.value??0)});}catch{}
 let receipt;
 try{receipt=await sent.wait(1,timeout);}catch(error){
  if(error.code==='TRANSACTION_REPLACED'&&error.receipt){
   const replacementHash=error.replacement?.hash??error.receipt.hash;
   try{onReplaced({hash:sent.hash,replacementHash,cancelled:Boolean(error.cancelled)});}catch{}
   if(error.cancelled){const e=Error('交易已被取消或替换');Object.assign(e,{code:'TX_CANCELLED',submittedHash:sent.hash,replacementHash});throw e;}
   receipt=error.receipt;
  }else if(error.receipt?.status===0){Object.assign(error,{code:'TX_REVERTED',submittedHash:sent.hash});throw error;}
  else{const e=Error('交易已提交，暂未确认');Object.assign(e,{code:'TX_PENDING',submittedHash:sent.hash,cause:error});throw e;}
 }
 if(!receipt||receipt.status!==1){const e=Error('交易执行失败');Object.assign(e,{code:receipt?'TX_REVERTED':'TX_PENDING',submittedHash:sent.hash,receipt});throw e;}
 return receipt;
}
