import {isReadFailure} from './operation-errors.mjs';
// A pinned snapshot can become unavailable as a fast chain advances or a
// backup node lags. Start one new snapshot; never retry signing or sending.
export async function retryReadSnapshot(read){
 try{return await read();}catch(error){if(!error.rpcPoolExhausted||!isReadFailure(error))throw error;return read();}
}
// Retry reads only. Signing and sending are never passed to this helper.
export class ReadRecovery{
 constructor({current,rotate,attempts=1,onState=()=>{}}){Object.assign(this,{current,rotate,attempts,onState});this.switching=null;}
 async run(read){
  for(let n=0;;n++){
   const previous=this.current();
   try{return await read();}catch(error){
    if(error.rpcPoolExhausted||!isReadFailure(error)||n>=this.attempts-1)throw error;
    this.onState('recovering');
    if(this.current()===previous){
     if(!this.switching)this.switching=Promise.resolve().then(()=>this.rotate(previous)).finally(()=>{this.switching=null;});
     if(!await this.switching)throw error;
    }
    this.onState('recovered');
   }
  }
 }
}
