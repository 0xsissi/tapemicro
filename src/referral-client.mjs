import{pointsMarkets}from'./points-markets.mjs';
import {getAddress,isAddress} from 'ethers';
import {rememberReferral,currentReferral,activeKol,referralLink} from './referral.mjs';
const address=v=>{if(!isAddress(v)||/^0x0{40}$/i.test(v))throw Error('Invalid referral address');return getAddress(v);};
const uint=v=>{if(typeof v!=='string'||!/^\d+$/.test(v))throw Error('Invalid referral amount');return v;};
const block=v=>Number.isSafeInteger(v)&&v>=0;
export function referralList(raw){
 const mode=Array.isArray(raw)?'allowlist':raw?.mode,rows=Array.isArray(raw)?raw:raw?.kols;
 if(!['open','allowlist'].includes(mode)||!Array.isArray(rows))throw Error('Invalid referral list');
 const seen=new Set(),kols=rows.map(r=>{const a=address(r.address);if(seen.has(a))throw Error('Duplicate referral address');seen.add(a);for(const k of ['startBlock','endBlock'])if(r[k]!=null&&!block(r[k]))throw Error('Invalid referral cutoff');if(r.startBlock!=null&&r.endBlock!=null&&r.startBlock>r.endBlock)throw Error('Invalid referral range');return{address:a,name:typeof r.name==='string'?r.name.slice(0,80):'',...(r.startBlock==null?{}:{startBlock:r.startBlock}),...(r.endBlock==null?{}:{endBlock:r.endBlock})};});return{mode,kols};
}
export function referralSnapshot(raw,config,mode){
 if(raw?.version!==1||raw.chainId!==config.chainId||raw.pointsPerBnb!==1000||(raw.referralMode??'allowlist')!==mode||!Array.isArray(raw.kols)||!Array.isArray(raw.referees))throw Error('Wrong referral snapshot');
 const rules=raw.rules;
 if(!rules||typeof rules.requireFirstInteraction!=='boolean'||!['kolShareBps','refereeBonusBps','validityDays'].every(k=>Number.isSafeInteger(rules[k])&&rules[k]>=0)||rules.kolShareBps>10000||rules.refereeBonusBps>10000)throw Error('Invalid referral rules');
 if(raw.toBlock===null){if(raw.kols.length||raw.referees.length)throw Error('Unprocessed referral data');}
 else{if(!block(raw.toBlock)||!block(raw.deploymentBlock)||raw.deploymentBlock>raw.toBlock||!/^0x[\da-f]{64}$/i.test(raw.toBlockHash??''))throw Error('Invalid referral checkpoint');if(!config.vault||address(raw.vault)!==address(config.vault)||!Array.isArray(raw.markets)||!raw.markets.some(a=>address(a)===address(config.market)))throw Error('Wrong referral contracts');if((config.legacyMarkets??[]).length&&!pointsMarkets(config).every(m=>raw.markets.some(a=>address(a)===address(m.address))))throw Error('Referral history misses a market');if(config.deploymentBlock!=null&&raw.deploymentBlock>Math.min(config.deploymentBlock,...(config.legacyMarkets??[]).map(m=>m.deploymentBlock)))throw Error('Referral history starts too late');}
 const kols=new Map(),referees=new Map();
 for(const r of raw.kols){const a=address(r.address);if(kols.has(a)||!block(r.referees))throw Error('Invalid promoter row');uint(r.pointsRaw);uint(r.refereeVolumeWei);if(BigInt(r.pointsRaw)!==BigInt(r.refereeVolumeWei)*1000n*BigInt(rules.kolShareBps)/10000n)throw Error('Referral points do not reconcile');kols.set(a,r);}
 for(const r of raw.referees){const a=address(r.address),kol=address(r.kol);if(referees.has(a)||kol===a||!block(r.bindBlock)||r.bindBlock>raw.toBlock||!/^0x[\da-f]{64}$/i.test(r.bindTx??''))throw Error('Invalid referred wallet');uint(r.volumeWei);uint(r.bonusRaw);if(BigInt(r.bonusRaw)!==BigInt(r.volumeWei)*1000n*BigInt(rules.refereeBonusBps)/10000n)throw Error('Referral bonus does not reconcile');referees.set(a,r);}
 return{...raw,kols,referees};
}
export class ReferralClient{
 constructor({config,href=globalThis.location?.href,storage,fetcher=globalThis.fetch}={}){Object.assign(this,{config,href,storage,fetcher,kols:[],mode:'allowlist',listReady:false,data:null,firstKol:null});this.ready=this.load();}
 async json(name){const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),6000);try{const r=await this.fetcher.call(globalThis,new URL('./'+name,this.href).href,{cache:'no-store',signal:controller.signal});if(!r.ok)throw Error('Referral file unavailable');return await r.json();}finally{clearTimeout(timer);}}
 async snapshot(){if(this.config.cacheApi)try{const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),2500);try{const response=await this.fetcher.call(globalThis,new URL(this.config.cacheApi.replace(/\/$/,'')+'/referral-points',this.href).href,{cache:'no-store',signal:controller.signal});if(!response.ok)throw Error();const raw=await response.json();referralSnapshot(raw,this.config,this.mode);return raw;}finally{clearTimeout(timer);}}catch{}return this.json('kol-points.json');}
 async load(){this.listReady=false;this.data=null;try{Object.assign(this,referralList(await this.json('kol-list.json')));this.listReady=true;this.remember(this.href);this.data=referralSnapshot(await this.snapshot(),this.config,this.mode);}catch{} }
 remember(href){if(!this.listReady)return;const kol=rememberReferral(href,this.kols,{storage:this.storage,mode:this.mode});this.firstKol??=kol;}
 current(blockNumber){if(!this.listReady)return null;const kol=currentReferral(this.kols,{storage:this.storage,mode:this.mode})??activeKol(this.kols,this.firstKol,null,{mode:this.mode});return activeKol(this.kols,kol,blockNumber??null,{mode:this.mode});}
 async refreshStats(){await this.ready;this.ready=this.load();await this.ready;}
 view(who){if(!this.listReady||!this.data||!isAddress(who))return null;const a=getAddress(who),allowed=activeKol(this.kols,a,null,{mode:this.mode}),base=new URL(this.href);base.searchParams.delete('ref');base.searchParams.delete('legacyMarket');base.hash='market';return{promoter:this.data.kols.get(a)??{pointsRaw:'0',referees:0,refereeVolumeWei:'0'},link:allowed?referralLink(base.href,a):null,referred:this.data.referees.get(a)??null,toBlock:this.data.toBlock,catchingUp:this.data.catchingUp===true,rules:this.data.rules};}
}
