#!/usr/bin/env node
// TapeMicro read cache.
//
// Reads the chain on the server every few seconds with the SAME LiveGateway
// code the website uses, and serves the result as small JSON files:
//   GET /api/snapshot              order book, bids, 24h stats, mining params
//   GET /api/account/<address>     one wallet's positions, balances, points
//   GET /api/health                last update, block, errors
// Everything here is display data. The website still checks the specific
// listings/bids on chain right before a user signs, and the contracts enforce
// prices, amounts and balances. A wrong or stale cache cannot move funds.
//
//   node server/cache-server.mjs server/cache-server.json
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {JsonRpcProvider, FetchRequest, getAddress, isAddress, id as topicId} from 'ethers';
import {LiveGateway} from '../src/live-gateway.mjs';
import {PooledReadProvider} from '../src/rpc-pool.mjs';
import{pointsMarkets}from'../src/points-markets.mjs';
import {batchRead} from '../src/chain-reader.mjs';

export const CACHE_VERSION = 1;
const identity=c=>({chainId:c.chainId,vault:c.vault,market:c.market,mining:c.mining,bem:c.bem,tapeout:c.tapeout,behemoth:c.behemoth,pointsMarkets:pointsMarkets(c).map(m=>m.address.toLowerCase())});
const same = (a, b) => String(a ?? '').toLowerCase() === String(b ?? '').toLowerCase();

// BigInt-safe JSON: bigints become {"$big":"123"}; the client revives them.
export const encode = value => JSON.stringify(value, (k, v) => (typeof v === 'bigint' ? {$big: v.toString()} : v));

function makeProvider(cfg) {
  if (cfg.provider) return cfg.provider;
  if (cfg.config.local) {
    const req = new FetchRequest(cfg.rpcUrls[0]); req.timeout = 5000;
    return new JsonRpcProvider(req, cfg.config.chainId, {staticNetwork: true, cacheTimeout: -1, batchMaxCount: 20});
  }
  return new PooledReadProvider(cfg.rpcUrls, cfg.config.chainId, {timeoutMs: cfg.rpcTimeoutMs ?? 5000, hedgeMs: cfg.rpcHedgeMs ?? 2000});
}

/**
 * The cache itself (no HTTP). Options:
 *  config      the website's config.json (addresses, chainId, deploymentBlock, marketVersion, feeManager)
 *  protocol    the website's generated-protocol.json (ABIs + runtime hashes)
 *  rpcUrls     server-side RPC list (may include a paid key; never sent to browsers)
 */
