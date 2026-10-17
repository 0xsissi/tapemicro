export function mergeTradeHistory(previous,incoming){
 const rows=new Map();for(const row of [...previous,...incoming])rows.set(`${row.hash}:${row.logIndex}`,row);
 return [...rows.values()].sort((a,b)=>b.blockNumber-a.blockNumber||b.logIndex-a.logIndex);
}
export function logWindow(cursor,firstBlock,span=5000){
 if(!Number.isSafeInteger(cursor)||!Number.isSafeInteger(firstBlock)||cursor<0||firstBlock<0||span<1)throw Error('Invalid log range');
 if(cursor<firstBlock)return null;
 return{fromBlock:Math.max(firstBlock,cursor-span+1),toBlock:cursor};
}
