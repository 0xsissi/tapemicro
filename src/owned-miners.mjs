// Every cached/scanned ID is checked at the same pinned block before use.
export async function discoverOwnedNfts({owner,collections,reader,onProgress=()=>{},signal,maxScan=50000,batchSize=500,concurrency=4,cache=null}){
 const same=a=>a&&String(a).toLowerCase()===owner.toLowerCase(),found=[],seen=new Set();let scanned=0,budget=maxScan;
 const cancelled=()=>{if(signal?.aborted)throw Error('Wallet lookup cancelled');};
 const add=(collection,id)=>{const key=collection.toLowerCase()+':'+id;if(!seen.has(key)){seen.add(key);found.push({collection,id:BigInt(id)});}};
 const info=await Promise.all(collections.map(async collection=>{cancelled();const balance=BigInt(await reader.balanceOf(collection,owner));const cached=cache?.read(collection)??[];
  if(balance&&cached.length){const ids=[...new Set(cached.map(String))].filter(id=>/^\d+$/.test(id)).map(BigInt);const owners=await reader.ownersOf(collection,ids);cancelled();if(owners.length!==ids.length)throw Error('Incomplete owner lookup');ids.forEach((id,i)=>{if(same(owners[i]))add(collection,id);});}
  const count=()=>BigInt(found.filter(x=>x.collection===collection).length);return{collection,balance,count,next:balance>count()?BigInt(await reader.nextId(collection)):0n};
 }));
 const total=info.reduce((n,c)=>n+c.next,0n);const progress=()=>{cancelled();onProgress({found:[...found],scanned,total});};if(found.length)progress();
 await Promise.all(info.map(async c=>{let cursor=c.next-1n;
  const worker=async()=>{while(c.count()<c.balance&&cursor>=0n&&budget>0){cancelled();const limit=Math.min(batchSize,budget,Number(cursor<BigInt(batchSize)?cursor+1n:BigInt(batchSize))),ids=Array.from({length:limit},(_,i)=>cursor-BigInt(i));cursor-=BigInt(limit);budget-=limit;
   const owners=await reader.ownersOf(c.collection,ids);cancelled();if(owners.length!==ids.length)throw Error('Incomplete owner lookup');ids.forEach((id,i)=>{if(same(owners[i]))add(c.collection,id);});scanned+=limit;progress();
  }};await Promise.all(Array.from({length:concurrency},worker));
  const ids=found.filter(x=>x.collection===c.collection).map(x=>String(x.id));if(BigInt(ids.length)===c.balance)cache?.write(c.collection,ids);
 }));cancelled();
 return{items:found,complete:info.every(c=>c.count()===c.balance),scanned,total};
}
export function walletMinerCache(storage,chainId,owner){
 const key=collection=>['tapemicro-miner-ids-v1',chainId,owner,collection].join(':').toLowerCase();
 return{read:collection=>{try{const ids=JSON.parse(storage?.getItem(key(collection))??'[]');return Array.isArray(ids)?ids.filter(x=>typeof x==='string'&&/^\d+$/.test(x)).slice(0,5000):[];}catch{return[];}},write:(collection,ids)=>{try{storage?.setItem(key(collection),JSON.stringify(ids));}catch{}}};
}
