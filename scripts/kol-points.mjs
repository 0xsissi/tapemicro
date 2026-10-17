#!/usr/bin/env node
// TapeMicro KOL referral points.
//
//   node scripts/kol-points.mjs --config kol/kol-config.json            incremental (from the saved state)
//   node scripts/kol-points.mjs --config kol/kol-config.json --full     recompute from the deployment block
//   options: --to-block N   stop at block N (default: latest - confirmations)
//
// Reads only public chain data: every log of the vault and market(s) gives the
// transactions that touched them; each transaction's calldata may end with a
// referral tag (see src/referral.mjs). Fill events give the gross BNB volume.
// Anyone can rerun with --full and must get the same output.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {JsonRpcProvider, Interface, getAddress, toQuantity} from 'ethers';
import {readRef, activeKol} from '../src/referral.mjs';

export const POINTS_PER_BNB = 1000n;
export const DEFAULT_RULES = {kolShareBps: 1000, refereeBonusBps: 0, requireFirstInteraction: true, validityDays: 0};
const MARKET = new Interface([
  'event Filled(uint256 indexed id, address indexed seller, address indexed buyer, uint256 assetId, uint256 amount, uint256 priceWei)',
  'event BidFilled(uint256 indexed bidId, address indexed seller, address indexed bidder, uint256 assetId, uint256 amount, uint256 priceWei, uint256 fee)',
]);
const FILL_TOPICS = new Set([MARKET.getEvent('Filled').topicHash, MARKET.getEvent('BidFilled').topicHash]);

// ---------- pure accounting (unit-tested) ----------
export function emptyState(fingerprint) { return {version: 2, fingerprint, lastBlock: null, lastBlockHash: null, wallets: {}, kols: {}, referees: {}}; }

function rulesOf(r) {
  const rules = {...DEFAULT_RULES, ...(r ?? {})};
  for (const k of ['kolShareBps', 'refereeBonusBps', 'validityDays']) if (!Number.isSafeInteger(rules[k]) || rules[k] < 0) throw Error(`rules.${k} must be a non-negative safe integer`);
  if (rules.kolShareBps > 10_000 || rules.refereeBonusBps > 10_000) throw Error('bps must be <= 10000');
  if (typeof rules.requireFirstInteraction !== 'boolean') throw Error('requireFirstInteraction must be boolean');
  return rules;
}
export function fingerprint(rules, kols, scope = {}) { return crypto.createHash('sha256').update(JSON.stringify({engine: 2, rules: rulesOf(rules), kols, scope})).digest('hex'); }
const add = (a, b) => (BigInt(a ?? 0) + b).toString();
const pts = (gross, bps) => gross * POINTS_PER_BNB * BigInt(bps) / 10_000n; // in point-wei (points × 1e18)

/**
 * Applies one ordered batch.
 * txs:   [{hash, from, block, txIndex, data, timestamp}]  transactions sent TO the vault/market
 * fills: [{hash, block, txIndex, logIndex, timestamp, parties:[a,b], gross}]
 * Within one transaction its binding is applied before its fills.
 */
export function applyBatch(state, {txs, fills, kols, rules: r, referralMode = 'allowlist'}) {
  const rules = rulesOf(r);
  const items = [...txs.map(t => ({k: [t.block, t.txIndex, 0, 0], t})), ...fills.map(f => ({k: [f.block, f.txIndex, 1, f.logIndex], f}))]
    .sort((a, b) => { for (let i = 0; i < 4; i++) if (a.k[i] !== b.k[i]) return a.k[i] - b.k[i]; return 0; });
  for (const it of items) {
    if (it.t) {
      const t = it.t, w = getAddress(t.from);
      let rec = state.wallets[w];
      const first = !rec;
      if (first) rec = state.wallets[w] = {firstBlock: t.block, firstTx: t.hash};
      if (rec.kol || (!first && rules.requireFirstInteraction)) continue;
      const kol = activeKol(kols, readRef(t.data), t.block, {mode: referralMode});
      if (!kol || kol === w) continue;
      Object.assign(rec, {kol, bindBlock: t.block, bindTx: t.hash, bindTime: t.timestamp});
      const k = state.kols[kol] ??= {referees: 0, volumeWei: '0', pointsRaw: '0'};
      k.referees += 1;
      state.referees[w] = {kol, volumeWei: '0', bonusRaw: '0'};
    } else {
      const f = it.f;
      for (const p of new Set(f.parties.map(a => getAddress(a)))) {
        const rec = state.wallets[p];
        if (!rec?.kol) continue;
        if (rules.validityDays > 0 && f.timestamp > rec.bindTime + rules.validityDays * 86400) continue;
        const k = state.kols[rec.kol], ref = state.referees[p];
        k.volumeWei = add(k.volumeWei, f.gross); k.pointsRaw = pts(BigInt(k.volumeWei), rules.kolShareBps).toString();
        ref.volumeWei = add(ref.volumeWei, f.gross); ref.bonusRaw = pts(BigInt(ref.volumeWei), rules.refereeBonusBps).toString();
      }
    }
  }
  return state;
}

