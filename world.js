// The drivable world: a golden-hour circuit with a pit building, paddock and
// trackside zones for every part of the CV. Three.js renders it, cannon-es
// throws the props around, and drive.js handles the car.
import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { Sky } from 'three/addons/objects/Sky.js';
import { FontLoader } from 'three/addons/loaders/FontLoader.js';
import { TextGeometry } from 'three/addons/geometries/TextGeometry.js';
import { buildCar } from './car.js';
import { CarController } from './drive.js';

const RED = 0xe10600;
const HALF = 7.5; // half track width, metres
const SAMPLES = 900;

// Circuit centreline, driven in this order. The main straight runs up x = 0.
const CIRCUIT = [
  [0, -150], [0, -40], [0, 70], [0, 150],
  [-14, 190], [-52, 210], [-100, 200],
  [-128, 165], [-122, 112], [-92, 74], [-66, 36],
  [-84, -6], [-132, -26], [-176, -58],
  [-190, -120], [-168, -178], [-114, -210], [-56, -212], [-16, -192],
];

// Where each CV zone sits: u is the fraction of the lap, side +1 is the infield
const ZONE_LAYOUT = {
  about: { at: [-24, -62] },
  gdsc: { garage: 0 },
  sainsburys: { garage: 1 },
  skills: { garage: 2 },
  contact: { at: [-26, -126] },
  education: { u: 0.29, side: -1 },
  'zero-hour': { u: 0.37, side: 1 },
  'duck-run': { u: 0.46, side: -1 },
  banking: { u: 0.55, side: 1 },
  desi: { u: 0.65, side: -1 },
  stem: { u: 0.74, side: 1 },
  events: { u: 0.84, side: -1 },
};

const FLAG_COLOURS = {
  green: ['#139a43', '#ffffff'],
  purple: ['#7a2bd1', '#ffffff'],
  blue: ['#1d5bd8', '#ffffff'],
  yellow: ['#f2c200', '#141414'],
  white: ['#efefef', '#141414'],
};

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));
const angleDiff = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));

// ---------- Textures ----------

function canvasTexture(w, h, draw, { repeat, srgb = true } = {}) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  if (repeat) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(...repeat);
  }
  return t;
}

function speckle(ctx, w, h, n, colours, size = 1.5) {
  for (let i = 0; i < n; i++) {
    ctx.fillStyle = colours[(Math.random() * colours.length) | 0];
    ctx.fillRect(Math.random() * w, Math.random() * h, size, size);
  }
}

function wrapText(ctx, text, x, y, max, lh, lines) {
  const words = text.split(' ');
  let line = '';
  let n = 0;
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > max && line) {
      ctx.fillText(line, x, y + n * lh);
      line = word;
      if (++n >= lines) return;
    } else line = test;
  }
  ctx.fillText(line, x, y + n * lh);
}

// Trackside LED board for one zone
function boardTexture({ num, title, sub, date, accent = '#e10600' }) {
  return canvasTexture(1024, 512, (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#17171e');
    g.addColorStop(1, '#09090d');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = accent;
    ctx.fillRect(0, 0, w, 16);
    ctx.fillRect(0, 0, 16, h);
    ctx.fillStyle = 'rgba(255,255,255,0.045)';
    for (let x = 0; x < w; x += 6) ctx.fillRect(x, 0, 1, h);
    ctx.fillStyle = accent;
    ctx.font = 'italic 900 140px "Titillium Web", Arial, sans-serif';
    ctx.fillText(num, 60, 180);
    ctx.fillStyle = '#ffffff';
    ctx.font = '700 64px "Titillium Web", Arial, sans-serif';
    wrapText(ctx, title.toUpperCase(), 60, 285, w - 120, 68, 2);
    ctx.fillStyle = '#b8b8c6';
    ctx.font = '400 38px "Titillium Web", Arial, sans-serif';
    ctx.fillText(sub, 60, 455);
    if (date) {
      ctx.fillStyle = '#2bd96b';
      ctx.font = '600 30px "JetBrains Mono", monospace';
      ctx.textAlign = 'right';
      ctx.fillText(date.toUpperCase(), w - 50, 100);
    }
  });
}

