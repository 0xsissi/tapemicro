import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,access} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const root=new URL('../dist/',import.meta.url);
test('production DeWEB assets are self-contained; RPC is the explicit runtime dependency',async()=>{
 const html=await readFile(new URL('index.html',root),'utf8'),css=await readFile(new URL('styles.css',root),'utf8'),app=await readFile(new URL('app.js',root),'utf8');
 assert.doesNotMatch(html,/(?:src)\s*=\s*["'](?:https?:|\/\/|\/[^/])/i);
 assert.doesNotMatch(css,/@import|url\(\s*["']?(?:https?:|\/\/)/i);
 const tokens=await readFile(new URL('tokens.css',root),'utf8'),layout=await readFile(new URL('protocol.css',root),'utf8');
 assert.doesNotMatch(tokens+layout,/@import|url\(\s*["']?(?:https?:|\/\/)|Consolas|font-size\s*:\s*(?:[0-9]|1[0-2])px|font-weight\s*:\s*(?:500|550|650|700)/i);
 assert.match(tokens,/font-variant|font-family:"Plex"/);assert.match(layout,/font-variant-numeric:tabular-nums/);
 assert.match(layout,/\.toast\{[^}]*left:0;right:0;[^}]*margin:0 auto/);assert.doesNotMatch(layout,/translate\(/);
 for(const weight of [400,600]){const font=await readFile(new URL(`fonts/ibm-plex-sans-latin-${weight}-normal.woff2`,root));assert.equal(font.toString('ascii',0,4),'wOF2');assert.match(tokens,new RegExp(`font-weight:${weight}`));}
 assert.match(await readFile(new URL('fonts/LICENSE',root),'utf8'),/SIL OPEN FONT LICENSE/);
 assert.match(html,/connect-src 'self' https:/);assert.match(html,/1H = 1 份微矿机/);assert.match(app,/eth_requestAccounts/);
 assert.doesNotMatch(app,/sourceMappingURL=data:|BEGIN PRIVATE KEY/);
 assert.match(html,/app\.js\?v=[0-9a-f]{12}/);assert.match(html,/protocol\.css\?v=[0-9a-f]{12}/);
 const config=JSON.parse(await readFile(new URL('config.json',root),'utf8'));
 assert.equal(config.chainId,56);assert.equal(Boolean(config.vault),Boolean(config.market));
 await assert.rejects(access(new URL('config.local.json',root)));
});
test('offline demo is separately labelled and cannot request wallet transactions',async()=>{
 const html=await readFile(new URL('demo/index.html',root),'utf8'),app=await readFile(new URL('demo/app.js',root),'utf8');
 assert.match(html,/connect-src 'none'/);assert.match(html,/演示/);
 assert.doesNotMatch(app,/\bfetch\s*\(|XMLHttpRequest|WebSocket|eth_sendTransaction|eth_requestAccounts|不承诺永久对应/);
});
test('release manifest matches every published runtime resource',async()=>{
 const manifest=JSON.parse(await readFile(new URL('release-manifest.json',root),'utf8'));
 assert.equal(manifest.localBuild,false);assert.equal(manifest.uiProtocolVersion,2);assert.equal(manifest.contractUiReady,true);const config=JSON.parse(await readFile(new URL('config.json',root),'utf8'));assert.equal(manifest.liveContractsConfigured,Boolean(config.vault&&config.market));
 for(const[file,entry]of Object.entries(manifest.files)){
 const bytes=await readFile(new URL(file,root));assert.equal(bytes.length,entry.bytes,file);assert.equal(createHash('sha256').update(bytes).digest('hex'),entry.sha256,file);
 }
});

test('real and demo pages share exactly the four requested primary flows',async()=>{
 const main=await readFile(new URL('index.html',root),'utf8'),demo=await readFile(new URL('demo/index.html',root),'utf8');
 for(const html of [main,demo]){assert.equal((html.match(/data-nav=/g)||[]).length,4);for(const route of ['deposit','market','rewards','points'])assert.ok(html.includes(`data-nav="${route}"`));assert.doesNotMatch(html,/protocol-hero|page-portfolio|backing-list|transfer-button|首次拆分贡献|持续持有贡献/);}
});
