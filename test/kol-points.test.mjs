// End-to-end: real vault + market V2 on a local chain, real tagged transactions,
// then the points script must match hand-computed results exactly.
// Needs artifacts/ (npm run compile) and the local anvil from devDependencies.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {ethers} from 'ethers';
import {freePort} from '../scripts/chain-helpers.mjs';
import {appendRef, readRef, parseRefFromUrl, rememberReferral, loadReferral, currentReferral, taggedData, referralLink, activeKol} from '../src/referral.mjs';
import {run, applyBatch, emptyState, formatPoints} from '../scripts/kol-points.mjs';

const ART = process.env.ARTIFACTS ?? 'artifacts';
const art = n => JSON.parse(fs.readFileSync(path.join(ART, n + '.json'), 'utf8'));
const ANVIL = process.env.ANVIL ?? `node_modules/@foundry-rs/anvil-${process.platform === 'win32' ? 'win32' : process.platform === 'darwin' ? 'darwin' : 'linux'}-${process.arch === 'arm64' ? 'arm64' : 'amd64'}/bin/anvil${process.platform === 'win32' ? '.exe' : ''}`;

test('tag helpers: append/read, URL parsing, first-touch storage, self and inactive KOLs', () => {
  const kol = '0x1111111111111111111111111111111111111111', data = '0xa9059cbb' + '00'.repeat(64);
  assert.equal(readRef(appendRef(data, kol)), ethers.getAddress(kol));
  assert.equal(readRef(data), null); assert.equal(readRef('0x'), null); assert.equal(readRef(data + 'deadbeef' + '11'.repeat(20)), null);
  assert.equal(parseRefFromUrl(`https://x.dweb/?ref=${kol}`), ethers.getAddress(kol));
  assert.equal(parseRefFromUrl(`https://x.dweb/#market?ref=${kol}`), ethers.getAddress(kol));
  assert.equal(parseRefFromUrl('https://x.dweb/?ref=0x123'), null);
  const mem = new Map(), storage = {getItem: k => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v)};
  const other = '0x2222222222222222222222222222222222222222', list = [{address: kol}, {address: other}];
  assert.equal(rememberReferral(`https://x/?ref=${'0x3333333333333333333333333333333333333333'}`, list, {storage}), null); // not whitelisted
  assert.equal(rememberReferral(`https://x/?ref=${kol}`, list, {storage}), ethers.getAddress(kol));
  assert.equal(rememberReferral(`https://x/?ref=${other}`, list, {storage}), ethers.getAddress(kol)); // first touch wins
  assert.equal(loadReferral({storage}), ethers.getAddress(kol));
  assert.equal(currentReferral([{address: kol, endBlock: 5}], {storage}), null); // ended KOL: stop tagging
  assert.equal(taggedData(data, {kol, from: kol}), data); // never tag the KOL's own transactions
  assert.equal(taggedData(data, {kol: null, from: other}), data);
  assert.equal(new URL(referralLink('https://tapemicro.dweb/', kol)).searchParams.get('ref'), ethers.getAddress(kol));
  const broken = {getItem() { throw Error('blocked'); }, setItem() { throw Error('blocked'); }};
  assert.equal(rememberReferral(`https://x/?ref=${kol}`, list, {storage: broken}), ethers.getAddress(kol));
  assert.equal(activeKol([{address: kol, startBlock: 10, endBlock: 20}], kol, 9), null);
  assert.equal(activeKol([{address: kol, startBlock: 10, endBlock: 20}], kol, 21), null);
  assert.equal(activeKol([{address: kol, startBlock: 10, endBlock: 20}], kol, 15), ethers.getAddress(kol));
  assert.equal(formatPoints(10n ** 18n * 1234n + 5n * 10n ** 13n), '1234.00005');
});

test('accounting rules on synthetic data: first interaction, self, binding before fills in the same tx', () => {
  const K = ethers.getAddress('0x' + 'aa'.repeat(20)), A = ethers.getAddress('0x' + '01'.repeat(20)), B = ethers.getAddress('0x' + '02'.repeat(20));
  const tag = d => appendRef('0x12345678', d);
  const st = applyBatch(emptyState('x'), {kols: [{address: K}], rules: {}, txs: [
    {hash: 'h1', from: A, block: 1, txIndex: 0, data: tag(K), timestamp: 100},
    {hash: 'h2', from: B, block: 1, txIndex: 1, data: '0x12345678', timestamp: 100},
    {hash: 'h3', from: B, block: 2, txIndex: 0, data: tag(K), timestamp: 200},
    {hash: 'h4', from: K, block: 2, txIndex: 1, data: tag(K), timestamp: 200},
  ], fills: [{hash: 'h1', block: 1, txIndex: 0, logIndex: 3, timestamp: 100, parties: [A, B], gross: 10n ** 18n}]});
  assert.equal(st.wallets[A].kol, K); assert.equal(st.wallets[B].kol, undefined); assert.equal(st.wallets[K].kol, undefined);
  assert.equal(st.kols[K].pointsRaw, (100n * 10n ** 18n).toString()); // 1 BNB → 1000 points → 10% = 100
});

