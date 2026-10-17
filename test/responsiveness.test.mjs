import test from'node:test';import assert from'node:assert/strict';
import{progressDeadline,yieldForPaint}from'../src/read-workflow.mjs';import{planSale}from'../src/bid-plan.mjs';
import{renderChanged}from'../src/dom-updates.mjs';import{formatInteger,displayUnits}from'../src/client-utils.mjs';
const pause=ms=>new Promise(r=>setTimeout(r,ms));
test('a progressing scan may exceed the idle budget, but a stalled scan aborts and ignores late heartbeats',async()=>{
 const value=await progressDeadline(async({heartbeat})=>{for(let i=0;i<4;i++){await pause(8);heartbeat();}return'complete';},{timeoutMs:25});assert.equal(value,'complete');
 let signal,late;await assert.rejects(progressDeadline(async c=>{signal=c.signal;late=c.heartbeat;await new Promise(()=>{});},{timeoutMs:5}),e=>e.code==='READ_TIMEOUT');assert.equal(signal.aborted,true);assert.doesNotThrow(late);
});
test('cancelling a scan releases the wait even when its upstream promise never settles',async()=>{
 const controller=new AbortController();let child;const pending=progressDeadline(async({signal})=>{child=signal;await new Promise(()=>{});},{signal:controller.signal});await Promise.resolve();controller.abort();await assert.rejects(pending,e=>e.code==='UI_CANCELLED');assert.equal(child.aborted,true);
 const already=new AbortController();already.abort();let called=false;await assert.rejects(progressDeadline(()=>called=true,{signal:already.signal}),e=>e.code==='UI_CANCELLED');assert.equal(called,false);
});
test('preparation yields to the event loop and a cancelled preview cannot continue',async()=>{
 let painted=false;setTimeout(()=>painted=true,0);await yieldForPaint();assert.equal(painted,true);const controller=new AbortController();controller.abort();await assert.rejects(yieldForPaint({signal:controller.signal}),e=>e.code==='UI_CANCELLED');
});
test('a browser that suspends animation frames cannot trap preparation or cancellation',async()=>{
 const saved=Object.fromEntries(['document','requestAnimationFrame','cancelAnimationFrame'].map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));let cancelled=0;
 try{globalThis.document={visibilityState:'visible'};globalThis.requestAnimationFrame=()=>7;globalThis.cancelAnimationFrame=id=>{assert.equal(id,7);cancelled++;};await yieldForPaint();const controller=new AbortController(),pending=yieldForPaint({signal:controller.signal});controller.abort();await assert.rejects(pending,e=>e.code==='UI_CANCELLED');assert.equal(cancelled,2);}
 finally{for(const[key,descriptor]of Object.entries(saved))if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}
});
test('an empty sale request never scans bid metadata or wallet holdings',()=>{
 const noRead=new Proxy([],{get(){throw Error('empty preview scanned inventory');}});const plan=planSale(noRead,noRead,0n);assert.equal(plan.quantity,0n);assert.equal(plan.enough,false);assert.deepEqual(plan.fills,[]);
});
test('unchanged book dependencies skip work, while new inventory, price, time or pending state invalidates it',()=>{
 const host={},orders=[],draw=()=>calls++;let calls=0;assert.equal(renderChanged(host,[orders,1n,5,false],draw),true);assert.equal(renderChanged(host,[orders,1n,5,false],draw),false);renderChanged(host,[[],1n,5,false],draw);renderChanged(host,[orders,2n,5,false],draw);renderChanged(host,[orders,2n,6,false],draw);renderChanged(host,[orders,2n,6,true],draw);assert.equal(calls,5);
});
test('reused integer formatting preserves exact H and wei, including values beyond safe Number precision',()=>{
 assert.equal(formatInteger(123456789012345678901n),'123,456,789,012,345,678,901');assert.equal(displayUnits(123456789012345678901n,18,18),'123.456789012345678901');assert.equal(displayUnits(-1000000000000000001n,18,18),'-1.000000000000000001');
});
