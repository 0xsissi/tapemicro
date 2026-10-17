// Offline bid escrow simulation. Never calls a provider or a real wallet.
import * as M from './simple-demo-model.mjs';
import{bidAccepts,isAnyBid}from'./bid-acceptance.mjs';
import {quoteSales} from './bid-plan.mjs';
const now=()=>Math.floor(Date.now()/1000),same=(a,b)=>String(a).toLowerCase()===String(b).toLowerCase();
export function initialize(s){if(s.bidVersion===1)return;s.bidVersion=1;s.bids=[];s.nextBidId=1n;s.bidEscrow=0n;
 const ids=Object.values(s.assets).filter(p=>p.active&&p.statusCode===1).map(p=>p.id),a=M.demoId('tapeout',5438n),b=M.demoId('behemoth',407n);
 for(const[bidder,accepted,amount,price]of [[M.SELLER_A,[a,b],40n,9n*10n**14n],[M.SELLER_B,[a],30n,8n*10n**14n],[M.SELLER_B,[b],10n,7n*10n**14n]])if(accepted.every(id=>ids.includes(id))&&s.accounts[bidder].bnb>=amount*price)place(s,accepted,amount,price,7,s.last,bidder);
}
export function catalog(s){return Object.values(s.assets).filter(p=>p.active&&p.statusCode===1).map(p=>({...p,tradable:true,status:'正常'}));}
export function bids(s){return s.bids.map(b=>{const assets=b.assetIds.map(id=>s.assets[id]).filter(Boolean).map(p=>({...p,tradable:p.active&&p.statusCode===1}));return{...b,bidId:b.id,assets,valid:isAnyBid(b)||assets.some(p=>p.tradable),receivable:true,simulated:true,filledAmount:b.originalAmount-b.remaining-b.refundedWei/b.priceWei};});}
export function place(s,assetIds,amount,priceWei,days,time=now(),bidder=M.DEMO_USER){
 const max=2n**128n-1n;if(assetIds.length>32||amount<=0n||amount>max||priceWei<=0n||priceWei>max||![1,7,30].includes(days))throw Error('请检查数量、价格、有效期和矿机范围');
 if(assetIds.some((id,i)=>i>0&&id<=assetIds[i-1]||!s.assets[id]?.active||s.assets[id]?.statusCode!==1))throw Error('矿机范围无效或顺序错误');
 const value=amount*priceWei,a=s.accounts[bidder];if(a.bnb<value)throw Error('BNB 余额不足');M.checkpoint(s,time);a.bnb-=value;s.bidEscrow+=value;const id=s.nextBidId++;
 s.bids.push({id,bidder,assetIds:[...assetIds],remaining:amount,originalAmount:amount,priceWei,expiresAt:BigInt(s.last+days*86400),kind:assetIds.length===0?2n:assetIds.length===1?1n:0n,refundedWei:0n});return id;
}
function fill(s,seller,f,time){
 const b=s.bids.find(b=>b.id===(f.bidId??f.id)),p=s.assets[f.assetId];if(!b||same(b.bidder,seller)||b.remaining<f.amount||f.amount<=0n||b.expiresAt<=BigInt(time)||b.priceWei!==f.priceWei||!bidAccepts(b,f.assetId)||!p?.active||p.statusCode!==1)throw Error('买单或矿机状态已变化');
 const a=s.accounts[seller],buyer=s.accounts[b.bidder];if((a.balances[f.assetId]??0n)<f.amount)throw Error('余额不足');const q=quoteSales([f]);a.balances[f.assetId]-=f.amount;buyer.balances[f.assetId]=(buyer.balances[f.assetId]??0n)+f.amount;b.remaining-=f.amount;s.bidEscrow-=q.gross;s.platformFees+=q.fee;if(a.rejectPayout)a.proceeds+=q.net;else a.bnb+=q.net;a.tradePoints+=q.gross;buyer.tradePoints+=q.gross;a.soldVolumeWei+=q.gross;buyer.boughtVolumeWei+=q.gross;
 const trade={...p,id:b.id,assetId:p.id,book:'bid',amount:f.amount,gross:q.gross,priceWei:f.priceWei,timestamp:time,hash:'virtual-'+s.allTrades.length,logIndex:s.allTrades.length,blockNumber:s.allTrades.length};s.allTrades.unshift(trade);if(seller===M.DEMO_USER||b.bidder===M.DEMO_USER)s.trades.unshift({...trade,side:b.bidder===M.DEMO_USER?'buy':'sell'});return q.net;
}
export function sell(s,fills,minNet,time=now(),seller=M.DEMO_USER){if(!fills.length||fills.length>16)throw Error('单笔最多 16 笔成交');const draft=structuredClone(s);M.checkpoint(draft,time);let net=0n;for(const f of fills)net+=fill(draft,seller,f,draft.last);if(net<minNet)throw Error('实际到账低于最低值');Object.assign(s,draft);return net;}
export function close(s,id,expired=false,time=now(),caller=M.DEMO_USER){const b=s.bids.find(b=>b.id===id);if(!b||b.remaining===0n||!expired&&!same(b.bidder,caller)||expired&&b.expiresAt>BigInt(time))throw Error('买单无法撤销或尚未过期');M.checkpoint(s,time);const refund=b.remaining*b.priceWei;b.remaining=0n;b.refundedWei=refund;s.bidEscrow-=refund;const a=s.accounts[b.bidder];if(a.rejectPayout)a.proceeds+=refund;else a.bnb+=refund;return refund;}
export function simulateSeller(s,id,time=now()){const b=s.bids.find(b=>b.id===id&&b.bidder===M.DEMO_USER&&b.remaining>0n);if(!b)return;for(const seller of [M.SELLER_A,M.SELLER_B])for(const assetId of (isAnyBid(b)?catalog(s).map(a=>a.id):b.assetIds)){const amount=[s.accounts[seller].balances[assetId]??0n,b.remaining,3n].reduce((a,b)=>a<b?a:b);if(amount>0n&&s.assets[assetId]?.statusCode===1)return sell(s,[{bidId:id,assetId,amount,priceWei:b.priceWei}],0n,time,seller);}}
