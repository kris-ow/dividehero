import * as Store from './storage.js';
import * as Audio from './audio.js';
import * as FX from './fx.js';
import * as Global from './global.js';
import { MODES, MAX_LIVES, configFor, multFor, focusPool, dropped, timeLimit as limitFor, points, accuracyBonus, levelGivesLife } from './rules.js';

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const fmt = n => n.toLocaleString('en-US');
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const vibrate = ms => { try { navigator.vibrate?.(ms); } catch { /* unsupported */ } };
const coarse = matchMedia('(pointer: coarse)').matches;

// ---------- pixel sprites ----------
function sprite(rows, color) {
  const w = rows[0].length, h = rows.length;
  let r = '';
  rows.forEach((row, y) => [...row].forEach((c, x) => { if (c === 'X') r += `<rect x="${x}" y="${y}" width="1.02" height="1.02"/>`; }));
  return `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" shape-rendering="crispEdges" fill="${color}">${r}</svg>`)}`;
}
const HEART = sprite(['.XX.XX.', 'XXXXXXX', 'XXXXXXX', '.XXXXX.', '..XXX..', '...X...'], '#ff2050');
const STAR_ON = sprite(['...X...', '..XXX..', 'XXXXXXX', '.XXXXX.', '.XXXXX.', 'XX...XX'], '#ffe600');
const STAR_OFF = sprite(['...X...', '..XXX..', 'XXXXXXX', '.XXXXX.', '.XXXXX.', 'XX...XX'], '#2a465a');
const starsHTML = n => `<span class="stars">${[0, 1, 2].map(i => `<img src="${i < n ? STAR_ON : STAR_OFF}" alt="">`).join('')}</span>`;

// ---------- screens ----------
let screen = 'splash';
function show(id) {
  screen = id;
  $$('.screen').forEach(s => s.classList.toggle('active', s.id === 's-' + id));
  if (!coarse && id !== 'game') {
    const first = document.querySelector(`#s-${id} [data-focus]`) || document.querySelector(`#s-${id} .btn, #s-${id} .tab, #s-${id} .tables button`);
    first?.focus({ preventScroll: true });
  }
  if (id !== 'game') { FX.setSpeed(0.25); FX.setDanger(false); }
}

function refreshMenu() {
  const p = Store.currentPlayer();
  const el = $('#m-player');
  el.textContent = p ? p.name : '---';
  el.style.color = p ? p.color : '';
  for (const m of ['arcade', 'hardcore']) {
    const best = p ? Store.best(m, p.id) : 0;
    $('#m-best-' + m).textContent = best ? 'BEST ' + fmt(best) : '';
  }
  const s = Store.settings();
  $('#t-music').textContent = s.music ? 'MUSIC ON' : 'MUSIC OFF';
  $('#t-music').classList.toggle('on', s.music);
  $('#t-sfx').textContent = s.sfx ? 'SFX ON' : 'SFX OFF';
  $('#t-sfx').classList.toggle('on', s.sfx);
}

function goMenu() {
  refreshMenu();
  Audio.playSong('title');
  show('menu');
}

// ---------- players ----------
let editing = false;
function renderPlayers() {
  const list = $('#player-list');
  list.classList.toggle('editing', editing);
  $('#b-edit').textContent = editing ? 'DONE' : 'EDIT';
  const cur = Store.currentPlayer();
  list.innerHTML = '';
  for (const p of Store.players()) {
    const best = Store.best('arcade', p.id);
    const row = document.createElement('div');
    row.className = 'prow';
    row.innerHTML = `<button class="btn${p === cur ? ' cur' : ''}" style="color:${p.color}">${p.name}<small>${best ? 'BEST ' + fmt(best) : 'NEW'}</small></button><button class="del" aria-label="Delete">X</button>`;
    row.firstChild.onclick = () => { Audio.sfx('select'); Store.setCurrent(p.id); editing = false; goMenu(); };
    row.lastChild.onclick = () => {
      if (confirm(`Delete ${p.name} and all their scores?`)) {
        if (p.gkey) Global.forget(p.gkey); // their rows leave the global board too
        Store.deletePlayer(p.id);
        renderPlayers();
      }
    };
    list.appendChild(row);
  }
  if (!Store.players().length) list.innerHTML = '<p class="hint">NO PLAYERS YET</p>';
}