export async function createCache({config, protocol, rpcUrls = config.rpcUrls, provider = null, referralPointsPath=null, refreshMs = 3000, staleMs = 30000,
  accountTtlMs = 4000, maxAccounts = 5000, logChunk = 5000, rpcTimeoutMs, rpcHedgeMs, log = (...a) => console.log(new Date().toISOString(), ...a)} = {}) {
  let p = makeProvider({config, rpcUrls, provider, rpcTimeoutMs, rpcHedgeMs});
  const hostname = config.local ? '127.0.0.1' : 'cache-server';
  const main = new LiveGateway(config, protocol, {provider: p, hostname, wallet: null});
  await main.init();p=main.provider;
  if (!main.ready) throw Error('Contracts not configured or not verified; refusing to serve a cache');
  const scoped = address => { // a gateway that reads as `address`, sharing the verified contracts
    const g = new LiveGateway(config, protocol, {provider: p, hostname, wallet: null});
    for (const k of ['mining', 'bem', 'vault', 'market', 'legacyMarkets', 'ready']) g[k] = main[k];
    g.originalAmounts = main.originalAmounts; g.bidMetadata = main.bidMetadata; g.address = address; return g;
  };

  // ---- event index: Listed / BidCreated metadata, never re-queried ----
  const iface = main.market.interface, T = {
    Listed: iface.getEvent('Listed').topicHash,
    ...(main.hasBids ? {BidCreated: iface.getEvent('BidCreated').topicHash} : {}),
  };
  const bidsByBidder = new Map(); let indexedTo = (config.deploymentBlock ?? 0) - 1; let chunk = logChunk;
  async function syncEvents(to) {
    while (indexedTo < to) {
      const from = indexedTo + 1, end = Math.min(to, from + chunk - 1);
      let logs;
      try { logs = await p.getLogs({address: config.market, fromBlock: from, toBlock: end, topics: [Object.values(T)]}); }
      catch (e) { if (chunk > 100) { chunk = Math.max(100, Math.floor(chunk / 2)); continue; } throw e; }
      for (const l of logs) {
        const e = iface.parseLog(l);
        if (e.name === 'Listed') main.originalAmounts.set(String(e.args.id), e.args.amount);
        else if (e.name === 'BidCreated') {
          main.bidMetadata.set(String(e.args.bidId), {assetIds: [...e.args.assetIds], originalAmount: e.args.amount});
          const k = e.args.bidder.toLowerCase(); if (!bidsByBidder.has(k)) bidsByBidder.set(k, []); bidsByBidder.get(k).push(e.args.bidId);
        }
      }
      indexedTo = end;
    }
  }

  // ---- order book: a listing/bid whose remaining hits 0 never reopens ----
  const open = {asks: new Set(), bids: new Set()}, nextSeen = {asks: 1n, bids: 1n};
  async function inChunks(ids, fn, size = 200) { const out = []; for (let i = 0; i < ids.length; i += size) out.push(await fn(ids.slice(i, i + size))); return out; }

  let snapshot = null, serialized = null, lastOkAt = 0, lastError = null, errors = 0, ticks = 0, timer = null, stopped = false, snapshotHash=null;
  async function tick() {
    const base = await main.read({book: false, account: false, reward: false, simulateBids: false});
    const block = base.block, now = base.chainTime;
    if(snapshotHash&&snapshot){const previous=await p.getBlock(snapshot.block);if(!previous||previous.hash!==snapshotHash||block<snapshot.block){
      indexedTo=(config.deploymentBlock??0)-1;main.originalAmounts.clear();main.bidMetadata.clear();bidsByBidder.clear();closedBids.clear();accounts.clear();open.asks.clear();open.bids.clear();nextSeen.asks=1n;nextSeen.bids=1n;
      snapshot=null;serialized=null;snapshotHash=null;
    }}
    const [nextAsk, nextBid] = await batchRead(p, [{contract: main.market, method: 'nextListingId'}, ...(main.hasBids ? [{contract: main.market, method: 'nextBidId'}] : [])], {blockTag: block});
    await syncEvents(block);
    const askIds = [...[...open.asks].map(BigInt)]; for (let id = nextSeen.asks; id < nextAsk; id++) askIds.push(id);
    const asks = (await inChunks(askIds, ids => main.readOrders(ids.length, block, now, {next: nextAsk, ids}))).flatMap(r => r.orders);
    open.asks = new Set(asks.map(o => String(o.id))); nextSeen.asks = nextAsk;
    let bids = [];
    if (main.hasBids) {
      const bidIds = [...[...open.bids].map(BigInt)]; for (let id = nextSeen.bids; id < nextBid; id++) bidIds.push(id);
      bids = (await inChunks(bidIds, ids => main.readBids(ids.length, block, now, [], {next: nextBid, ids, simulate: false}))).flatMap(r => r.bids);
      open.bids = new Set(bids.filter(b => b.remaining > 0n).map(b => String(b.id))); nextSeen.bids = nextBid;
    }
    let stats = snapshot?.stats ?? null; try { stats = await main.stats(); } catch (e) { log('stats failed:', e.message); }
    const blockHash=(await p.getBlock(block))?.hash;if(!blockHash)throw Error('snapshot block unavailable');
    snapshot = {version: CACHE_VERSION, ...identity(config), block, chainTime: now, updatedAt: Date.now(),
      ready: base.ready, paused: base.paused, dailyPer100: base.dailyPer100, bidsSupported: main.hasBids,
      ordersTotal: nextAsk - 1n, bidsTotal: main.hasBids ? nextBid - 1n : 0n, bidMetadataComplete: true, orders: asks, bids, stats};
    snapshotHash=blockHash;serialized = encode(snapshot); lastOkAt = snapshot.updatedAt; lastError = null; ticks++;
  }
  async function loop() {
    if (stopped) return;
    const started = Date.now();
    try { await tick(); } catch (e) { errors++; lastError = e.message ?? String(e); log('refresh failed:', lastError); }
    if (!stopped) timer = setTimeout(loop, Math.max(250, refreshMs - (Date.now() - started)));
  }

  // ---- per-account reads, short TTL, deduplicated ----
  let activeAccounts=0;
  const accounts = new Map(), closedBids = new Map(); // closed bid rows never change again
  async function readAccount(address) {
    const g = scoped(address);
    const data = await g.read({book: false, reward: false, account: true, simulateBids: false});
    let myBids = [];
    if (main.hasBids) {
      const ids = bidsByBidder.get(address.toLowerCase()) ?? [];
      const known = ids.filter(id => closedBids.has(String(id))).map(id => closedBids.get(String(id)));
      const rest = ids.filter(id => !closedBids.has(String(id)) && !open.bids.has(String(id)));
      if (rest.length) {
        const nextBid = (snapshot?.bidsTotal ?? 0n) + 1n;
        const rows = (await inChunks(rest, chunkIds => g.readBids(chunkIds.length, data.block, data.chainTime, [], {next: nextBid, ids: chunkIds, simulate: false}))).flatMap(r => r.bids);
        for (const b of rows) if (b.remaining === 0n) closedBids.set(String(b.id), b);
        myBids = [...known, ...rows];
      } else myBids = known;
    }
    if (data.account) data.account.bidEscrow = (snapshot?.bids ?? []).filter(b => same(b.bidder, address)).reduce((n, b) => n + b.remaining * b.priceWei, 0n);
    return encode({version: CACHE_VERSION, ...identity(config), address, block: data.block, chainTime: data.chainTime,
      updatedAt: Date.now(), assets: data.assets, assetsComplete: data.assetsComplete, account: data.account, rewardFresh: data.rewardFresh, closedBids: myBids});
  }
  function account(address) {
    const now = Date.now(), hit = accounts.get(address);
    if (hit && (hit.pending||now-hit.at<accountTtlMs))return hit.value;
    if(activeAccounts>=8)return Promise.reject(Error('account capacity'));
    activeAccounts++;let entry;const value=readAccount(address).finally(()=>{activeAccounts--;if(entry){entry.pending=false;entry.at=Date.now();}});
    entry={at:now,value,pending:true};accounts.delete(address);accounts.set(address,entry);
    value.catch(() => { if (accounts.get(address)?.value === value) accounts.delete(address); });
    while (accounts.size > maxAccounts) accounts.delete(accounts.keys().next().value);
    return value;
  }

  return {
    provider: p, gateway: main,
    start() { stopped = false; return loop(); },
    stop() { stopped = true; clearTimeout(timer); },
    tick,
    snapshotJson() { if (!serialized || Date.now() - lastOkAt > staleMs) return null; return serialized; },
    account,
    referralJson(){if(!referralPointsPath)return null;try{const text=fs.readFileSync(referralPointsPath,'utf8');if(text.length>8_000_000)return null;const data=JSON.parse(text);if(data.chainId!==config.chainId||!same(data.vault,config.vault)||!pointsMarkets(config).every(m=>data.markets?.some(a=>same(a,m.address))))return null;return text;}catch{return null;}},
    health() { return {ok: Boolean(serialized) && Date.now() - lastOkAt <= staleMs, block: snapshot?.block ?? null, ageMs: lastOkAt ? Date.now() - lastOkAt : null, ticks, errors, lastError:lastError?'upstream unavailable':null, indexedTo, openAsks: open.asks.size, openBids: open.bids.size, accountsCached: accounts.size}; },
  };
}

