export const COMMUNITY_LINKS=Object.freeze({x:'https://x.com/luoluo3311',telegram:'https://t.me/+rQM0AKp729E2ZWZl'});
export function socialLinksMarkup({english=false}={}){
 return`<nav class="footer-socials" aria-label="${english?'Community links':'社区链接'}"><a href="${COMMUNITY_LINKS.x}" target="_blank" rel="noopener noreferrer">X @luoluo3311 ↗</a><a href="${COMMUNITY_LINKS.telegram}" target="_blank" rel="noopener noreferrer">${english?'Telegram group ↗':'Telegram 群组 ↗'}</a></nav>`;
}
