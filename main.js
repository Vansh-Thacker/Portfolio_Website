// Boot, UI and input for the drivable portfolio. The CV lives as plain HTML in
// index.html; each <article> there is also a zone in the 3D world.
import { EngineAudio } from './audio.js';

const $ = (id) => document.getElementById(id);
const root = document.documentElement;
const mobile = matchMedia('(pointer: coarse)').matches || Math.min(innerWidth, innerHeight) < 600;
if (mobile) root.classList.add('touch-ui');

const articles = [...document.querySelectorAll('.classic-main article[id]')];
const zoneData = articles.map((el) => ({ id: el.id, ...el.dataset }));

let world = null;
let running = false;
const audio = new EngineAudio();

// ---------- Classic CV overlay ----------
const classic = $('cv');
function setUrl(url) {
  try {
    history.pushState(null, '', url);
  } catch {}
}
function openClassic(push = true) {
  root.classList.add('classic-open');
  classic.scrollTop = 0;
  classic.focus({ preventScroll: true });
  if (push && location.hash !== '#cv') setUrl('#cv');
  audio.suspend(true);
}
function closeClassic() {
  root.classList.remove('classic-open');
  if (location.hash === '#cv') setUrl(location.pathname + location.search.replace(/[?&]classic\b/, ''));
  if (running) audio.suspend(false);
  if (!world) boot();
}
document.querySelectorAll('[data-open-classic]').forEach((a) =>
  a.addEventListener('click', (e) => {
    e.preventDefault();
    openClassic();
  }),
);
$('classic-drive').addEventListener('click', closeClassic);
window.addEventListener('popstate', () => (location.hash === '#cv' ? openClassic(false) : closeClassic()));

// ---------- Input ----------
const keys = new Set();
const touch = { gas: 0, brake: 0, drift: false, steer: 0 };
const input = { throttle: 0, brake: 0, steer: 0, handbrake: false, locked: true };

const KEYMAP = {
  KeyW: 'up', ArrowUp: 'up', KeyS: 'down', ArrowDown: 'down',
  KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right',
  Space: 'hand', ShiftLeft: 'hand',
};
window.addEventListener('keydown', (e) => {
  if (root.classList.contains('classic-open') || e.metaKey || e.ctrlKey) return;
  const k = KEYMAP[e.code];
  if (k) {
    keys.add(k);
    e.preventDefault();
    hideKeysSoon();
  }
  if (!running) return;
  if (e.code === 'KeyR') world.resetCar();
  if (e.code === 'KeyC') world.toggleCamera();
  if (e.code === 'KeyM') setMuted(!audio.muted);
  if (e.code === 'Escape') closePanel();
});
window.addEventListener('keyup', (e) => keys.delete(KEYMAP[e.code]));
window.addEventListener('blur', () => keys.clear());

function readInput() {
  const kSteer = (keys.has('right') ? 1 : 0) - (keys.has('left') ? 1 : 0);
  input.throttle = keys.has('up') || touch.gas ? 1 : 0;
  input.brake = keys.has('down') || touch.brake ? 1 : 0;
  input.steer = kSteer || touch.steer;
  input.handbrake = keys.has('hand') || touch.drift;
  return input;
}

let keysTimer = 0;
function hideKeysSoon() {
  if (keysTimer) return;
  keysTimer = setTimeout(() => $('keys').classList.add('faded'), 6000);
}

// Touch: a steering slider on the left, pedals on the right
{
  const pad = $('steer');
  const knob = $('steer-knob');
  let id = null;
  let cx = 0;
  const move = (e) => {
    const r = pad.getBoundingClientRect();
    const half = r.width / 2 - 28;
    const dx = Math.max(-half, Math.min(half, e.clientX - cx));
    touch.steer = dx / half;
    knob.style.transform = `translateX(${dx}px)`;
  };
  pad.addEventListener('pointerdown', (e) => {
    id = e.pointerId;
    pad.setPointerCapture(id);
    const r = pad.getBoundingClientRect();
    cx = r.left + r.width / 2;
    move(e);
  });
  pad.addEventListener('pointermove', (e) => e.pointerId === id && move(e));
  const end = (e) => {
    if (e.pointerId !== id) return;
    id = null;
    touch.steer = 0;
    knob.style.transform = '';
  };
  pad.addEventListener('pointerup', end);
  pad.addEventListener('pointercancel', end);

  document.querySelectorAll('.pedal').forEach((btn) => {
    const k = btn.dataset.key;
    const set = (v) => {
      touch[k] = k === 'drift' ? v : v ? 1 : 0;
      btn.classList.toggle('down', v);
    };
    btn.addEventListener('pointerdown', (e) => {
      btn.setPointerCapture(e.pointerId);
      set(true);
    });
    btn.addEventListener('pointerup', () => set(false));
    btn.addEventListener('pointercancel', () => set(false));
    btn.addEventListener('contextmenu', (e) => e.preventDefault());
  });
}

