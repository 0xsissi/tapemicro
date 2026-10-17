export const escapeHtml=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const integerFormatter=/* @__PURE__ */new Intl.NumberFormat('en-US');
export const formatInteger=value=>integerFormatter.format(BigInt(value??0));
export function positiveInteger(value,label='数量'){
 const s=String(value).trim();if(!/^[0-9]+$/.test(s))throw Error(`${label}必须为正整数`);const n=BigInt(s);if(n<=0n||n>2n**128n-1n)throw Error(`${label}超出范围`);return n;
}
export function tokenId(value){
 const text=String(value).trim();if(!/^[0-9]+$/.test(text))throw Error('矿机编号必须为非负整数');const n=BigInt(text);if(n>2n**64n-1n)throw Error('矿机编号超出范围');return n;
}
export function displayUnits(raw,decimals=18,places=6){
 const n=BigInt(raw),negative=n<0n,a=negative?-n:n,base=10n**BigInt(decimals),whole=a/base,frac=(a%base).toString().padStart(decimals,'0').slice(0,places).replace(/0+$/,'');return `${negative?'-':''}${formatInteger(whole)}${frac?'.'+frac:''}`;
}
export function maskRuntime(code,ranges){
 if(!/^0x(?:[0-9a-fA-F]{2})*$/.test(code))throw Error('合约字节码格式错误');let hex=code.slice(2).toLowerCase();for(const{start,length}of ranges){if(!Number.isSafeInteger(start)||!Number.isSafeInteger(length)||start<0||length<0||(start+length)*2>hex.length)throw Error('合约字节码长度不匹配');hex=hex.slice(0,start*2)+'0'.repeat(length*2)+hex.slice((start+length)*2);}return '0x'+hex;
}
export function validateRpc(value,{local=false}={}){
 const u=new URL(value);const loopback=['127.0.0.1','localhost','[::1]'].includes(u.hostname);if(u.username||u.password||(!local&&u.protocol!=='https:')||(local&&(!loopback||u.protocol!=='http:')))throw Error(local?'本地模式仅允许回环 HTTP 节点':'公共 RPC 必须为不含凭证的 HTTPS 地址');return u.href;
}
export const shortAddress=a=>a?`${a.slice(0,6)}…${a.slice(-4)}`:'—';