function flagTexture(flag) {
  const [bg] = FLAG_COLOURS[flag] || FLAG_COLOURS.green;
  return canvasTexture(256, 160, (ctx, w, h) => {
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);
    const g = ctx.createLinearGradient(0, 0, w, 0);
    for (let i = 0; i <= 6; i++) g.addColorStop(i / 6, i % 2 ? 'rgba(0,0,0,0.14)' : 'rgba(255,255,255,0.08)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  });
}

// Floating label above a zone: number chip and title
function labelTexture(num, title, colour) {
  return canvasTexture(512, 160, (ctx, w, h) => {
    ctx.font = '700 46px "Titillium Web", Arial, sans-serif';
    const tw = Math.min(w - 150, ctx.measureText(title.toUpperCase()).width);
    const total = 120 + tw + 36;
    const x0 = (w - total) / 2;
    ctx.fillStyle = 'rgba(10,10,14,0.82)';
    ctx.beginPath();
    ctx.roundRect(x0, 30, total, 90, 14);
    ctx.fill();
    ctx.fillStyle = colour;
    ctx.beginPath();
    ctx.roundRect(x0, 30, 110, 90, [14, 0, 0, 14]);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = 'italic 900 40px "Titillium Web", Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(num.length > 4 ? num.slice(0, 3) : num, x0 + 55, 76);
    ctx.textAlign = 'left';
    ctx.font = '700 46px "Titillium Web", Arial, sans-serif';
    ctx.fillText(title.toUpperCase(), x0 + 130, 78, tw);
  });
}

// ---------- World ----------

export async function createWorld(canvas, { zones: zoneData, mobile = false, onProgress = () => {} }) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: !mobile, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, mobile ? 1.5 : 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.62;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 3000);
  const tick = () => new Promise((r) => requestAnimationFrame(r));

  // --- Sky, sun and atmosphere ---
  const sky = new Sky();
  sky.scale.setScalar(2800);
  const su = sky.material.uniforms;
  su.turbidity.value = 5;
  su.rayleigh.value = 1.4;
  su.mieCoefficient.value = 0.004;
  su.mieDirectionalG.value = 0.82;
  const sunDir = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(78), THREE.MathUtils.degToRad(215));
  su.sunPosition.value.copy(sunDir);
  scene.add(sky);

  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();
  envScene.add(sky.clone());
  const env = pmrem.fromScene(envScene, 0.02).texture;
  scene.environment = env;
  scene.environmentIntensity = 0.75;

  scene.fog = new THREE.Fog(0xcdb9a2, 180, 900);

  const hemi = new THREE.HemisphereLight(0xc4d6ff, 0x5b4a33, 0.9);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffdcb0, 3.2);
  sun.castShadow = true;
  sun.shadow.mapSize.set(mobile ? 1024 : 2048, mobile ? 1024 : 2048);
  const sc = sun.shadow.camera;
  sc.left = sc.bottom = -45;
  sc.right = sc.top = 45;
  sc.near = 1;
  sc.far = 260;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.04;
  scene.add(sun, sun.target);
  onProgress(0.1);
  await tick();

  // --- Physics (props only; the car has its own model) ---
  const physics = new CANNON.World({ gravity: new CANNON.Vec3(0, -9.82, 0) });
  physics.broadphase = new CANNON.SAPBroadphase(physics);
  physics.allowSleep = true;
  physics.defaultContactMaterial.friction = 0.45;
  physics.defaultContactMaterial.restitution = 0.25;
  const groundBody = new CANNON.Body({ type: CANNON.Body.STATIC, shape: new CANNON.Plane() });
  groundBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
  physics.addBody(groundBody);

  const car = new CarController();
  const colliders = car.colliders;

  // Static obstacle for both the car (2D) and the props (3D box)
  function solidBox(x, z, w, d, h, rot = 0) {
    colliders.push({ x, z, hw: w / 2, hd: d / 2, rot });
    const b = new CANNON.Body({ type: CANNON.Body.STATIC, shape: new CANNON.Box(new CANNON.Vec3(w / 2, h / 2, d / 2)) });
    b.position.set(x, h / 2, z);
    b.quaternion.setFromEuler(0, rot, 0);
    physics.addBody(b);
  }
  function solidPost(x, z, r) {
    colliders.push({ x, z, r });
  }

  // --- Circuit ---
  const curve = new THREE.CatmullRomCurve3(CIRCUIT.map(([x, z]) => new THREE.Vector3(x, 0, z)), true, 'centripetal');
  const P = curve.getSpacedPoints(SAMPLES);
  P.pop();
  const lapLength = curve.getLength();
  const T = P.map((p, i) => P[(i + 1) % SAMPLES].clone().sub(P[(i - 1 + SAMPLES) % SAMPLES]).normalize());
  const R = T.map((t) => new THREE.Vector3(-t.z, 0, t.x)); // car's right-hand side = infield
  const K = T.map((t, i) => {
    const n = T[(i + 4) % SAMPLES];
    return angleDiff(Math.atan2(n.x, n.z), Math.atan2(t.x, t.z)) / (8 * lapLength / SAMPLES);
  });
  const frame = (u) => {
    const i = ((Math.round(u * SAMPLES) % SAMPLES) + SAMPLES) % SAMPLES;
    return { i, p: P[i], t: T[i], r: R[i] };
  };

  function nearestSample(x, z) {
    let best = 0;
    let bd = Infinity;
    for (let i = 0; i < SAMPLES; i++) {
      const dx = P[i].x - x;
      const dz = P[i].z - z;
      const d = dx * dx + dz * dz;
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    return { i: best, d: Math.sqrt(bd) };
  }

  // Hard-standing areas off the circuit: pit lane, paddock
  const pads = [
    { x0: 8, x1: 22, z0: -10, z1: 130 }, // pit lane
    { x0: 12, x1: 100, z0: -130, z1: -10 }, // paddock
  ];
  let lastNear = 0;
  function surface(x, z) {
    for (const r of pads) if (x > r.x0 && x < r.x1 && z > r.z0 && z < r.z1) return { track: true };
    // Local search from the last nearest sample keeps this cheap
    let best = lastNear;
    let bd = Infinity;
    for (let k = -30; k <= 30; k++) {
      const i = (lastNear + k + SAMPLES) % SAMPLES;
      const d = (P[i].x - x) ** 2 + (P[i].z - z) ** 2;
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    if (bd > 900) {
      const n = nearestSample(x, z);
      best = n.i;
      bd = n.d * n.d;
    }
    lastNear = best;
    return { track: Math.sqrt(bd) < HALF + 1.6, i: best };
  }

  // Textures for ground and tarmac
  const asphaltTex = canvasTexture(512, 512, (ctx, w, h) => {
    ctx.fillStyle = '#4a4a50';
    ctx.fillRect(0, 0, w, h);
    speckle(ctx, w, h, 26000, ['#3a3a40', '#56565c', '#606068', '#323236', '#6b6b72'], 2);
    // Rubbered-in racing line darkening down the middle
    const g = ctx.createLinearGradient(0, 0, w, 0);
    g.addColorStop(0.2, 'rgba(0,0,0,0)');
    g.addColorStop(0.5, 'rgba(10,10,12,0.32)');
    g.addColorStop(0.8, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#f2f2f2';
    ctx.fillRect(10, 0, 12, h);
    ctx.fillRect(w - 22, 0, 12, h);
  }, { repeat: [1, 1] });
  asphaltTex.wrapS = THREE.ClampToEdgeWrapping;
  asphaltTex.wrapT = THREE.RepeatWrapping;
  const padTex = canvasTexture(512, 512, (ctx, w, h) => {
    ctx.fillStyle = '#505057';
    ctx.fillRect(0, 0, w, h);
    speckle(ctx, w, h, 24000, ['#424248', '#5b5b62', '#66666d', '#3a3a3f'], 2);
  }, { repeat: [1, 1] });

  const asphaltMat = new THREE.MeshStandardMaterial({ map: asphaltTex, roughness: 0.86, metalness: 0 });

  // Ribbon along the centreline between two lateral offsets
  function ribbon(a, b, y, material, { vScale = 1 / (2 * HALF), colorAt, keep } = {}) {
    const pos = [];
    const uv = [];
    const col = [];
    const idx = [];
    let dist = 0;
    let n = 0;
    let prev = -2;
    for (let k = 0; k <= SAMPLES; k++) {
      const i = k % SAMPLES;
      if (k > 0) dist += P[i].distanceTo(P[(i - 1 + SAMPLES) % SAMPLES]);
      if (keep && !keep(i)) continue;
      for (const [o, u] of [[a, 0], [b, 1]]) {
        pos.push(P[i].x + R[i].x * o, y, P[i].z + R[i].z * o);
        uv.push(u, dist * vScale);
        if (colorAt) col.push(...colorAt(dist, i));
      }
      if (prev === k - 1) {
        const s = (n - 1) * 2;
        idx.push(s, s + 1, s + 2, s + 1, s + 3, s + 2);
      }
      prev = k;
      n++;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    if (colorAt) g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    // Ribbons are built in either winding; force the normal up
    const nrm = g.attributes.normal;
    for (let i = 0; i < nrm.count; i++) nrm.setXYZ(i, 0, 1, 0);
    const m = new THREE.Mesh(g, material);
    m.receiveShadow = true;
    scene.add(m);
    return m;
  }

  ribbon(-HALF, HALF, 0.03, asphaltMat);
  // Kerbs on the corners, both sides
  const kerbMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 });
  const red = new THREE.Color(0xd8150f).convertSRGBToLinear();
  const white = new THREE.Color(0xf0f0f0).convertSRGBToLinear();
  const kerbColour = (d) => (Math.floor(d / 3) % 2 ? red.toArray() : white.toArray());
  const cornering = (i) => {
    for (let k = -6; k <= 6; k++) if (Math.abs(K[(i + k + SAMPLES) % SAMPLES]) > 0.008) return true;
    return false;
  };
  ribbon(HALF, HALF + 1.4, 0.05, kerbMat, { colorAt: kerbColour, keep: cornering });
  ribbon(-HALF - 1.4, -HALF, 0.05, kerbMat, { colorAt: kerbColour, keep: cornering });
  onProgress(0.25);
  await tick();

  // Grass: subdivided plane with low-frequency colour patches and a mown stripe texture
  {
    const grassTex = canvasTexture(256, 256, (ctx, w, h) => {
      ctx.fillStyle = '#5f7f35';
      ctx.fillRect(0, 0, w, h);
      speckle(ctx, w, h, 9000, ['#557530', '#6a8a3c', '#4e6c2a', '#739343'], 2);
      ctx.fillStyle = 'rgba(255,255,255,0.05)';
      ctx.fillRect(0, 0, w / 2, h);
    }, { repeat: [220, 220] });
    const size = 2400;
    const geo = new THREE.PlaneGeometry(size, size, 120, 120);
    geo.rotateX(-Math.PI / 2);
    const cols = [];
    const p = geo.attributes.position;
    const a = new THREE.Color(0x9fbf6a);
    const b = new THREE.Color(0x7d9a4c);
    const c = new THREE.Color();
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i);
      const z = p.getZ(i);
      const n = 0.5 + 0.25 * Math.sin(x * 0.011 + Math.cos(z * 0.007) * 2) + 0.25 * Math.sin(z * 0.013 + x * 0.004);
      c.copy(a).lerp(b, n);
      cols.push(c.r, c.g, c.b);
    }
    geo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
    const ground = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: grassTex, vertexColors: true, roughness: 0.95 }));
    ground.position.set(-60, 0, 0);
    ground.receiveShadow = true;
    scene.add(ground);
  }

  // Paddock and pit lane hard standing
  {
    const mat = new THREE.MeshStandardMaterial({ map: padTex, roughness: 0.85 });
    for (const r of pads) {
      const w = r.x1 - r.x0;
      const d = r.z1 - r.z0;
      const tex = padTex.clone();
      tex.repeat.set(w / 14, d / 14);
      tex.needsUpdate = true;
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mat.clone());
      m.material.map = tex;
      m.rotation.x = -Math.PI / 2;
      m.position.set((r.x0 + r.x1) / 2, 0.02, (r.z0 + r.z1) / 2);
      m.receiveShadow = true;
      scene.add(m);
    }
    // Pit lane lines
    const lineMat = new THREE.MeshBasicMaterial({ color: 0xf2f2f2 });
    const line = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 138), lineMat);
    line.rotation.x = -Math.PI / 2;
    line.position.set(9.5, 0.035, 59);
    scene.add(line);
    const yellow = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 138), new THREE.MeshBasicMaterial({ color: 0xf2c200 }));
    yellow.rotation.x = -Math.PI / 2;
    yellow.position.set(20.5, 0.035, 59);
    scene.add(yellow);
  }

  // Start/finish line, grid boxes and the start gantry
  const startU = (() => {
    let best = 0;
    for (let i = 0; i < SAMPLES; i++) if (Math.abs(P[i].x) < 2 && Math.abs(P[i].z + 100) < Math.abs(P[best].z + 100)) best = i;
    return best / SAMPLES;
  })();
  const lightBulbs = [];
  {
    const f = frame(startU);
    const chk = canvasTexture(256, 32, (ctx) => {
      for (let x = 0; x < 16; x++) for (let y = 0; y < 2; y++) {
        ctx.fillStyle = (x + y) % 2 ? '#111' : '#f4f4f4';
        ctx.fillRect(x * 16, y * 16, 16, 16);
      }
    });
    const line = new THREE.Mesh(new THREE.PlaneGeometry(2 * HALF, 1.6), new THREE.MeshStandardMaterial({ map: chk, roughness: 0.7 }));
    line.rotation.x = -Math.PI / 2;
    line.position.set(f.p.x, 0.04, f.p.z);
    scene.add(line);
    const boxMat = new THREE.MeshBasicMaterial({ color: 0xf2f2f2 });
    for (let k = 0; k < 6; k++) {
      const side = k % 2 ? -1 : 1;
      const m = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 0.25), boxMat);
      m.rotation.x = -Math.PI / 2;
      m.position.set(side * 3.2, 0.04, f.p.z - 8 - k * 8);
      scene.add(m);
    }

    // Gantry over the line with five pairs of start lights
    const g = new THREE.Group();
    g.position.set(f.p.x, 0, f.p.z + 1);
    const steel = new THREE.MeshStandardMaterial({ color: 0x24242c, roughness: 0.4, metalness: 0.7 });
    for (const s of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.8, 8.5, 0.8), steel);
      leg.position.set(s * (HALF + 2), 4.25, 0);
      leg.castShadow = true;
      g.add(leg);
      solidBox(f.p.x + s * (HALF + 2), f.p.z + 1, 0.8, 0.8, 8.5);
    }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(2 * HALF + 5, 1.8, 1), steel);
    beam.position.y = 8.2;
    beam.castShadow = true;
    g.add(beam);
    const banner = new THREE.Mesh(new THREE.PlaneGeometry(2 * HALF + 4.6, 1.5), new THREE.MeshBasicMaterial({
      map: canvasTexture(1024, 96, (ctx, w, h) => {
        ctx.fillStyle = '#0c0c10';
        ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = '#e10600';
        ctx.fillRect(0, 0, 12, h);
        ctx.fillRect(w - 12, 0, 12, h);
        ctx.fillStyle = '#fff';
        ctx.font = 'italic 900 54px "Titillium Web", Arial, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('VANSH THACKER  ·  SOFTWARE ENGINEER', w / 2, h / 2 + 2);
      }),
    }));
    banner.position.set(0, 8.2, -0.51);
    banner.rotation.y = Math.PI;
    g.add(banner);
    // Light pods face the grid (towards -z)
    const pod = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.4, 0.4), new THREE.MeshStandardMaterial({ color: 0x0a0a0c, roughness: 0.5 }));
    for (let k = 0; k < 5; k++) {
      const x = (2 - k) * 1.1; // first light on the driver's left
      const p = pod.clone();
      p.position.set(x, 6.7, -0.4);
      g.add(p);
      const bulbs = [];
      for (const y of [7.0, 6.45]) {
        const b = new THREE.Mesh(new THREE.CircleGeometry(0.22, 20), new THREE.MeshBasicMaterial({ color: 0x220404 }));
        b.position.set(x, y, -0.66);
        b.rotation.y = Math.PI;
        g.add(b);
        bulbs.push(b);
      }
      lightBulbs.push(bulbs);
    }
    scene.add(g);
  }

  // --- Pit building: three garages facing the pit lane ---
  const garages = [];
  {
    const wallMat = new THREE.MeshStandardMaterial({ color: 0xe9e9ee, roughness: 0.55, metalness: 0.1 });
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x1a1a20, roughness: 0.6, metalness: 0.3 });
    const glassMat = new THREE.MeshPhysicalMaterial({ color: 0x1b2a3a, roughness: 0.08, metalness: 0.2, clearcoat: 1, envMapIntensity: 1.4 });
    const X = 23; // front face of the building
    const D = 16;
    const zs = [10, 34, 58];
    const z0 = -14;
    const z1 = 82;
    // Main block with an upstairs glass hospitality floor
    const block = new THREE.Mesh(new THREE.BoxGeometry(D, 3.6, z1 - z0), glassMat);
    block.position.set(X + D / 2, 8.4, (z0 + z1) / 2);
    block.castShadow = true;
    scene.add(block);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(D + 3, 0.6, z1 - z0 + 2), wallMat);
    roof.position.set(X + D / 2 - 1.2, 10.5, (z0 + z1) / 2);
    roof.castShadow = true;
    scene.add(roof);
    const slab = new THREE.Mesh(new THREE.BoxGeometry(D + 1, 0.8, z1 - z0), wallMat);
    slab.position.set(X + D / 2 - 0.5, 6.2, (z0 + z1) / 2);
    slab.castShadow = true;
    scene.add(slab);
    const back = new THREE.Mesh(new THREE.BoxGeometry(0.5, 6, z1 - z0), darkMat);
    back.position.set(X + D, 3, (z0 + z1) / 2);
    scene.add(back);
    solidBox(X + D / 2 + 1, (z0 + z1) / 2, D - 2, z1 - z0, 6);
    colliders.pop(); // the car may drive into the garages, so only walls block it
    for (let k = 0; k <= zs.length; k++) {
      const z = k < zs.length ? zs[k] - 10 : zs[zs.length - 1] + 10;
      const wall = new THREE.Mesh(new THREE.BoxGeometry(D, 6, 0.6), wallMat);
      wall.position.set(X + D / 2, 3, z);
      wall.castShadow = true;
      wall.receiveShadow = true;
      scene.add(wall);
      solidBox(X + D / 2, z, D, 0.6, 6);
    }
    solidBox(X + D, (z0 + z1) / 2, 0.5, z1 - z0, 6);
    // Ends of the building outside the garages
    for (const [a, b] of [[z0, zs[0] - 10], [zs[2] + 10, z1]]) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(D, 6, b - a), wallMat);
      m.position.set(X + D / 2, 3, (a + b) / 2);
      m.castShadow = true;
      scene.add(m);
      solidBox(X + D / 2, (a + b) / 2, D, b - a, 6);
    }
    zs.forEach((z) => {
      const floor = new THREE.Mesh(new THREE.PlaneGeometry(D - 0.5, 19.4), new THREE.MeshStandardMaterial({ color: 0xc8c8cf, roughness: 0.25, metalness: 0.1 }));
      floor.rotation.x = -Math.PI / 2;
      floor.position.set(X + D / 2, 0.025, z);
      floor.receiveShadow = true;
      scene.add(floor);
      garages.push({ x: X, z });
    });
    // Pit wall on the other side of the lane? Leave it open so the car can drive in and out freely.
  }

  // --- Grandstand on the infield along the main straight ---
  {
    const g = new THREE.Group();
    const concrete = new THREE.MeshStandardMaterial({ color: 0xb9b6b0, roughness: 0.9 });
    const seatCols = [0xe10600, 0xf2f2f2, 0x202028];
    const rows = 9;
    const len = 100;
    for (let r = 0; r < rows; r++) {
      const step = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.8 + r * 0.8, len), concrete);
      step.position.set(-r * 1.4, (0.8 + r * 0.8) / 2, 0);
      step.castShadow = step.receiveShadow = true;
      g.add(step);
    }
    // Crowd as instanced boxes in team colours
    const crowd = new THREE.InstancedMesh(new THREE.BoxGeometry(0.45, 0.8, 0.45), new THREE.MeshStandardMaterial({ roughness: 0.8 }), rows * 140);
    const m = new THREE.Matrix4();
    const c = new THREE.Color();
    let n = 0;
    for (let r = 0; r < rows; r++) {
      for (let k = 0; k < 140; k++) {
        if (Math.random() < 0.18) continue;
        m.makeTranslation(-r * 1.4 + (Math.random() - 0.5) * 0.3, 0.8 + r * 0.8 + 0.4, -len / 2 + 0.5 + k * (len - 1) / 140);
        crowd.setMatrixAt(n, m);
        c.setHex(seatCols[(Math.random() * 3) | 0]).offsetHSL(0, 0, (Math.random() - 0.5) * 0.15);
        crowd.setColorAt(n, c);
        n++;
      }
    }
    crowd.count = n;
    g.add(crowd);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(14, 0.4, len + 2), new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.4, metalness: 0.3 }));
    roof.position.set(-5.5, 10.5, 0);
    roof.rotation.z = -0.08;
    roof.castShadow = true;
    g.add(roof);
    for (const z of [-len / 2, 0, len / 2]) {
      const col = new THREE.Mesh(new THREE.BoxGeometry(0.5, 10.5, 0.5), concrete);
      col.position.set(-11.5, 5.25, z);
      g.add(col);
    }
    g.position.set(-22, 0, 52);
    scene.add(g);
    solidBox(-28, 52, 14, len, 10);
  }
  onProgress(0.4);
  await tick();

  // --- Zones ---
  const zones = [];
  const waving = [];
  const beams = [];
  const steel = new THREE.MeshStandardMaterial({ color: 0x2a2a32, roughness: 0.45, metalness: 0.7 });
  const beamTex = canvasTexture(4, 128, (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(0.7, 'rgba(255,255,255,0.35)');
    g.addColorStop(1, 'rgba(255,255,255,0.9)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }, { srgb: false });

  function zoneColour(d) {
    if (d.kind === 'pit') return d.team || '#e10600';
    if (d.kind === 'finish') return '#f2f2f2';
    return (FLAG_COLOURS[d.flag] || FLAG_COLOURS.green)[0];
  }

  // Glowing ring, light beam and floating label shared by every zone
  function zoneMarker(x, z, colour, d, labelY = 9) {
    const col = new THREE.Color(colour);
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    const ring = new THREE.Mesh(new THREE.RingGeometry(6.2, 6.8, 64), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.95, toneMapped: false, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.06;
    g.add(ring);
    const disc = new THREE.Mesh(new THREE.CircleGeometry(6.2, 64), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.12, depthWrite: false }));
    disc.rotation.x = -Math.PI / 2;
    disc.position.y = 0.05;
    g.add(disc);
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(6.5, 6.5, 26, 48, 1, true), new THREE.MeshBasicMaterial({
      color: col, map: beamTex, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
    }));
    beam.position.y = 13;
    g.add(beam);
    const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: labelTexture(d.num, d.title.split(' · ')[0], colour), depthWrite: false, fog: false }));
    label.scale.set(12, 3.75, 1);
    label.position.y = labelY;
    g.add(label);
    scene.add(g);
    beams.push({ ring, disc, beam, label, labelY, phase: Math.random() * 6 });
    return beams[beams.length - 1];
  }

  // LED board on two posts, facing the given direction
  function board(x, z, faceYaw, d, accent, { y = 5.5, posts = true } = {}) {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    g.rotation.y = faceYaw;
    const tex = boardTexture({ ...d, accent });
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(10, 5), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false, color: 0xd0d0d0 }));
    screen.position.set(0, y, 0.21);
    g.add(screen);
    const frameM = new THREE.Mesh(new THREE.BoxGeometry(10.5, 5.5, 0.4), steel);
    frameM.position.set(0, y, 0);
    frameM.castShadow = true;
    g.add(frameM);
    for (const s of posts ? [-1, 1] : []) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.35, 3, 0.35), steel);
      post.position.set(s * 3.8, 1.5, 0);
      g.add(post);
      const wx = x + Math.cos(faceYaw) * s * 3.8;
      const wz = z - Math.sin(faceYaw) * s * 3.8;
      solidPost(wx, wz, 0.4);
    }
    scene.add(g);
  }

  function flagPole(x, z, flag, faceYaw) {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    g.rotation.y = faceYaw;
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 9, 10), new THREE.MeshStandardMaterial({ color: 0xdedede, metalness: 0.8, roughness: 0.3 }));
    pole.position.y = 4.5;
    pole.castShadow = true;
    g.add(pole);
    const geo = new THREE.PlaneGeometry(3.6, 2.3, 24, 12);
    geo.translate(1.8, 0, 0);
    const cloth = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: flagTexture(flag), roughness: 0.8, side: THREE.DoubleSide }));
    cloth.position.y = 7.6;
    cloth.castShadow = true;
    g.add(cloth);
    waving.push({ geo, base: Float32Array.from(geo.attributes.position.array), phase: Math.random() * 6 });
    scene.add(g);
    solidPost(x, z, 0.3);
  }

  function podium(x, z, faceYaw) {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    g.rotation.y = faceYaw;
    const mat = new THREE.MeshStandardMaterial({ color: 0x15151b, roughness: 0.35, metalness: 0.4 });
    const steps = [[-3, 1.6, '2', 0x7a2bd1], [0, 2.3, '1', 0x3a3a46], [3, 1.1, '3', 0x3a3a46]];
    for (const [px, h, label, col] of steps) {
      const block = new THREE.Mesh(new THREE.BoxGeometry(3, h, 2.6), mat);
      block.position.set(px, h / 2, 0);
      block.castShadow = block.receiveShadow = true;
      g.add(block);
      const face = new THREE.Mesh(new THREE.PlaneGeometry(2.2, Math.min(1, h - 0.3)), new THREE.MeshBasicMaterial({
        toneMapped: false,
        map: canvasTexture(128, 64, (ctx, w, hh) => {
          ctx.fillStyle = `#${col.toString(16).padStart(6, '0')}`;
          ctx.fillRect(0, 0, w, hh);
          ctx.fillStyle = '#fff';
          ctx.font = 'italic 900 52px "Titillium Web", Arial, sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(label, w / 2, hh / 2 + 3);
        }),
      }));
      face.position.set(px, h / 2, 1.31);
      g.add(face);
    }
    // Trophy on P2
    const gold = new THREE.MeshPhysicalMaterial({ color: 0xffc94a, metalness: 1, roughness: 0.18, clearcoat: 1 });
    const pts = [[0, 0], [0.35, 0], [0.35, 0.08], [0.12, 0.14], [0.08, 0.5], [0.3, 0.7], [0.42, 1.1], [0.38, 1.12], [0.26, 0.76], [0, 0.66]];
    const trophy = new THREE.Mesh(new THREE.LatheGeometry(pts.map(([a, b]) => new THREE.Vector2(a, b)), 32), gold);
    trophy.position.set(-3, 1.6, 0);
    trophy.scale.setScalar(1.3);
    trophy.castShadow = true;
    g.add(trophy);
    scene.add(g);
    solidBox(x, z, 9, 2.6, 2.3, faceYaw);
    return { trophy };
  }

  let trophy = null;
  for (const d of zoneData) {
    const L = ZONE_LAYOUT[d.id];
    if (!L) continue;
    const colour = zoneColour(d);
    let x;
    let z;
    let landmark = null;
    if (L.garage !== undefined) {
      const gpos = garages[L.garage];
      x = 15;
      z = gpos.z;
      // Board above the garage door and a coloured header band
      const accent = d.team || '#e10600';
      board(gpos.x - 0.6, gpos.z, -Math.PI / 2, d, accent, { y: 9.3, posts: false });
      const band = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.6, 19.4), new THREE.MeshBasicMaterial({ color: new THREE.Color(accent), toneMapped: false }));
      band.position.set(gpos.x + 0.2, 5.6, gpos.z);
      scene.add(band);
      // Lit garage interior
      const glow = new THREE.Mesh(new THREE.PlaneGeometry(19, 5.4), new THREE.MeshBasicMaterial({ color: new THREE.Color(accent).multiplyScalar(0.55), toneMapped: false }));
      glow.position.set(gpos.x + 15.6, 2.8, gpos.z);
      glow.rotation.y = -Math.PI / 2;
      scene.add(glow);
      const lamp = new THREE.PointLight(0xffffff, 60, 26, 1.6);
      lamp.position.set(gpos.x + 7, 5, gpos.z);
      scene.add(lamp);
      landmark = { type: 'garage', x: gpos.x + 8, z: gpos.z };
    } else {
      let faceYaw;
      if (L.at) {
        [x, z] = L.at;
        faceYaw = x > 0 ? -Math.PI / 2 : Math.PI / 2;
      } else {
        const f = frame(L.u);
        const off = HALF + 15;
        x = f.p.x + f.r.x * off * L.side;
        z = f.p.z + f.r.z * off * L.side;
        // Board behind the pad, facing back towards the track
        faceYaw = Math.atan2(-f.r.x * L.side, -f.r.z * L.side);
      }
      const fx = Math.sin(faceYaw);
      const fz = Math.cos(faceYaw);
      const bx = x - fx * 10;
      const bz = z - fz * 10;
      if (d.kind === 'podium') {
        trophy = podium(bx, bz, faceYaw).trophy;
        board(bx - fx * 5, bz - fz * 5, faceYaw, d, colour);
      } else {
        board(bx, bz, faceYaw, d, d.kind === 'finish' ? '#e10600' : colour);
        if (d.kind === 'flag') flagPole(bx + Math.cos(faceYaw) * 6.5, bz - Math.sin(faceYaw) * 6.5, d.flag, faceYaw);
      }
      landmark = { type: d.kind, faceYaw };
    }
    const marker = zoneMarker(x, z, colour, d, L.garage !== undefined ? 13.5 : 12.5);
    zones.push({ ...d, x, z, r: 7, colour, marker, landmark, visited: false });
  }

  // Chequered flag on the finish zone
  {
    const fin = zones.find((z) => z.kind === 'finish');
    if (fin) {
      const chk = canvasTexture(256, 160, (ctx) => {
        for (let x = 0; x < 8; x++) for (let y = 0; y < 5; y++) {
          ctx.fillStyle = (x + y) % 2 ? '#111' : '#f4f4f4';
          ctx.fillRect(x * 32, y * 32, 32, 32);
        }
      });
      const g = new THREE.Group();
      g.position.set(fin.x + 4, 0, fin.z + 7);
      g.rotation.y = -Math.PI / 2;
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 9, 10), new THREE.MeshStandardMaterial({ color: 0xdedede, metalness: 0.8, roughness: 0.3 }));
      pole.position.y = 4.5;
      g.add(pole);
      const geo = new THREE.PlaneGeometry(3.6, 2.3, 24, 12);
      geo.translate(1.8, 0, 0);
      const cloth = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: chk, roughness: 0.8, side: THREE.DoubleSide }));
      cloth.position.y = 7.6;
      cloth.castShadow = true;
      g.add(cloth);
      waving.push({ geo, base: Float32Array.from(geo.attributes.position.array), phase: 1 });
      scene.add(g);
      solidPost(fin.x + 4, fin.z + 7, 0.3);
    }
  }
  onProgress(0.55);
  await tick();

  // --- Cars: the hero car and team cars parked in the garages ---
  const hero = buildCar();
  scene.add(hero.group);
  if (!mobile) {
    const parked = [
      { base: '#1a56c4', number: '15', helmetColor: 0xffffff, g: 0 },
      { base: '#ea6a0a', number: '22', helmetColor: 0x202020, g: 1 },
    ];
    for (const p of parked) {
      const c = buildCar(p);
      const gp = garages[p.g];
      c.group.position.set(gp.x + 8.5, 0, gp.z);
      c.group.rotation.y = -Math.PI / 2;
      scene.add(c.group);
      solidBox(gp.x + 8.5, gp.z, 6, 2.2, 1.2, Math.PI / 2);
    }
  }
  onProgress(0.7);
  await tick();

  // --- Dynamic props: name letters, cones and tyre stacks ---
  const props = [];
  const bodyOf = new Map();
  const carBody = new CANNON.Body({ type: CANNON.Body.KINEMATIC, shape: new CANNON.Box(new CANNON.Vec3(0.95, 0.55, 2.8)) });
  physics.addBody(carBody);

  function addProp(mesh, body) {
    body.allowSleep = true;
    body.sleepSpeedLimit = 0.15;
    body.sleepTimeLimit = 0.6;
    body.linearDamping = 0.15;
    body.angularDamping = 0.25;
    physics.addBody(body);
    body.sleep();
    props.push({ mesh, body });
    bodyOf.set(body, mesh);
  }

  // Big italic name, standing on the paddock facing the grid
  try {
    const json = await fetch('vendor/fonts/helvetiker_bold.subset.json').then((r) => r.json());
    const font = new FontLoader().parse(json);
    const front = new THREE.MeshPhysicalMaterial({ color: 0xf6f6f6, roughness: 0.3, clearcoat: 1 });
    const sides = new THREE.MeshPhysicalMaterial({ color: RED, roughness: 0.35, clearcoat: 1 });
    const shear = new THREE.Matrix4().makeShear(0, 0, 0.18, 0, 0, 0);
    const size = 4.2;
    {
      let cursor = 0;
      const glyphs = [];
      for (const ch of 'VANSH THACKER') {
        if (ch === ' ') {
          cursor += size * 0.6;
          continue;
        }
        const geo = new TextGeometry(ch, { font, size, depth: 1.1, curveSegments: 6, bevelEnabled: true, bevelThickness: 0.08, bevelSize: 0.06, bevelSegments: 2 });
        geo.applyMatrix4(shear);
        geo.computeBoundingBox();
        const bb = geo.boundingBox;
        const w = bb.max.x - bb.min.x;
        const h = bb.max.y - bb.min.y;
        const dd = bb.max.z - bb.min.z;
        geo.translate(-(bb.min.x + w / 2), -(bb.min.y + h / 2), -(bb.min.z + dd / 2));
        glyphs.push({ geo, w, h, dd, at: cursor + w / 2 });
        cursor += w + size * 0.14;
      }
      // Text reads towards -x so it faces a camera looking up +z from the grid,
      // angled a little towards the grid
      const tilt = 0.22;
      const yaw = Math.PI + tilt;
      const ox = 14 + cursor * Math.cos(tilt);
      const oz = -20 - cursor * Math.sin(tilt);
      for (const g of glyphs) {
        const mesh = new THREE.Mesh(g.geo, [front, sides]);
        mesh.castShadow = mesh.receiveShadow = true;
        scene.add(mesh);
        const body = new CANNON.Body({ mass: 60, shape: new CANNON.Box(new CANNON.Vec3(g.w / 2, g.h / 2, g.dd / 2)) });
        body.position.set(ox - g.at * Math.cos(tilt), g.h / 2 + 0.01, oz + g.at * Math.sin(tilt));
        body.quaternion.setFromEuler(0, yaw, 0);
        addProp(mesh, body);
      }
    }
  } catch (err) {
    console.warn('Name letters skipped:', err);
  }

  // Cones: slalom across the paddock and markers round the zone pads
  const coneSpots = [];
  for (let k = 0; k < 9; k++) coneSpots.push([40 + k * 6.5, -80 + (k % 2) * 3]);
  for (let k = 0; k < 7; k++) coneSpots.push([45 + k * 7, -100]);
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2;
    coneSpots.push([70 + Math.cos(a) * 12, -112 + Math.sin(a) * 6]);
  }
  const coneMesh = new THREE.InstancedMesh(
    (() => {
      const pts = [[0, -0.35], [0.24, -0.35], [0.24, -0.31], [0.19, -0.3], [0.04, 0.35], [0, 0.35]].map(([a, b]) => new THREE.Vector2(a, b));
      return new THREE.LatheGeometry(pts, 16);
    })(),
    new THREE.MeshStandardMaterial({
      roughness: 0.55,
      map: canvasTexture(4, 64, (ctx) => {
        ctx.fillStyle = '#ff5a0a';
        ctx.fillRect(0, 0, 4, 64);
        ctx.fillStyle = '#f6f6f6';
        ctx.fillRect(0, 26, 4, 12);
        ctx.fillRect(0, 8, 4, 8);
      }),
    }),
    coneSpots.length,
  );
  coneMesh.castShadow = true;
  scene.add(coneMesh);
  const instanced = [];
  coneSpots.forEach(([x, z], i) => {
    const body = new CANNON.Body({ mass: 3, shape: new CANNON.Cylinder(0.05, 0.24, 0.7, 8) });
    body.position.set(x, 0.36, z);
    addProp(null, body);
    instanced.push({ mesh: coneMesh, i, body });
  });

  // Tyre stacks on the outside of the slowest corners
  const tyreSpots = [];
  for (let i = 0; i < SAMPLES; i += 3) {
    if (Math.abs(K[i]) < 0.016) continue;
    const side = K[i] > 0 ? 1 : -1; // outside of the corner
    const o = -side * (HALF + 7);
    tyreSpots.push([P[i].x + R[i].x * o, P[i].z + R[i].z * o]);
  }
  const tyreGeo = (() => {
    const g = new THREE.TorusGeometry(0.3, 0.13, 8, 18);
    g.rotateX(Math.PI / 2);
    return g;
  })();
  const tyreMesh = new THREE.InstancedMesh(tyreGeo, new THREE.MeshStandardMaterial({ color: 0x18181b, roughness: 0.9 }), tyreSpots.length * 3);
  tyreMesh.castShadow = true;
  scene.add(tyreMesh);
  tyreSpots.forEach(([x, z], k) => {
    const body = new CANNON.Body({ mass: 25, shape: new CANNON.Cylinder(0.43, 0.43, 0.78, 10) });
    body.position.set(x, 0.4, z);
    addProp(null, body);
    for (let j = 0; j < 3; j++) instanced.push({ mesh: tyreMesh, i: k * 3 + j, body, dy: -0.26 + j * 0.26 });
  });
  onProgress(0.82);
  await tick();

  // --- Trees around the outside ---
  {
    const count = mobile ? 160 : 380;
    const trunkGeo = new THREE.CylinderGeometry(0.18, 0.28, 2.4, 6);
    trunkGeo.translate(0, 1.2, 0);
    const crownGeo = new THREE.ConeGeometry(2.2, 6.5, 7);
    crownGeo.translate(0, 5.2, 0);
    const trunks = new THREE.InstancedMesh(trunkGeo, new THREE.MeshStandardMaterial({ color: 0x5a3d26, roughness: 0.9 }), count);
    const crowns = new THREE.InstancedMesh(crownGeo, new THREE.MeshStandardMaterial({ color: 0x2f5a2a, roughness: 0.85, flatShading: true }), count);
    trunks.castShadow = crowns.castShadow = true;
    const m = new THREE.Matrix4();
    const c = new THREE.Color();
    let n = 0;
    let guard = 0;
    const clear = (x, z) => {
      if (x > -60 && x < 120 && z > -150 && z < 140) return false; // paddock, pits, grandstand
      for (const zn of zones) if (Math.hypot(zn.x - x, zn.z - z) < 26) return false;
      return nearestSample(x, z).d > HALF + 22;
    };
    while (n < count && guard++ < 6000) {
      const a = Math.random() * Math.PI * 2;
      const r = 40 + Math.random() * 420;
      const x = -80 + Math.cos(a) * r;
      const z = Math.sin(a) * r * 0.9;
      if (!clear(x, z)) continue;
      const s = 0.8 + Math.random() * 0.8;
      m.compose(new THREE.Vector3(x, 0, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.random() * 6), new THREE.Vector3(s, s * (0.85 + Math.random() * 0.4), s));
      trunks.setMatrixAt(n, m);
      crowns.setMatrixAt(n, m);
      c.setHSL(0.27 + Math.random() * 0.06, 0.4, 0.2 + Math.random() * 0.1);
      crowns.setColorAt(n, c);
      solidPost(x, z, 0.5 * s);
      n++;
    }
    trunks.count = crowns.count = n;
    scene.add(trunks, crowns);
  }

  // --- Skid marks and tyre smoke ---
  const MAX_SKIDS = 900;
  const skidMesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.34, 1).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x0a0a0a, transparent: true, opacity: 0.55, depthWrite: false }), MAX_SKIDS);
  skidMesh.count = 0;
  skidMesh.renderOrder = 2;
  scene.add(skidMesh);
  let skidHead = 0;
  const lastSkid = [null, null];

  const smokeTex = canvasTexture(64, 64, (ctx, w) => {
    const g = ctx.createRadialGradient(w / 2, w / 2, 2, w / 2, w / 2, w / 2);
    g.addColorStop(0, 'rgba(235,235,235,0.75)');
    g.addColorStop(1, 'rgba(235,235,235,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, w);
  });
  const smoke = [];
  for (let k = 0; k < 40; k++) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: smokeTex, transparent: true, depthWrite: false, opacity: 0 }));
    s.visible = false;
    scene.add(s);
    smoke.push({ s, life: 0, vx: 0, vz: 0 });
  }
  let smokeHead = 0;

  // ---------- State ----------
  const spawn = (() => {
    const f = frame(startU - 18 / lapLength);
    return { x: f.p.x + 3.2, z: f.p.z, yaw: Math.atan2(f.t.x, f.t.z) };
  })();
  car.place(spawn.x, spawn.z, spawn.yaw);

  let camMode = 0; // 0 chase, 1 high
  let camYaw = spawn.yaw;
  let orbit = 0;
  let orbitPitch = 0;
  let dragging = false;
  let intro = true;
  let time = 0;
  let shake = 0;
  let activeZone = null;
  const listeners = { zone: () => {}, impact: () => {} };

  camera.position.set(spawn.x - 10, 3.5, spawn.z - 6);
  const look = new THREE.Vector3();
  const desired = new THREE.Vector3();
  const camPos = new THREE.Vector3();

  function setStartLights(n) {
    lightBulbs.forEach((bulbs, k) => bulbs.forEach((b) => b.material.color.setHex(k < n ? 0xff1a0a : 0x220404)));
  }

  function resetCar() {
    const { i } = nearestSample(car.x, car.z);
    const f = { p: P[i], t: T[i] };
    car.place(f.p.x, f.p.z, Math.atan2(f.t.x, f.t.z));
    camYaw = car.yaw;
    camPos.set(car.x - Math.sin(car.yaw) * 10, 4, car.z - Math.cos(car.yaw) * 10);
  }

  function teleport(id) {
    const z = zones.find((zz) => zz.id === id);
    if (!z) return;
    // Park on the pad facing its landmark
    let yaw;
    if (z.landmark?.type === 'garage') yaw = Math.PI / 2;
    else if (z.landmark?.faceYaw !== undefined) yaw = z.landmark.faceYaw + Math.PI;
    else yaw = 0;
    car.place(z.x - Math.sin(yaw) * 3, z.z - Math.cos(yaw) * 3, yaw);
    camYaw = yaw;
    orbit = 0;
    camPos.set(car.x - Math.sin(yaw) * 9, 3.5, car.z - Math.cos(yaw) * 9);
  }

  // Wave the flags: a travelling wave pinned at the pole
  function waveFlags(t) {
    for (const fl of waving) {
      const pos = fl.geo.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const x = fl.base[i * 3];
        const y = fl.base[i * 3 + 1];
        const k = x / 3.6;
        pos.setZ(i, Math.sin(x * 1.6 - t * 5 + fl.phase + y * 0.3) * 0.28 * k);
        pos.setY(i, y - k * k * 0.2);
      }
      pos.needsUpdate = true;
      fl.geo.computeVertexNormals();
    }
  }

  const dummy = new THREE.Object3D();
  function addSkid(slot, x, z, yaw) {
    const prev = lastSkid[slot];
    if (prev) {
      const dx = x - prev.x;
      const dz = z - prev.z;
      const len = Math.hypot(dx, dz);
      if (len < 0.5) return;
      if (len < 3) {
        dummy.position.set((x + prev.x) / 2, 0.045, (z + prev.z) / 2);
        dummy.rotation.set(0, Math.atan2(dx, dz), 0);
        dummy.scale.set(1, 1, len + 0.05);
        dummy.updateMatrix();
        skidMesh.setMatrixAt(skidHead, dummy.matrix);
        skidHead = (skidHead + 1) % MAX_SKIDS;
        skidMesh.count = Math.min(MAX_SKIDS, skidMesh.count + 1);
        skidMesh.instanceMatrix.needsUpdate = true;
      }
    }
    lastSkid[slot] = { x, z };
  }

  function puff(x, z, vx, vz) {
    const p = smoke[smokeHead];
    smokeHead = (smokeHead + 1) % smoke.length;
    p.life = 1;
    p.s.visible = true;
    p.s.position.set(x, 0.5, z);
    p.vx = vx * 0.3 + (Math.random() - 0.5);
    p.vz = vz * 0.3 + (Math.random() - 0.5);
  }

  // ---------- Frame update ----------
  let acc = 0;
  const DT = 1 / 120;

  function step(dt, input) {
    dt = Math.min(dt, 0.05);
    time += dt;
    const frozen = intro || input.locked;

    // Car physics at a fixed rate
    acc += dt;
    let impact = 0;
    while (acc >= DT) {
      // Held on the grid until the lights go out
      if (!frozen) car.update(DT, input, surface);
      impact = Math.max(impact, car.impact);
      // Soft world boundary
      const bx = car.x + 70;
      const bz = car.z;
      const br = Math.hypot(bx, bz);
      if (br > 470) {
        car.x -= (bx / br) * (br - 470);
        car.z -= (bz / br) * (br - 470);
        car.vx *= 0.5;
        car.vz *= 0.5;
      }
      acc -= DT;
    }
    if (impact > 3) {
      shake = Math.min(1, shake + impact / 25);
      listeners.impact(impact);
    }

    // Kinematic proxy so the props get shoved
    carBody.position.set(car.x, 0.6, car.z);
    carBody.quaternion.setFromEuler(0, car.yaw, 0);
    carBody.velocity.set(car.vx, 0, car.vz);
    carBody.angularVelocity.set(0, car.yawRate, 0);
    physics.step(1 / 60, dt, 3);
    // Wake props near the car only
    for (const { body } of props) {
      if (body.sleepState === CANNON.Body.SLEEPING) {
        const dx = body.position.x - car.x;
        const dz = body.position.z - car.z;
        if (dx * dx + dz * dz < 64) body.wakeUp();
      }
    }
    for (const { mesh, body } of props) {
      if (!mesh) continue;
      mesh.position.copy(body.position);
      mesh.quaternion.copy(body.quaternion);
    }
    const touched = new Set();
    for (const it of instanced) {
      dummy.position.copy(it.body.position);
      dummy.quaternion.copy(it.body.quaternion);
      if (it.dy) dummy.position.add(new THREE.Vector3(0, it.dy, 0).applyQuaternion(dummy.quaternion));
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      it.mesh.setMatrixAt(it.i, dummy.matrix);
      touched.add(it.mesh);
    }
    touched.forEach((m) => (m.instanceMatrix.needsUpdate = true));

    // Car pose
    hero.group.position.set(car.x, 0, car.z);
    hero.group.rotation.y = car.yaw;
    // Lean and squat a touch under load
    hero.group.rotation.z = clamp(car.yawRate * car.speed * 0.0016, -0.03, 0.03);
    hero.group.rotation.x = clamp(-car.braking * 0.012 + car.throttle * 0.006, -0.02, 0.02);
    hero.spin(car.speed * dt);
    hero.steer(-car.steer * 1.4);
    hero.tick(time);

    // Skids and smoke from the rear wheels when sliding or locking up
    const sliding = car.slip > 3.2 || (car.braking > 0.6 && car.speed > 25);
    const [fx, fz] = car.forward;
    for (const [slot, side] of [[0, -1], [1, 1]]) {
      const x = car.x - fx * 1.8 + -fz * 0.8 * side;
      const z = car.z - fz * 1.8 + fx * 0.8 * side;
      if (sliding && car.onTrack) {
        addSkid(slot, x, z);
        if (Math.random() < 0.5) puff(x, z, car.vx, car.vz);
      } else lastSkid[slot] = null;
    }
    for (const p of smoke) {
      if (p.life <= 0) continue;
      p.life -= dt * 0.9;
      p.s.position.x += p.vx * dt;
      p.s.position.z += p.vz * dt;
      p.s.position.y += dt * 0.8;
      const sc = 1.2 + (1 - p.life) * 4;
      p.s.scale.set(sc, sc, 1);
      p.s.material.opacity = Math.max(0, p.life) * 0.45;
      if (p.life <= 0) p.s.visible = false;
    }

    // Zones
    let inside = null;
    for (const z of zones) {
      const d = Math.hypot(z.x - car.x, z.z - car.z);
      if (d < z.r) inside = z;
      const m = z.marker;
      const pulse = 0.5 + 0.5 * Math.sin(time * 2.4 + m.phase);
      m.beam.material.opacity = (z.visited ? 0.12 : 0.3) + pulse * 0.1;
      m.ring.material.opacity = inside === z ? 1 : 0.65 + pulse * 0.3;
      m.disc.material.opacity = inside === z ? 0.28 : 0.1;
      m.label.position.y = m.labelY + Math.sin(time * 1.6 + m.phase) * 0.35;
    }
    if (inside !== activeZone) {
      activeZone = inside;
      if (inside) inside.visited = true;
      listeners.zone(inside);
    }
    if (trophy) trophy.rotation.y += dt * 0.8;
    waveFlags(time);

    // Camera
    const speed = car.speed;
    const sp = Math.abs(speed);
    if (intro) {
      const a = time * 0.18 + 2.2;
      desired.set(car.x + Math.sin(a) * 9, 2.4 + Math.sin(time * 0.3) * 0.6, car.z + Math.cos(a) * 9);
      camPos.copy(desired);
      look.set(car.x, 0.7, car.z);
      camera.fov = 45;
    } else {
      // Follow the direction of travel, not just the nose, so slides look like slides
      const velYaw = sp > 3 && speed > 0 ? Math.atan2(car.vx, car.vz) : car.yaw;
      const target = speed < -1 ? car.yaw : car.yaw + angleDiff(velYaw, car.yaw) * 0.6;
      camYaw += angleDiff(target, camYaw) * (1 - Math.exp(-(camMode ? 2.5 : 4.5) * dt));
      if (!dragging) {
        orbit = damp(orbit, 0, sp > 2 ? 2 : 0.4, dt);
        orbitPitch = damp(orbitPitch, 0, 2, dt);
      }
      const yaw = camYaw + orbit;
      const portrait = camera.aspect < 1;
      const dist = (camMode ? 20 : 8.6 + sp * 0.045) * (portrait ? 1.35 : 1);
      const height = camMode ? 13 : 2.9 + sp * 0.012 + orbitPitch * 6;
      desired.set(car.x - Math.sin(yaw) * dist, height, car.z - Math.cos(yaw) * dist);
      camPos.lerp(desired, 1 - Math.exp(-(camMode ? 4 : 9) * dt));
      if (camPos.y < 0.8) camPos.y = 0.8;
      const ahead = camMode ? 2 : 6;
      look.set(car.x + Math.sin(yaw) * ahead, camMode ? 0.5 : 1.25, car.z + Math.cos(yaw) * ahead);
      camera.fov = damp(camera.fov, (camMode ? 50 : 56) + sp * 0.16 + (portrait ? 14 : 0), 3, dt);
    }
    camera.position.copy(camPos);
    shake = damp(shake, 0, 6, dt);
    const buzz = shake * 0.25 + (sp > 60 ? (sp - 60) * 0.0008 : 0);
    camera.position.x += (Math.random() - 0.5) * buzz;
    camera.position.y += (Math.random() - 0.5) * buzz;
    camera.lookAt(look);
    camera.updateProjectionMatrix();

    // Sun shadow follows the car
    sun.position.set(car.x + sunDir.x * 120, sunDir.y * 120, car.z + sunDir.z * 120);
    sun.target.position.set(car.x, 0, car.z);

    renderer.render(scene, camera);
  }

  function resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  resize();
  camPos.copy(camera.position);

  // Car-vs-prop feedback: heavy things slow the car
  carBody.addEventListener('collide', (e) => {
    const m = e.body.mass;
    if (!m) return;
    const f = 1 - 0.05 * (m / (m + 150));
    car.vx *= f;
    car.vz *= f;
  });

  onProgress(1);

  return {
    car,
    zones,
    track: P,
    renderer,
    step,
    resize,
    resetCar,
    teleport,
    setStartLights,
    setIntro(v) {
      intro = v;
      if (!v) {
        camPos.set(car.x - Math.sin(car.yaw) * 12, 4.5, car.z - Math.cos(car.yaw) * 12);
        camYaw = car.yaw;
      }
    },
    toggleCamera() {
      camMode = (camMode + 1) % 2;
      return camMode;
    },
    orbitBy(dx, dy) {
      orbit += dx;
      orbitPitch = clamp(orbitPitch + dy, -0.3, 1.2);
    },
    setDragging(v) {
      dragging = v;
    },
    on(name, fn) {
      listeners[name] = fn;
    },
  };
}