// Drag on the canvas to look around the car
{
  const canvas = $('world');
  let last = null;
  canvas.addEventListener('pointerdown', (e) => {
    last = { x: e.clientX, y: e.clientY, id: e.pointerId };
    canvas.setPointerCapture(e.pointerId);
    world?.setDragging(true);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!last || e.pointerId !== last.id) return;
    world?.orbitBy(-(e.clientX - last.x) * 0.006, (e.clientY - last.y) * 0.004);
    last.x = e.clientX;
    last.y = e.clientY;
  });
  const up = () => {
    last = null;
    world?.setDragging(false);
  };
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);
}

// ---------- Sound ----------
const soundBtn = $('sound-btn');
function setMuted(m) {
  audio.setMuted(m);
  soundBtn.setAttribute('aria-pressed', String(!m));
  try {
    localStorage.setItem('muted', m ? '1' : '');
  } catch {}
}
try {
  audio.muted = !!localStorage.getItem('muted');
} catch {}
soundBtn.setAttribute('aria-pressed', String(!audio.muted));
soundBtn.addEventListener('click', () => {
  audio.start();
  setMuted(!audio.muted);
});

// ---------- Zone panel ----------
const panel = $('zone-panel');
const panelBody = $('zone-body');
let panelZone = null;
let dismissed = null;
function showZone(z) {
  if (!z) {
    dismissed = null;
    closePanel();
    return;
  }
  if (dismissed === z.id) return;
  panelZone = z.id;
  const src = document.getElementById(z.id);
  panelBody.innerHTML = '';
  panelBody.append(...[...src.children].map((n) => n.cloneNode(true)));
  panel.style.setProperty('--zone', z.colour);
  panel.classList.add('open');
  updateFound();
}
function closePanel() {
  if (panelZone) dismissed = panelZone;
  panelZone = null;
  panel.classList.remove('open');
}
$('zone-close').addEventListener('click', closePanel);

function updateFound() {
  if (!world) return;
  const n = world.zones.filter((z) => z.visited).length;
  $('found').textContent = `${n}/${world.zones.length}`;
  if (n === world.zones.length && !updateFound.done) {
    updateFound.done = true;
    toast('Every sector visited. Chequered flag! 🏁');
  }
}

let toastTimer = 0;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 3200);
}

// ---------- Sector menu ----------
const mapBtn = $('map-btn');
const mapMenu = $('map-menu');
function toggleMap(open = mapMenu.hidden) {
  mapMenu.hidden = !open;
  mapBtn.setAttribute('aria-expanded', String(open));
}
mapBtn.addEventListener('click', () => toggleMap());
document.addEventListener('pointerdown', (e) => {
  if (!mapMenu.hidden && !mapMenu.contains(e.target) && !mapBtn.contains(e.target)) toggleMap(false);
});
function buildMapList() {
  const list = $('map-list');
  list.innerHTML = '';
  for (const z of world.zones) {
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.innerHTML = `<i style="background:${z.colour}"></i><span class="mono">${z.num}</span> ${z.title}`;
    b.addEventListener('click', () => {
      world.teleport(z.id);
      dismissed = null;
      toggleMap(false);
    });
    li.append(b);
    list.append(li);
  }
}

// ---------- Minimap ----------
const mini = $('minimap');
const mctx = mini.getContext('2d');
let mapXform = null;
function drawMinimap() {
  const W = mini.width;
  if (!mapXform) {
    let x0 = Infinity;
    let x1 = -Infinity;
    let z0 = Infinity;
    let z1 = -Infinity;
    for (const p of world.track) {
      x0 = Math.min(x0, p.x);
      x1 = Math.max(x1, p.x);
      z0 = Math.min(z0, p.z);
      z1 = Math.max(z1, p.z);
    }
    x1 = Math.max(x1, 60);
    const s = (W - 36) / Math.max(x1 - x0, z1 - z0);
    // North-up with +x to the left, matching the view from the grid
    mapXform = (x, z) => [W / 2 - (x - (x0 + x1) / 2) * s, W / 2 - (z - (z0 + z1) / 2) * s];
  }
  mctx.clearRect(0, 0, W, W);
  mctx.lineJoin = 'round';
  mctx.beginPath();
  world.track.forEach((p, i) => {
    const [x, y] = mapXform(p.x, p.z);
    i ? mctx.lineTo(x, y) : mctx.moveTo(x, y);
  });
  mctx.closePath();
  mctx.strokeStyle = 'rgba(255,255,255,0.18)';
  mctx.lineWidth = 9;
  mctx.stroke();
  mctx.strokeStyle = 'rgba(255,255,255,0.85)';
  mctx.lineWidth = 2.5;
  mctx.stroke();
  for (const z of world.zones) {
    const [x, y] = mapXform(z.x, z.z);
    mctx.beginPath();
    mctx.arc(x, y, z.visited ? 3.5 : 5, 0, Math.PI * 2);
    mctx.fillStyle = z.colour;
    mctx.globalAlpha = z.visited ? 0.55 : 1;
    mctx.fill();
    mctx.globalAlpha = 1;
  }
  const c = world.car;
  const [cx, cy] = mapXform(c.x, c.z);
  mctx.save();
  mctx.translate(cx, cy);
  mctx.rotate(-c.yaw);
  mctx.beginPath();
  mctx.moveTo(0, -8);
  mctx.lineTo(5.5, 6);
  mctx.lineTo(-5.5, 6);
  mctx.closePath();
  mctx.fillStyle = '#e10600';
  mctx.strokeStyle = '#fff';
  mctx.lineWidth = 2;
  mctx.fill();
  mctx.stroke();
  mctx.restore();
}

