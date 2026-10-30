import { SEASON } from './rules.js';

// Everything lives in one localStorage key, per device. Every access is guarded:
// private windows and blocked storage must still give a playable (if forgetful) game.

const KEY = 'dividehero.v1'; // MULTIHERO shares this origin, so the key keeps the two games apart
const MAX_SCORES = 300;
export { SEASON };

export const COLORS = ['#00f0ff', '#ff2bd6', '#ffe600', '#39ff14', '#ff8a00', '#b48cff'];

const blank = () => ({
  players: [],
  current: null,
  season: SEASON,
  scores: { arcade: [], hardcore: [] },
  archive: {},           // season -> that season's scores (0 = before seasons)
  pending: [],           // global-board runs not sent yet (offline)
  practice: {},          // pid -> { table: { best, stars } }
  facts: {},             // pid -> { "axb": { n, w, e, tm } }
  settings: { music: true, sfx: true },
});

let db = blank();

export function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (raw && typeof raw === 'object') {
      const b = blank();
      db = { ...b, ...raw, scores: { ...b.scores, ...raw.scores }, settings: { ...b.settings, ...raw.settings } };
      if ((raw.season || 0) < SEASON) {
        db.archive = { ...db.archive, [raw.season || 0]: db.scores };
        db.scores = b.scores;
        db.season = SEASON;
        save();
      }
    }
  } catch { db = blank(); }
  return db;
}

export function save() {
  try { localStorage.setItem(KEY, JSON.stringify(db)); } catch { /* storage unavailable */ }
}

export const settings = () => db.settings;
export function setSetting(k, v) { db.settings[k] = v; save(); }

// ---------- players ----------
export const players = () => db.players;
export const currentPlayer = () => db.players.find(p => p.id === db.current) || null;
export const playerById = id => db.players.find(p => p.id === id) || null;

export function addPlayer(name) {
  const existing = db.players.find(p => p.name === name);
  if (existing) { db.current = existing.id; save(); return { player: existing, existed: true }; }
  const used = new Set(db.players.map(p => p.color));
  const color = COLORS.find(c => !used.has(c)) || COLORS[db.players.length % COLORS.length];
  const player = { id: 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name, color };
  db.players.push(player);
  db.current = player.id;
  save();
  return { player, existed: false };
}

export function setCurrent(id) { db.current = id; save(); }

// Global board opt-in: undefined = not asked yet, true/false = the answer. The key identifies the
// profile to the board and is made on joining.
export function setGlobal(id, on) {
  const p = playerById(id);
  if (!p) return;
  p.global = on;
  if (on && !p.gkey) p.gkey = Array.from(crypto.getRandomValues(new Uint8Array(12)), b => b.toString(36).padStart(2, '0')).join('');
  save();
}

export function queueRun(run) { db.pending = [...db.pending, run].slice(-20); save(); }
export function takeRuns() { const runs = db.pending; db.pending = []; save(); return runs; }

export function deletePlayer(id) {
  db.players = db.players.filter(p => p.id !== id);
  for (const m of Object.keys(db.scores)) db.scores[m] = db.scores[m].filter(s => s.pid !== id);
  for (const old of Object.values(db.archive)) for (const m of Object.keys(old)) old[m] = old[m].filter(s => s.pid !== id);
  delete db.practice[id];
  delete db.facts[id];
  if (db.current === id) db.current = db.players[0]?.id || null;
  save();
}

// ---------- scores ----------
const byScore = (a, b) => b.score - a.score || a.date - b.date;

export function top(mode, pid = null, n = 10) {
  const list = db.scores[mode] || [];
  return (pid ? list.filter(s => s.pid === pid) : list).slice().sort(byScore).slice(0, n);
}

export function best(mode, pid) {
  return top(mode, pid, 1)[0]?.score || 0;
}

// Returns where the new score landed, so the results screen can find something to celebrate.
export function recordScore(mode, entry) {
  const prevBest = best(mode, entry.pid);
  const prevGames = db.scores[mode].filter(s => s.pid === entry.pid).length;
  entry.id = Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  entry.date = Date.now();
  const list = db.scores[mode];
  list.push(entry);
  list.sort(byScore);
  // Trim the overall list but never drop anyone's personal top 10.
  if (list.length > MAX_SCORES) {
    const keep = new Set();
    for (const p of new Set(list.map(s => s.pid))) top(mode, p, 10).forEach(s => keep.add(s.id));
    db.scores[mode] = list.filter((s, i) => i < MAX_SCORES || keep.has(s.id));
  }
  save();
  const mine = db.scores[mode].filter(s => s.pid === entry.pid);
  return {
    id: entry.id,
    deviceRank: db.scores[mode].findIndex(s => s.id === entry.id) + 1,
    personalRank: mine.findIndex(s => s.id === entry.id) + 1,
    prevBest,
    firstGame: prevGames === 0,
    isPB: entry.score > prevBest,
  };
}

// ---------- practice ----------
export function practiceRecord(pid, table) {
  return db.practice[pid]?.[table] || { best: 0, stars: 0 };
}

export function recordPractice(pid, table, score, stars) {
  const prev = practiceRecord(pid, table);
  db.practice[pid] ??= {};
  db.practice[pid][table] = { best: Math.max(prev.best, score), stars: Math.max(prev.stars, stars) };
  save();
  return { prevBest: prev.best, prevStars: prev.stars, isPB: score > prev.best, moreStars: stars > prev.stars };
}

// ---------- per-fact learning stats ----------
// e and tm are moving averages, so a fact that used to be hard stops being nagged once it is learnt.
const factKey = (a, b) => (a <= b ? `${a}x${b}` : `${b}x${a}`);

export function factStat(pid, a, b) {
  return db.facts[pid]?.[factKey(a, b)] || null;
}

export function recordFact(pid, a, b, ok, t) {
  db.facts[pid] ??= {};
  const k = factKey(a, b);
  const s = db.facts[pid][k] || { n: 0, w: 0, e: 0.3, tm: 4 };
  s.n++;
  if (!ok) s.w++;
  s.e = s.e * 0.65 + (ok ? 0 : 1) * 0.35;
  if (ok) s.tm = s.tm * 0.6 + Math.min(t, 10) * 0.4;
  db.facts[pid][k] = s;
  // saved at the end of the game, not on every answer
}

export function factWeight(pid, a, b) {
  const s = factStat(pid, a, b);
  if (!s) return 1.6;
  const slow = Math.min(1, Math.max(0, (s.tm - 2) / 4));
  return 0.6 + 4 * s.e + 1.6 * slow;
}

export function factClass(s) {
  if (!s) return '';
  if (s.e >= 0.3) return 'c-bad';
  if (s.tm > 4.5) return 'c-slow';
  if (s.n >= 3 && s.e < 0.12 && s.tm <= 2.6) return 'c-ace';
  return 'c-ok';
}
