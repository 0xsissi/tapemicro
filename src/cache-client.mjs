import{pointsMarkets}from'./points-markets.mjs';
// Reads TapeMicro's server cache (/api/*) and plugs it into LiveGateway.
// Only display reads go through the cache. Anything that must be fresh stays
// on chain: rewards preview (reward:true), reads of specific assets right
// after a transaction (assetIds / minBlock beyond the cache), checkPurchase,
// checkSale, crossingPrice, prepare, and every signed transaction.
// If the cache is missing, stale, slow or for other contracts, the original
// chain read runs instead, so the site keeps working without the server.
import {getAddress} from 'ethers';

const same = (a, b) => String(a ?? '').toLowerCase() === String(b ?? '').toLowerCase();
export const reviveBig=(k,v)=>{if(v&&typeof v==='object'&&Object.keys(v).length===1&&typeof v.$big==='string'){if(!/^-?\d{1,78}$/.test(v.$big))throw Error('invalid cached integer');return BigInt(v.$big);}return v;};
const range = total => {const n=Number(total);if(!Number.isSafeInteger(n)||n<0||n>100000)throw Error('cache book too large');return Array.from({length:n},(_,i)=>BigInt(i+1));};

const uint=v=>typeof v==='bigint'&&v>=0n;
function validateDisplay(data,path){
 if(!Number.isSafeInteger(data.block)||data.block<0||!Number.isSafeInteger(data.chainTime)||data.chainTime<0)throw Error('invalid cache block');
 const asset=a=>a&&['id','assetId','balance','reserved','funded','pending','hashrate','tokenId'].every(k=>uint(a[k]));
 if(path==='/snapshot'){
  if(!Array.isArray(data.orders)||!Array.isArray(data.bids)||!uint(data.ordersTotal)||!uint(data.bidsTotal))throw Error('invalid cache book');
  if(!data.orders.every(o=>o&&['id','assetId','remaining','priceWei','balance','expiresAt'].every(k=>uint(o[k]))&&typeof o.approved==='boolean'&&typeof o.tradable==='boolean'))throw Error('invalid cache listing');
  if(!data.bids.every(b=>b&&['id','remaining','priceWei','expiresAt'].every(k=>uint(b[k]))&&[0n,1n,2n].includes(b.kind)&&Array.isArray(b.assetIds)&&b.assetIds.every(uint)))throw Error('invalid cache bid');
 }else if(path.startsWith('/account/')){
  if(!Array.isArray(data.assets)||!data.assets.every(asset)||!data.account||!['micro','pending','reserved','bem','proceeds','tradePoints','boughtVolumeWei','soldVolumeWei','bnb'].every(k=>uint(data.account[k])))throw Error('invalid cache account');
 }
}

export class CacheClient {
  constructor({config, baseUrl = config.cacheApi ?? '/api', maxAgeMs = 30000, timeoutMs = 2500, fetcher = globalThis.fetch?.bind(globalThis), snapshotReuseMs = 1000} = {}) {
    Object.assign(this, {config, baseUrl: baseUrl.replace(/\/$/, ''), maxAgeMs, timeoutMs, fetcher, snapshotReuseMs});
    this.recent = null;
  }
  async get(path) {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await this.fetcher(this.baseUrl + path, {cache: 'no-store', headers: {accept: 'application/json'}, signal: controller.signal});
      if (!res.ok) throw Error('cache HTTP ' + res.status);
      const body=await res.text();if(body.length>8_000_000)throw Error('cache response too large');const data=JSON.parse(body,reviveBig),c=this.config;
      if (data.version !== 1 || data.chainId !== c.chainId || !same(data.vault, c.vault) || !same(data.market, c.market) || !same(data.mining,c.mining) || !same(data.bem,c.bem) || !same(data.tapeout,c.tapeout) || !same(data.behemoth,c.behemoth)) throw Error('cache is for other contracts');
      if((c.legacyMarkets??[]).length&&JSON.stringify(data.pointsMarkets)!==JSON.stringify(pointsMarkets(c).map(m=>m.address.toLowerCase())))throw Error('cache points market mismatch');
      const age = data.servedAt - data.updatedAt; // both server clock
      if (!(age >= 0 && age <= this.maxAgeMs)) throw Error('cache is stale');
      validateDisplay(data,path);return data;
    } finally { clearTimeout(timer); }
  }
  snapshot() { // one request serves several reads in the same refresh
    const now = Date.now();
    if (this.recent && now - this.recent.at < this.snapshotReuseMs) return this.recent.promise;
    const promise = this.get('/snapshot'); this.recent = {at: now, promise}; promise.catch(() => { if (this.recent?.promise === promise) this.recent = null; });
    return promise;
  }
  async account(address) { const a = getAddress(address), data = await this.get('/account/' + a); if (!same(data.address, a)) throw Error('cache account mismatch'); return data; }
}

