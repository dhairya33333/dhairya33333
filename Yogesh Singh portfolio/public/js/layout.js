// Shared header and footer for the inner pages (About, Contact, Social), so navigation stays identical everywhere.
import { esc, getUser, mountNav } from './common.js';

const LINKS = [['Films', '/films'], ['About', '/about'], ['Social', '/social'], ['Contact', '/contact']];

export async function mountChrome({ active = '', settings = {} } = {}) {
  const here = (href) => (href === active ? ' aria-current="page"' : '');
  document.getElementById('chrome-nav').outerHTML = `
    <header class="nav stuck"><div class="wrap"><a href="/" class="brand"><i></i>Y. P. Singh</a>
      <nav class="nav-links" aria-label="Main">${LINKS.map(([t, h]) => `<a href="${h}"${here(h)}>${t}</a>`).join('')}<span id="nav-auth" style="display:contents"></span></nav>
      <button class="burger" aria-label="Menu" aria-expanded="false"><span></span><span></span></button></div></header>`;
  const socials = [['Instagram', settings.social_instagram], ['YouTube', settings.social_youtube], ['X', settings.social_x], ['Facebook', settings.social_facebook], ['LinkedIn', settings.social_linkedin]].filter(([, u]) => u);
  document.getElementById('chrome-foot').outerHTML = `
    <footer class="slim"><div class="wrap"><div class="foot-row">
      <span>© ${new Date().getFullYear()} ${esc(settings.hero_name || 'Yogesh Pratap Singh')}. All rights reserved.</span>
      <div class="foot-links"><a href="/">Home</a>${LINKS.map(([t, h]) => `<a href="${h}">${t}</a>`).join('')}</div>
      <div class="socials">${socials.map(([n, u]) => `<a href="${esc(u)}" target="_blank" rel="noopener">${n}</a>`).join('')}</div>
    </div></div></footer>`;
  mountNav(await getUser());
}
