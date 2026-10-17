import test from 'node:test';
import assert from 'node:assert/strict';
import {minerChoicesMarkup,initialReadPanel,loadingState} from '../src/loading-ui.mjs';
import {translateText} from '../src/i18n.mjs';
test('discovery cannot report an empty wallet before a complete successful read',()=>{
 for(const state of ['idle','loading','error','partial']){
  const html=minerChoicesMarkup([],{state,progress:'已找到 0 台原矿机…'});
  assert.doesNotMatch(html,/钱包里没有可拆分的矿机/);
  if(state==='loading'){assert.match(html,/read-spinner/);assert.match(html,/正在读取钱包原矿机/);assert.match(html,/aria-busy="true"/);}
 }
 assert.match(minerChoicesMarkup([],{state:'complete'}),/钱包里没有可拆分的矿机/);
});
test('partial discovery and failed refresh retain known miners and offer recovery',()=>{
 const miners=[{sourceKey:'tapeout',source:'TapeOut',id:5438n,hashrate:149n,eligible:true}];
 for(const state of ['loading','error','partial']){const html=minerChoicesMarkup(miners,{state});assert.match(html,/149H/);assert.match(html,/5438/);assert.doesNotMatch(html,/钱包里没有/);if(state!=='loading')assert.match(html,/data-retry-miners/);}
});
test('initial account data stays unknown during reads and failures; known data survives refresh',()=>{
 const s={ready:true,contractsConfigured:true,dataLoaded:false,reading:true,readError:false};
 assert.match(initialReadPanel(s,'正在读取交易积分…'),/read-spinner/);
 assert.match(initialReadPanel({...s,readError:true,reading:false},'积分'),/data-retry-read/);
 assert.doesNotMatch(initialReadPanel({...s,readError:true},'积分'),/read-spinner|<h2>钱包里没有|0 BEM/);
 assert.equal(initialReadPanel({...s,dataLoaded:true},'积分'),null);
 assert.equal(initialReadPanel({...s,dataLoaded:true,readError:true},'积分'),null);
});
test('loading copy is translated and progress text remains untrusted content',()=>{
 assert.equal(translateText('正在读取，已找到 12 台原矿机…','en'),'Loading; found 12 original miners so far…');
 assert.equal(translateText('正在读取持仓和 BEM 收益…','en'),'Loading holdings and BEM rewards…');
 assert.doesNotMatch(loadingState('<script>x</script>'),/<script>/);
});