let initials = '';
function renderInitials() {
  $$('.initials span').forEach((s, i) => { s.textContent = initials[i] || ''; s.classList.toggle('cur', i === initials.length); });
}
function typeLetter(c) {
  if (c === 'DEL') { initials = initials.slice(0, -1); Audio.sfx('back'); }
  else if (initials.length < 3) { initials += c; Audio.sfx('key'); }
  renderInitials();
}
function buildLetters() {
  const box = $('#letters');
  for (const c of [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'DEL']) {
    const k = document.createElement('button');
    k.textContent = c;
    if (c === 'DEL') k.className = 'wide';
    k.addEventListener('pointerdown', e => { e.preventDefault(); press(k); typeLetter(c); });
    box.appendChild(k);
  }
}
function openNew() {
  initials = '';
  renderInitials();
  $('#b-cancelnew').style.visibility = Store.players().length ? 'visible' : 'hidden';
  show('new');
}
function savePlayer() {
  if (!initials) { FX.shake(); Audio.sfx('wrong'); return; }
  const { existed } = Store.addPlayer(initials);
  Audio.sfx(existed ? 'select' : 'level');
  goMenu();
}

// ---------- practice table picker ----------
function renderTables() {
  const box = $('#tables'), p = Store.currentPlayer();
  box.innerHTML = '';
  for (let t = 1; t <= 12; t++) {
    const rec = Store.practiceRecord(p.id, t);
    const b = document.createElement('button');
    if (t > 10) b.className = 'x';
    b.innerHTML = `${t}${starsHTML(rec.stars)}`;
    b.onclick = () => { Audio.sfx('select'); startGame('practice', t); };
    box.appendChild(b);
  }
}

// ---------- game ----------
const DIFF_TAG = { easy: 'E', normal: 'N', hard: 'H' };

let G = null, lastGame = null;

function pickFact() {
  const max = G.cfg.max, pool = G.mode === 'arcade' ? focusPool(G.level) : null;
  const drop = G.mode === 'practice' ? [] : dropped(G.level);
  const cands = [];
  let total = 0;
  for (let a = 1; a <= max; a++) for (let b = a; b <= max; b++) {
    if (pool && !pool.includes(a) && !pool.includes(b)) continue;
    if (drop.includes(a) || drop.includes(b)) continue;
    const key = a + 'x' + b;
    if (G.recent.includes(key)) continue;
    let w = Store.factWeight(G.pid, a, b);
    if (a === 1) w *= 0.1;
    if (G.mode === 'hardcore' && b > 10) w *= 1.5;
    cands.push([a, b, w, key]);
    total += w;
  }
  let r = Math.random() * total, pick = cands[cands.length - 1];
  for (const c of cands) { r -= c[2]; if (r <= 0) { pick = c; break; } }
  G.recent.push(pick[3]);
  if (G.recent.length > 5) G.recent.shift();
  return Math.random() < 0.5 ? [pick[0], pick[1]] : [pick[1], pick[0]];
}

// Every fact of the table once each way round (the square only once), shuffled so a fact and its
// reverse are not back to back.
function buildDeck(table) {
  const top = table > 10 ? 12 : 10, deck = [];
  for (let m = 1; m <= top; m++) { deck.push([table, m]); if (m !== table) deck.push([m, table]); }
  const other = q => q[0] === table ? q[1] : q[0];
  for (let tries = 0; tries < 50; tries++) {
    for (let i = deck.length - 1; i > 0; i--) { const j = Math.random() * (i + 1) | 0; [deck[i], deck[j]] = [deck[j], deck[i]]; }
    if (deck.every((q, i) => !i || other(q) !== other(deck[i - 1]))) break;
  }
  return deck;
}

const timeLimit = () => (G.mode === 'practice' ? G.cfg.base : limitFor(G.cfg, G.level));

function startGame(mode, table = 0, diff = 'normal') {
  const p = Store.currentPlayer();
  if (!p) { openNew(); return; }
  clearTimeout(G?.timer);
  G = {
    mode, table, diff, cfg: configFor(mode, diff), pid: p.id, name: p.name,
    lives: MODES[mode].lives, level: 1, score: 0, streak: 0, bestStreak: 0,
    correct: 0, wrong: 0, times: [], missed: [], recent: [], log: [],
    deck: mode === 'practice' ? buildDeck(table) : null, qi: 0,
    input: '', phase: 'ready', timer: null, token: {},
  };
  G.facts = G.deck ? G.deck.length : 0;
  lastGame = { mode, table, diff };
  $('#keypad').style.visibility = 'visible';
  $('#g-q').textContent = '';
  $('#g-a').innerHTML = '';
  $('#g-pauseov').classList.remove('on');
  $('.timer').classList.toggle('off', mode === 'practice'); // practice is untimed, so no bar
  renderHUD();
  show('game');
  Audio.playSong(mode === 'hardcore' ? 'hardcore' : 'game');
  Audio.setLevel(1, G.cfg.bpm);
  FX.setSpeed(G.cfg.fx);
  countdown(G.token);
}

async function countdown(token) {
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const label = G.mode === 'practice' ? `${G.table} TABLE` : G.mode === 'hardcore' ? 'HARDCORE!' : `${G.diff.toUpperCase()}!`;
  banner(label, G.mode === 'hardcore' || G.diff === 'hard' ? 'red' : G.diff === 'easy' ? 'lime' : 'mag', 900);
  Audio.sfx('count');
  await wait(900);
  if (G?.token !== token) return;
  banner('GO!', 'lime', 600);
  Audio.sfx('go');
  await wait(250);
  if (G?.token !== token) return;
  nextQuestion();
}

