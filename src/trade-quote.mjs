// Integer-only UI quotes. Fees round down PER FILL so a batch is the sum of
// the same individual purchases, matching TapeMicroMarket.quotePayment.
export const MARKET_FEE_BPS=100n;
const MAX=2n**128n-1n;
export function quoteFills(fills,feeBps=MARKET_FEE_BPS){
 if(typeof feeBps!=='bigint'||feeBps<0n||feeBps>10000n)throw Error('费率超出范围');
 if(fills.length>16)throw Error('一次最多购买 16 个卖单');
 let quantity=0n,gross=0n,fee=0n;
 for(const f of fills){if(typeof f.amount!=='bigint'||typeof f.priceWei!=='bigint'||f.amount<=0n||f.amount>MAX||f.priceWei<=0n||f.priceWei>MAX)throw Error('请检查数量和单价');const value=f.amount*f.priceWei;quantity+=f.amount;gross+=value;fee+=value*feeBps/10000n;}
 if(gross+fee>2n**256n-1n)throw Error('支付金额超出合约范围');
 return{quantity,gross,fee,total:gross+fee};
}
export function parseBnbPrice(value){
 const text=value.trim();if(!/^\d+(\.\d{1,18})?$/.test(text))throw Error('请输入有效的 BNB 单价，最多 18 位小数');
 const [a,b='']=text.split('.'),price=BigInt(a)*10n**18n+BigInt(b.padEnd(18,'0'));if(price<=0n||price>MAX)throw Error('单价超出范围');return price;
}
