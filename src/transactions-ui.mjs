import {escapeHtml as esc} from './client-utils.mjs';
import {locale} from './i18n.mjs';
import {isPending} from './transaction-journal.mjs';
export function transactionSummary(rows=[]){return{pending:rows.filter(isPending).length,total:rows.length};}
export function transactionsMarkup(s){
 const rows=s.transactions??[],pending=rows.filter(isPending),ordered=[...pending,...rows.filter(t=>!isPending(t))];
 const labels={pending:'等待确认',unknown:'需要核对',confirmed:'已确认',failed:'执行失败',cancelled:'已取消',replaced:'已取消或替换'};
 const time=at=>new Date(at).toLocaleString(locale(),{timeZone:'Asia/Shanghai',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false});
 return `<p class="field-note">记录保存在当前浏览器，仅显示当前钱包。</p>${pending.length?'<p class="field-note">已有交易提交，确认结果前暂停新操作，避免重复提交。刷新页面不会重发。</p>':''}${ordered.length?ordered.map(t=>{
  const hash=t.receiptHash??t.replacementHash??t.hash;
  return `<div class="transaction-row"><div><b>${esc(t.title??'协议操作')}</b><small class="${t.status==='failed'?'bad':'muted'}">${labels[t.status]??''}${t.at?' · '+time(t.at):''}</small>${t.note?`<small>${esc(t.note)}</small>`:''}</div>${s.explorer?`<a href="${esc(s.explorer)}/tx/${esc(hash)}" target="_blank" rel="noopener">查看交易 ↗</a>`:`<span class="mono small" title="${esc(hash)}">${esc(hash.slice(0,10))}…</span>`}${t.status==='unknown'?`<button class="text-button" data-replacement="${esc(t.hash)}">填写替换交易哈希</button>`:''}</div>`;
 }).join(''):'<div class="empty-state"><h2>暂无本机交易记录</h2><p>提交交易后，可在这里查看确认状态和交易链接。</p></div>'}${ordered.length?'<button class="text-button" data-check-transactions>查询确认状态</button>':''}${s.transactionReadError?`<p class="bad small">${esc(s.transactionReadError)}</p>`:''}${s.transactionStorageWarning?'<p class="bad small">浏览器未能持久保存记录，请保存交易哈希，关闭页面可能丢失本机记录。</p>':''}`;
}
