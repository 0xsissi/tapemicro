import {quoteFills} from './trade-quote.mjs';
import {availableH} from './market-plan.mjs';
import {bidAccepts} from './bid-acceptance.mjs';
export function quoteSales(fills){const q=quoteFills(fills);return{quantity:q.quantity,gross:q.gross,fee:q.fee,net:q.gross-q.fee};}
const same=(a,b)=>String(a??'').toLowerCase()===String(b??'').toLowerCase();
export function assertUnlistedSale(fills,assets){
 const totals=new Map();for(const f of fills)totals.set(String(f.assetId),(totals.get(String(f.assetId))??0n)+f.amount);
 for(const [id,amount]of totals){const a=assets.find(a=>String(a.id)===id);if(!a?.tradable||amount>availableH({...a,reserved:a.reserved??0n}))throw Error('部分份额已挂售或余额变化，请先撤单再卖出');}
}
export const liveBids=(bids,{address=null,now=0}={})=>bids.filter(b=>b.valid&&b.receivable!==false&&b.remaining>0n&&b.expiresAt>BigInt(now)&&!same(b.bidder,address));
const liveAsks=(orders,now)=>orders.filter(o=>o.tradable&&o.approved&&o.balance>0n&&o.remaining>0n&&o.expiresAt>BigInt(now));
export function lowestAskForAssets(orders,assetIds,{now=0}={}){
 const accepted=new Set(assetIds.map(String));
 return liveAsks(orders,now).filter(o=>!assetIds.length||accepted.has(String(o.assetId))).reduce((low,o)=>low===null||o.priceWei<low?o.priceWei:low,null);
}
export function hasCrossedQuotes(orders,bids,{now=0}={}){
 const asks=liveAsks(orders,now);
 return liveBids(bids,{now}).some(b=>asks.some(o=>bidAccepts(b,o.assetId)&&!same(o.seller,b.bidder)&&b.priceWei>=o.priceWei));
}
export function planSale(bids,assets,wanted,{address=null,now=0,maxFills=16}={}){
 if(typeof wanted!=='bigint'||wanted<0n)throw Error('请输入整数 H');
 if(wanted===0n)return{fills:[],requested:wanted,enough:false,limited:false,reservedQuantity:0n,...quoteSales([])};
 const freeH=a=>availableH({...a,reserved:a.reserved??0n});
 const eligible=assets.filter(a=>a.tradable&&freeH(a)>0n),orders=liveBids(bids,{address,now}).filter(b=>eligible.some(a=>bidAccepts(b,a.id))).sort((a,b)=>a.priceWei===b.priceWei?(a.id<b.id?-1:1):a.priceWei>b.priceWei?-1:1);
 if(wanted===0n||!eligible.length||!orders.length)return{fills:[],requested:wanted,enough:false,limited:false,reservedQuantity:0n,...quoteSales([])};
 // Minimum-cost flow accounts for overlapping accepted sets. A flexible
 // high bid must not consume the only asset a later bid accepts when another
 // asset can fill it. Costs use exact integer wei; capacities use integer H.
 const sink=eligible.length+orders.length+1,n=sink+1,g=Array.from({length:n},()=>[]),links=[];
 const edge=(from,to,cap,cost)=>{const e={to,rev:g[to].length,cap,original:cap,cost};g[from].push(e);g[to].push({to:from,rev:g[from].length-1,cap:0n,original:0n,cost:-cost});return e;};
 // Listed shares stay reserved in this UI until the seller cancels the asks.
 // This is a wallet-side safeguard, not an on-chain transfer lock.
 eligible.forEach((a,i)=>edge(0,i+1,freeH(a),0n));
 orders.forEach((b,j)=>{const node=eligible.length+j+1;edge(node,sink,b.remaining,0n);eligible.forEach((a,i)=>{if(bidAccepts(b,a.id))links.push({b,a,e:edge(i+1,node,a.balance,-b.priceWei)});});});
 let left=wanted;
 while(left>0n){const dist=Array(n).fill(null),prev=Array(n);dist[0]=0n;
  for(let pass=0;pass<n-1;pass++){let changed=false;for(let u=0;u<n;u++){if(dist[u]===null)continue;for(let k=0;k<g[u].length;k++){const e=g[u][k],d=dist[u]+e.cost;if(e.cap>0n&&(dist[e.to]===null||d<dist[e.to])){dist[e.to]=d;prev[e.to]=[u,k];changed=true;}}}if(!changed)break;}
  if(dist[sink]===null)break;let amount=left;for(let v=sink;v!==0;){const [u,k]=prev[v];if(g[u][k].cap<amount)amount=g[u][k].cap;v=u;}
  for(let v=sink;v!==0;){const[u,k]=prev[v],e=g[u][k];e.cap-=amount;g[v][e.rev].cap+=amount;v=u;}left-=amount;
 }
 const all=links.filter(l=>l.e.original>l.e.cap).map(({b,a,e})=>({...a,id:b.id,bidId:b.id,assetId:a.id,bidder:b.bidder,amount:e.original-e.cap,priceWei:b.priceWei})).sort((a,b)=>a.priceWei===b.priceWei?(a.bidId===b.bidId?(a.amount>b.amount?-1:1):a.bidId<b.bidId?-1:1):a.priceWei>b.priceWei?-1:1),fills=all.slice(0,maxFills),q=quoteSales(fills);
 const sold=new Map();for(const f of fills)sold.set(f.assetId,(sold.get(f.assetId)??0n)+f.amount);
 const reservedQuantity=eligible.reduce((n,a)=>{const amount=sold.get(a.id)??0n,free=freeH(a);return n+(amount>free?amount-free:0n);},0n);
 return{fills,requested:wanted,enough:q.quantity===wanted,limited:all.length>maxFills,reservedQuantity,...q};
}
