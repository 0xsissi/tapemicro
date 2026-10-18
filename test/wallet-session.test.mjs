import test from'node:test';import assert from'node:assert/strict';
import{walletSession}from'../src/wallet-session.mjs';
import{authorizedWalletAccounts}from'../src/wallet-connection.mjs';
import{LiveGateway}from'../src/live-gateway.mjs';
import{rewardSummary}from'../src/reward-summary.mjs';
const address='0x1111111111111111111111111111111111111111',other='0x2222222222222222222222222222222222222222',config={chainId:56,rpcUrls:[]};
const storage=()=>{const rows=new Map();return{getItem:k=>rows.get(k)??null,setItem:(k,v)=>rows.set(k,v)};};
test('wallet preference survives reload and discovery reordering; explicit disconnect persists',()=>{
 const s=storage(),a={id:'1',rdns:'io.a',name:'A',provider:{}},b={id:'2',rdns:'io.b',name:'B',provider:{}};
 walletSession(s,56).remember(b);const reloaded=walletSession(s,56),rows=[{...b,id:'1'},{...a,id:'2'}];assert.equal(reloaded.select(rows).rdns,'io.b');
 reloaded.disable();assert.equal(walletSession(s,56).select(rows),null);assert.equal(walletSession(s,56).select([b]),null);
});
test('ambiguous or unrelated wallet sessions are never silently substituted',()=>{
 const s=storage(),session=walletSession(s,56);assert.equal(session.select([{name:'A'},{name:'B'}]),null);session.remember({rdns:'io.saved',name:'Saved'});
 assert.equal(session.select([{rdns:'io.other',name:'Other'}]),null);assert.equal(session.select([{rdns:'io.saved'},{rdns:'io.saved'}]),null);assert.equal(walletSession(s,1).read(),null);
});
test('blocked storage retains the current-page preference without throwing',()=>{
 const session=walletSession({getItem(){throw Error('blocked');},setItem(){throw Error('blocked');}},56),row={rdns:'io.a',name:'A'};session.remember(row);assert.equal(session.select([row]).rdns,'io.a');session.disable();assert.equal(session.select([row]),null);
});
test('silent restoration uses only existing account permissions and the current chain',async()=>{
 const calls=[],wallet={request:async r=>{calls.push(r.method);if(r.method==='eth_accounts')return[address];if(r.method==='eth_chainId')return'0x38';throw Error('Unexpected wallet prompt');}};
 const g=new LiveGateway(config,{}, {wallet});assert.equal(await g.connect(0,{silent:true}),address);assert.equal(await g.signer.getAddress(),address);assert.ok(calls.every(m=>['eth_accounts','eth_chainId'].includes(m)));
});
test('locked wallets and wrong networks never request authorization or a network switch automatically',async()=>{
 for(const[accounts,chain]of[[[],'0x38'],[[address],'0x1']]){const calls=[],wallet={request:async r=>{calls.push(r.method);return r.method==='eth_accounts'?accounts:chain;}};const g=new LiveGateway(config,{}, {wallet});assert.equal(await g.connect(0,{silent:true}),null);assert.equal(g.address,null);assert.equal(g.signer,null);assert.ok(!calls.includes('eth_requestAccounts')&&!calls.includes('wallet_switchEthereumChain'));}
 assert.equal(await authorizedWalletAccounts(null,config),null);
});
test('a disconnected or superseded restoration cannot resurrect an old account',async()=>{
 let release;const gate=new Promise(r=>release=r),wallet={request:async r=>r.method==='eth_accounts'?(await gate,[address]):'0x38'},g=new LiveGateway(config,{}, {wallet});
 const restore=g.connect(0,{silent:true});g.disconnect();release();assert.equal(await restore,null);assert.equal(g.address,null);assert.equal(g.signer,null);
 let reads=0;wallet.request=async r=>r.method==='eth_accounts'?(++reads===1?[address]:[other]):'0x38';assert.equal(await g.connect(0,{silent:true}),null);assert.equal(g.address,null);
});
test('display rewards include upstream preview and zero-share historical rewards, with exact integers',()=>{
 const rows=[{balance:0n,funded:4n,pending:400n,fresh:true},{balance:2n,funded:3n,pending:355900n,fresh:true}];assert.deepEqual(rewardSummary(rows),{pending:356300n,funded:7n,fresh:true});
 assert.equal(rewardSummary([{balance:1n,funded:900719925474099300n,pending:900719925474099399n,fresh:true}]).pending,900719925474099399n);
});
test('failed or missing harvest previews fall back to funded rewards without pretending to be fresh',()=>{
 assert.deepEqual(rewardSummary([{balance:1n,funded:10n}]),{pending:10n,funded:10n,fresh:false});assert.deepEqual(rewardSummary([]),{pending:0n,funded:0n,fresh:true});
});
