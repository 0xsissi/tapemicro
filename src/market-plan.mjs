import {quoteFills} from './trade-quote.mjs';
import {displayUnits} from './client-utils.mjs';
export const POINTS_PER_BNB=1000n;
export const points=wei=>{const raw=BigInt(wei)*POINTS_PER_BNB,s=displayUnits(raw,18,8);return raw>0n&&s==='0'?'<0.00000001':s;};
export const chunks=(items,size=32)=>{const out=[];for(let i=0;i<items.length;i+=size)out.push(items.slice(i,i+size));return out;};
const lower=v=>String(v??'').toLowerCase();
export function planPurchase(orders,wanted,{address=null,now=0,maxFills=16,orderId=null}={}){
 if(typeof wanted!=='bigint'||wanted<0n)throw Error('请输入整数 H');
 const sorted=orders.filter(o=>(orderId===null||o.id===orderId)&&o.tradable&&o.approved&&o.remaining>0n&&o.balance>0n&&o.expiresAt>BigInt(now)&&lower(o.seller)!==lower(address)).sort((a,b)=>a.priceWei===b.priceWei?(a.id<b.id?-1:1):a.priceWei<b.priceWei?-1:1);
 const inventory=new Map(),fills=[];let left=wanted;
 for(const o of sorted){if(left===0n||fills.length===maxFills)break;const key=lower(o.seller)+':'+o.assetId,available=inventory.has(key)?inventory.get(key):o.balance,cap=o.remaining<available?o.remaining:available,amount=left<cap?left:cap;if(amount===0n)continue;fills.push({...o,amount});inventory.set(key,available-amount);left-=amount;}
 const quote=quoteFills(fills);return{fills,requested:wanted,quantity:wanted-left,enough:left===0n&&wanted>0n,limited:left>0n&&fills.length===maxFills,...quote};
}
export const planKey=plan=>plan.fills.map(f=>`${f.id}:${f.assetId}:${f.amount}:${f.priceWei}`).join('|');
export function availableH(asset){return asset.balance>asset.reserved?asset.balance-asset.reserved:0n;}
export function dailyAtCurrentRate(rate,unverifiedBps,totalWeight,h=100n){if(totalWeight<=0n||rate<0n)return null;const emitted=rate*86400n;return (emitted-emitted*unverifiedBps/10000n)*h/totalWeight;}
