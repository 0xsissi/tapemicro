export const BID_KIND_ANY=2n;
export const isAnyBid=bid=>bid?.kind===BID_KIND_ANY;
export const bidAccepts=(bid,assetId)=>isAnyBid(bid)||(bid?.assetIds??[]).some(id=>id===assetId);
