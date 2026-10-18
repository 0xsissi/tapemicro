// Reuse the app's branding/navigation markup as well as its CSS, so guide pages
// cannot silently acquire a different header, logo, spacing or type system.
import{socialLinksMarkup}from'../src/social-links.mjs';
export function buildGuide(source,{appHtml,icons,english=false}){
 const headerStart=appHtml.indexOf('<header class="app-header">');
 const controls=appHtml.indexOf('<div class="header-right">',headerStart);
 if(headerStart<0||controls<0)throw Error('App header template is missing');
 let header=appHtml.slice(headerStart,controls)
  .replace(/<span id="network-read-status"[^>]*><\/span>/,'')
  .replace(/href="#(deposit|market|rewards|points)"/g,'href="./index.html#$1"')
  .replace(/ data-nav="[^"]+"/g,'')
  .replace('data-guide-link="./guide.html"','class="active" aria-current="page"')
  .replace('data-i18n-en="Rewards"','');
 if(english){
  header=header.replace('href="./guide.html"','href="./guide-en.html"');
  for(const[from,to]of [['TapeMicro 首页','TapeMicro home'],['主导航','Main navigation'],['>拆分<','>Split<'],['>交易<','>Market<'],['>领取<','>Rewards<'],['>积分<','>Points<'],['>使用指南<','>Guide<']])header=header.replaceAll(from,to);
 }
 const switchTo=english?'./guide.html':'./guide-en.html';
 const switchLabel=english?'Switch to Chinese':'Switch to English';
 const returnLabel=english?'Back to app':'返回应用';
 header+=`<div class="header-right"><a class="language-switch guide-language" href="${switchTo}" lang="${english?'zh-CN':'en'}" hreflang="${english?'zh-CN':'en'}" aria-label="${switchLabel}">${english?'中文':'EN'}</a><a class="button secondary guide-return" href="./index.html#market">${returnLabel}</a></div></header>`;
 const copyright=english?'© 2026 TapeMicro. All rights reserved.':'© 2026 TapeMicro. 保留所有权利。';
 const footer=`<footer class="app-footer"><p>${copyright} <a href="https://tapemicro.top/" target="_blank" rel="noopener noreferrer">${english?'Official website':'官方网站'}：tapemicro.top</a> · <a href="https://github.com/0xsissi/tapemicro" target="_blank" rel="noopener noreferrer">GitHub ↗</a></p>${socialLinksMarkup({english})}<a class="totop" href="#">${english?'Back to top ↑':'回到顶部 ↑'}</a></footer>`;
 return source.replace('<!-- ICONS -->',icons).replace('<!-- GUIDE HEADER -->',header).replace('<!-- GUIDE FOOTER -->',footer);
}
