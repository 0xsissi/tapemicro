import test from'node:test';import assert from'node:assert/strict';import{lazyWalletUI}from'../src/wallet-ui-loader.mjs';
test('wallet UI loading does not open permissions; user actions wait for the mounted component',async()=>{
 let finish;const ready=new Promise(resolve=>finish=resolve),calls=[],sdk={ready,subscribe(fn){fn({status:'disconnected'});},open:mode=>calls.push(mode),restore:()=>calls.push('silent-restore'),setLanguage:lang=>calls.push(lang)};
 const ui=lazyWalletUI(async()=>({createRainbowWalletUI:()=>sdk}),{}),pending=ui.open('connect');await Promise.resolve();await Promise.resolve();assert.deepEqual(calls,[]);finish();await pending;assert.deepEqual(calls,['connect']);await ui.restore();ui.setLanguage('en');assert.deepEqual(calls,['connect','silent-restore','en']);
});
test('a failed wallet UI download can be retried without retaining a broken component',async()=>{
 let tries=0,destroyed=0;const ui=lazyWalletUI(async()=>{if(++tries===1)return{createRainbowWalletUI:()=>({ready:Promise.reject(Error('load failed')),subscribe(){},destroy(){destroyed++;}})};return{createRainbowWalletUI:()=>({ready:Promise.resolve(),subscribe(fn){fn({status:'disconnected'});},open:()=>42})};},{});
 await assert.rejects(ui.open('connect'),/load failed/);assert.equal(ui.getState().status,'unavailable');assert.equal(destroyed,1);assert.equal(await ui.open('connect'),42);assert.equal(tries,2);
});
