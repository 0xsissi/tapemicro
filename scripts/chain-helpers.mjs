import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {JsonRpcProvider,ContractFactory,Contract} from 'ethers';
export const root=fileURLToPath(new URL('../',import.meta.url));
export const BSC={chainId:56,mining:'0x7E2E0DC66a3bD9103E69b766afA62d9f7b697b46',bem:'0x5ce033B2bFCa3Af30b3e8C8457DeaF776A8b695a',tapeout:'0xb1024b89886B9a34Aa4ff5F31C411D708b20a14C',behemoth:'0x1F5Cb4aeaE1807Bf60c3b9C0D8aDBCC14e91f12C',lens:'0x2243Eaf4Dd308AeA7E243C06d7b95265a90b0134',rpc:'https://bsc-rpc.publicnode.com'};
export async function artifact(name){return JSON.parse(await readFile(new URL(`../artifacts/${name}.json`,import.meta.url),'utf8'));}
export async function deploy(name,signer,args=[]){const a=await artifact(name);const c=await new ContractFactory(a.abi,a.bytecode,signer).deploy(...args,{gasLimit:15_000_000});await c.waitForDeployment();return c;}
export async function at(name,address,runner){return new Contract(address,(await artifact(name)).abi,runner);}
export async function mine(provider,seconds){const now=(await provider.getBlock('latest')).timestamp;await provider.send('evm_setNextBlockTimestamp',[now+seconds]);await provider.send('evm_mine',[]);}
export async function tx(promise){return (await promise).wait();}
export async function freePort(){return new Promise((resolve,reject)=>{const s=createServer();s.on('error',reject);s.listen(0,'127.0.0.1',()=>{const n=s.address().port;s.close(()=>resolve(n));});});}
export async function startAnvil({fork=false,port,blockNumber,blockTime,chainId=31337}={}){
 if(chainId!==31337&&!(fork&&chainId===56))throw Error('Only an isolated BSC fork may retain chainId 56');
 port??=await freePort();
 const bin=process.platform==='win32'?root+'node_modules/@foundry-rs/anvil-win32-amd64/bin/anvil.exe':root+`node_modules/@foundry-rs/anvil-${process.platform==='darwin'?'darwin':'linux'}-${process.arch==='arm64'?'arm64':'amd64'}/bin/anvil`;
 const args=['--host','127.0.0.1','--port',String(port),'--chain-id',String(chainId),'--hardfork','cancun','--gas-limit','30000000','--silent'];
 if(blockTime) args.push('--block-time',String(blockTime));
 if(fork){args.push('--fork-url',process.env.BSC_RPC_URL||BSC.rpc);if(blockNumber)args.push('--fork-block-number',String(blockNumber));}
 const child=spawn(bin,args,{windowsHide:true,stdio:['ignore','pipe','pipe']});let logs='';child.stdout.on('data',b=>{logs=(logs+b).slice(-5000)});child.stderr.on('data',b=>{logs=(logs+b).slice(-5000)});
 const url=`http://127.0.0.1:${port}`;const p=new JsonRpcProvider(url,chainId,{staticNetwork:true,cacheTimeout:-1,batchMaxCount:1});p.pollingInterval=50;
 let childError;child.on('error',e=>{childError=e});
 for(let i=0;i<80;++i){if(childError)throw childError;if(child.exitCode!==null)throw Error(`Anvil failed: ${logs}`);try{const v=await p.send('web3_clientVersion',[]);if(!v.toLowerCase().includes('anvil'))throw Error('Refusing a non-Anvil local endpoint');return{provider:p,url,child,logs:()=>logs,stop:async()=>{p.destroy();child.kill();}};}catch{await new Promise(r=>setTimeout(r,150));}}
 child.kill();p.destroy();throw Error(`Anvil readiness timeout: ${logs}`);
}
export async function mockSystem(p){
 // Deterministic Mock clock: only mine(p, seconds) advances mining time.
 // Wall-clock boundaries must not change which SSTORE/mint path a test covers.
 await p.send('anvil_setBlockTimestampInterval',[0]);
 const signers=await Promise.all([0,1,2,3,4].map(i=>p.getSigner(i)));const addresses=await Promise.all(signers.map(s=>s.getAddress()));
 const bem=await deploy('MockBem',signers[0]),nft=await deploy('MockMinerNFT',signers[0],['Mock TapeOut']),giant=await deploy('MockMinerNFT',signers[0],['Mock Behemoth']);
 const mining=await deploy('MockMining',signers[0],[await bem.getAddress()]);
 const vault=await deploy('TapeMicroVault',signers[0],[await mining.getAddress(),await bem.getAddress(),await nft.getAddress(),await giant.getAddress()]);
 const market=await deploy('TapeMicroMarket',signers[0],[await vault.getAddress(),addresses[4]]);
 async function mintMiner(owner,id,h,{collection=nft,optimal=false,verified=true,mult=collection===giant?6:1}={}){await tx(collection.mint(await owner.getAddress(),id));await tx(mining.register(await collection.getAddress(),id,h,optimal,verified,mult,{gasLimit:1_000_000}));await tx(collection.connect(owner).approve(await vault.getAddress(),id));return vault.minerKey(await collection.getAddress(),id);}
 return{signers,addresses,bem,nft,giant,mining,vault,market,mintMiner};
}