export function formatPoints(raw) { // point-wei → decimal string, 8 places, like the frontend
  const v = BigInt(raw), whole = v / 10n ** 18n, frac = (v % 10n ** 18n).toString().padStart(18, '0').slice(0, 8).replace(/0+$/, '');
  return frac ? `${whole}.${frac}` : `${whole}`;
}

export function buildOutput(state, {cfg, kols, rules, toBlock}) {
  const names = Object.fromEntries((kols ?? []).map(k => [getAddress(k.address), k.name ?? '']));
  const kolRows = Object.entries(state.kols).map(([address, k]) => ({address, name: names[address] ?? '', referees: k.referees, refereeVolumeWei: k.volumeWei, points: formatPoints(k.pointsRaw), pointsRaw: k.pointsRaw}))
    .sort((a, b) => (BigInt(b.pointsRaw) > BigInt(a.pointsRaw) ? 1 : BigInt(b.pointsRaw) < BigInt(a.pointsRaw) ? -1 : a.address < b.address ? -1 : 1));
  const refRows = Object.entries(state.referees).map(([address, r]) => ({address, kol: r.kol, bindBlock: state.wallets[address].bindBlock, bindTx: state.wallets[address].bindTx, volumeWei: r.volumeWei, bonusPoints: formatPoints(r.bonusRaw), bonusRaw: r.bonusRaw}))
    .sort((a, b) => a.bindBlock - b.bindBlock || (a.address < b.address ? -1 : 1));
  return {version: 1, chainId: cfg.chainId, vault: cfg.vault, markets: cfg.markets, deploymentBlock: cfg.deploymentBlock, toBlock, toBlockHash: state.lastBlockHash, referralMode: cfg.referralMode ?? 'allowlist', fingerprint: state.fingerprint, rules: rulesOf(rules), pointsPerBnb: Number(POINTS_PER_BNB), kols: kolRows, referees: refRows};
}

// ---------- chain reading ----------
async function pool(items, n, fn) { const out = new Array(items.length); let i = 0; await Promise.all(Array.from({length: Math.min(n, items.length)}, async () => { while (i < items.length) { const j = i++; out[j] = await fn(items[j]); } })); return out; }
async function retry(fn, tries = 5) { for (let i = 0; ; i++) { try { return await fn(); } catch (e) { if (i >= tries - 1) throw e; await new Promise(r => setTimeout(r, 500 * 2 ** i)); } } }

