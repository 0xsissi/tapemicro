import {JsonRpcProvider} from 'ethers';
import {isReadFailure} from './operation-errors.mjs';

// Only idempotent reads enter the race. Wallet signing/broadcasting never does.
const readMethod=name=>name==='eth_blockNumber'||name==='eth_chainId'||name==='net_version'||name==='web3_clientVersion'||name==='eth_call'||name==='eth_estimateGas'||name==='eth_gasPrice'||name==='eth_maxPriorityFeePerGas'||name==='eth_feeHistory'||name.startsWith('eth_get');
export class ReadRpcPool{
 constructor(urls,chainId,{fetcher=globalThis.fetch,timeoutMs=3000,hedgeMs=1500,quarantineMs=300000,now=()=>Date.now(),onRequest=()=>{}}={}){
  Object.assign(this,{chainId:BigInt(chainId),fetcher,timeoutMs,hedgeMs,quarantineMs,now,onRequest});this.fetcher=fetcher.bind(globalThis);this.nodes=[...new Set(urls)].map((url,index)=>({url,index,latency:500,failures:0,cooldown:0,validated:false}));this.requests=0;this.lastUrl=urls[0];this.serial=0;
 }
 async attempt(node,payload,controller){
  const start=this.now(),probeId='tapemicro-chain-'+(++this.serial),list=Array.isArray(payload)?payload:[payload],probe=!node.validated;
  const body=probe?[...list,{jsonrpc:'2.0',id:probeId,method:'eth_chainId',params:[]}]:payload;
  const timer=setTimeout(()=>controller.abort(),this.timeoutMs);this.requests++;let failed=false;
  try{
   const response=await this.fetcher(node.url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body),signal:controller.signal});
   if(!response.ok)throw Object.assign(Error('RPC HTTP '+response.status),{code:'SERVER_ERROR'});
   const raw=await response.json(),rows=Array.isArray(raw)?raw:[raw];
   if(probe){const network=rows.find(r=>r.id===probeId);if(!network?.result||BigInt(network.result)!==this.chainId)throw Object.assign(Error('RPC chain mismatch'),{code:'NETWORK_ERROR'});node.validated=true;}
   const result=list.map(p=>rows.find(r=>r.id===p.id));
   if(result.some(r=>!r||!Object.hasOwn(r,'result')&&!r.error))throw Object.assign(Error('RPC missing response'),{code:'BAD_DATA'});
   const networkError=result.find(r=>r.error&&(isReadFailure(r.error)||[-32601,-32602].includes(r.error.code)||/archive|personal token|not supported|exceed.*limit|response size/i.test(r.error.message??'')));if(networkError)throw Object.assign(Error(networkError.error.message),{code:'SERVER_ERROR'});
   node.latency=node.latency*.4+(this.now()-start)*.6;node.cooldown=0;this.lastUrl=node.url;return result;
  }catch(error){failed=true;if(!controller.signal.aborted||this.now()-start>=this.timeoutMs-10||controller.signal.reason==='HEDGE_LOST'&&this.now()-start>=this.hedgeMs){node.failures++;node.cooldown=this.now()+this.quarantineMs;}throw Object.assign(Error(error.message??'RPC timeout'),{code:typeof error.code==='string'?error.code:'TIMEOUT',cause:error});}
  finally{clearTimeout(timer);this.onRequest({url:node.url,methods:list.map(x=>x.method),elapsedMs:this.now()-start,failed});}
 }
 async send(payload){
  const list=Array.isArray(payload)?payload:[payload];
  if(!list.every(p=>readMethod(p.method)))throw Error('Read RPC pool refuses transaction submission');
  const nodes=[...this.nodes].sort((a,b)=>(a.cooldown>this.now())-(b.cooldown>this.now())||a.latency-b.latency||a.index-b.index);
  if(!nodes.length)throw Object.assign(Error('No RPC configured'),{code:'NETWORK_ERROR',rpcPoolExhausted:true});
  return new Promise((resolve,reject)=>{
   let next=0,active=0,done=false,lastError,timer;const controllers=[];
   const launch=()=>{if(done||next>=nodes.length||active>=2)return;const node=nodes[next++],controller=new AbortController();controllers.push(controller);active++;
    this.attempt(node,payload,controller).then(result=>{if(done)return;done=true;clearTimeout(timer);for(const c of controllers)if(c!==controller)c.abort('HEDGE_LOST');resolve(result);},error=>{active--;lastError=error;if(done)return;if(next<nodes.length)launch();else if(!active){done=true;clearTimeout(timer);reject(Object.assign(lastError,{rpcPoolExhausted:true}));}});
   };
   launch();timer=setTimeout(launch,this.hedgeMs);
  });
 }
}
export class PooledReadProvider extends JsonRpcProvider{
 constructor(urls,chainId,options={}){super(urls[0],chainId,{staticNetwork:true,cacheTimeout:-1,batchMaxCount:20,batchStallTime:5});this.readPool=new ReadRpcPool(urls,chainId,options);this.pollingInterval=800;}
 async _send(payload){return this.readPool.send(payload);}
}
