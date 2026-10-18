import{setHTML}from'./dom-updates.mjs';import{localizeTree}from'./i18n.mjs';
import{socialLinksMarkup}from'./social-links.mjs';
export function trustMarkup(config,{demo=false}={}){
 if(demo||config.local)return'<p>© 2026 TapeMicro. 保留所有权利。</p>'+socialLinksMarkup();
 return'<p>© 2026 TapeMicro. 保留所有权利。 <a href="https://tapemicro.top/" rel="noopener">官方网站：tapemicro.top</a> · <a href="https://github.com/0xsissi/tapemicro" target="_blank" rel="noopener">GitHub ↗</a></p>'+socialLinksMarkup();
}
export function renderTrust(config,options){const host=globalThis.document?.getElementById('trust-info');setHTML(host,trustMarkup(config,options));localizeTree(host);}