function nextQuestion() {
  clearTimeout(G.timer);
  if (G.mode === 'practice' && G.qi >= G.deck.length) { finish(); return; }
  const [a, b] = G.mode === 'practice' ? G.deck[G.qi++] : pickFact();
  // Asked as dividend ÷ divisor; the fact stats stay keyed on the factor pair.
  G.q = { a, b, ans: a };
  G.input = '';
  G.limit = timeLimit();
  G.qStart = performance.now();
  G.lastTick = 0;
  G.phase = 'ask';
  const q = $('#g-q');
  q.className = 'question';
  q.textContent = `${a * b} ÷ ${b}`;
  void q.offsetWidth;
  q.classList.add('pop');
  $('#g-a').className = 'answer';
  renderAnswer();
}

function renderAnswer() {
  const box = $('#g-a');
  // One fixed-width field: it must not hint how many digits the answer has.
  box.innerHTML = `<span class="field">${G.input}<i class="caret"></i></span>`;
}

function digit(d) {
  if (!G || screen !== 'game') return;
  if (G.phase === 'feedback' && performance.now() >= G.skipAfter && G.lives > 0) nextQuestion();
  if (G.phase !== 'ask') return;
  G.input += d;
  Audio.sfx('key');
  renderAnswer();
  // Judged as soon as enough digits are in: right is instant, and so is wrong.
  if (G.input.length === String(G.q.ans).length) submit(false);
}

function backspace() {
  if (!G || G.phase !== 'ask' || !G.input) return;
  G.input = G.input.slice(0, -1);
  Audio.sfx('back');
  renderAnswer();
}

function submit(timedOut) {
  // Whole milliseconds, so the global board's re-check of the log scores exactly the same.
  const t = Math.round(performance.now() - G.qStart) / 1000;
  const ok = !timedOut && Number(G.input) === G.q.ans;
  if (G.mode !== 'practice') G.log.push([G.q.a, G.q.b, timedOut ? null : Number(G.input), t]);
  Store.recordFact(G.pid, G.q.a, G.q.b, ok, t);
  if (ok) onCorrect(t); else onWrong(timedOut);
}

function answerCenter() {
  const r = $('#g-a').getBoundingClientRect();
  return [r.left + r.width / 2, r.top + r.height / 2];
}

function float(text, color, big = false) {
  const el = document.createElement('div');
  el.className = 'float' + (big ? ' big' : '');
  el.textContent = text;
  el.style.color = color;
  el.style.textShadow = `0 0 10px ${color}`;
  el.addEventListener('animationend', () => el.remove());
  $('#g-float').appendChild(el);
}

let bannerTimer = 0;
function banner(text, color = '', ms = 1000, hold = false) {
  const el = $('#g-banner');
  clearTimeout(bannerTimer);
  el.className = 'banner';
  el.textContent = text;
  void el.offsetWidth;
  el.className = `banner ${hold ? 'hold' : 'show'} ${color}`;
  el.style.animationDuration = ms + 'ms';
  if (!hold) bannerTimer = setTimeout(() => { el.className = 'banner'; }, ms);
}

const COMBO_COLORS = ['#7aa3b8', '#00f0ff', '#39ff14', '#ffe600', '#ff8a00', '#ff722b'];

function onCorrect(t) {
  G.correct++;
  G.streak++;
  G.bestStreak = Math.max(G.bestStreak, G.streak);
  G.times.push(t);
  const mult = multFor(G.streak), prevMult = multFor(G.streak - 1);
  const pts = points(t, G.streak, G.level, G.cfg.mul);
  G.score += pts;
  G.phase = 'feedback';
  G.skipAfter = 0;

  $('#g-a').classList.add('ok');
  const col = COMBO_COLORS[Math.min(mult, 6) - 1];
  float('+' + fmt(pts), '#ffe600', mult >= 3);
  if (t < 1.2) setTimeout(() => float('LIGHTNING!', '#00f0ff'), 90);
  else if (t < G.limit * 0.3) setTimeout(() => float('FAST!', '#39ff14'), 90);
  const [x, y] = answerCenter();
  FX.burst(x, y, col, 12 + mult * 4, 0.8 + mult * 0.1);
  FX.flash('57,255,20', 0.08);
  Audio.sfx('correct', G.streak);
  vibrate(8);
  if (mult > prevMult) { banner(`COMBO x${mult}`, 'mag', 800); Audio.sfx('combo'); }

  if (G.mode !== 'practice' && G.correct % G.cfg.perLevel === 0) levelUp();
  renderHUD(true);
  // Practice ends once every fact has been answered right.
  G.timer = setTimeout(G.mode === 'practice' && G.correct >= G.facts ? finish : nextQuestion, 280);
}

