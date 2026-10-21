const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const canvas = document.getElementById('scene');

// --- 1. 3D scene (falls back to the Ferrari video if WebGL is unavailable) ---
let scene = null;

function hasWebGL() {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}

const stopSections = [...document.querySelectorAll('main .stop')];
const stops = stopSections.map((el) => {
  const d = el.dataset;
  return {
    u: Number(d.u),
    cam: Number(d.cam || 1),
    frame: Number(d.frame || 0),
    aerial: Number(d.aerial || 0),
    num: d.num,
    title: d.title,
    sub: d.sub || '',
    kind: d.kind,
    pit: d.kind === 'pit' ? 1 : 0,
    flag: d.flag,
    date: d.date || '',
  };
});

async function initScene() {
  if (!hasWebGL()) throw new Error('WebGL unavailable');
  // Board text uses the web fonts, so wait for them before drawing
  await Promise.race([document.fonts?.ready, new Promise((r) => setTimeout(r, 1500))]);
  const { createScene } = await import('./scene.js');
  scene = createScene(canvas, { stops, reducedMotion });
}

function useFallback() {
  document.documentElement.classList.add('no-webgl');
  const video = document.createElement('video');
  Object.assign(video, { src: 'ferrari.mp4', autoplay: true, muted: true, loop: true, playsInline: true });
  video.className = 'fallback-video';
  video.setAttribute('aria-hidden', 'true');
  document.body.prepend(video);
}

// --- 2. Start lights intro (once per visit) ---
const lights = document.getElementById('start-lights');

function skipIntro() {
  return reducedMotion || sessionStorageGet('introSeen');
}

function sessionStorageGet(k) {
  try {
    return sessionStorage.getItem(k);
  } catch {
    return null;
  }
}

function runIntro() {
  return new Promise((resolve) => {
    if (skipIntro()) {
      lights.classList.add('done');
      resolve();
      return;
    }
    const bulbs = lights.querySelectorAll('.lights-row span');
    let n = 0;
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      bulbs.forEach((b) => b.classList.remove('on'));
      scene?.setStartLights(0);
      lights.classList.add('out');
      setTimeout(() => lights.classList.add('done'), 450);
      try {
        sessionStorage.setItem('introSeen', '1');
      } catch {}
      resolve();
    };
    const step = setInterval(() => {
      if (n < 5) {
        bulbs[n].classList.add('on');
        n++;
        scene?.setStartLights(n);
      } else {
        clearInterval(step);
        setTimeout(finish, 300 + Math.random() * 500);
      }
    }, 420);
    lights.addEventListener('click', () => {
      clearInterval(step);
      finish();
    });
  });
}

// --- 3. Scroll: lap progress, HUD, header state, active nav ---
const header = document.querySelector('.site-header');
const hudLap = document.getElementById('hud-lap');
const hudSpeed = document.getElementById('hud-speed');
const hudSector = document.getElementById('hud-sector');
const navLinks = [...document.querySelectorAll('.site-nav a')];

// Scroll position where each stop's section is centred in the viewport
let anchors = [];
function measure() {
  const max = document.documentElement.scrollHeight - window.innerHeight;
  anchors = stopSections.map((el) => Math.min(max, Math.max(0, el.offsetTop + el.offsetHeight / 2 - window.innerHeight / 2)));
}

// Fractional stop index: 2.5 is halfway between the third and fourth stops
function stopIndex(y) {
  if (y <= anchors[0]) return 0;
  for (let i = 0; i < anchors.length - 1; i++) {
    if (y < anchors[i + 1]) return i + (y - anchors[i]) / Math.max(1, anchors[i + 1] - anchors[i]);
  }
  return anchors.length - 1;
}

function onScroll() {
  const f = stopIndex(window.scrollY);
  scene?.setStop(f);
  hudLap.style.width = `${((f / (stops.length - 1)) * 100).toFixed(1)}%`;
  header.classList.toggle('scrolled', window.scrollY > 20);

  const current = stopSections[Math.min(stopSections.length - 1, Math.round(f))];
  hudSector.textContent = current.dataset.sector || 'GRID';
  navLinks.forEach((a) => a.classList.toggle('active', a.dataset.section.split(' ').includes(current.id)));
}
window.addEventListener('scroll', onScroll, { passive: true });
window.addEventListener('resize', () => {
  measure();
  onScroll();
});

function hudLoop() {
  if (scene) hudSpeed.textContent = Math.round(scene.speed);
  requestAnimationFrame(hudLoop);
}

// --- 4. Pointer parallax ---
window.addEventListener('pointermove', (e) => {
  if (e.pointerType !== 'mouse') return;
  scene?.setPointer((e.clientX / window.innerWidth) * 2 - 1, -((e.clientY / window.innerHeight) * 2 - 1));
});

// --- 5. Reveal on scroll ---
const observer = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
        observer.unobserve(entry.target);
      }
    });
  },
  { threshold: 0.15 }
);
document.querySelectorAll('.reveal').forEach((el) => observer.observe(el));

// --- 6. 3D tilt on project cards ---
if (!reducedMotion) {
  document.querySelectorAll('.tilt').forEach((card) => {
    card.addEventListener('pointermove', (e) => {
      if (e.pointerType !== 'mouse') return;
      const r = card.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width;
      const y = (e.clientY - r.top) / r.height;
      card.style.transform = `rotateX(${(0.5 - y) * 10}deg) rotateY(${(x - 0.5) * 12}deg) translateZ(0)`;
      card.style.setProperty('--gx', `${x * 100}%`);
      card.style.setProperty('--gy', `${y * 100}%`);
    });
    card.addEventListener('pointerleave', () => {
      card.style.transform = '';
    });
  });
}

// --- 7. Mobile nav ---
const toggle = document.querySelector('.nav-toggle');
const nav = document.getElementById('site-nav');
toggle.addEventListener('click', () => {
  const open = toggle.getAttribute('aria-expanded') !== 'true';
  toggle.setAttribute('aria-expanded', String(open));
  toggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
  nav.classList.toggle('open', open);
});
navLinks.forEach((a) =>
  a.addEventListener('click', () => {
    toggle.setAttribute('aria-expanded', 'false');
    nav.classList.remove('open');
  })
);

// --- Boot ---
initScene()
  .catch((err) => {
    console.warn('3D scene disabled:', err);
    useFallback();
  })
  .finally(() => {
    measure();
    onScroll();
    hudLoop();
    runIntro();
  });
