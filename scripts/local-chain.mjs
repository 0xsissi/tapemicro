import {writeFile} from 'node:fs/promises';
import {startAnvil,mockSystem,deploy,tx,mine,root} from './chain-helpers.mjs';
const node=await startAnvil({port:Number(process.env.LOCAL_CHAIN_PORT||18576)});
try{
 const sys=await mockSystem(node.provider);sys.market=await deploy('TapeMicroMarketV2',sys.signers[0],[sys.vault.target,sys.addresses[4]]);const{signers:[a,b,c],nft,giant,mining,bem,vault,market}=sys;
 for(const[owner,id,h,collection,opt,ver]of [[a,1,100,nft,false,true],[b,2,60,nft,false,true],[a,3,1260,giant,false,true],[a,4,360,giant,true,true],[a,5,80,nft,false,false],[a,6,60,nft,false,true],[c,7,100,nft,false,true],[b,8,100,nft,false,true]])await sys.mintMiner(owner,id,h,{collection,optimal:opt,verified:ver});
 await tx(vault.deposit(await nft.getAddress(),1,100,{gasLimit:12_000_000}));await tx(vault.connect(b).deposit(await nft.getAddress(),2,60,{gasLimit:12_000_000}));
 await tx(vault.setApprovalForAll(await market.getAddress(),true));await tx(vault.connect(b).setApprovalForAll(await market.getAddress(),true));
 await tx(vault.connect(b).deposit(nft.target,8,100,{gasLimit:12000000}));
 const t=(await node.provider.getBlock('latest')).timestamp;await tx(market.createListing(await vault.assetId(await nft.getAddress(),1),50,10n**15n,t+7*86400));await tx(market.connect(b).createListing(await vault.assetId(await nft.getAddress(),2),30,12n*10n**14n,t+7*86400));
 await tx(market.connect(b).createListing(await vault.assetId(nft.target,8),100,15n*10n**14n,t+7*86400));
 if(process.env.TAPEMICRO_UI_QA==='1'){
  const bad=await sys.mintMiner(c,9,22);await tx(vault.connect(c).deposit(nft.target,9,22,{gasLimit:12000000}));
  await tx(vault.connect(c).safeTransferFrom(sys.addresses[2],sys.addresses[1],BigInt(bad),2,'0x',{gasLimit:1500000}));
  await tx(market.connect(b).createListing(BigInt(bad),2,5n*10n**14n,t+7*86400));
  for(let i=100;i<133;i++){await sys.mintMiner(c,i,1);await tx(vault.connect(c).deposit(nft.target,i,1,{gasLimit:12000000}));}
  await mine(node.provider,10);await tx(mining.setState(bad,2));
 }
 const config={version:'1.0.0-rc.4',protocolVersion:2,marketVersion:4,chainId:31337,network:'Local Anvil · 测试资产',rpcUrls:[node.url],explorer:null,mining:await mining.getAddress(),bem:await bem.getAddress(),tapeout:await nft.getAddress(),behemoth:await giant.getAddress(),lens:null,vault:await vault.getAddress(),market:await market.getAddress(),deploymentBlock:1,feeRecipient:sys.addresses[4],feeManager:sys.addresses[0],local:true};
 await writeFile(root+'src/config.local.json',JSON.stringify(config,null,2));await node.provider.send('anvil_removeBlockTimestampInterval',[]);await node.provider.send('evm_setIntervalMining',[1]);console.log(`Local chain: ${node.url}\nTest accounts: 0 / 1 / 2 (no real funds)\nRC4 UI: use a local build with ?network=local. Account 2 can buy 100H across three IDs. Ctrl+C stops this owned node.`);
 const stop=async()=>{await node.stop();process.exit(0)};process.on('SIGINT',stop);process.on('SIGTERM',stop);await new Promise(()=>{});
}catch(e){console.error(e);await node.stop();process.exitCode=1;}
