// Keep the application and contract reads independent from the optional UI
// bundle. The implementation and CSS are shipped locally, including on DeWEB.
export function lazyWalletUI(load,site){
 const listeners=new Set();let instance,loading,state={status:'loading'};
 function start(){return loading??=(async()=>{const module=await load();instance=module.createRainbowWalletUI(site);instance.subscribe(next=>{state=next;for(const fn of listeners)fn(next);});await instance.ready;return instance;})().catch(error=>{instance?.destroy?.();instance=null;loading=null;state={status:'unavailable'};for(const fn of listeners)fn(state);throw error;});}
 queueMicrotask(()=>start().catch(()=>{}));
 return{getState:()=>state,subscribe(fn){listeners.add(fn);fn(state);return()=>listeners.delete(fn);},async open(mode){return(await start()).open(mode);},async restore(){return(await start()).restore();},setLanguage(lang){instance?.setLanguage(lang);}};
}
