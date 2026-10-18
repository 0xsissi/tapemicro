import * as M from './simple-demo-model.mjs';
import {quoteFills} from './trade-quote.mjs';
import * as B from './demo-bids.mjs';
import {quoteSales} from './bid-plan.mjs';
import {referralLink} from './referral.mjs';
export class DemoGateway{
 referrals={ready:Promise.resolve(),refreshStats:async()=>{},view:who=>who?{promoter:{pointsRaw:'0',referees:0,refereeVolumeWei:'0'},link:referralLink(new URL('../index.html#market',globalThis.location?.href??'https://tapemicro.top/demo/index.html').href,who),referred:null,toBlock:null,rules:{kolShareBps:1000,refereeBonusBps:1000,requireFirstInteraction:true,validityDays:0}}:null};
 constructor(){this.config={chainId:0,marketVersion:4,explorer:null,local:false};this.hasBids=true;this.anyMinerBids=true;this.ready=true;this.state=M.createDemoState();this.storageKey='tapemicro-per-miner-demo-v6';try{const text=localStorage.getItem(this.storageKey);if(text)this.state=M.restore(text);}catch{}B.initialize(this.state);this.onChange=()=>{};}
 get address(){return this.state.connected?M.DEMO_USER:null;}
 async init(){}
 save(){try{localStorage.setItem(this.storageKey,M.serialize(this.state));}catch{}}
 async connect(){this.state.connected=true;this.save();return M.DEMO_USER;}
 disconnect(){this.state.connected=false;this.save();}
 reset(){this.state=M.createDemoState();B.initialize(this.state);this.save();}
 async read(){M.checkpoint(this.state);const bids=B.bids(this.state),account=this.address?M.account(this.state):null;if(account)account.bidEscrow=bids.filter(b=>b.bidder===this.address).reduce((n,b)=>n+b.remaining*b.priceWei,0n);return{ready:true,chainTime:this.state.last,block:0,paused:this.state.paused,assets:this.address?M.positions(this.state):[],assetsComplete:true,account,orders:M.orders(this.state),orderWindowIds:this.state.orders.map(o=>o.id),bidWindowIds:bids.map(b=>b.id),ordersExhausted:true,ordersScanned:this.state.orders.length,ordersTotal:BigInt(this.state.orders.length),bids,bidsSupported:true,bidsExhausted:true,bidsScanned:bids.length,bidsTotal:BigInt(bids.length),rewardFresh:true,dailyPer100:M.RATE*86400n*100n};}
 async catalog(){return{assets:B.catalog(this.state),complete:true,total:BigInt(B.catalog(this.state).length),next:B.catalog(this.state).length};}
 async quoteSale(fills){return{...quoteSales(fills),confirmed:true};}
 async discover(){return this.state.miners.filter(m=>!m.deposited&&m.owner===M.DEMO_USER).map(m=>M.inspect(this.state,m.sourceKey,m.id));}
 async inspect(k,id){return M.inspect(this.state,k,id);}
 async quote(fills){return{...quoteFills(fills),confirmed:true};}
 async marketApproved(){return this.state.marketApproved;}
 async history(){return{trades:this.state.trades,exhausted:true,cursor:-1};}
 async stats(){const trades=this.state.allTrades.filter(t=>t.timestamp>=this.state.last-86400);return{complete:true,lastPrice:trades[0]?.priceWei??null,volume24:trades.reduce((n,t)=>n+t.gross,0n)};}
 run(s,a){switch(a.kind){case'approveNFT':return M.approveMiner(s,a.sourceKey,a.tokenId);case'deposit':return M.splitMiner(s,a.sourceKey,a.tokenId,a.hashrate);case'approveMarket':s.marketApproved=true;return;case'list':return M.list(s,a.assetId,a.amount,a.priceWei,a.days);case'buy':return M.buyBatch(s,a.fills);case'bid':return B.place(s,a.assetIds,a.amount,a.priceWei,a.days);case'sale':return B.sell(s,a.fills,a.quote.net);case'cancelBid':case'expireBid':return B.close(s,a.id,a.kind==='expireBid');case'claim':return M.claim(s,a.ids);case'redeem':return M.redeem(s,a.assetId,a.hashrate);case'cancel':case'expire':return M.cancel(s,a.id);case'withdraw':return M.withdraw(s);default:throw Error('操作不存在');}}
 async prepare(action){this.run(structuredClone(this.state),action);return{who:this.address,action,contractAddress:null,gasCost:0n,execute:async()=>{if(!this.address)throw Error('请先连接钱包');const result=this.run(this.state,action);this.save();if(action.kind==='bid'){const state=this.state,id=result;setTimeout(()=>{if(state!==this.state)return;try{B.simulateSeller(state,id);this.save();this.onChange('买单已部分成交，持仓和积分已更新');}catch{}},6000);}if(action.kind==='list'){const state=this.state,id=result;setTimeout(()=>{if(state!==this.state)return;const order=state.orders.find(o=>o.id===id&&o.remaining>0n);if(!order)return;try{M.simulateBuyer(state,id,order.remaining<3n?order.remaining:3n);this.save();this.onChange('已部分成交，卖出款和积分已更新');}catch{}},6000);}return{hash:'virtual-'+Date.now(),amount:action.kind==='claim'?result:undefined};}};}
 errorName(){return null;}
}