function onWrong(timedOut) {
  G.wrong++;
  G.streak = 0;
  G.missed.push([G.q.a, G.q.b]);
  G.phase = 'feedback';
  G.skipAfter = performance.now() + 500;
  if (G.mode !== 'practice') G.lives--;
  // Missed facts come back a few questions later in practice, until they are answered right.
  else G.deck.splice(Math.min(G.qi + 3, G.deck.length), 0, [G.q.a, G.q.b]);

  const q = $('#g-q');
  q.classList.add('reveal');
  q.textContent = `${G.q.a * G.q.b} ÷ ${G.q.b} = ${G.q.ans}`;
  if (timedOut) { G.input = ''; renderAnswer(); }
  $('#g-a').classList.add('bad');
  float(timedOut ? 'TIME!' : 'OOPS!', '#ff2050', true);
  FX.shake();
  FX.flash('255,32,80', 0.32);
  Audio.sfx('wrong');
  vibrate([60, 40, 90]);
  renderHUD();
  if (G.lives <= 0) G.timer = setTimeout(gameOver, 1300);
  else G.timer = setTimeout(nextQuestion, 1400);
}

function levelUp() {
  G.level++;
  banner(`LEVEL ${G.level}`, '', 1100);
  Audio.sfx('level');
  Audio.setLevel(G.level, G.cfg.bpm);
  FX.setSpeed(G.cfg.fx + (G.level - 1) * 0.3);
  if (levelGivesLife(G.level) && G.lives < MAX_LIVES) {
    G.lives++;
    G.gained = true;
    setTimeout(() => { float('1UP!', '#ff2050', true); Audio.sfx('oneup'); }, 450);
  }
}

function renderHUD(bump = false) {
  const sc = $('#g-score');
  sc.textContent = fmt(G.score);
  if (bump) { sc.classList.remove('bump'); void sc.offsetWidth; sc.classList.add('bump'); }

  const lives = $('#g-lives');
  if (G.mode === 'practice') {
    lives.innerHTML = `<span class="lbl">${G.correct}/${G.facts}</span>`;
    $('#g-level').textContent = `${G.table} TABLE`;
  } else {
    const slots = Math.max(G.cfg.lives, G.lives);
    lives.innerHTML = Array.from({ length: slots }, (_, i) => `<img src="${HEART}" class="${i < G.lives ? '' : 'lost'}${G.gained && i === G.lives - 1 ? ' gain' : ''}" alt="">`).join('');
    G.gained = false;
    $('#g-level').textContent = `LEVEL ${G.level}`;
    FX.setDanger(G.lives === 1);
  }

  const mult = multFor(G.streak), combo = $('#g-combo');
  combo.textContent = `x${mult}`;
  combo.className = 'combo' + (mult > 1 ? ' c' + Math.min(mult, 6) : '');
  $('#g-streak').textContent = G.streak >= 2 ? `STREAK ${G.streak}` : '';
}

// Timer bar and timeouts run off one rAF loop.
function tick() {
  requestAnimationFrame(tick);
  if (!G || G.phase !== 'ask') return;
  const el = (performance.now() - G.qStart) / 1000;
  const frac = clamp(1 - el / G.limit, 0, 1);
  const bar = $('#g-timer');
  bar.style.transform = `scaleX(${frac})`;
  bar.style.setProperty('--tc', frac > 0.5 ? '#39ff14' : frac > 0.25 ? '#ffe600' : '#ff2050');
  if (G.mode === 'practice') return;
  const left = G.limit - el;
  $('.timer').classList.toggle('danger', left < 1.5);
  if (left < 1.5 && el - G.lastTick > 0.25) { G.lastTick = el; Audio.sfx('tick'); }
  if (left <= 0) { $('.timer').classList.remove('danger'); submit(true); }
}

function pause() {
  if (!G || screen !== 'game' || G.phase === 'over' || G.phase === 'ready' || G.phase === 'paused') return;
  G.prePhase = G.phase;
  G.pausedAt = performance.now();
  G.phase = 'paused';
  clearTimeout(G.timer);
  $('#g-pauseov').classList.add('on');
  Audio.suspend();
}

function resume() {
  if (!G || G.phase !== 'paused') return;
  Audio.resume();
  $('#g-pauseov').classList.remove('on');
  if (G.prePhase === 'ask') {
    G.qStart += performance.now() - G.pausedAt;
    G.phase = 'ask';
  } else if (G.lives <= 0) gameOver();
  else nextQuestion();
}

function quit() {
  if (!G) return;
  clearTimeout(G.timer);
  G.token = null;
  G.phase = 'over';
  Audio.resume();
  $('#g-pauseov').classList.remove('on');
  goMenu();
}

