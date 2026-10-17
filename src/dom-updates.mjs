const markup=new WeakMap();
const writeLocks=new Map();
const rendered=new WeakMap();
export function renderChanged(element,dependencies,render){if(!element)return false;const previous=rendered.get(element);if(previous&&dependencies.length===previous.length&&dependencies.every((value,i)=>value===previous[i]))return false;render();rendered.set(element,dependencies);return true;}
// Compare source markup, rather than translated DOM, so background renders
// preserve focus, selection, scroll position and language bindings.
export function setHTML(element,html){if(!element)return false;html=String(html);if(markup.get(element)===html)return false;markup.set(element,html);element.innerHTML=html;return true;}
export function restoreWriteLocks(){for(const [button,disabled]of writeLocks)button.disabled=disabled;writeLocks.clear();}
export function lockWrites(buttons){for(const button of buttons){if(!writeLocks.has(button))writeLocks.set(button,button.disabled);button.disabled=true;}}