export async function collect(provider, cfg, from, to) {
  const targets = [cfg.vault, ...cfg.markets].map(a => getAddress(a));
  const marketSet = new Set(cfg.markets.map(a => getAddress(a)));
  const logs = [];
  for (let a = from; a <= to; a += cfg.logChunk ?? 5000) {
    const b = Math.min(to, a + (cfg.logChunk ?? 5000) - 1);
    logs.push(...await retry(() => provider.getLogs({address: targets, fromBlock: a, toBlock: b})));
  }
  const fills = [];
  for (const l of logs) {
    if (l.removed) throw Error('Chain reorganization during collection; rerun with --full');
    if (marketSet.has(getAddress(l.address)) && FILL_TOPICS.has(l.topics[0])) {
      const e = MARKET.parseLog(l);
      const parties = e.name === 'Filled' ? [e.args.seller, e.args.buyer] : [e.args.seller, e.args.bidder];
      fills.push({hash: l.transactionHash, block: l.blockNumber, txIndex: l.transactionIndex, logIndex: l.index, parties, gross: e.args.amount * e.args.priceWei});
    }
  }
  // Events alone miss successful calls that emit nothing (e.g. syncRewards
  // without new BEM). Inspect full blocks so "first interaction" stays exact.
  const blocks = await pool(Array.from({length: to - from + 1}, (_, i) => from + i), cfg.concurrency ?? 8, async n => {
    const b = await retry(() => provider.send('eth_getBlockByNumber', [toQuantity(n), true]));
    if (!b?.hash || !Array.isArray(b.transactions)) throw Error(`Missing block ${n}`);
    const timestamp = Number(BigInt(b.timestamp));
    const direct = b.transactions.map((t, i) => ({t, i})).filter(({t}) => t.to && targets.includes(getAddress(t.to)));
    return {number: n, hash: b.hash, parentHash: b.parentHash, timestamp, txs: direct.map(({t,i}) => ({hash: t.hash, from: t.from, block: n, txIndex: i, data: t.input ?? t.data, timestamp, blockHash: b.hash}))};
  });
  for (let i = 1; i < blocks.length; i++) if (blocks[i].parentHash !== blocks[i-1].hash) throw Error('Chain reorganization during collection; rerun with --full');
  const txs = (await pool(blocks.flatMap(b => b.txs), cfg.concurrency ?? 8, async t => {
    const receipt = await retry(() => provider.getTransactionReceipt(t.hash));
    if (!receipt || receipt.blockHash !== t.blockHash) throw Error('Missing or reorganized receipt; rerun with --full');
    return receipt.status === 1 ? t : null;
  })).filter(Boolean);
  const times = new Map(blocks.map(b => [b.number, b.timestamp]));
  for (const f of fills) f.timestamp = times.get(f.block);
  return {txs, fills};
}

// ---------- CLI ----------
function arg(name) { const i = process.argv.indexOf(name); return i < 0 ? null : process.argv[i + 1]; }
const readJson = p => JSON.parse(fs.readFileSync(p, 'utf8'));
function writeJson(p, v) { fs.mkdirSync(path.dirname(path.resolve(p)), {recursive: true}); const tmp = p + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(v, null, 2) + '\n'); fs.renameSync(tmp, p); }