function gameOver() {
  G.phase = 'over';
  $('#keypad').style.visibility = 'hidden';
  $('.timer').classList.add('off');
  Audio.playSong(null);
  Audio.sfx('gameover');
  FX.setSpeed(0.05);
  banner('GAME OVER', 'red', 1800, true);
  const token = G.token;
  G.timer = setTimeout(() => { if (G.token === token) results(); }, 2000);
}

function finish() {
  G.phase = 'over';
  $('#keypad').style.visibility = 'hidden';
  $('.timer').classList.add('off');
  Audio.playSong(null);
  Audio.sfx('finish');
  banner('FINISH!', 'lime', 1200, true);
  const token = G.token;
  G.timer = setTimeout(() => { if (G.token === token) results(); }, 1300);
}

// ---------- results ----------
// Practice stars count first-try accuracy only, so being slow never costs a star.
function practiceStars(acc) {
  if (acc >= 1) return 3;
  if (acc >= 0.9) return 2;
  if (acc >= 0.7) return 1;
  return 0;
}

async function results() {
  const g = G;
  const token = g.token;
  const answered = g.correct + g.wrong;
  // Practice: the share of facts right first time (every fact is answered right in the end).
  const firstTry = g.mode === 'practice' ? g.facts - new Set(g.missed.map(q => q.join('x'))).size : 0;
  const acc = g.mode === 'practice' ? firstTry / g.facts : answered ? g.correct / answered : 0;
  const bonus = accuracyBonus(g.score, acc);
  const total = g.score + bonus;
  const avg = g.times.length ? g.times.reduce((a, b) => a + b, 0) / g.times.length : 0;
  const fastest = g.times.length ? Math.min(...g.times) : 0;
  Store.save(); // persists the per-fact stats gathered during play

  let rec, stars = 0;
  if (g.mode === 'practice') {
    stars = practiceStars(acc);
    rec = Store.recordPractice(g.pid, g.table, total, stars);
  } else {
    rec = Store.recordScore(g.mode, { pid: g.pid, name: g.name, score: total, level: g.level, acc: Math.round(acc * 100), ...(g.mode === 'arcade' && { diff: g.diff }) });
  }
  lastGame.entryId = rec.id;

  $('#r-title').textContent = g.mode === 'practice' ? `${g.table} TABLE` : g.mode === 'hardcore' ? 'HARDCORE RESULTS' : `${g.diff.toUpperCase()} RESULTS`;
  const lines = $('#r-lines'), totalEl = $('#r-total'), badges = $('#r-badges'), missed = $('#r-missed');
  lines.innerHTML = ''; totalEl.textContent = ''; badges.innerHTML = ''; missed.innerHTML = '';
  $('#r-buttons').classList.remove('on');
  show('results');

  const wait = ms => new Promise(r => setTimeout(r, ms));
  const alive = () => G === g && G.token === token && screen === 'results';
  const rows = [
    g.mode === 'practice' ? ['FIRST TRY', `${firstTry}/${g.facts}`] : ['CORRECT', `${g.correct}/${answered}`],
    ['ACCURACY', `${Math.round(acc * 100)}%`],
    ['BEST STREAK', g.bestStreak],
    ['AVG TIME', avg ? avg.toFixed(1) + 's' : '-'],
    ['FASTEST', fastest ? fastest.toFixed(2) + 's' : '-'],
  ];
  if (g.mode !== 'practice') rows.push(['LEVEL', g.level]);
  rows.push(['SCORE', fmt(g.score)], ['ACCURACY BONUS', '+' + fmt(bonus)]);

  await wait(300);
  for (const [k, v] of rows) {
    if (!alive()) return;
    const d = document.createElement('div');
    if (k === 'ACCURACY BONUS') d.className = 'bonus';
    d.innerHTML = `<span>${k}</span><span>${v}</span>`;
    lines.appendChild(d);
    Audio.sfx('thud');
    await wait(170);
  }

  // count the total up
  const steps = 24;
  for (let i = 1; i <= steps; i++) {
    if (!alive()) return;
    totalEl.textContent = fmt(Math.round(total * i / steps / 10) * 10);
    Audio.sfx('tally', i);
    await wait(28);
  }
  totalEl.textContent = fmt(total);
  await wait(250);
  if (!alive()) return;

  // Always find something worth celebrating.
  const add = (text, cls) => { const b = document.createElement('div'); b.className = 'badge ' + cls; b.innerHTML = text; badges.appendChild(b); };
  if (g.mode === 'practice') {
    add(starsHTML(stars), '');
    for (let i = 0; i < stars; i++) setTimeout(() => Audio.sfx('star', i), i * 160);
    if (rec.isPB && rec.prevBest) add('NEW PERSONAL BEST!', 'pb');
    else if (rec.moreStars && rec.prevStars) add('NEW STAR RECORD!', 'pb');
    else if (!rec.prevBest) add('FIRST RUN DONE!', 'gold');
    else add(`YOUR BEST: ${fmt(rec.prevBest)}`, 'dim');
    if (stars < 3) add(stars < 2 ? 'GET 90% FOR 2 STARS' : 'NO MISSES FOR 3 STARS', 'dim');
    if (stars === 3 || (rec.isPB && rec.prevBest)) celebrate();
  } else {
    if (rec.isPB && !rec.firstGame) { add('NEW PERSONAL BEST!', 'pb'); celebrate(); }
    else if (rec.firstGame) add('FIRST SCORE ON THE BOARD!', 'gold');
    else if (rec.personalRank <= 10) add(`#${rec.personalRank} IN YOUR TOP 10`, 'gold');
    else add(`YOUR BEST: ${fmt(rec.prevBest)}. KEEP GOING!`, 'dim');
    if (rec.deviceRank === 1 && Store.top(g.mode).length > 1) add('DEVICE CHAMPION!', 'cyan');
    else if (rec.deviceRank <= 10) add(`#${rec.deviceRank} ON THE BIG BOARD`, 'cyan');
    globalRun(g, rec, (text, cls) => alive() && add(text, cls));
  }

  const seen = new Set(), list = [];
  for (const [a, b] of g.missed) {
    // 56 ÷ 7 and 56 ÷ 8 are different questions, so only exact repeats are merged.
    const k = a + 'x' + b;
    if (!seen.has(k)) { seen.add(k); list.push(`<b>${a * b}&nbsp;÷&nbsp;${b}&nbsp;=&nbsp;${a}</b>`); }
  }
  if (list.length) missed.innerHTML = 'PRACTISE THESE:<br>' + list.slice(0, 6).join('&nbsp;&nbsp; ');

  await wait(200);
  if (!alive()) return;
  $('#r-buttons').classList.add('on');
  if (!coarse) $('#r-buttons .btn').focus({ preventScroll: true });
  Audio.playSong('title');
}

