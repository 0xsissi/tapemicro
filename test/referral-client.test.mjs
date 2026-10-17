import test from 'node:test';import assert from 'node:assert/strict';
import {ReferralClient,referralList,referralSnapshot} from '../src/referral-client.mjs';
import {activeKol,readRef,taggedData} from '../src/referral.mjs';
import {referralMarkup,referralPoints} from '../src/referral-ui.mjs';
import {translateText} from '../src/i18n.mjs';
import {currentRoute} from '../src/simple-ui.mjs';
const K='0x1111111111111111111111111111111111111111',U='0x2222222222222222222222222222222222222222',V='0x3333333333333333333333333333333333333333',M='0x4444444444444444444444444444444444444444';
const config={chainId:56,vault:V,market:M,deploymentBlock:10};
const snapshot=()=>({version:1,chainId:56,vault:V,markets:[M],deploymentBlock:10,toBlock:20,toBlockHash:'0x'+'ab'.repeat(32),referralMode:'open',rules:{kolShareBps:1000,refereeBonusBps:0,requireFirstInteraction:true,validityDays:0},pointsPerBnb:1000,kols:[],referees:[]});
const store=()=>{const m=new Map();return{getItem:k=>m.get(k),setItem:(k,v)=>m.set(k,v)};};
function client({href=`https://site.example/sub/index.html?ref=${K}#market`,list={mode:'open',kols:[]},data=snapshot(),storage=store(),missing=null}={}){return new ReferralClient({config,href,storage,fetcher:async url=>({ok:!url.endsWith(missing??'impossible'),json:async()=>url.endsWith('kol-list.json')?list:data})});}
test('open referrals accept any nonzero wallet and every connected wallet receives its own portable link',async()=>{
 const c=client();await c.ready;assert.equal(c.current(20),K);assert.equal(c.view(U).promoter.pointsRaw,'0');const link=new URL(c.view(U).link);assert.equal(link.origin,'https://site.example');assert.equal(link.pathname,'/sub/index.html');assert.equal(link.searchParams.get('ref'),U);assert.equal(link.hash,'#market');assert.equal(activeKol([],K,null,{mode:'open'}),K);assert.equal(activeKol([],'0x'+'00'.repeat(20),null,{mode:'open'}),null);
 assert.equal(readRef(taggedData('0x12345678',{kol:c.current(20),from:U})),K);assert.equal(taggedData('0x12345678',{kol:K,from:K}),'0x12345678');
});
test('first-touch survives reload and wallet changes; unavailable storage still works for the current visit',async()=>{
 const storage=store(),a=client({storage});await a.ready;const b=client({storage,href:`https://site.example/?ref=${U}`});await b.ready;assert.equal(b.current(20),K);assert.equal(new URL(b.view(U).link).searchParams.get('ref'),U);
 const blocked={getItem(){throw Error('blocked');},setItem(){throw Error('blocked');}},c=client({storage:blocked});await c.ready;assert.equal(c.current(20),K);c.remember(`https://site.example/?ref=${U}`);assert.equal(c.current(20),K);
});
test('legacy allowlists, end cutoffs and start blocks retain their eligibility rules',async()=>{
 const c=client({list:[{address:K,endBlock:20}]});await c.ready;assert.equal(c.current(20),null);assert.equal(c.view(K),null);
 assert.equal(activeKol([{address:K,endBlock:20}],K,20,{mode:'open'}),K);assert.equal(activeKol([{address:K,endBlock:20}],K,21,{mode:'open'}),null);
 const future=client({list:{mode:'open',kols:[{address:K,startBlock:30}]}});await future.ready;assert.equal(future.current(29),null);assert.equal(future.current(30),K);
});
test('missing or malformed snapshots hide promotion data without preventing referral capture or core transactions',async()=>{
 for(const missing of ['kol-list.json','kol-points.json']){const c=client({missing});await assert.doesNotReject(c.ready);assert.equal(c.view(U),null);assert.equal(c.current(20),missing==='kol-list.json'?null:K);}
 const c=client({data:{...snapshot(),chainId:1}});await c.ready;assert.equal(c.view(U),null);assert.equal(c.current(20),K);
 assert.throws(()=>referralList({mode:'open',kols:[{address:K},{address:K}]}));assert.throws(()=>referralSnapshot({...snapshot(),vault:K},config,'open'));
});
test('snapshot identity and point accounting are validated; historical referrers and bonuses render separately',async()=>{
 const raw=snapshot();raw.rules.refereeBonusBps=500;raw.kols=[{address:K,pointsRaw:'200000000000000000000',referees:1,refereeVolumeWei:'2000000000000000000'}];raw.referees=[{address:U,kol:K,bindBlock:15,bindTx:'0x'+'cd'.repeat(32),volumeWei:'2000000000000000000',bonusRaw:'100000000000000000000'}];const c=client({data:raw});await c.ready;assert.equal(c.view(K).promoter.pointsRaw,raw.kols[0].pointsRaw);assert.equal(c.view(U).referred.kol,K);assert.match(referralMarkup(c.view(U)),/我的受邀奖励/);assert.match(referralMarkup(c.view(U)),/统计截止区块/);assert.equal(referralPoints(1n),'<0.00000001');assert.throws(()=>referralSnapshot({...raw,kols:[{...raw.kols[0],pointsRaw:'1'}]},config,'open'));
 for(const node of [...referralMarkup(c.view(U)).matchAll(/>([^<>]+)</g)].map(m=>m[1]).filter(s=>/[\u4e00-\u9fff]/.test(s)))assert.doesNotMatch(translateText(node,'en'),/[\u4e00-\u9fff]/,node);
});
test('hash referral links preserve the four routes rather than falling back to split',()=>{
 const original=globalThis.location;try{for(const route of ['deposit','market','rewards','points']){globalThis.location={hash:`#${route}?ref=${K}`};assert.equal(currentRoute(),route);}}finally{if(original===undefined)delete globalThis.location;else globalThis.location=original;}
});
test('browser fetch receives the global receiver while loading relative referral resources',async()=>{
 let calls=0;const c=new ReferralClient({config,href:'https://site.example/prefix/index.html',fetcher:async function(url){assert.equal(this,globalThis);calls++;return{ok:true,json:async()=>url.endsWith('kol-list.json')?{mode:'open',kols:[]}:snapshot()};}});await c.ready;assert.equal(calls,2);assert.ok(c.view(U)?.link);
});