export async function run({configPath, full = false, toBlock: toArg = null, provider: given = null, log = console.log}) {
  const cfg = readJson(configPath);
  for (const k of ['vault', 'markets', 'deploymentBlock', 'kolList', 'statePath', 'outPath']) if (cfg[k] == null) throw Error(`config.${k} is required`);
  const rawList = readJson(cfg.kolList), kols = Array.isArray(rawList) ? rawList : rawList.kols;
  cfg.referralMode ??= Array.isArray(rawList) ? 'allowlist' : rawList.mode;
  if (!['allowlist','open'].includes(cfg.referralMode) || !Array.isArray(kols)) throw Error('Invalid referral mode or KOL list');
  cfg.vault = getAddress(cfg.vault); cfg.markets = [...new Set(cfg.markets.map(getAddress))];
  for (const key of ['chainId','deploymentBlock','confirmations','logChunk','concurrency']) {
    cfg[key] ??= {confirmations:15,logChunk:5000,concurrency:8}[key];
    if (!Number.isSafeInteger(cfg[key]) || cfg[key] < (['chainId','logChunk','concurrency'].includes(key) ? 1 : 0)) throw Error(`Invalid config.${key}`);
  }
  if (cfg.concurrency > 32 || cfg.logChunk > 10000 || !cfg.markets.length || cfg.markets.includes(cfg.vault) || [cfg.vault,...cfg.markets].some(a=>/^0x0{40}$/i.test(a))) throw Error('Invalid targets or scan limits');
  if (toArg !== null && (!Number.isSafeInteger(toArg) || toArg < cfg.deploymentBlock)) throw Error('Invalid --to-block');
  const seen = new Set(); for (const k of kols) { const a = getAddress(k.address); if (seen.has(a) || /^0x0{40}$/i.test(a)) throw Error(`duplicate or zero KOL ${a}`); seen.add(a); for(const key of ['startBlock','endBlock'])if(k[key]!=null&&(!Number.isSafeInteger(k[key])||k[key]<0))throw Error(`Invalid KOL ${key}`);if(k.startBlock!=null&&k.endBlock!=null&&k.startBlock>k.endBlock)throw Error('Invalid KOL block range'); }
  const fp = fingerprint(cfg.rules, kols, {chainId:cfg.chainId,vault:cfg.vault,markets:cfg.markets,deploymentBlock:cfg.deploymentBlock,referralMode:cfg.referralMode});
  const provider = given ?? new JsonRpcProvider(cfg.rpcUrl, cfg.chainId, {staticNetwork: true, cacheTimeout: -1});
  try {
  if (BigInt(await provider.send('eth_chainId', [])) !== BigInt(cfg.chainId)) throw Error('RPC chainId does not match config');
  let state = !full && fs.existsSync(cfg.statePath) ? readJson(cfg.statePath) : emptyState(fp);
  if (state.version !== 2 || state.fingerprint !== fp) throw Error('Rules, targets, network or kol-list.json changed since the last run. Rerun with --full so every binding is recomputed under the same rules.');
  if (state.lastBlock !== null && (!state.lastBlockHash || (await provider.getBlock(state.lastBlock))?.hash !== state.lastBlockHash)) throw Error('Saved checkpoint was reorganized. Rerun with --full.');
  const latest = await provider.getBlockNumber();
  const to = Math.min(toArg ?? Infinity, latest - (cfg.confirmations ?? 15));
  if (state.lastBlock !== null && state.lastBlock > to) throw Error('Requested safe head precedes the saved checkpoint. Rerun with --full.');
  const from = state.lastBlock === null ? cfg.deploymentBlock : state.lastBlock + 1;
  if (from <= to) {
    for (let a = from; a <= to; a += cfg.logChunk) {
      const b = Math.min(to, a + cfg.logChunk - 1), before = await provider.getBlock(b);
      const batch = await collect(provider, cfg, a, b);
      if (!before || (await provider.getBlock(b))?.hash !== before.hash || state.lastBlock !== null && (await provider.getBlock(state.lastBlock))?.hash !== state.lastBlockHash) throw Error('Chain reorganization during scan. Rerun with --full.');
      applyBatch(state, {...batch, kols, rules: cfg.rules, referralMode:cfg.referralMode});
      state.lastBlock = b; state.lastBlockHash = before.hash;
      writeJson(cfg.statePath, state);
      if(cfg.publishProgress)writeJson(cfg.outPath,{...buildOutput(state,{cfg,kols,rules:cfg.rules,toBlock:b}),catchingUp:b<to,backfillToBlock:to});
      log(`blocks ${a}–${b}: ${batch.txs.length} successful direct transactions, ${batch.fills.length} fills`);
    }
  } else log(`nothing new (next block ${from}, safe head ${to})`);
  writeJson(cfg.statePath, state);
  const out = buildOutput(state, {cfg, kols, rules: cfg.rules, toBlock: state.lastBlock});
  writeJson(cfg.outPath, out);
  log(`${out.kols.length} KOLs, ${out.referees.length} referred wallets → ${cfg.outPath}`);
  return out;
  } finally { if (!given) provider.destroy(); }
}

// This module is also bundled into kol-worker.mjs. Only the named CLI should
// execute here; a worker must use its own explicitly supplied config once.
if (process.argv[1] && new URL(import.meta.url).pathname.endsWith('/kol-points.mjs') && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const configPath = arg('--config') ?? 'kol/kol-config.json';
  run({configPath, full: process.argv.includes('--full'), toBlock: arg('--to-block') === null ? null : Number(arg('--to-block'))})
    .catch(e => { console.error(e.message ?? e); process.exit(1); });
}
