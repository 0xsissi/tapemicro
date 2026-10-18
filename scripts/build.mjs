import {readFile,mkdir,writeFile,copyFile,rm,readdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {build} from 'esbuild';
import {keccak256} from 'ethers';
import {buildGuide} from './build-guide.mjs';
import{walletNotices}from'./wallet-notices.mjs';
import{darkTheme,cssStringFromTheme}from'@rainbow-me/rainbowkit';
const root=fileURLToPath(new URL('../',import.meta.url));
await mkdir(`${root}dist/demo`,{recursive:true});
await mkdir(`${root}dist/contracts`,{recursive:true});
let html=await readFile(`${root}src/index.html`,'utf8');
html=html.replace('<!-- ICONS -->',await readFile(`${root}src/icons.svg`,'utf8'));
await writeFile(`${root}dist/index.html`,html);
for(const file of ['styles.css','tokens.css','protocol.css','guide.css','config.json','kol-list.json','kol-points.json'])await copyFile(`${root}src/${file}`,`${root}dist/${file}`);
for(const file of ['guide.html','guide-en.html'])await writeFile(`${root}dist/${file}`,buildGuide(await readFile(`${root}src/${file}`,'utf8'),{appHtml:html,icons:await readFile(`${root}src/icons.svg`,'utf8'),english:file==='guide-en.html'}));
const files=['index.html','styles.css','tokens.css','protocol.css','app.js','config.json','kol-list.json','kol-points.json','protocol.json','demo/index.html','demo/app.js','deploy.html','deploy.js','fees.html','fees.js','contracts/compiler-input.json','THIRD_PARTY_NOTICES.txt','guide.html','guide-en.html','guide.css','guide.js'];
await mkdir(`${root}dist/fonts`,{recursive:true});
for(const font of ['ibm-plex-sans-latin-400-normal.woff2','ibm-plex-sans-latin-600-normal.woff2','LICENSE']){await copyFile(`${root}src/fonts/${font}`,`${root}dist/fonts/${font}`);files.push('fonts/'+font);}
await copyFile(`${root}THIRD_PARTY_NOTICES.txt`,`${root}dist/THIRD_PARTY_NOTICES.txt`);
await rm(`${root}dist/model.js`,{force:true});
await copyFile(`${root}src/deploy.html`,`${root}dist/deploy.html`);
await copyFile(`${root}src/fees.html`,`${root}dist/fees.html`);
await copyFile(`${root}artifacts/compiler-input.json`,`${root}dist/contracts/compiler-input.json`);
let demo=html.replace('<link rel="stylesheet" href="./wallet-kit.css">','').replace('href="./protocol.css"','href="../protocol.css"').replace('href="./tokens.css"','href="../tokens.css"').replaceAll('href="./fonts/','href="../fonts/').replace("connect-src 'self' https: http://127.0.0.1:* http://localhost:*","connect-src 'none'");
demo=demo.replaceAll('="./guide.html"','="../guide.html"').replace('<title>TapeMicro · 微型矿机</title>','<title>TapeMicro · 四功能演示</title>').replace('id="connect-wallet">连接钱包','id="connect-wallet">使用演示钱包').replace('id="env-badge">BSC','id="env-badge">演示').replace('<div class="app-notice hidden" id="deployment-notice" role="status"></div>','<div class="app-notice" id="deployment-notice" role="status">演示模式：全部为虚拟资产，不连接真实钱包。</div>');
await writeFile(`${root}dist/demo/index.html`,demo);
await rm(`${root}dist/demo/model.js`,{force:true});
await build({entryPoints:[`${root}src/simple-demo-client.mjs`],outfile:`${root}dist/demo/app.js`,bundle:true,format:'iife',platform:'browser',target:['es2022'],minify:true,legalComments:'eof'});
await build({entryPoints:[`${root}src/guide-client.mjs`],outfile:`${root}dist/guide.js`,bundle:true,format:'iife',platform:'browser',target:['es2022'],minify:true,legalComments:'eof'});
const protocol=JSON.parse(await readFile(`${root}src/protocol-legacy.json`,'utf8'));
for(const name of ['TapeMicroVault','TapeMicroMarket','TapeMicroMarketV2','TapeMicroCustody','IPodMining']){
 const a=JSON.parse(await readFile(`${root}artifacts/${name}.json`,'utf8'));
 protocol[name]={abi:a.abi,runtimeHash:keccak256(a.deployedBytecode),immutableRanges:Object.values(a.immutableReferences).flat()};
}
await writeFile(`${root}dist/protocol.json`,JSON.stringify(protocol));
await writeFile(`${root}src/generated-protocol.json`,JSON.stringify(protocol));
const deployment={};for(const name of ['TapeMicroVault','TapeMicroMarket','TapeMicroMarketV2']){const a=JSON.parse(await readFile(`${root}artifacts/${name}.json`,'utf8'));deployment[name]={abi:a.abi,bytecode:a.bytecode};}
await writeFile(`${root}src/generated-deployment.json`,JSON.stringify(deployment));
let localConfig=null;
if(process.env.TAPEMICRO_LOCAL==='1'){
 await copyFile(`${root}src/config.local.json`,`${root}dist/config.local.json`);files.push('config.local.json');localConfig=JSON.parse(await readFile(`${root}src/config.local.json`,'utf8'));
}else await rm(`${root}dist/config.local.json`,{force:true});
const englishWalletLocale=(await readdir(`${root}node_modules/@rainbow-me/rainbowkit/dist`)).find(f=>/^en_US-.*\.js$/.test(f));
const walletLocales={name:'tapemicro-wallet-locales',setup(ctx){ctx.onResolve({filter:/^\.\/[a-z]{2}_[A-Z]{2}-[^/]+\.js$/},args=>args.importer.replaceAll('\\','/').includes('@rainbow-me/rainbowkit')&&!/^\.\/(en_US|zh_CN)-/.test(args.path)?{path:root+'node_modules/@rainbow-me/rainbowkit/dist/'+englishWalletLocale}:null);}};
const walletBuild=await build({entryPoints:[`${root}src/rainbow-wallet.mjs`],outfile:`${root}dist/wallet-kit.js`,plugins:[walletLocales],bundle:true,format:'esm',platform:'browser',target:['es2022'],minify:true,legalComments:'eof',metafile:true,define:{'process.env.NODE_ENV':'"production"'}});
const walletTheme=darkTheme({accentColor:'#F3F3F1',accentColorForeground:'#0B0C0E',borderRadius:'medium',fontStack:'system',overlayBlur:'small'});
walletTheme.fonts.body='"IBM Plex Sans", "Microsoft YaHei", "PingFang SC", sans-serif';
walletTheme.colors.modalBackground='#131518';walletTheme.colors.modalText='#F3F3F1';walletTheme.colors.modalTextSecondary='#B4B8BF';
await writeFile(`${root}dist/wallet-kit.css`,(await readFile(`${root}dist/wallet-kit.css`,'utf8'))+'\n[data-rk]{'+cssStringFromTheme(walletTheme)+'}\n');
files.push('wallet-kit.js','wallet-kit.css');
await mkdir(`${root}output/rainbowkit`,{recursive:true});await writeFile(`${root}output/rainbowkit/bundle-meta.json`,JSON.stringify(walletBuild.metafile));
await walletNotices(root,walletBuild.metafile);
const walletModuleUrl='./wallet-kit.js?v='+createHash('sha256').update(await readFile(`${root}dist/wallet-kit.js`)).digest('hex').slice(0,12);
await build({entryPoints:[`${root}src/client.mjs`],outfile:`${root}dist/app.js`,bundle:true,format:'iife',platform:'browser',target:['es2022'],minify:true,legalComments:'eof',define:{__LOCAL_CONFIG__:JSON.stringify(localConfig),__WALLET_MODULE_URL__:JSON.stringify(walletModuleUrl)}});
await build({entryPoints:[`${root}src/deploy-client.mjs`],outfile:`${root}dist/deploy.js`,bundle:true,format:'iife',platform:'browser',target:['es2022'],minify:true,legalComments:'eof'});
await build({entryPoints:[`${root}src/fees-client.mjs`],outfile:`${root}dist/fees.js`,bundle:true,format:'iife',platform:'browser',target:['es2022'],minify:true,legalComments:'eof',define:{__LOCAL_CONFIG__:JSON.stringify(localConfig)}});
for(const name of ['TapeMicroVault','TapeMicroMarket','TapeMicroMarketV2','TapeMicroCustody']){await copyFile(`${root}contracts/${name}.sol`,`${root}dist/contracts/${name}.sol`);files.push(`contracts/${name}.sol`);}
// A reopened page must fetch the matching bundle, even behind browser/CDN caches.
// Content hashes also work when these files are served by DeWEB.
for(const file of ['index.html','demo/index.html','deploy.html','fees.html','guide.html','guide-en.html']){
 let page=await readFile(`${root}dist/${file}`,'utf8');
 for(const url of new Set([...page.matchAll(/(?:src|href)="((?:\.{1,2}\/)[^"?]+\.(?:js|css))"/g)].map(m=>m[1]))){
  const bytes=await readFile(new URL(url,new URL('../dist/'+file,import.meta.url))),tag=createHash('sha256').update(bytes).digest('hex').slice(0,12);
  page=page.replaceAll('="'+url+'"','="'+url+'?v='+tag+'"');
 }
 await writeFile(`${root}dist/${file}`,page);
}
const manifest={version:JSON.parse(await readFile(`${root}package.json`,'utf8')).version,uiProtocolVersion:2,contractUiReady:true,liveContractsConfigured:!!JSON.parse(await readFile(`${root}src/config.json`,'utf8')).vault,localBuild:process.env.TAPEMICRO_LOCAL==='1',files:{}};
for(const file of files){const bytes=await readFile(`${root}dist/${file}`);manifest.files[file]={bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};}
await writeFile(`${root}dist/release-manifest.json`,JSON.stringify(manifest,null,2));
console.log(`DeWEB static build: ${root}dist (${files.length} resources, ${manifest.version})`);
