# DIVIDEHERO

80s-arcade division game for the kids, the sister of
[MULTIHERO](https://github.com/kris-ow/multihero) and built from its code. Static site: HTML, CSS
and ES modules, no build step, no dependencies, no asset files beyond one pixel font. Music and
sound effects are synthesised with Web Audio.

Every question comes from the times tables: a fact a × b is asked as (a × b) ÷ b, so the answer
is always a whole number from 1 to 10 (1 to 12 in HARDCORE).

## Run

Any static file server works (ES modules will not load from `file://`):

```
python3 -m http.server 8891 --directory /Users/admin/Projects/dividehero
```

## Modes

- **Arcade**: answers and divisors up to 10, 3 lives, a level every 8 correct answers. The time
  limit per question shrinks each level. Levels 1-3 ease in with the 2, 5 and 10 tables before
  bringing in the rest. From level 4 there is no ÷1, no ÷10 and no answer of 1 or 10; from
  level 6 the same goes for 2. Extra life at levels 4, 7, 10 (max 5). Three speeds that share
  one board and are tagged E/N/H on it:

  | Speed  | Start | Floor | Points |
  |--------|-------|-------|--------|
  | Easy   | 14s   | 2.2s  | x0.35  |
  | Normal | 9s    | 2.2s  | x1     |
  | Hard   | 4.5s  | 2.2s  | x3.5   |

  The speed bonus is measured against a fixed 6s in every mode.

- **Hardcore**: up to 12, 7s down to 2.2s, 3x score. Same removals as arcade.
- **Practice**: one table, every fact both ways (for the 7 table, 56 ÷ 7 = 8 and 56 ÷ 8 = 7),
  the square only once (19 facts for tables 1-10, 23 for 11 and 12), shuffled. No lives, no
  timer. A missed fact comes back a few questions later, and the run ends when all of them are
  answered right. Stars count first-try accuracy only: 1 at 70%, 2 at 90%, 3 with no misses.

The answer is judged as soon as it has as many digits as the right answer. There is no OK key.

Scores belong to a season (`SEASON` in js/rules.js). A scoring change bumps it: the boards start
empty and the previous season's scores move to an archive in storage.

## Scoring

Per correct answer: `(100 + 400 x time left fraction) x combo x level factor x mode factor`.
The combo multiplier goes up by 1 every 5 in a row (max x8), and any miss resets it.
At the end, accuracy bonus = `score x 0.5 x accuracy²`.

## Data

Everything is stored per device in `localStorage` under `dividehero.v1`. MULTIHERO is served from
the same origin, so the separate key keeps the two games' players and scores apart. Stored:
players (3-letter initials), score lists for arcade and hardcore, practice bests/stars, and
per-fact learning stats. The stats are kept per fact family (56 ÷ 7 and 56 ÷ 8 count together)
as moving averages of error rate and answer time. Arcade and hardcore pick questions weighted
towards slow or missed facts, and the MY STATS grid shows them: rows are answers, columns are
divisors, each cell is the number divided.

## Files

- `js/main.js`: screens, game loop, input, results
- `js/rules.js`: scoring, levels and the run replay
- `js/global.js`: global board client, switched off (no server yet)
- `js/audio.js`: synth arrangements of three classical themes, sequencer and SFX
- `js/fx.js`: synthwave background, particles, flashes
- `js/storage.js`: localStorage model
