// Global board client, kept from MULTIHERO for a later board. With no API address every global
// feature stays hidden, so the game works the same without a server.
import { SEASON } from './rules.js';

// DIVIDEHERO has no board of its own yet (planned for v2), so this stays empty and the GLOBAL tab is hidden.
const API = '';
export const enabled = () => !!API;

// Resolves to the JSON body, or { error, offline } when the server can't be reached.
async function call(path, body) {
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 8000);
  try {
    const res = await fetch(API + path, body
      ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: ctl.signal }
      : { signal: ctl.signal });
    const data = await res.json().catch(() => ({}));
    return res.ok ? data : { error: data.error || res.status, status: res.status };
  } catch {
    return { error: 'offline', offline: true };
  } finally { clearTimeout(timer); }
}

export const top = mode => call(`/top?mode=${mode}&season=${SEASON}`);
export const submit = run => call('/submit', { season: SEASON, ...run });
export const forget = key => call('/forget', { key });

// Short hash of a player key, the same one the board shows, to spot your own rows.
export async function tagFor(key) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('player:' + key));
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 10);
}