// ---------- global board ----------
// Sends the run if this profile joined; on its first personal best, offers to join.
function globalRun(g, rec, add) {
  const p = Store.playerById(g.pid);
  if (!Global.enabled() || !p) return;
  const run = { mode: g.mode, diff: g.mode === 'arcade' ? g.diff : null, name: p.name, key: p.gkey, log: g.log };
  if (p.global) sendRun(run, add);
  else if (p.global === undefined && rec.isPB) askJoin(p, run, add);
}

async function sendRun(run, add) {
  const r = await Global.submit(run);
  if (r.offline) { Store.queueRun(run); return; } // retried on the next launch
  if (!r.error && add && r.best === r.score) add(`#${r.rank} IN THE WORLD!`, 'gold');
}

function askJoin(p, run, add) {
  const box = document.createElement('div');
  box.className = 'badge join';
  box.innerHTML = `JOIN THE GLOBAL BOARD AS <b style="color:${p.color}">${p.name}</b>?
    <div class="row"><button class="btn small go">YES</button><button class="btn small">NO</button></div>
    <small>ONLY YOUR INITIALS AND SCORES ARE SHARED</small>`;
  const [yes, no] = box.querySelectorAll('button');
  yes.onclick = () => {
    Store.setGlobal(p.id, true);
    Audio.sfx('select');
    box.remove();
    sendRun({ ...run, key: p.gkey }, add);
  };
  no.onclick = () => {
    Store.setGlobal(p.id, false);
    Audio.sfx('back');
    box.className = 'badge dim';
    box.textContent = 'OK. YOUR SCORES STAY ON THIS DEVICE';
  };
  $('#r-badges').appendChild(box);
}

function celebrate() {
  Audio.sfx('best');
  FX.confetti(['#00f0ff', '#ff722b', '#ffe600', '#39ff14', '#ff8a00']);
  vibrate([30, 30, 30, 30, 80]);
}

