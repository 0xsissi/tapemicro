// The guide uses the app's font/layout assets, but never connects a wallet.
const language=document.documentElement.lang==='en'?'en':'zh';
try{localStorage.setItem('tapemicro-language',language);}catch{}
const switcher=document.querySelector('.guide-language');
if(switcher){
 const path=switcher.getAttribute('href');
 const update=()=>{switcher.href=path+location.hash;};
 update();window.addEventListener('hashchange',update);
}
const toc=document.getElementById('toc'),links=[...toc.querySelectorAll('a')];
const entries=new Map(links.map(link=>[link.hash.slice(1),link]));
let current;
function activate(id){
 if(current===id||!entries.has(id))return;current=id;
 for(const [key,link]of entries){link.classList.toggle('on',key===id);if(key===id)link.setAttribute('aria-current','location');else link.removeAttribute('aria-current');}
 const link=entries.get(id);
 if(matchMedia('(max-width:960px)').matches)toc.scrollLeft=Math.max(0,link.offsetLeft-toc.clientWidth/2+link.offsetWidth/2);
}
activate(location.hash.slice(1)||'what');
window.addEventListener('hashchange',()=>activate(location.hash.slice(1)));
if('IntersectionObserver'in window){
 const observer=new IntersectionObserver(rows=>{for(const row of rows)if(row.isIntersecting)activate(row.target.id);},{rootMargin:'-15% 0px -70% 0px'});
 for(const id of entries.keys()){const section=document.getElementById(id);if(section)observer.observe(section);}
}
