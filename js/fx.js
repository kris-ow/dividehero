// Background: synthwave sun + perspective grid whose speed follows the game.
// Foreground: pixel particles and screen flashes on a pointer-transparent canvas.

let bg, b, fx, f, W = 0, H = 0;
let speed = 0.25, target = 0.25, offset = 0, last = 0;
let gridA = [255, 114, 43], gridB = [255, 114, 43];
let flashA = 0, flashC = '255,255,255';
const stars = [], parts = [];

export function init() {
  bg = document.getElementById('bg'); b = bg.getContext('2d');
  fx = document.getElementById('fx'); f = fx.getContext('2d');
  for (let i = 0; i < 110; i++) stars.push({ x: Math.random(), y: Math.random() * 0.95, s: Math.random() < 0.15 ? 2 : 1, tw: 0.5 + Math.random() * 2.5, ph: Math.random() * 6 });
  resize();
  addEventListener('resize', resize);
  requestAnimationFrame(loop);
}

function resize() {
  const dpr = Math.min(2, devicePixelRatio || 1);
  W = innerWidth; H = innerHeight;
  for (const [c, x] of [[bg, b], [fx, f]]) {
    c.width = Math.round(W * dpr); c.height = Math.round(H * dpr);
    x.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
}

export const setSpeed = v => { target = v; };
export function setDanger(on) { gridB = on ? [255, 32, 60] : [255, 114, 43]; }

export function flash(rgb = '255,255,255', a = 0.35) { flashC = rgb; flashA = a; }

export function shake() {
  const app = document.getElementById('app');
  app.classList.remove('shake');
  void app.offsetWidth;
  app.classList.add('shake');
}

export function burst(x, y, color, n = 18, power = 1) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, v = (120 + Math.random() * 320) * power;
    parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 120, g: 700, life: 0.45 + Math.random() * 0.45, t: 0, s: 3 + (Math.random() * 4 | 0), c: color });
  }
}

export function confetti(colors) {
  for (let i = 0; i < 140; i++) {
    parts.push({ x: Math.random() * W, y: -20 - Math.random() * H * 0.5, vx: (Math.random() - 0.5) * 80, vy: 80 + Math.random() * 160, g: 60, life: 3 + Math.random() * 1.5, t: 0, s: 4 + (Math.random() * 4 | 0), c: colors[i % colors.length], wob: Math.random() * 6 });
  }
}

function loop(ts) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.05, (ts - last) / 1000 || 0);
  last = ts;
  speed += (target - speed) * Math.min(1, dt * 1.5);
  offset = (offset + dt * speed) % 1;
  for (let k = 0; k < 3; k++) gridA[k] += (gridB[k] - gridA[k]) * Math.min(1, dt * 3);
  drawBG(ts / 1000);
  drawFX(dt);
}

function drawBG(time) {
  const hz = Math.round(H * 0.56);
  const sky = b.createLinearGradient(0, 0, 0, hz);
  sky.addColorStop(0, '#01090d'); sky.addColorStop(0.65, '#051c32'); sky.addColorStop(1, '#0b255e');
  b.fillStyle = sky; b.fillRect(0, 0, W, hz);

  for (const s of stars) {
    b.globalAlpha = 0.25 + 0.75 * Math.abs(Math.sin(time * s.tw + s.ph));
    b.fillStyle = '#fff';
    b.fillRect(Math.round(s.x * W), Math.round(s.y * hz * 0.8), s.s, s.s);
  }
  b.globalAlpha = 1;

  // sun, cut by stripes that drift downward
  const r = Math.min(W, H) * 0.24, cx = W / 2;
  const sg = b.createLinearGradient(0, hz - r, 0, hz);
  sg.addColorStop(0, '#ffe600'); sg.addColorStop(0.55, '#ff8a00'); sg.addColorStop(1, '#ff722b');
  b.fillStyle = sg;
  b.beginPath(); b.arc(cx, hz, r, Math.PI, 0); b.fill();
  b.fillStyle = '#082148';
  const drift = (time * 6) % (r / 7);
  for (let i = 0; i < 7; i++) {
    const y = hz - r * 0.55 + i * (r / 7) + drift;
    if (y < hz) b.fillRect(cx - r, y, r * 2, Math.max(1, 1 + i * 0.9));
  }

  // floor
  const fl = b.createLinearGradient(0, hz, 0, H);
  fl.addColorStop(0, '#02172a'); fl.addColorStop(1, '#010a0f');
  b.fillStyle = fl; b.fillRect(0, hz, W, H - hz);

  const [cr, cg, cb] = gridA.map(Math.round);
  const lines = (alpha, width) => {
    b.strokeStyle = `rgba(${cr},${cg},${cb},${alpha})`;
    b.lineWidth = width;
    b.beginPath();
    for (let i = 0; i < 16; i++) {
      const z = (i + offset) / 16, y = hz + (H - hz) * Math.pow(z, 2.4);
      b.moveTo(0, y); b.lineTo(W, y);
    }
    for (let k = -14; k <= 14; k++) {
      b.moveTo(cx + k * W * 0.03, hz);
      b.lineTo(cx + k * W * 0.32, H);
    }
    b.stroke();
  };
  lines(0.18, 4);
  lines(0.75, 1.2);

  // horizon glow
  const hg = b.createLinearGradient(0, hz - 14, 0, hz + 14);
  hg.addColorStop(0, 'rgba(255,114,43,0)'); hg.addColorStop(0.5, `rgba(${cr},${cg},${cb},0.8)`); hg.addColorStop(1, 'rgba(255,114,43,0)');
  b.fillStyle = hg; b.fillRect(0, hz - 14, W, 28);
}

function drawFX(dt) {
  f.clearRect(0, 0, W, H);
  if (flashA > 0.005) {
    f.fillStyle = `rgba(${flashC},${flashA})`;
    f.fillRect(0, 0, W, H);
    flashA *= Math.pow(0.004, dt);
  }
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i];
    p.t += dt;
    if (p.t >= p.life || p.y > H + 20) { parts.splice(i, 1); continue; }
    p.vy += p.g * dt;
    p.x += (p.vx + (p.wob ? Math.sin(p.t * 4 + p.wob) * 40 : 0)) * dt;
    p.y += p.vy * dt;
    f.globalAlpha = Math.min(1, (1 - p.t / p.life) * 1.6);
    f.fillStyle = p.c;
    f.fillRect(Math.round(p.x), Math.round(p.y), p.s, p.s);
  }
  f.globalAlpha = 1;
}