// ---------- high scores ----------
let scMode = 'arcade', scScope = 'me';
const dayMonth = ts => { const d = new Date(ts); return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`; };

function renderScores() {
  $$('#sc-mode .tab').forEach(t => t.classList.toggle('on', t.dataset.mode === scMode));
  $$('#sc-scope .tab').forEach(t => t.classList.toggle('on', t.dataset.scope === scScope));
  if (scScope === 'global') { renderGlobal(); return; }
  const p = Store.currentPlayer();
  const list = Store.top(scMode, scScope === 'me' ? p?.id : null, 10);
  const ol = $('#score-list');
  if (!list.length) { ol.innerHTML = '<li class="empty">NO SCORES YET<br>GO PLAY!</li>'; return; }
  ol.innerHTML = list.map((s, i) => {
    const pl = Store.playerById(s.pid);
    return `<li class="${s.id === lastGame?.entryId ? 'fresh' : ''}"><span class="rk">${i + 1}.</span><span style="color:${pl?.color || '#7aa3b8'}">${s.name}</span><span class="sc">${fmt(s.score)}</span><span class="mt">${s.diff ? DIFF_TAG[s.diff] + ' ' : ''}L${s.level} ${s.acc}%<br>${dayMonth(s.date)}</span></li>`;
  }).join('');
}

let globalReq = 0;
async function renderGlobal() {
  const ol = $('#score-list'), p = Store.currentPlayer(), req = ++globalReq;
  ol.innerHTML = '<li class="empty">LOADING...</li>';
  const [r, mine] = await Promise.all([Global.top(scMode), p?.gkey ? Global.tagFor(p.gkey) : null]);
  if (req !== globalReq || scScope !== 'global' || screen !== 'scores') return;
  if (r.error) { ol.innerHTML = `<li class="empty">${r.offline ? "CAN'T REACH THE<br>GLOBAL BOARD" : 'GLOBAL BOARD ERROR'}</li>`; return; }
  let html = r.rows.map((s, i) => `<li class="${s.tag === mine ? 'fresh' : ''}"><span class="rk">${i + 1}.</span><span style="color:${s.tag === mine ? p.color : '#7aa3b8'}">${s.name}</span><span class="sc">${fmt(s.score)}</span><span class="mt">${s.diff ? DIFF_TAG[s.diff] + ' ' : ''}L${s.level} ${s.acc}%<br>${dayMonth(s.created)}</span></li>`).join('')
    || '<li class="empty">NO SCORES YET<br>BE THE FIRST!</li>';
  if (p && !p.global) html += `<li class="empty"><button class="btn small go" id="sc-join">JOIN AS ${p.name}</button></li>`;
  else if (p && !r.rows.some(s => s.tag === mine)) html += '<li class="empty">YOUR NEXT GAME COUNTS!</li>';
  ol.innerHTML = html;
  $('#sc-join')?.addEventListener('click', () => { Store.setGlobal(p.id, true); Audio.sfx('select'); renderGlobal(); });
}

// ---------- stats ----------
let statSize = 10;
function renderStats() {
  const p = Store.currentPlayer();
  $('#st-title').textContent = `${p.name}'S STATS`;
  $('#st-size').textContent = statSize === 10 ? '12×12' : '10×10';
  const grid = $('#st-grid');
  grid.style.gridTemplateColumns = `repeat(${statSize + 1}, 1fr)`;
  let html = '<div class="h">÷</div>';
  for (let b = 1; b <= statSize; b++) html += `<div class="h">${b}</div>`;
  let aced = 0, seen = 0, tricky = [];
  for (let a = 1; a <= statSize; a++) {
    html += `<div class="h">${a}</div>`;
    for (let b = 1; b <= statSize; b++) {
      const s = Store.factStat(p.id, a, b), c = Store.factClass(s);
      html += `<div class="${c}">${a * b}</div>`;
      if (a <= b && s) { seen++; if (c === 'c-ace') aced++; if (c === 'c-bad') tricky.push(`${a * b}÷${b}`); }
    }
  }
  grid.innerHTML = html;
  const total = statSize * (statSize + 1) / 2;
  $('#st-summary').innerHTML = `ACED ${aced} OF ${total} FACTS` + (seen ? '' : '<br>PLAY A GAME TO FILL THIS IN') +
    (tricky.length ? `<br>TRICKY: ${tricky.slice(0, 6).join(' ')}` : '');
}

// ---------- input wiring ----------
function press(el) {
  el.classList.add('pressed');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('pressed'), 90);
}

function buildKeypad() {
  const pad = $('#keypad');
  for (const k of ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', 'DEL']) {
    const b = document.createElement('button');
    b.className = 'key' + (k === '0' ? ' zero' : '') + (k === 'DEL' ? ' del' : '');
    b.textContent = k;
    b.dataset.key = k;
    // pointerdown, not click: fires on touch contact, which is what makes it feel instant
    b.addEventListener('pointerdown', e => {
      e.preventDefault();
      press(b);
      if (k === 'DEL') backspace(); else digit(k);
    });
    pad.appendChild(b);
  }
}

const actions = {
  players: () => { editing = false; renderPlayers(); show('players'); },
  newplayer: openNew,
  editplayers: () => { editing = !editing; renderPlayers(); },
  cancelnew: () => { renderPlayers(); show('players'); },
  saveplayer: savePlayer,
  menu: goMenu,
  arcade: () => {
    if (!Store.currentPlayer()) return openNew();
    show('arcade');
    if (!coarse) $(`#s-arcade [data-diff="${Store.settings().diff || 'normal'}"]`).focus({ preventScroll: true });
  },
  hardcore: () => startGame('hardcore'),
  practice: () => { if (!Store.currentPlayer()) return openNew(); renderTables(); show('practice'); },
  scores: () => { scScope = 'me'; renderScores(); show('scores'); },
  stats: () => { if (!Store.currentPlayer()) return openNew(); renderStats(); show('stats'); },
  statsize: () => { statSize = statSize === 10 ? 12 : 10; renderStats(); },
  music: () => { const v = !Store.settings().music; Store.setSetting('music', v); Audio.setMusic(v); refreshMenu(); },
  sfx: () => { const v = !Store.settings().sfx; Store.setSetting('sfx', v); Audio.setSfx(v); refreshMenu(); },
  pause, resume, quit,
  again: () => startGame(lastGame.mode, lastGame.table, lastGame.diff),
};
const QUIET = new Set(['pause', 'resume', 'quit', 'menu', 'cancelnew', 'saveplayer']);

