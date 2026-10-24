import { api, $, loadScript } from './common.js';

/** Shows the "Continue with Google" button when the server has a client id configured. The ID token is verified server-side. */
export async function initGoogle(onCredential) {
  let cfg;
  try { cfg = await api('/auth/config'); } catch { return false; }
  if (!cfg.googleClientId) return false;
  try { await loadScript('https://accounts.google.com/gsi/client'); } catch { return false; }
  window.google.accounts.id.initialize({ client_id: cfg.googleClientId, callback: (r) => onCredential(r.credential), ux_mode: 'popup', auto_select: false });
  window.google.accounts.id.renderButton($('#google-btn'), { theme: 'outline', size: 'large', text: 'continue_with', shape: 'pill', width: 320 });
  $('#google-wrap').hidden = false;
  return true;
}