test('real contracts accept tagged calldata; script output matches the hand-computed ledger; incremental == full', async () => {
  const port = await freePort();
  const anvil = spawn(ANVIL, ['--port', String(port), '--accounts', '12', '--gas-limit', '100000000', '--hardfork', 'cancun', '--silent'], {stdio: 'ignore', windowsHide: true});
  const p = new ethers.JsonRpcProvider(`http://127.0.0.1:${port}`, 31337, {staticNetwork: true, cacheTimeout: -1});
  try {
    for (let i = 0; i < 80; i++) { try { await p.getBlockNumber(); break; } catch { await new Promise(r => setTimeout(r, 150)); } }
    // Freeze wall-clock advancement so gas estimates and execution use the same reward branch.
    await p.send('anvil_setBlockTimestampInterval', [0]);
    const S = await Promise.all([...Array(12).keys()].map(i => p.getSigner(i))), A = await Promise.all(S.map(s => s.getAddress()));
    const [U0, K1, K2, K3, U1, U2, U4, U5, K4] = [0, 1, 2, 3, 4, 5, 6, 7, 8];
    const dep = async (n, ...a) => { const c = await new ethers.ContractFactory(art(n).abi, art(n).bytecode, S[0]).deploy(...a, {gasLimit: 15_000_000}); await c.waitForDeployment(); return c; };
    const wait = async (txp) => { const t = await txp; for (let i = 0; i < 400; i++) { const r = await p.getTransactionReceipt(t.hash); if (r) { assert.equal(r.status, 1, 'tx reverted'); return r; } await new Promise(z => setTimeout(z, 25)); } throw Error('no receipt'); };
    const bem = await dep('MockBem'), nft = await dep('MockMinerNFT', 'T'), nft2 = await dep('MockMinerNFT', 'B');
    const mining = await dep('MockMining', bem.target), vault = await dep('TapeMicroVault', mining.target, bem.target, nft.target, nft2.target);
    const market = await dep('TapeMicroMarketV2', vault.target, A[11]);
    const deploymentBlock = await p.getBlockNumber();
    const G = {gasLimit: 15_000_000};
    // Sends a transaction to `c` with an optional referral tag appended to the calldata.
    const call = async (who, c, fn, args, {ref = null, value = 0n} = {}) => {
      let data = c.interface.encodeFunctionData(fn, args); if (ref !== null) data = appendRef(data, A[ref]);
      return wait(S[who].sendTransaction({to: c.target, data, value, ...G}));
    };
    const ids = [];
    for (let n = 1; n <= 3; n++) { await wait(nft.mint(A[U0], n)); await wait(mining.register(nft.target, n, 100, false, true, 1)); await wait(nft.connect(S[U0]).approve(vault.target, n)); await call(U0, vault, 'deposit', [nft.target, n, 100]); ids.push(await vault.assetId(nft.target, n)); }
    await call(U0, vault, 'setApprovalForAll', [market.target, true]);
    const k4End = await p.getBlockNumber(); // K4's cooperation already ended at this block
    const end = (await p.getBlock('latest')).timestamp + 30 * 86400 - 100;
    const p1 = 10n ** 15n, p2 = 9n * 10n ** 14n, p3 = 12n * 10n ** 14n;
    const buy = (who, lid, amt, price, ref) => market.quotePayment(amt, price).then(([, , total]) => call(who, market, 'buyBatch', [[[lid, amt, price]], total, end], {ref, value: total}));
    const exp = {K1: 0n, K2: 0n};

    await call(U0, market, 'createListing', [ids[0], 50, p1, end]); // listing 1 (U0 untagged, existing user)
    await call(U1, vault, 'setApprovalForAll', [market.target, true], {ref: K1}); // U1 first tx tagged K1 → bound
    await buy(U1, 1, 10n, p1, K1); exp.K1 += 10n * p1;                          // a
    await buy(U4, 1, 5n, p1, K2); exp.K2 += 5n * p1;                            // b: U4's first tx is the buy itself
    await call(U4, vault, 'setApprovalForAll', [market.target, true], {ref: K2});
    const bidIds = [ids[0], ids[1]].sort((x, y) => (x < y ? -1 : 1));
    await call(U1, market, 'createBid', [bidIds, 20, p2, end], {ref: K1, value: 20n * p2}); // bid 1
    await call(U0, market, 'sellBatch', [[[1, ids[0], 8, p2]], 0, end]); exp.K1 += 8n * p2; // c: passive U1 side counts
    await call(U1, market, 'createListing', [ids[0], 6, p3, end], {ref: K1});   // listing 2
    await buy(U4, 2, 6n, p3, K2); exp.K1 += 6n * p3; exp.K2 += 6n * p3;          // d: both sides referred
    await call(U2, market, 'createBid', [[ids[2]], 1, 1n, end], {ref: K3, value: 1n}); // U2 first tx: K3 not whitelisted
    await buy(U2, 1, 3n, p1, K1);                                                 // e: U2 not first → never bound
    await call(K2, market, 'createBid', [[ids[2]], 1, 1n, end], {ref: K2, value: 1n}); // self-referral → not bound
    await buy(K2, 1, 2n, p1, K1);                                                 // not first → not bound
    await call(U0, vault, 'setApprovalForAll', [market.target, true], {ref: K1});  // existing user tagged later → ignored
    await wait(nft.mint(A[U5], 9)); await wait(mining.register(nft.target, 9, 40, false, true, 1)); await wait(nft.connect(S[U5]).approve(vault.target, 9));
    await call(U5, vault, 'deposit', [nft.target, 9, 40], {ref: K4});           // tagged deposit works; K4 ended → not bound
    await p.send('evm_setNextBlockTimestamp', [(await p.getBlock('latest')).timestamp + 60]); await p.send('evm_mine', []); // accrue explicit rewards for the tagged claim
    await call(U1, vault, 'claimBem', [[ids[0]], A[U1]], {ref: K1});             // tagged claim works
    await call(U1, market, 'cancelBid', [1], {ref: K1});                          // tagged cancel works
    const mid = await p.getBlockNumber();
    // after 2 days: counts with validityDays 0, not with validityDays 1
    await p.send('evm_setNextBlockTimestamp', [(await p.getBlock('latest')).timestamp + 2 * 86400]); await p.send('evm_mine', []);
    const late = 4n * p1; await buy(U1, 1, 4n, p1, K1);

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kol-'));
    fs.writeFileSync(path.join(dir, 'kols.json'), JSON.stringify([{address: A[K1], name: 'K1'}, {address: A[K2], name: 'K2'}, {address: A[K4], name: 'K4', endBlock: k4End}]));
    const cfg = (name, rules) => { const c = {chainId: 31337, vault: vault.target, markets: [market.target], deploymentBlock, kolList: path.join(dir, 'kols.json'), statePath: path.join(dir, name + '-state.json'), outPath: path.join(dir, name + '-out.json'), confirmations: 0, logChunk: 7, rules}; fs.writeFileSync(path.join(dir, name + '.json'), JSON.stringify(c)); return path.join(dir, name + '.json'); };
    const quiet = () => {};
    const pointsRaw = wei => (wei * 1000n * 1000n / 10_000n).toString();

    const full = await run({configPath: cfg('a', {}), full: true, provider: p, log: quiet});
    const byAddr = Object.fromEntries(full.kols.map(k => [k.address, k]));
    assert.deepEqual(Object.keys(byAddr).sort(), [A[K1], A[K2]].sort());
    assert.equal(byAddr[A[K1]].referees, 1); assert.equal(byAddr[A[K2]].referees, 1);
    assert.equal(byAddr[A[K1]].pointsRaw, pointsRaw(exp.K1 + late));
    assert.equal(byAddr[A[K2]].pointsRaw, pointsRaw(exp.K2));
    assert.deepEqual(full.referees.map(r => [r.address, r.kol]).sort(), [[A[U1], A[K1]], [A[U4], A[K2]]].sort());

    // incremental in two steps == one full run
    await run({configPath: cfg('b', {}), toBlock: mid, provider: p, log: quiet});
    const inc = await run({configPath: cfg('b', {}), provider: p, log: quiet});
    assert.deepEqual(inc.kols, full.kols); assert.deepEqual(inc.referees, full.referees);

    // validity window and referee bonus
    const v = await run({configPath: cfg('c', {validityDays: 1, refereeBonusBps: 500}), full: true, provider: p, log: quiet});
    const vk = Object.fromEntries(v.kols.map(k => [k.address, k]));
    assert.equal(vk[A[K1]].pointsRaw, pointsRaw(exp.K1)); // the late buy is outside 1 day
    const u1 = v.referees.find(r => r.address === A[U1]);
    assert.equal(u1.bonusRaw, ((10n * p1 + 8n * p2 + 6n * p3) * 1000n * 500n / 10_000n).toString());

    // changing rules without --full is refused
    await assert.rejects(run({configPath: cfg('b', {kolShareBps: 2000}), provider: p, log: quiet}), /--full/);
    console.log('K1', byAddr[A[K1]].points, 'points; K2', byAddr[A[K2]].points, 'points');
  } finally { p.destroy(); anvil.kill(); }
});
