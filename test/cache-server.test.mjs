// End-to-end: real vault + market V2 on a local chain. The cache (server +
// browser client) must return exactly what a direct LiveGateway chain read
// returns at the same block, follow changes, and fall back when unavailable.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {JsonRpcProvider} from 'ethers';
import {startAnvil, mockSystem, deploy, tx} from '../scripts/chain-helpers.mjs';
import {LiveGateway} from '../src/live-gateway.mjs';
import {createCache, createServer} from '../server/cache-server.mjs';
import {CacheClient, useCache} from '../src/cache-client.mjs';

const protocol = JSON.parse(fs.readFileSync(new URL('../src/generated-protocol.json', import.meta.url), 'utf8'));
const sortById = rows => [...rows].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
const strip = o => JSON.parse(JSON.stringify(o, (k, v) => (typeof v === 'bigint' ? 'n' + v : v)));
let node, sys, market, config, cache, server, base, ref, A, B, C;

async function gatewayAs(who, provider) {
  const g = new LiveGateway(config, protocol, {provider: provider ?? new JsonRpcProvider(node.url, 31337, {staticNetwork: true, cacheTimeout: -1}), hostname: '127.0.0.1', wallet: null});
  await g.init(); g.address = who; return g;
}
async function direct(who) { // the reference: what the site reads today, straight from the chain
  const g = await gatewayAs(who);
  return g.read({reward: false, simulateBids: false, orderLimit: 1000});
}
async function viaCache(who, opts = {}) {
  const g = await gatewayAs(who), client = new CacheClient({config, baseUrl: base, ...opts}), handle = useCache(g, client);
  const data = await g.read({reward: false, simulateBids: false, orderLimit: 1000});
  return {data, state: handle.state(), g};
}
function assertSame(cached, chain, label) {
  assert.equal(cached.block, chain.block, label + ' block');
  for (const k of ['chainTime', 'ready', 'paused', 'dailyPer100']) assert.deepEqual(cached[k], chain[k], label + ' ' + k);
  // The chain path fills originalAmount asynchronously (only for the viewer's own listings, after a
  // background event query); the cache always has it from its event index. Compare the rest exactly.
  const noOriginal = rows => sortById(rows).map(({originalAmount, ...o}) => o);
  assert.deepEqual(strip(noOriginal(cached.orders)), strip(noOriginal(chain.orders)), label + ' orders');
  if (cached.cached) for (const o of cached.orders) assert.equal(typeof o.originalAmount, 'bigint', label + ' originalAmount present');
  assert.deepEqual(strip(sortById(cached.bids)), strip(sortById(chain.bids)), label + ' bids');
  assert.deepEqual(strip(sortById(cached.assets)), strip(sortById(chain.assets)), label + ' assets');
  assert.deepEqual(strip(cached.account), strip(chain.account), label + ' account');
  assert.equal(cached.ordersTotal, chain.ordersTotal); assert.equal(cached.bidsTotal, chain.bidsTotal);
}

