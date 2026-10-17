import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {translateText,readLanguage,setLanguage,getLanguage,localizeTree,LANGUAGE_KEY} from '../src/i18n.mjs';

test('English covers static user pages and their accessibility/input labels',async()=>{
 const html=(await Promise.all(['index.html','deploy.html','fees.html'].map(name=>readFile(new URL('../src/'+name,import.meta.url),'utf8')))).join('\n');
 const labels=[...html.matchAll(/>([^<>\r\n]+)</g)].map(m=>m[1]).concat([...html.matchAll(/(?:placeholder|aria-label)="([^"]+)"/g)].map(m=>m[1]));
 for(const label of labels.filter(t=>/[\u3400-\u9fff]/.test(t)))assert.doesNotMatch(translateText(label,'en'),/[\u3400-\u9fff]/,label);
});
test('Dynamic English messages preserve financial quantities, identifiers and exact strings',()=>{
 const cases=[
  ['已选 2 台 · ≈ 0.123456 BEM','Selected 2 miners · ≈ 0.123456 BEM'],
  ['已选 1 台 · ≈ 0.123456 BEM','Selected 1 miner · ≈ 0.123456 BEM'],
  ['买入 1000000000000000001H','Buy 1000000000000000001H'],
  ['已扫描 80 / 85 单 · 仅按已加载范围匹配，旧单可能更便宜','Scanned 80 / 85 listings · Matching loaded listings only; older listings may be cheaper'],
  ['收益从成交那一刻开始算。已合并 3 张卖单，一笔交易。','Rewards start at purchase. Combined 3 listings in one transaction.'],
  ['第 1 / 2 笔 · 本批 16 台','Transaction 1 / 2 · 16 miners in this batch'],
  ['卖单 #$&','Listing #$&'],
  ['BNB 余额不足，请同时预留成交款和网络 Gas','Insufficient BNB. Keep enough for both payment and network gas.']
 ];
 for(const [source,expected]of cases){assert.equal(translateText(source,'en'),expected);assert.equal(translateText(source,'zh'),source);}
 for(const source of ['0.117160000000000001 BNB','0xfa1867bd071fb52b0f2ed73cee30f899093090be','<script>alert(1)</script>','Unknown provider error: 429'])assert.equal(translateText(source,'en'),source);
});
test('Language preference is allowlisted, persisted and safe with unavailable storage',()=>{
 let saved;const storage={getItem:()=>saved,setItem:(key,value)=>{assert.equal(key,LANGUAGE_KEY);saved=value;}};
 assert.equal(readLanguage(storage),'zh');setLanguage('en',{storage});assert.equal(getLanguage(),'en');assert.equal(readLanguage(storage),'en');
 saved='javascript:bad';assert.equal(readLanguage(storage),'zh');
 const blocked={getItem(){throw Error('blocked');},setItem(){throw Error('blocked');}};assert.equal(readLanguage(blocked),'zh');assert.doesNotThrow(()=>setLanguage('en',{storage:blocked}));assert.equal(getLanguage(),'en');setLanguage('zh',{storage});
});
test('Language round-trips preserve inputs and action data while accepting fresh status updates',()=>{
 const attributes=new Map([['placeholder','输入 H'],['data-label','数量'],['data-asset-id','123456789012345678901']]);
 const element={nodeType:1,value:'1000000000000000001',closest:()=>null,hasAttribute:k=>attributes.has(k),getAttribute:k=>attributes.get(k)??null,setAttribute:(k,v)=>attributes.set(k,v),querySelectorAll:()=>[]};
 const text={nodeValue:'等待确认',parentElement:element};element.ownerDocument={createTreeWalker:()=>{let delivered=false;return{nextNode:()=>delivered?null:(delivered=true,text)}}};
 setLanguage('en',{storage:null});localizeTree(element);assert.equal(text.nodeValue,'Pending');assert.equal(attributes.get('placeholder'),'Enter H');
 assert.equal(element.value,'1000000000000000001');assert.equal(attributes.get('data-asset-id'),'123456789012345678901');
 text.nodeValue='已取消';localizeTree(element);assert.equal(text.nodeValue,'Cancelled');
 setLanguage('zh',{storage:null});localizeTree(element);assert.equal(text.nodeValue,'已取消');assert.equal(attributes.get('placeholder'),'输入 H');assert.equal(attributes.get('data-label'),'数量');
});
