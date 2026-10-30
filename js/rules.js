// Scoring and level rules. The game and the global-board server (server/) both import this file,
// so a run is scored the same way on the phone and when the server re-checks it.

// Scoring changes start a new season: boards begin empty (old scores are archived on the device,
// and the global board keeps each season apart). Season 1 started with the first release.
export const SEASON = 1;

export const MODES = {
  arcade:   { max: 10, lives: 3, base: 9, step: 0.7, min: 2.2, perLevel: 8, mul: 1, bpm: 138, fx: 0.6 },
  hardcore: { max: 12, lives: 3, base: 7, step: 0.6, min: 2.2, perLevel: 8, mul: 3, bpm: 150, fx: 0.9 },
  practice: { lives: Infinity, base: 6, mul: 1, bpm: 132, fx: 0.6 },
};
// Arcade difficulty: more thinking time costs points, so all three can share one board. Every
// speed ends at the same 2.2s floor, so no mode lets a strong player survive forever; the
// multipliers come from a balance simulation (advisor repo, research/multihero-sim).
export const DIFFS = {
  easy:   { base: 14, step: 0.8, min: 2.2, mul: 0.35, bpm: 128, fx: 0.4 },
  normal: {},
  hard:   { base: 4.5, step: 0.4, min: 2.2, mul: 3.5, bpm: 146, fx: 0.8 },
};
// The speed bonus is judged against a fixed 6s, not the mode's clock, so a slow clock pays no extra.
export const SPEED_REF = 6;
export const MAX_LIVES = 5;

export const configFor = (mode, diff) => (mode === 'arcade' ? { ...MODES.arcade, ...DIFFS[diff] } : MODES[mode]);
export const multFor = streak => Math.min(8, 1 + Math.floor(streak / 5));
export const timeLimit = (cfg, level) => Math.max(cfg.min, cfg.base - (level - 1) * cfg.step);

// Arcade eases in: the friendly tables first, the 7s and 8s from level 4.
export function focusPool(level) {
  if (level <= 1) return [2, 5, 10];
  if (level === 2) return [2, 3, 4, 5, 10];
  if (level === 3) return [2, 3, 4, 5, 6, 9, 10];
  return null;
}
// Once warmed up (arcade and hardcore), the giveaway facts go: ÷1, ÷10 and answers 1 and 10 from
// level 4, ÷2 and answer 2 from level 6.
export const dropped = level => (level >= 6 ? [1, 2, 10] : level >= 4 ? [1, 10] : []);

export function points(t, streak, level, mul) {
  const frac = Math.min(1, Math.max(0, 1 - t / SPEED_REF));
  return Math.round((100 + 400 * frac) * multFor(streak) * (1 + (level - 1) * 0.25) * mul / 10) * 10;
}
export const accuracyBonus = (score, acc) => Math.round(score * 0.5 * acc * acc / 10) * 10;
// A level every perLevel correct answers; an extra life at levels 4, 7, 10...
export const levelGivesLife = level => (level - 1) % 3 === 0;

// A fact [a, b] is asked as (a × b) ÷ b, so the answer is a.
// Re-plays an arcade or hardcore run from its answer log ([a, b, answer, seconds] per question,
// answer null on a timeout) and returns the score, or { error } if the run could not happen.
export function replay(mode, diff, log) {
  if (mode !== 'arcade' && mode !== 'hardcore') return { error: 'mode' };
  if (mode === 'arcade' && !(diff in DIFFS)) return { error: 'diff' };
  if (!Array.isArray(log) || !log.length || log.length > 5000) return { error: 'log' };
  const cfg = configFor(mode, diff);
  let lives = cfg.lives, level = 1, streak = 0, correct = 0, wrong = 0, score = 0;
  for (const e of log) {
    if (lives <= 0) return { error: 'after game over' };
    if (!Array.isArray(e) || e.length !== 4) return { error: 'entry' };
    const [a, b, ans, t] = e;
    if (![a, b].every(x => Number.isInteger(x) && x >= 1 && x <= cfg.max)) return { error: 'fact' };
    const pool = mode === 'arcade' ? focusPool(level) : null;
    if (pool && !pool.includes(a) && !pool.includes(b)) return { error: 'fact for level' };
    const drop = dropped(level);
    if (drop.includes(a) || drop.includes(b)) return { error: 'fact for level' };
    const limit = timeLimit(cfg, level);
    if (typeof t !== 'number' || !(t >= 0) || t > limit + 0.25) return { error: 'time' };
    if (ans === a) {
      if (t < 0.3) return { error: 'too fast' };
      correct++; streak++;
      score += points(t, streak, level, cfg.mul);
      if (correct % cfg.perLevel === 0) { level++; if (levelGivesLife(level) && lives < MAX_LIVES) lives++; }
    } else {
      if (ans !== null && !Number.isInteger(ans)) return { error: 'answer' };
      wrong++; streak = 0; lives--;
    }
  }
  const acc = correct / (correct + wrong);
  return { score, total: score + accuracyBonus(score, acc), level, acc: Math.round(acc * 100), over: lives <= 0 };
}
