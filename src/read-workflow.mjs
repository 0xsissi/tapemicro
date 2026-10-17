// Deadlines apply to reads/preparation only, never to signing or broadcasting.
export async function yieldForPaint({signal}={}){
 if(signal?.aborted)throw Object.assign(Error('操作已取消'),{code:'UI_CANCELLED'});
 await new Promise(resolve=>{let frame,timer,paintTimer;const done=()=>{clearTimeout(timer);clearTimeout(paintTimer);if(frame!==undefined)globalThis.cancelAnimationFrame?.(frame);signal?.removeEventListener('abort',done);resolve();};signal?.addEventListener('abort',done,{once:true});if(globalThis.document?.visibilityState==='visible'&&globalThis.requestAnimationFrame){timer=setTimeout(done,50);frame=requestAnimationFrame(()=>paintTimer=setTimeout(done,0));}else timer=setTimeout(done,0);});
 if(signal?.aborted)throw Object.assign(Error('操作已取消'),{code:'UI_CANCELLED'});
}
// Long NFT scans may run for minutes, but must not spin forever without progress.
export async function progressDeadline(work,{signal,timeoutMs=20000}={}){
 const controller=new AbortController();let timer,onAbort;
 try{return await Promise.race([new Promise((_,reject)=>{
  const stop=error=>{reject(error);controller.abort();};onAbort=()=>stop(Object.assign(Error('操作已取消'),{code:'UI_CANCELLED'}));
  controller.heartbeat=()=>{if(controller.signal.aborted)return;clearTimeout(timer);timer=setTimeout(()=>stop(Object.assign(Error('节点响应慢，可以重试或在连接设置中切换节点'),{code:'READ_TIMEOUT'})),timeoutMs);};
  if(signal?.aborted)onAbort();else{signal?.addEventListener('abort',onAbort,{once:true});controller.heartbeat();}
 }),Promise.resolve().then(()=>{if(controller.signal.aborted)throw Object.assign(Error('操作已取消'),{code:'UI_CANCELLED'});return work({signal:controller.signal,heartbeat:controller.heartbeat});})]);}
 finally{clearTimeout(timer);signal?.removeEventListener('abort',onAbort);controller.abort();}
}
export async function readDeadline(work,{signal,timeoutMs=20000}={}){
 let timer,onAbort;try{return await Promise.race([Promise.resolve().then(work),new Promise((_,reject)=>{onAbort=()=>reject(Object.assign(Error('操作已取消'),{code:'UI_CANCELLED'}));if(signal?.aborted)return onAbort();signal?.addEventListener('abort',onAbort,{once:true});timer=setTimeout(()=>reject(Object.assign(Error('节点响应慢，可以重试或在连接设置中切换节点'),{code:'READ_TIMEOUT'})),timeoutMs);})]);}finally{clearTimeout(timer);signal?.removeEventListener('abort',onAbort);}
}
export class CoalescedRead{
 constructor(){this.pending=null;this.followup=null;}
 run(work,{fresh=false}={}){
  if(!this.pending){const task=Promise.resolve().then(work);this.pending=task.finally(()=>{if(this.pending===owned)this.pending=null;});const owned=this.pending;return owned;}
  if(!fresh)return this.pending;
  if(!this.followup){const previous=this.pending;this.followup=previous.catch(()=>{}).then(()=>{this.followup=null;return this.run(work);});}return this.followup;
 }
}