test.before(async () => {
  node = await startAnvil(); const p = node.provider;
  sys = await mockSystem(p); market = await deploy('TapeMicroMarketV2', sys.signers[0], [sys.vault.target, sys.addresses[4]]);
  [A, B, C] = sys.addresses;
  config = {version: 'test', protocolVersion: 2, marketVersion: 4, chainId: 31337, network: 'local', rpcUrls: [node.url], explorer: null,
    mining: sys.mining.target, bem: sys.bem.target, tapeout: sys.nft.target, behemoth: sys.giant.target, lens: null,
    vault: sys.vault.target, market: market.target, deploymentBlock: 1, feeRecipient: A, feeManager: A, local: true};
  const [a, b, c] = sys.signers, nft = sys.nft, v = sys.vault;
  for (const [owner, id, h] of [[a, 1, 100], [b, 2, 60], [a, 3, 80]]) { await sys.mintMiner(owner, id, h); await tx(v.connect(owner).deposit(nft.target, id, h, {gasLimit: 12_000_000})); }
  for (const s of [a, b, c]) await tx(v.connect(s).setApprovalForAll(market.target, true));
  const id = n => v.assetId(nft.target, n), t = (await p.getBlock('latest')).timestamp, end = t + 7 * 86400;
  const [x1, x2, x3] = await Promise.all([id(1), id(2), id(3)]);
  await tx(market.connect(a).createListing(x1, 50, 10n ** 15n, end));      // 1: partly bought below
  await tx(market.connect(b).createListing(x2, 30, 12n * 10n ** 14n, end)); // 2: cancelled below
  await tx(market.connect(a).createListing(x3, 20, 9n * 10n ** 14n, end));  // 3: stays open
  const [, , total] = await market.quotePayment(10, 10n ** 15n);
  await tx(market.connect(c).buyBatch([[1, 10, 10n ** 15n]], total, end, {value: total, gasLimit: 5_000_000}));
  await tx(market.connect(b).cancelListing(2));
  const ids = [x1, x2].sort((p, q) => (p < q ? -1 : 1));
  await tx(market.connect(c).createBid(ids, 20, 8n * 10n ** 14n, end, {value: 20n * 8n * 10n ** 14n}));  // bid 1: partly sold into
  await tx(market.connect(c).createBid([x3], 5, 7n * 10n ** 14n, end, {value: 5n * 7n * 10n ** 14n}));    // bid 2: cancelled -> C's closed bid
  await tx(market.connect(b).sellBatch([[1, x2, 4, 8n * 10n ** 14n]], 0, end, {gasLimit: 5_000_000}));
  await tx(market.connect(c).cancelBid(2));
  cache = await createCache({config, protocol, refreshMs: 300, staleMs: 1500, accountTtlMs: 0, log: () => {}});
  await cache.tick(); cache.start();
  server = createServer(cache, {accountRate: 6, accountWindowMs: 60000});
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}/api`;
});
test.after(async () => { cache?.stop(); server?.close(); await node?.stop(); });

test('cached read equals a direct chain read for buyer, seller, bidder and a wallet with nothing', async () => {
  for (const who of [A, B, C, '0x000000000000000000000000000000000000dEaD']) {
    const {data, state} = await viaCache(who), chain = await direct(who);
    assert.equal(state.source, 'cache', 'served from cache'); assert.equal(data.cached, true);
    assertSame(data, chain, who.slice(0, 8));
  }
  const {data} = await viaCache(C);
  assert.ok(data.bids.some(b => b.id === 2n && b.remaining === 0n && b.refundedWei > 0n), "C's cancelled bid stays in 我的买单 with its refund");
  assert.equal(data.orders.find(o => o.id === 1n).originalAmount, 50n, 'original listing amount comes from the event index');
  assert.ok(!data.orders.some(o => o.id === 2n), 'cancelled listing is not in the book');
  assert.equal(data.orderWindowIds.length, 3, 'window covers every id so closed rows get removed in mergeRead');
});

test('book page and stats via cache match chain', async () => {
  const g = await gatewayAs(A), chainBook = await g.readBook({orderLimit: 1000}), chainStats = await g.stats();
  const h = await gatewayAs(A); useCache(h, new CacheClient({config, baseUrl: base}));
  const book = await h.readBook({orderLimit: 80});
  const noOriginal = rows => sortById(rows).map(({originalAmount, ...o}) => o);
  assert.deepEqual(strip(noOriginal(book.orders)), strip(noOriginal(chainBook.orders)));
  assert.deepEqual(strip(sortById(book.bids)), strip(sortById(chainBook.bids)));
  assert.deepEqual(strip(await h.stats()), strip(chainStats));
});

test('cache follows chain changes within a refresh: fills close rows, new rows appear', async () => {
  const v = sys.vault, end = (await node.provider.getBlock('latest')).timestamp + 86400, x3 = await v.assetId(sys.nft.target, 3);
  const [, , total] = await market.quotePayment(20, 9n * 10n ** 14n);
  await tx(market.connect(sys.signers[1]).buyBatch([[3, 20, 9n * 10n ** 14n]], total, end, {value: total, gasLimit: 5_000_000})); // closes listing 3
  await tx(market.connect(sys.signers[0]).createListing(x3, 5, 2n * 10n ** 15n, end)); // listing 4
  const target = await node.provider.getBlockNumber();
  for (let i = 0; i < 50 && (cache.health().block ?? 0) < target; i++) await new Promise(r => setTimeout(r, 100));
  const chain = await direct(B), {data} = await viaCache(B);
  assertSame(data, chain, 'after changes');
  assert.ok(!data.orders.some(o => o.id === 3n) && data.orders.some(o => o.id === 4n));
  cache.stop();
});

test('stale or foreign cache falls back to the chain transparently', async () => {
  const other = await viaCache(A, {config: {...config, market: '0x0000000000000000000000000000000000000001'}});
  assert.equal(other.state.source, 'chain'); assert.match(other.state.error, /other contracts/);
  await new Promise(r => setTimeout(r, 1700)); // staleMs passed, loop stopped
  assert.equal((await fetch(base + '/snapshot')).status, 503);
  const chain = await direct(C), {data, state} = await viaCache(C);
  assert.equal(state.source, 'chain'); assert.equal(data.cached, undefined);
  assertSame(data, chain, 'fallback');
  const down = await viaCache(C, {baseUrl: 'http://127.0.0.1:9/api'}); // nothing listening
  assert.equal(down.state.source, 'chain');
});

test('fresh paths never use the cache', async () => {
  let calls = 0; const g = await gatewayAs(C), fake = {snapshot: async () => { calls++; throw Error('x'); }, account: async () => { calls++; throw Error('x'); }};
  useCache(g, fake);
  await g.read({reward: true, simulateBids: false});
  await g.read({reward: false, assetIds: [], simulateBids: false});
  assert.equal(calls, 0);
});

test('HTTP surface: health, bad paths, address validation, rate limit', async () => {
  await cache.tick();
  const health = await (await fetch(base + '/health')).json(); assert.equal(health.ok, true); assert.equal(health.openAsks, 2);
  assert.equal((await fetch(base + '/nope')).status, 404);
  assert.equal((await fetch(base + '/account/0x123')).status, 404);
  assert.equal((await fetch(base + '/snapshot', {method: 'POST'})).status, 405);
  const codes = []; for (let i = 0; i < 8; i++) codes.push((await fetch(base + '/account/' + C)).status);
  assert.ok(codes.includes(429), 'per-IP account rate limit');
  const snap = await (await fetch(base + '/snapshot')).json(); assert.ok(snap.servedAt >= snap.updatedAt);
  assert.ok(!JSON.stringify(snap).includes('rpcUrls'), 'no server RPC config leaks');
});

test('slow account reads remain deduplicated beyond the TTL until completion',async()=>{
 const isolated=await createCache({config,protocol,accountTtlMs:1,log:()=>{}});
 try{await isolated.tick();const first=isolated.account(A);await new Promise(r=>setTimeout(r,10));const second=isolated.account(A);assert.equal(first,second);await first;}finally{isolated.stop();isolated.provider.destroy();}
});
test('a reverted chain rebuilds closed-order state instead of retaining a disappeared cancellation',async()=>{
 cache.stop();const isolated=await createCache({config,protocol,log:()=>{}});const checkpoint=await node.provider.send('evm_snapshot',[]);
 try{await isolated.tick();assert.ok(JSON.parse(isolated.snapshotJson()).orders.some(o=>o.id.$big==='1'));await tx(market.connect(sys.signers[0]).cancelListing(1));await isolated.tick();assert.ok(!JSON.parse(isolated.snapshotJson()).orders.some(o=>o.id.$big==='1'));assert.equal(await node.provider.send('evm_revert',[checkpoint]),true);await isolated.tick();assert.ok(JSON.parse(isolated.snapshotJson()).orders.some(o=>o.id.$big==='1'));}finally{isolated.stop();isolated.provider.destroy();}
});
test('HTTP upstream failures expose neither a private RPC URL nor its token',async()=>{
 const fake={health:()=>({ok:true}),snapshotJson:()=>'{"version":1}',account:()=>{throw Error('https://rpc.invalid/private-token');}},s=createServer(fake);
 try{await new Promise(r=>s.listen(0,'127.0.0.1',r));const response=await fetch('http://127.0.0.1:'+s.address().port+'/api/account/'+A);assert.equal(response.status,502);const text=await response.text();assert.doesNotMatch(text,/rpc\.invalid|private-token/);}finally{s.close();}
});

test('indexed cancelled bids remain readable when historical RPC log queries fail',async()=>{
 const isolated=await createCache({config,protocol,accountTtlMs:0,log:()=>{}});
 try{
  await isolated.tick();
  let queries=0;isolated.provider.getLogs=async()=>{queries++;throw Error('historical RPC temporarily unavailable');};
  const data=JSON.parse(await isolated.account(C),(key,value)=>value&&typeof value==='object'&&'$big'in value?BigInt(value.$big):value);
  const closed=data.closedBids.find(b=>b.id===2n);
  assert.ok(closed,'cancelled bid remains in the account');
  assert.equal(closed.refundedWei,5n*7n*10n**14n);
  assert.equal(closed.filledAmount,0n);
  assert.equal(queries,0,'account reads do not scan already indexed refund events again');
 }finally{isolated.stop();isolated.provider.destroy();}
});

test('fully filled bids use an indexed zero refund without scanning history',async()=>{
 const isolated=await createCache({config,protocol,accountTtlMs:0,log:()=>{}});
 const end=(await node.provider.getBlock('latest')).timestamp+86400,price=10n**14n;
 await tx(market.connect(sys.signers[2]).createBid([],1,price,end,{value:price}));
 const bidId=(await market.nextBidId())-1n,assetId=await sys.vault.assetId(sys.nft.target,2);
 await tx(market.connect(sys.signers[1]).sellBatch([[bidId,assetId,1,price]],0,end,{gasLimit:5_000_000}));
 try{
  await isolated.tick();let queries=0;
  isolated.provider.getLogs=async()=>{queries++;throw Error('historical RPC temporarily unavailable');};
  const data=JSON.parse(await isolated.account(C),(key,value)=>value&&typeof value==='object'&&'$big'in value?BigInt(value.$big):value);
  const closed=data.closedBids.find(b=>b.id===bidId);
  assert.equal(closed.refundedWei,0n);assert.equal(closed.filledAmount,1n);
  assert.equal(queries,0);
 }finally{isolated.stop();isolated.provider.destroy();}
});

test('a chain rollback discards indexed refunds before rebuilding the same bid',async()=>{
 cache.stop();const isolated=await createCache({config,protocol,accountTtlMs:0,log:()=>{}});
 const bidder=market.connect(sys.signers[2]),end=(await node.provider.getBlock('latest')).timestamp+86400,price=10n**14n;
 await tx(bidder.createBid([],2,price,end,{value:2n*price}));
 const bidId=(await market.nextBidId())-1n,checkpoint=await node.provider.send('evm_snapshot',[]);
 try{
  await isolated.tick();await tx(bidder.cancelBid(bidId));await isolated.tick();
  const decode=text=>JSON.parse(text,(key,value)=>value&&typeof value==='object'&&'$big'in value?BigInt(value.$big):value);
  assert.equal(decode(await isolated.account(C)).closedBids.find(b=>b.id===bidId).refundedWei,2n*price);
  assert.equal(await node.provider.send('evm_revert',[checkpoint]),true);await isolated.tick();
  const assetId=await sys.vault.assetId(sys.nft.target,2);
  await tx(market.connect(sys.signers[1]).sellBatch([[bidId,assetId,1,price]],0,end,{gasLimit:5_000_000}));
  await tx(bidder.cancelBid(bidId));await isolated.tick();
  const rebuilt=decode(await isolated.account(C)).closedBids.find(b=>b.id===bidId);
  assert.equal(rebuilt.refundedWei,price,'refund follows the replacement chain');
  assert.equal(rebuilt.filledAmount,1n);
 }finally{isolated.stop();isolated.provider.destroy();}
});
