// TapeMicro referral tag — shared by the frontend and scripts/kol-points.mjs.
//
// A referral tag is 24 bytes appended to the END of a transaction's calldata:
//   4 bytes magic "TMRF" (0x544d5246) + 20 bytes KOL address.
// Solidity ignores calldata past the ABI-encoded arguments, so the vault and
// market contracts execute exactly as without it. The tag only matters to the
// off-chain points script. It can never move funds or change any contract state.
import {getAddress, isAddress} from 'ethers';

export const REF_MAGIC = '544d5246';
const TAG_HEX = 48; // 24 bytes
const STORAGE_KEY = 'tapemicro.referral.v1';

/** 24-byte tag (hex without 0x) for a KOL address. */
export function refTag(kol) { return REF_MAGIC + getAddress(kol).slice(2).toLowerCase(); }

/** Returns calldata with the tag appended. Use for every tx sent to the vault or market. */
export function appendRef(data, kol) {
  if (typeof data !== 'string' || !/^0x([0-9a-fA-F]{2})*$/.test(data) || data.length < 10) throw Error('invalid calldata');
  return data + refTag(kol);
}

/** Reads the KOL address from calldata, or null when the tx carries no tag. */
export function readRef(data) {
  if (typeof data !== 'string' || data.length < 2 + 8 + TAG_HEX) return null; // selector + tag at least
  const tail = data.slice(-TAG_HEX).toLowerCase();
  if (tail.slice(0, 8) !== REF_MAGIC) return null;
  try { return getAddress('0x' + tail.slice(8)); } catch { return null; }
}

/** Finds ?ref=0x… in the query string or in the hash (#market?ref=0x…). */
export function parseRefFromUrl(href) {
  try {
    const url = new URL(href);
    const fromHash = url.hash.includes('?') ? new URLSearchParams(url.hash.slice(url.hash.indexOf('?') + 1)).get('ref') : null;
    const raw = url.searchParams.get('ref') ?? fromHash;
    return raw && isAddress(raw) ? getAddress(raw) : null;
  } catch { return null; }
}

/** Whitelist lookup. `kols` is the parsed kol-list.json array.
 *  A KOL with `endBlock` set no longer binds new users (the frontend stops tagging
 *  for them); with `block` given, the tag counts only within [startBlock, endBlock]. */
export function activeKol(kols, address, block = null, {mode = 'allowlist'} = {}) {
  if (!address || !isAddress(address) || /^0x0{40}$/i.test(address)) return null;
  const k = (kols ?? []).find(x => typeof x.address === 'string' && x.address.toLowerCase() === address.toLowerCase());
  if (!k) return mode === 'open' ? getAddress(address) : null;
  if (block === null) return k.endBlock == null ? getAddress(k.address) : null;
  if (k.startBlock != null && block < k.startBlock) return null;
  if (k.endBlock != null && block > k.endBlock) return null;
  return getAddress(k.address);
}

function safeStorage(storage) { try { return storage ?? globalThis.localStorage ?? null; } catch { return null; } }

/** First-touch: keeps the first whitelisted KOL this browser saw; a later link never replaces it. */
export function rememberReferral(href, kols, {storage, now = Date.now(), mode = 'allowlist'} = {}) {
  const s = safeStorage(storage);
  const existing = loadReferral({storage: s});
  if (existing) return existing;
  const kol = activeKol(kols, parseRefFromUrl(href), null, {mode});
  if (!kol) return null;
  try { s?.setItem(STORAGE_KEY, JSON.stringify({kol, firstSeen: now})); } catch {}
  return kol;
}

export function loadReferral({storage} = {}) {
  const s = safeStorage(storage);
  try { const v = JSON.parse(s?.getItem(STORAGE_KEY) ?? 'null'); return v?.kol && isAddress(v.kol) ? getAddress(v.kol) : null; } catch { return null; }
}

/** Calldata to send: tagged when a referral is stored and it is not the user's own address. */
export function taggedData(data, {kol, from}) {
  if (!kol || (from && kol.toLowerCase() === from.toLowerCase())) return data;
  return appendRef(data, kol);
}

/** Link a whitelisted KOL shares. `base` is the site URL. */
export function referralLink(base, kol) { const u = new URL(base); u.searchParams.set('ref', getAddress(kol)); return u.toString(); }

/** The stored KOL, only while still whitelisted and active; otherwise null (stop tagging). */
export function currentReferral(kols, {storage, mode = 'allowlist'} = {}) { return activeKol(kols, loadReferral({storage}), null, {mode}); }