// ---------- Dash ----------
const speedEl = $('speed');
const gearEl = $('gear');
const revsEl = $('revs');
function updateDash() {
  const c = world.car;
  speedEl.textContent = Math.round(Math.abs(c.speed) * 3.6);
  gearEl.textContent = c.gear === -1 ? 'R' : c.gear === 0 ? 'N' : c.gear;
  revsEl.style.transform = `scaleX(${c.rpm.toFixed(3)})`;
  revsEl.classList.toggle('limit', c.rpm > 0.93);
}

// ---------- Loop ----------
let last = performance.now();
let frame = 0;
function loop(now) {
  const dt = (now - last) / 1000;
  last = now;
  if (!root.classList.contains('classic-open') && !document.hidden) {
    world.step(dt, readInput());
    if (running) {
      updateDash();
      if (frame++ % 2 === 0) drawMinimap();
      audio.update({ rpm: world.car.rpm, throttle: input.locked ? 0 : input.throttle, slip: world.car.slip, running: true });
    }
  }
  requestAnimationFrame(loop);
}

// ---------- Start sequence ----------
const loader = $('loader');
const startBtn = $('start-btn');
const bulbs = [...document.querySelectorAll('#lights span')];

function lightsOut() {
  return new Promise((resolve) => {
    let n = 0;
    const step = setInterval(() => {
      if (n < 5) {
        bulbs[n].classList.add('on');
        world.setStartLights(++n);
      } else {
        clearInterval(step);
        setTimeout(() => {
          bulbs.forEach((b) => b.classList.remove('on'));
          world.setStartLights(0);
          resolve();
        }, 350 + Math.random() * 600);
      }
    }, 450);
  });
}

async function start() {
  startBtn.disabled = true;
  audio.start();
  audio.setMuted(audio.muted);
  root.classList.add('driving');
  world.setIntro(false);
  running = true;
  input.locked = true;
  loader.classList.add('countdown');
  await lightsOut();
  loader.classList.add('gone');
  input.locked = false;
  toast('Lights out! Drive into a glowing zone.');
  try {
    sessionStorage.setItem('raced', '1');
  } catch {}
}
startBtn.addEventListener('click', start);
window.addEventListener('keydown', (e) => {
  if (e.code === 'Enter' && !startBtn.disabled && !running) start();
});

function hasWebGL() {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}

let booting = false;
async function boot() {
  if (booting || root.classList.contains('classic-open')) return;
  booting = true;
  const fill = $('loader-fill');
  const status = $('loader-status');
  if (!hasWebGL()) {
    status.textContent = 'Your browser can’t run the 3D world, so here is the classic CV.';
    setTimeout(() => openClassic(), 1200);
    return;
  }
  try {
    await Promise.race([document.fonts?.ready, new Promise((r) => setTimeout(r, 1500))]);
    const { createWorld } = await import('./world.js');
    world = await createWorld($('world'), {
      zones: zoneData,
      mobile,
      onProgress: (p) => (fill.style.transform = `scaleX(${p})`),
    });
    world.on('zone', showZone);
    world.on('impact', (s) => audio.thud(s));
    window.addEventListener('resize', () => world.resize());
    buildMapList();
    updateFound();
    status.textContent = 'Ready. Press start or hit Enter.';
    startBtn.disabled = false;
    loader.classList.add('ready');
    requestAnimationFrame(loop);
    window.__world = world;
  } catch (err) {
    console.error(err);
    status.textContent = 'The 3D world failed to load, so here is the classic CV.';
    setTimeout(() => openClassic(), 1200);
  }
}

document.addEventListener('visibilitychange', () => {
  if (running) audio.suspend(document.hidden);
});

boot();
