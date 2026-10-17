import {escapeHtml as esc} from './client-utils.mjs';
import {setHTML} from './dom-updates.mjs';
import {localizeTree,translateText} from './i18n.mjs';

export const loadingIndicator=(label='正在读取…')=>`<span class="read-indicator" role="status"><span class="read-spinner" aria-hidden="true"></span><span>${esc(label)}</span></span>`;
export const loadingState=(label='正在读取…',detail='请稍候，读取完成后会自动显示。',action='')=>`<div class="read-state" data-read-state role="status" aria-live="polite" aria-busy="true"><span class="read-spinner" aria-hidden="true"></span><strong class="read-label">${esc(label)}</strong><p class="read-detail" ${detail?'':'hidden'}>${esc(detail)}</p><small class="read-wait" data-read-wait></small><div class="read-actions">${action}</div></div>`;
// Update labels in place: replacing the spinner restarts its CSS animation.
export function renderLoadingState(host,label,detail='请稍候，读取完成后会自动显示。',action=''){
 if(!host)return;const existing=host.firstElementChild;
 if(!existing?.hasAttribute('data-read-state')||host.children.length!==1)setHTML(host,loadingState(label,detail,action));
 const panel=host.firstElementChild;panel.querySelector('.read-label').textContent=label;const note=panel.querySelector('.read-detail');note.textContent=detail;note.hidden=!detail;setHTML(panel.querySelector('.read-actions'),action);localizeTree(panel);
}
export function startReadFeedback(root=globalThis.document?.body){
 const started=new WeakMap();const tick=()=>{for(const el of root?.querySelectorAll('[data-read-wait]')??[]){if(el.closest('.hidden')||el.closest('dialog:not([open])'))continue;const start=started.get(el)??Date.now();started.set(el,start);const seconds=Math.floor((Date.now()-start)/1000);el.textContent=seconds?translateText(seconds>=8?'已等待 '+seconds+' 秒，节点响应较慢。':'已等待 '+seconds+' 秒'):' ';}};
 const timer=setInterval(tick,1000);return()=>clearInterval(timer);
}
export const readFailure=(label='读取暂不可用',detail='请重试，当前结果不代表钱包没有资产。',retry='data-retry-read')=>`<div class="read-state read-failure" role="status"><strong>${esc(label)}</strong><p>${esc(detail)}</p><button class="text-button" ${retry}>重新读取</button></div>`;
export function initialReadPanel(s,label){
 if(s.dataLoaded||!s.ready&&!s.contractsConfigured&&!s.demo)return null;
 return s.readError?readFailure():loadingState(label);
}
export function minerChoicesMarkup(miners,{state='idle',progress='',error='',selected}={}){
 const pending=state==='loading',failed=state==='error',partial=state==='partial';
 const cards=miners.length?`<div class="miner-picker">${miners.map(m=>`<button class="miner-choice ${m.eligible===false?'unavailable':''} ${selected?.sourceKey===m.sourceKey&&selected?.id===m.id?'selected':''}" data-pick-miner="${m.id}" data-source="${m.sourceKey}"><strong>${BigInt(m.hashrate??0).toLocaleString('en-US')}H</strong><small>${esc(m.source)} #${m.id}</small>${m.eligible===false?`<small>${esc(m.reason)}</small>`:''}</button>`).join('')}</div>`:'';
 if(pending)return (cards?loadingIndicator(progress||'正在读取钱包原矿机…'):loadingState('正在读取钱包原矿机…',progress||'扫描和资格核验可能需要一些时间，请稍候。'))+cards;
 if(failed||partial)return readFailure(partial?'原矿机尚未全部读取':'原矿机读取失败',error||'可重试自动读取，或按编号查找。','data-retry-miners')+cards;
 if(cards)return cards;
 // Only a successful, complete lookup can establish that the wallet is empty.
 if(state==='complete')return `<div class="empty-state"><svg aria-hidden="true"><use href="#i-chip"/></svg><h2>钱包里没有可拆分的矿机</h2><p>可以按编号查找，或去交易页买入。</p><a class="text-button" href="#market">去交易页 →</a></div>`;
 return `<div class="empty-state"><h2>连接钱包，读取原矿机</h2><p>连接后自动读取钱包中的原矿机。</p><button class="button primary" data-connect>连接钱包</button></div>`;
}