/** Snapshot rows in the exact shape LiveGateway.read()/readBook() return. */
export function bookFromSnapshot(s, extraBids = []) {
  const bids = new Map(s.bids.map(b => [String(b.id), b])); for (const b of extraBids) if (!bids.has(String(b.id))) bids.set(String(b.id), b);
  return {orders: s.orders, bids: [...bids.values()], ordersTotal: s.ordersTotal, bidsTotal: s.bidsTotal,
    orderWindowIds: range(s.ordersTotal), bidWindowIds: range(s.bidsTotal), askCursor: 1n, bidCursor: 1n,
    ordersExhausted: true, bidsExhausted: true, ordersScanned: Number(s.ordersTotal), bidsScanned: Number(s.bidsTotal),
    bidMetadataComplete: s.bidMetadataComplete, bidsSupported: s.bidsSupported};
}

/** Wraps gateway.read / readBook / stats. Returns an object with `state()` for a small status badge. */
export function useCache(gateway, client, {cooldownMs = 30000, now = () => Date.now()} = {}) {
  const original = {read: gateway.read, readBook: gateway.readBook, stats: gateway.stats};
  let disabledUntil = 0, last = {source: 'chain', error: null};
  const attempt = async (viaCache, viaChain) => {
    if (now() < disabledUntil) { last = {source: 'chain', error: last.error}; return viaChain(); }
    try { const out = await viaCache(); last = {source: 'cache', error: null}; return out; }
    catch (error) { disabledUntil = now() + cooldownMs; last = {source: 'chain', error: String(error?.message ?? error)}; return viaChain(); }
  };
  gateway.read = (opts = {}) => {
    const {reward = true, book = true, account = true, assetIds = null, minBlock = 0} = opts;
    if (reward || assetIds || !gateway.ready) return original.read(opts);
    return attempt(async () => {
      const who = gateway.address;
      const [snap, acct] = await Promise.all([client.snapshot(), account && who ? client.account(who) : null]);
      if (!snap.ready) throw Error('cache not ready');if(acct&&!acct.account)throw Error('cache account missing');
      const block = Math.min(snap.block, acct?.block ?? snap.block);
      if (block < minBlock) throw Error('cache behind the confirmed block');
      if (gateway.address !== who) throw Error('wallet changed');
      const out = {chainTime: snap.chainTime, block, ready: snap.ready, paused: snap.paused, dailyPer100: snap.dailyPer100, cached: true};
      if (book) Object.assign(out, bookFromSnapshot(snap, acct?.closedBids ?? []));
      if (account) Object.assign(out, who ? {assets: acct.assets, assetsComplete: acct.assetsComplete, account: acct.account, rewardFresh: acct.rewardFresh} : {assets: [], assetsComplete: true, account: null, rewardFresh: false});
      return out;
    }, () => original.read(opts));
  };
  gateway.readBook = (opts = {}) => attempt(async () => {
    const snap = await client.snapshot();
    return {...bookFromSnapshot(snap), chainTime: snap.chainTime, block: snap.block, bookPage: true};
  }, () => original.readBook(opts));
  gateway.stats = () => attempt(async () => { const snap = await client.snapshot(); if (!snap.stats) throw Error('no stats'); return snap.stats; }, () => original.stats());
  return {state: () => ({...last, disabledUntil}), restore() { Object.assign(gateway, original); }};
}