/** Plain node:http front. Run behind nginx: location /api/ { proxy_pass http://127.0.0.1:8787; } */
export function createServer(cache, {accountRate = 20, accountWindowMs = 10000} = {}) {
  const hits = new Map();
  const limited = ip => { const now = Date.now(), h = hits.get(ip) ?? {start: now, n: 0}; if (now - h.start > accountWindowMs) { h.start = now; h.n = 0; } h.n++; hits.set(ip, h); if (hits.size > 50000) hits.clear(); return h.n > accountRate; };
  const send = (res, status, body, extra = {}) => { res.writeHead(status, {'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'access-control-allow-origin': '*', ...extra}); res.end(body); };
  // servedAt lets the browser judge freshness with the SERVER clock, not its own.
  const stamp = json => '{"servedAt":' + Date.now() + ',' + json.slice(1);
  return http.createServer(async (req, res) => {
    try {
      if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, '{"error":"method"}');
      const url = new URL(req.url, 'http://x'); if (url.pathname.length > 80) return send(res, 404, '{"error":"not found"}');
      if (url.pathname === '/api/health') { const h = cache.health(); return send(res, h.ok ? 200 : 503, JSON.stringify(h)); }
      if (url.pathname === '/api/snapshot') { const json = cache.snapshotJson(); return json ? send(res, 200, stamp(json)) : send(res, 503, '{"error":"stale"}'); }
      if(url.pathname==='/api/referral-points'){const json=cache.referralJson?.();return json?send(res,200,json):send(res,503,'{"error":"unavailable"}');}
      const m = url.pathname.match(/^\/api\/account\/(0x[0-9a-fA-F]{40})$/);
      if (m) {
        if (!isAddress(m[1])) return send(res, 400, '{"error":"address"}');
        const ip = String(req.headers['x-real-ip'] ?? req.socket.remoteAddress ?? '');
        if (limited(ip)) return send(res, 429, '{"error":"rate"}', {'retry-after': '5'});
        if (!cache.snapshotJson()) return send(res, 503, '{"error":"stale"}');
        return send(res, 200, stamp(await cache.account(getAddress(m[1]))));
      }
      return send(res, 404, '{"error":"not found"}');
    } catch (e) { return send(res, 502, JSON.stringify({error:'upstream',message:'Data temporarily unavailable. Retry shortly.'})); }
  });
}

// ---- CLI ----
if (process.argv[1] && pathToFileURL(fs.realpathSync(path.resolve(process.argv[1]))).href === import.meta.url) {
  const cfgPath = process.argv[2] ?? 'server/cache-server.json';
  const opts = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  const dir = path.dirname(path.resolve(cfgPath));
  const config = JSON.parse(fs.readFileSync(path.resolve(dir, opts.siteConfig), 'utf8'));
  const protocol = JSON.parse(fs.readFileSync(path.resolve(dir, opts.protocol), 'utf8'));
  const cache = await createCache({config, protocol, referralPointsPath:opts.referralPointsPath,rpcUrls: opts.rpcUrls ?? config.rpcUrls, refreshMs: opts.refreshMs, staleMs: opts.staleMs, accountTtlMs: opts.accountTtlMs, logChunk: opts.logChunk, rpcTimeoutMs: opts.rpcTimeoutMs});
  cache.start();
  const server = createServer(cache, {accountRate: opts.accountRate});
  server.listen(opts.port ?? 8787, opts.host ?? '127.0.0.1', () => console.log(`TapeMicro cache on http://${opts.host ?? '127.0.0.1'}:${opts.port ?? 8787}/api/health`));
  const shutdown = () => { cache.stop(); server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 3000).unref(); };
  process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);
}