let ignoreClicksUntil = 0;
document.addEventListener('click', e => {
  if (performance.now() < ignoreClicksUntil) return;
  const el = e.target.closest('[data-act]');
  if (el && actions[el.dataset.act]) {
    if (!QUIET.has(el.dataset.act)) Audio.sfx('select');
    else if (el.dataset.act !== 'saveplayer') Audio.sfx('back');
    actions[el.dataset.act]();
    return;
  }
  const dif = e.target.closest('[data-diff]');
  if (dif) {
    Audio.sfx('select');
    Store.setSetting('diff', dif.dataset.diff);
    startGame('arcade', 0, dif.dataset.diff);
    return;
  }
  const tab = e.target.closest('.tab');
  if (tab) {
    Audio.sfx('select');
    if (tab.dataset.mode) scMode = tab.dataset.mode;
    if (tab.dataset.scope) scScope = tab.dataset.scope;
    renderScores();
  }
});

function startFromSplash() {
  if (screen !== 'splash') return;
  ignoreClicksUntil = performance.now() + 500; // the release of this tap must not hit a menu button
  Audio.unlock();
  Audio.sfx('go');
  if (Store.players().length) goMenu();
  else { Audio.playSong('title'); openNew(); }
}
$('#s-splash').addEventListener('pointerdown', startFromSplash);

document.addEventListener('keydown', e => {
  if (e.repeat && screen !== 'game') return;
  const k = e.key;
  if (screen === 'splash') { startFromSplash(); return; }
  if (screen === 'game') {
    if (/^[0-9]$/.test(k)) {
      digit(k);
      const b = document.querySelector(`.key[data-key="${k}"]`); if (b) press(b);
    } else if (k === 'Backspace') { backspace(); e.preventDefault(); }
    else if (k === 'Escape' || k === 'p' || k === 'P') { G?.phase === 'paused' ? resume() : pause(); }
    else if (k === 'Enter' && G?.phase === 'paused') resume();
    return;
  }
  if (screen === 'new') {
    if (/^[a-z]$/i.test(k)) typeLetter(k.toUpperCase());
    else if (k === 'Backspace') { typeLetter('DEL'); e.preventDefault(); }
    else if (k === 'Enter') savePlayer();
    else if (k === 'Escape' && Store.players().length) actions.cancelnew();
    return;
  }
  if (k === 'Escape' && screen !== 'menu') { Audio.sfx('back'); goMenu(); return; }
  // arrow keys move focus through the buttons of the current screen
  if (k === 'ArrowDown' || k === 'ArrowUp' || k === 'ArrowLeft' || k === 'ArrowRight') {
    const btns = [...document.querySelectorAll(`#s-${screen} button`)].filter(b => b.offsetParent && getComputedStyle(b).visibility !== 'hidden');
    if (!btns.length) return;
    const i = btns.indexOf(document.activeElement);
    const dir = k === 'ArrowDown' || k === 'ArrowRight' ? 1 : -1;
    btns[(i + dir + btns.length) % btns.length].focus();
    Audio.sfx('key');
    e.preventDefault();
  }
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden) { pause(); Audio.suspend(); }
  else if (screen !== 'game' || G?.phase !== 'paused') Audio.resume();
});
// iOS can drop the audio context after interruptions; any touch revives it
document.addEventListener('pointerdown', () => { if (screen !== 'splash' && G?.phase !== 'paused') Audio.resume(); }, { capture: true });
// iOS only fully unlocks audio on touchend/click, so unlock on those too
for (const ev of ['touchend', 'click']) document.addEventListener(ev, () => { if (screen !== 'splash') Audio.unlock(); }, { capture: true, passive: true });
document.addEventListener('contextmenu', e => e.preventDefault());

// ---------- boot ----------
Store.load();
if (Global.enabled()) for (const run of Store.takeRuns()) sendRun(run);
else $('#sc-scope [data-scope=global]').remove();
$('#sc-season').textContent = `SEASON ${Store.SEASON}`;
Audio.setMusic(Store.settings().music);
Audio.setSfx(Store.settings().sfx);
FX.init();
buildKeypad();
buildLetters();
refreshMenu();
requestAnimationFrame(tick);
