// Real-time 3D scene: a floodlit night circuit where each career milestone is
// a stop along the lap. The page tells the scene which stop it is on (a
// fractional index); the car holds at each stop, then races to the next.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { buildCar } from './car.js';

const RED = 0xe10600;
const TRACK_WIDTH = 12;
const UP = new THREE.Vector3(0, 1, 0);

const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

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

function noise(ctx, w, h, base, spread) {
  const img = ctx.createImageData(w, h);
  for (let i = 0; i < w * h; i++) {
    const v = base + (Math.random() - 0.5) * spread;
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
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

// Trackside LED board showing one milestone
function boardTexture({ num, title, sub, date }) {
  return canvasTexture(1024, 512, (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#16161d');
    g.addColorStop(1, '#0a0a0e');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#e10600';
    ctx.fillRect(0, 0, w, 18);
    ctx.fillRect(0, 0, 18, h);
    ctx.fillStyle = 'rgba(255,255,255,0.05)';
    for (let x = 0; x < w; x += 6) ctx.fillRect(x, 0, 1, h);
    ctx.fillStyle = '#e10600';
    ctx.font = 'italic 900 150px "Titillium Web", Arial, sans-serif';
    ctx.fillText(num, 60, 190);
    ctx.fillStyle = '#ffffff';
    ctx.font = '700 62px "Titillium Web", Arial, sans-serif';
    wrapText(ctx, title.toUpperCase(), 60, 290, w - 120, 66, 2);
    ctx.fillStyle = '#b8b8c6';
    ctx.font = '400 38px "Titillium Web", Arial, sans-serif';
    ctx.fillText(sub, 60, 450);
    if (date) {
      ctx.fillStyle = '#2bd96b';
      ctx.font = '600 32px "JetBrains Mono", monospace';
      ctx.textAlign = 'right';
      ctx.fillText(date.toUpperCase(), w - 60, 110);
    }
  });
}

const FLAG_COLOURS = {
  green: ['#139a43', '#ffffff'],
  purple: ['#7a2bd1', '#ffffff'],
  blue: ['#1d5bd8', '#ffffff'],
  yellow: ['#f2c200', '#141414'],
  white: ['#efefef', '#141414'],
  chequered: ['#111111', '#ffffff'],
};

// Marshal flag carrying one milestone, in F1 flag colours
function flagTexture({ flag = 'green', num, title, sub, date }) {
  const [bg, ink] = FLAG_COLOURS[flag] || FLAG_COLOURS.green;
  return canvasTexture(1024, 640, (ctx, w, h) => {
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);
    if (flag === 'chequered') {
      for (let y = 0; y < h; y += 64) {
        for (let x = 0; x < w; x += 64) {
          if ((x + y) / 64 % 2) {
            ctx.fillStyle = '#f2f2f2';
            ctx.fillRect(x, y, 64, 64);
          }
        }
      }
      ctx.fillStyle = 'rgba(10,10,12,0.85)';
      ctx.fillRect(40, 60, w - 80, h - 120);
    }
    // Fabric shading
    const g = ctx.createLinearGradient(0, 0, w, 0);
    for (let i = 0; i <= 6; i++) g.addColorStop(i / 6, i % 2 ? 'rgba(0,0,0,0.12)' : 'rgba(255,255,255,0.06)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = ink;
    ctx.globalAlpha = 0.9;
    ctx.font = 'italic 900 120px "Titillium Web", Arial, sans-serif';
    ctx.fillText(num, 80, 190);
    ctx.globalAlpha = 1;
    ctx.font = '700 66px "Titillium Web", Arial, sans-serif';
    wrapText(ctx, title.toUpperCase(), 80, 300, w - 160, 70, 2);
    ctx.font = '400 40px "Titillium Web", Arial, sans-serif';
    ctx.fillText(sub, 80, 470);
    if (date) {
      ctx.font = '600 34px "JetBrains Mono", monospace';
      ctx.textAlign = 'right';
      ctx.fillText(date.toUpperCase(), w - 80, 130);
    }
  });
}

export function createScene(canvas, { stops, reducedMotion = false }) {
  const isSmall = window.matchMedia('(max-width: 720px)').matches;

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, isSmall ? 1.5 : 1.75));
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = !isSmall;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x0c0c14, 0.0065);
  scene.background = canvasTexture(2, 512, (ctx) => {
    const g = ctx.createLinearGradient(0, 0, 0, 512);
    g.addColorStop(0, '#04040a');
    g.addColorStop(0.5, '#0b0b16');
    g.addColorStop(0.66, '#2a1018');
    g.addColorStop(0.72, '#0c0c14');
    g.addColorStop(1, '#0c0c14');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 2, 512);
  });

  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.7;

  const camera = new THREE.PerspectiveCamera(38, window.innerWidth / window.innerHeight, 0.1, 900);

  // ---------- Post-processing: MSAA render, bloom, tone mapping ----------
  const target = new THREE.WebGLRenderTarget(window.innerWidth, window.innerHeight, {
    type: THREE.HalfFloatType,
    samples: 4,
  });
  const composer = new EffectComposer(renderer, target);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth / 2, window.innerHeight / 2), 0.42, 0.45, 0.93);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  // ---------- Lights ----------
  scene.add(new THREE.HemisphereLight(0x8e9cff, 0x1a0c0c, 0.45));

  const key = new THREE.DirectionalLight(0xfff4e6, 2.1);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  Object.assign(key.shadow.camera, { left: -9, right: 9, top: 9, bottom: -9, near: 1, far: 60 });
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.02;
  scene.add(key, key.target);

  const rim = new THREE.SpotLight(0xff3b2e, 28, 30, 0.6, 0.6, 1.4);
  const fill = new THREE.SpotLight(0x7fb2ff, 16, 30, 0.6, 0.6, 1.4);
  scene.add(rim, rim.target, fill, fill.target);

  // ---------- Ground ----------
  const groundTex = canvasTexture(256, 256, (ctx, w, h) => noise(ctx, w, h, 22, 14), { repeat: [120, 120] });
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(1200, 1200),
    new THREE.MeshStandardMaterial({ map: groundTex, color: 0x5a6a5c, roughness: 1 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  // ---------- Track ----------
  const curve = new THREE.CatmullRomCurve3(
    [
      [0, 0], [60, -2], [105, -22], [118, -62], [96, -100], [48, -112], [14, -88],
      [-12, -62], [-52, -78], [-98, -60], [-110, -10], [-82, 22], [-40, 16],
    ].map(([x, z]) => new THREE.Vector3(x, 0, z)),
    true,
    'centripetal'
  );
  const trackLength = curve.getLength();
  const SAMPLES = 1400;
  const frames = [];
  for (let i = 0; i <= SAMPLES; i++) {
    const u = (i / SAMPLES) % 1;
    const p = curve.getPointAt(u);
    const t = curve.getTangentAt(u);
    frames.push({ p, t, side: new THREE.Vector3().crossVectors(t, UP).normalize() });
  }
  const seg = trackLength / SAMPLES;

  function strip(a, b, y, material, { colorAt, vScale = 1 / TRACK_WIDTH, skip } = {}) {
    const pos = [];
    const uv = [];
    const col = [];
    const c = new THREE.Color();
    for (let i = 0; i < SAMPLES; i++) {
      if (skip?.(i)) continue;
      const f0 = frames[i];
      const f1 = frames[i + 1];
      const v = (f, o) => [f.p.x + f.side.x * o, y, f.p.z + f.side.z * o];
      const q = [v(f0, a), v(f0, b), v(f1, a), v(f1, b)];
      pos.push(...q[0], ...q[2], ...q[1], ...q[1], ...q[2], ...q[3]);
      const v0 = i * seg * vScale;
      const v1 = (i + 1) * seg * vScale;
      uv.push(0, v0, 0, v1, 1, v0, 1, v0, 0, v1, 1, v1);
      if (colorAt) {
        c.set(colorAt(i));
        for (let k = 0; k < 6; k++) col.push(c.r, c.g, c.b);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    if (colorAt) g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, material);
    m.receiveShadow = true;
    scene.add(m);
    return m;
  }

  function wall(o, h, material, uScale, skip) {
    const pos = [];
    const uv = [];
    for (let i = 0; i < SAMPLES; i++) {
      if (skip?.(i)) continue;
      const f0 = frames[i];
      const f1 = frames[i + 1];
      const x0 = f0.p.x + f0.side.x * o, z0 = f0.p.z + f0.side.z * o;
      const x1 = f1.p.x + f1.side.x * o, z1 = f1.p.z + f1.side.z * o;
      pos.push(x0, 0, z0, x1, 0, z1, x0, h, z0, x0, h, z0, x1, 0, z1, x1, h, z1);
      const u0 = i * seg * uScale;
      const u1 = (i + 1) * seg * uScale;
      uv.push(u0, 0, u1, 0, u0, 1, u0, 1, u1, 0, u1, 1);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, material);
    m.receiveShadow = true;
    scene.add(m);
  }

  const half = TRACK_WIDTH / 2;

  // Pit boxes: work experience stops pull off the track on the side away from the camera
  const PIT_REACH = 40; // metres either side of the box where the pit lane exists
  const pits = stops
    .filter((s) => s.kind === 'pit')
    .map((s) => ({ ...s, u: s.u % 1, side: -Math.sign(s.cam || 1), centre: Math.round((s.u % 1) * SAMPLES) }));
  const pitSamples = Math.round(PIT_REACH / seg);
  const inPit = (i, side) =>
    pits.some((p) => p.side === side && Math.abs(((i - p.centre + SAMPLES * 1.5) % SAMPLES) - SAMPLES / 2) <= pitSamples);

  // Asphalt with grain, a rubbered-in racing line and a light wet sheen
  const asphaltTex = canvasTexture(512, 512, (ctx, w, h) => {
    noise(ctx, w, h, 58, 34);
    const g = ctx.createLinearGradient(0, 0, w, 0);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(0.5, 'rgba(0,0,0,0.28)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }, { repeat: [1, 1] });
  strip(-half, half, 0.02, new THREE.MeshPhysicalMaterial({
    map: asphaltTex, color: 0x6a6a72, roughness: 0.62, metalness: 0, clearcoat: 0.35, clearcoatRoughness: 0.35,
  }));

  const lineMat = new THREE.MeshStandardMaterial({ color: 0xe6e6e6, roughness: 0.5 });
  strip(half - 0.5, half - 0.3, 0.03, lineMat);
  strip(-half + 0.3, -half + 0.5, 0.03, lineMat);

  const kerbMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45 });
  const kerbColor = (i) => (Math.floor(i / 2) % 2 ? 0xbdbdbd : 0xb00804);
  strip(half, half + 1.3, 0.04, kerbMat, { colorAt: kerbColor });
  strip(-half - 1.3, -half, 0.04, kerbMat, { colorAt: kerbColor });

  // Run-off: tarmac apron, then grass
  const runoffMat = new THREE.MeshStandardMaterial({ map: asphaltTex, color: 0x3a3a42, roughness: 0.85 });
  strip(half + 1.3, half + 4, 0.015, runoffMat);
  strip(-half - 4, -half - 1.3, 0.015, runoffMat);
  const grassTex = canvasTexture(256, 256, (ctx, w, h) => noise(ctx, w, h, 70, 40), { repeat: [1, 1] });
  const grassMat = new THREE.MeshStandardMaterial({ map: grassTex, color: 0x24402a, roughness: 1 });
  strip(half + 4, half + 11, 0.01, grassMat, { vScale: 1 / 4 });
  strip(-half - 11, -half - 4, 0.01, grassMat, { vScale: 1 / 4 });

  // Barriers with painted panels and an LED strip along the top
  const barrierTex = canvasTexture(512, 64, (ctx, w, h) => {
    for (let i = 0; i < 4; i++) {
      ctx.fillStyle = i % 2 ? '#bcbcbc' : '#9a0805';
      ctx.fillRect((i * w) / 4, 0, w / 4, h);
    }
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(0, h * 0.85, w, h * 0.15);
  });
  barrierTex.wrapS = THREE.RepeatWrapping;
  const barrierMat = new THREE.MeshStandardMaterial({ map: barrierTex, roughness: 0.6, side: THREE.DoubleSide });
  wall(half + 11, 1.1, barrierMat, 1 / 16, (i) => inPit(i, 1));
  wall(-half - 11, 1.1, barrierMat, 1 / 16, (i) => inPit(i, -1));
  strip(half + 10.9, half + 11.1, 1.12, new THREE.MeshBasicMaterial({ color: 0xff3324 }), { skip: (i) => inPit(i, 1) });
  strip(-half - 11.1, -half - 10.9, 1.12, new THREE.MeshBasicMaterial({ color: 0xdfe6ff }), { skip: (i) => inPit(i, -1) });

  // Start / finish line and grid slots
  {
    const tex = canvasTexture(64, 768, (ctx) => {
      for (let y = 0; y < 24; y++) {
        for (let x = 0; x < 2; x++) {
          ctx.fillStyle = (x + y) % 2 ? '#111' : '#bdbdbd';
          ctx.fillRect(x * 32, y * 32, 32, 32);
        }
      }
    });
    const f = frames[0];
    const line = new THREE.Mesh(new THREE.PlaneGeometry(1.4, TRACK_WIDTH), new THREE.MeshStandardMaterial({ map: tex, color: 0x8a8a8a, roughness: 0.9 }));
    line.position.copy(f.p).setY(0.035);
    line.rotation.set(-Math.PI / 2, 0, Math.atan2(-f.t.z, f.t.x));
    line.receiveShadow = true;
    scene.add(line);
    for (let k = 1; k <= 6; k++) {
      const fi = frames[SAMPLES - Math.round((k * 9) / seg)];
      const slot = new THREE.Mesh(new THREE.PlaneGeometry(0.25, 3), lineMat);
      slot.position.copy(fi.p).addScaledVector(fi.side, (k % 2 ? -1 : 1) * 2.6).setY(0.035);
      slot.rotation.set(-Math.PI / 2, 0, Math.atan2(-fi.t.z, fi.t.x));
      scene.add(slot);
    }
  }

  // Start gantry with five lights
  const gantryLights = [];
  {
    const u = 25 / trackLength;
    const p = curve.getPointAt(u);
    const t = curve.getTangentAt(u);
    const g = new THREE.Group();
    g.position.copy(p);
    g.rotation.y = Math.atan2(t.x, t.z);
    const steel = new THREE.MeshStandardMaterial({ color: 0x2a2a33, roughness: 0.4, metalness: 0.85 });
    for (const x of [-half - 2, half + 2]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.5, 8, 0.5), steel);
      post.position.set(x, 4, 0);
      post.castShadow = true;
      g.add(post);
    }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(TRACK_WIDTH + 4.5, 1, 0.6), steel);
    beam.position.y = 7.6;
    g.add(beam);
    const housing = new THREE.Mesh(new THREE.BoxGeometry(6, 1.3, 0.6), new THREE.MeshStandardMaterial({ color: 0x050507 }));
    housing.position.set(0, 6.5, -0.05);
    g.add(housing);
    for (let i = 0; i < 5; i++) {
      const m = new THREE.Mesh(new THREE.CircleGeometry(0.42, 32), new THREE.MeshBasicMaterial({ color: 0x2a0b0b }));
      // Faces back down the straight, towards the grid
      m.position.set(-2.4 + i * 1.2, 6.5, -0.36);
      m.rotation.y = Math.PI;
      g.add(m);
      gantryLights.push(m);
    }
    scene.add(g);
  }

  // Floodlight towers
  {
    const count = 34;
    const poles = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.18, 0.28, 22, 8),
      new THREE.MeshStandardMaterial({ color: 0x2a2a32, roughness: 0.5, metalness: 0.7 }),
      count
    );
    const heads = new THREE.InstancedMesh(new THREE.BoxGeometry(3.2, 1.2, 0.3), new THREE.MeshBasicMaterial({ color: 0xfff3dc }), count);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const one = new THREE.Vector3(1, 1, 1);
    for (let i = 0; i < count; i++) {
      const f = frames[Math.floor((i / count) * SAMPLES)];
      const o = (i % 2 ? 1 : -1) * (half + 15);
      const x = f.p.x + f.side.x * o;
      const z = f.p.z + f.side.z * o;
      q.setFromAxisAngle(UP, Math.atan2(f.t.x, f.t.z));
      m.compose(new THREE.Vector3(x, 11, z), q, one);
      poles.setMatrixAt(i, m);
      m.compose(new THREE.Vector3(x, 22, z), q, one);
      heads.setMatrixAt(i, m);
    }
    scene.add(poles, heads);
  }

  // Grandstands with a crowd
  function grandstand(fi, o, length) {
    const f = frames[fi];
    const g = new THREE.Group();
    g.position.copy(f.p).addScaledVector(f.side, o);
    // Local +x points away from the track
    const outward = f.side.clone().multiplyScalar(Math.sign(o));
    g.rotation.y = Math.atan2(-outward.z, outward.x);
    const mat = new THREE.MeshStandardMaterial({ color: 0x1d1d26, roughness: 0.8 });
    const rows = 9;
    const crowd = [];
    const colors = [];
    const palette = [0xe10600, 0xffffff, 0xffcf1a, 0x2b6bff, 0x1fb85a, 0xff7a00];
    const c = new THREE.Color();
    for (let r = 0; r < rows; r++) {
      const step = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.6 * (r + 1), length), mat);
      step.position.set(r * 1.2 + 0.6, 0.3 * (r + 1), 0);
      step.receiveShadow = true;
      g.add(step);
      for (let k = 0; k < length * 1.6; k++) {
        if (Math.random() < 0.25) continue;
        crowd.push(r * 1.2 + 0.6 + (Math.random() - 0.5) * 0.4, 0.6 * (r + 1) + 0.35, -length / 2 + k / 1.6 + Math.random() * 0.3);
        c.set(palette[Math.floor(Math.random() * palette.length)]).multiplyScalar(0.4 + Math.random() * 0.4);
        colors.push(c.r, c.g, c.b);
      }
    }
    const roof = new THREE.Mesh(new THREE.BoxGeometry(rows * 1.2 + 2, 0.3, length + 2), mat);
    roof.position.set(rows * 0.6, 0.6 * rows + 4, 0);
    g.add(roof);
    const led = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.25, length + 2), new THREE.MeshBasicMaterial({ color: RED }));
    led.position.set(-0.4, 0.6 * rows + 3.9, 0);
    g.add(led);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(crowd, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    g.add(new THREE.Points(geo, new THREE.PointsMaterial({ size: 0.45, vertexColors: true })));
    scene.add(g);
  }
  grandstand(Math.floor(SAMPLES * 0.035), half + 20, 60);
  grandstand(Math.floor(SAMPLES * 0.6), -half - 20, 50);

  // Distant city skyline, unaffected by fog so it reads as a backdrop
  {
    const winTex = canvasTexture(64, 128, (ctx, w, h) => {
      ctx.fillStyle = '#07070c';
      ctx.fillRect(0, 0, w, h);
      for (let y = 4; y < h; y += 8) {
        for (let x = 4; x < w; x += 8) {
          if (Math.random() < 0.35) {
            ctx.fillStyle = Math.random() < 0.8 ? '#ffd9a0' : '#9fc4ff';
            ctx.globalAlpha = 0.25 + Math.random() * 0.5;
            ctx.fillRect(x, y, 3, 4);
          }
        }
      }
    });
    const count = 90;
    const city = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ map: winTex, fog: false, color: 0x8888a0 }), count);
    const m = new THREE.Matrix4();
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + Math.random() * 0.05;
      const r = 330 + Math.random() * 60;
      const hgt = 20 + Math.random() ** 2 * 90;
      const w = 10 + Math.random() * 18;
      m.compose(
        new THREE.Vector3(Math.cos(a) * r, hgt / 2, Math.sin(a) * r - 50),
        new THREE.Quaternion().setFromAxisAngle(UP, -a),
        new THREE.Vector3(w, hgt, w)
      );
      city.setMatrixAt(i, m);
    }
    scene.add(city);
  }

  // Stars
  {
    const n = 900;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const e = 0.15 + Math.random() * 1.3;
      pos.set([Math.cos(a) * Math.cos(e) * 600, Math.sin(e) * 600, Math.sin(a) * Math.cos(e) * 600], i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    scene.add(new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffffff, size: 1.2, sizeAttenuation: false, fog: false, transparent: true, opacity: 0.6 })));
  }

  // ---------- Milestones: marshal flags and pit boxes ----------
  // Each stop: { u, cam (+1/-1 side the parked camera sits), frame, kind, flag, num, title, sub, date }
  // The parked camera looks back at the car from ahead, so flags stand behind
  // the car on the far side of the track, turned to face the camera.
  const flags = [];
  const frameAt = (u) => {
    const p = curve.getPointAt(((u % 1) + 1) % 1);
    const t = curve.getTangentAt(((u % 1) + 1) % 1);
    return { p, t, side: new THREE.Vector3().crossVectors(t, UP).normalize() };
  };
  const parkedCamAt = (s) => {
    const f = frameAt(s.u);
    return f.p.clone().addScaledVector(f.t, Math.cos(0.95) * 8.4).addScaledVector(f.side, Math.sin(0.95 * s.cam) * 8.4);
  };
  const steel = new THREE.MeshStandardMaterial({ color: 0x8c8c96, roughness: 0.3, metalness: 0.9 });

  stops.filter((s) => s.kind === 'flag').forEach((s) => {
    const f = frameAt(s.u - 13 / trackLength);
    const flagSide = -Math.sign(s.cam || 1);
    const g = new THREE.Group();
    g.position.copy(f.p).addScaledVector(f.side, flagSide * (half + 4));
    const cam = parkedCamAt(s);
    g.lookAt(cam.x, 0, cam.z);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 6.6, 12), steel);
    pole.position.set(-3.3, 3.3, 0);
    pole.castShadow = true;
    g.add(pole);
    const finial = new THREE.Mesh(new THREE.SphereGeometry(0.14, 16, 12), steel);
    finial.position.set(-3.3, 6.65, 0);
    g.add(finial);
    const geo = new THREE.PlaneGeometry(6.4, 4, 36, 18);
    geo.translate(3.2 - 3.3, 0, 0);
    const cloth = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
      map: flagTexture(s), roughness: 0.75, side: THREE.DoubleSide, emissive: 0xffffff, emissiveIntensity: 0.18,
    }));
    cloth.material.emissiveMap = cloth.material.map;
    cloth.position.y = 4.4;
    cloth.castShadow = true;
    g.add(cloth);
    flags.push({ geo, base: Float32Array.from(geo.attributes.position.array), phase: Math.random() * 6 });
    scene.add(g);
  });

  // Animate cloth: a travelling wave pinned at the pole
  function waveFlags(t) {
    for (const fl of flags) {
      const pos = fl.geo.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const x = fl.base[i * 3] + 3.3; // 0 at the pole
        const y = fl.base[i * 3 + 1];
        const k = x / 6.4;
        pos.setZ(i, Math.sin(x * 1.3 - t * 4.2 + fl.phase + y * 0.25) * 0.38 * k + Math.sin(x * 2.9 - t * 6.1) * 0.08 * k);
        pos.setY(i, y - k * k * 0.35);
      }
      pos.needsUpdate = true;
      fl.geo.computeVertexNormals();
    }
  }

  // Pit box: apron, garage with lit interior, overhead sign and pit crew
  const apronMat = new THREE.MeshStandardMaterial({ map: asphaltTex, color: 0x55555e, roughness: 0.7 });
  const pitLineMat = new THREE.MeshStandardMaterial({ color: 0xf2c200, roughness: 0.6 });
  pits.forEach((p) => {
    const inThis = (i) => Math.abs(((i - p.centre + SAMPLES * 1.5) % SAMPLES) - SAMPLES / 2) <= pitSamples;
    const [a, b] = p.side > 0 ? [half + 1.3, half + 11] : [-half - 11, -half - 1.3];
    strip(a, b, 0.025, apronMat, { skip: (i) => !inThis(i) });
    const lo = p.side > 0 ? half + 1.6 : -half - 1.8;
    strip(lo, lo + 0.2, 0.03, pitLineMat, { skip: (i) => !inThis(i) });

    const f = frameAt(p.u);
    const box = f.p.clone().addScaledVector(f.side, p.side * (half + 5.5));
    const garage = new THREE.Group();
    garage.position.copy(f.p).addScaledVector(f.side, p.side * (half + 14));
    garage.lookAt(f.p.x, 0, f.p.z);
    const wallMat = new THREE.MeshStandardMaterial({ color: 0x1b1b22, roughness: 0.6, metalness: 0.3 });
    const W = 16;
    const back = new THREE.Mesh(new THREE.BoxGeometry(W, 6, 0.4), wallMat);
    back.position.set(0, 3, -3.5);
    garage.add(back);
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(W - 1, 4.6), new THREE.MeshBasicMaterial({ map: boardTexture(p), toneMapped: false, color: 0x9a9a9a }));
    glow.position.set(0, 3, -3.28);
    garage.add(glow);
    for (const x of [-W / 2, W / 2]) {
      const sideWall = new THREE.Mesh(new THREE.BoxGeometry(0.4, 6, 7), wallMat);
      sideWall.position.set(x, 3, 0);
      garage.add(sideWall);
    }
    const roof = new THREE.Mesh(new THREE.BoxGeometry(W + 0.8, 0.5, 8), wallMat);
    roof.position.set(0, 6.25, 0.3);
    garage.add(roof);
    const fascia = new THREE.Mesh(new THREE.BoxGeometry(W + 0.8, 0.3, 0.1), new THREE.MeshBasicMaterial({ color: RED }));
    fascia.position.set(0, 5.9, 4.3);
    garage.add(fascia);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(W, 7), new THREE.MeshStandardMaterial({ color: 0x2a2a33, roughness: 0.25, metalness: 0.2 }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0, 0.03, 0);
    garage.add(floor);
    const lamp = new THREE.PointLight(0xfff1dd, 30, 22, 1.6);
    lamp.position.set(0, 5.4, 1.5);
    garage.add(lamp);
    scene.add(garage);

    // Pit crew around the box: four wheel crews, front and rear jacks, lollipop
    const suit = new THREE.MeshStandardMaterial({ color: 0x1a1a1f, roughness: 0.7 });
    const stripe = new THREE.MeshStandardMaterial({ color: RED, roughness: 0.5 });
    const lid = new THREE.MeshStandardMaterial({ color: 0x9a9aa2, roughness: 0.4 });
    // Kept behind and beside the car so the camera, parked ahead, sees past them
    const spots = [[1.5, 1.8], [-1.5, 1.8], [1.6, -1.8], [-1.6, -1.8], [0, -3.6], [-2.6, 0.2]];
    for (const [lx, lz] of spots) {
      const person = new THREE.Group();
      const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.24, 0.85, 6, 12), suit);
      body.position.y = 0.75;
      const band = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 0.12, 12), stripe);
      band.position.y = 0.95;
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.17, 16, 12), lid);
      head.position.y = 1.55;
      person.add(body, band, head);
      person.position.copy(box).addScaledVector(f.side, lx).addScaledVector(f.t, lz);
      person.lookAt(box.x, 0, box.z);
      // Kneel the wheel crews
      if (Math.abs(lz) > 1 && Math.abs(lz) < 2) person.scale.y = 0.72;
      person.traverse((o) => (o.castShadow = true));
      scene.add(person);
    }
  });

  // How far the car sits towards a pit box (metres along its side vector)
  function pitOffset(u) {
    let off = 0;
    for (const p of pits) {
      let d = Math.abs(u - p.u) * trackLength;
      d = Math.min(d, trackLength - d);
      off += p.side * (half + 5.5) * smoothstep(PIT_REACH, 14, d);
    }
    return off;
  }

  // ---------- Car ----------
  let car = buildCar();
  scene.add(car.group);
  if (isSmall) car.group.traverse((o) => (o.castShadow = false));

  // Rival cars lapping in their own lanes, so the circuit feels like a race
  const rivalSpecs = [
    { base: '#00a19c', number: '44', helmetColor: 0xffffff, lane: 3.4, speed: 54, u0: 0.31 },
    { base: '#ff8000', number: '4', helmetColor: 0x1d5bd8, lane: -3.4, speed: 57, u0: 0.58 },
    { base: '#1e3cd6', number: '1', helmetColor: 0xf2c200, lane: 3.4, speed: 59, u0: 0.83 },
    { base: '#0b6e5f', number: '14', helmetColor: 0xffffff, lane: -3.4, speed: 51, u0: 0.12 },
  ].slice(0, isSmall ? 2 : 4);
  const rivals = rivalSpecs.map((spec) => {
    const r = buildCar(spec);
    r.group.traverse((o) => (o.castShadow = false));
    scene.add(r.group);
    return { ...spec, car: r, u: spec.u0 };
  });
  const rp = new THREE.Vector3();
  const rt = new THREE.Vector3();
  const rs = new THREE.Vector3();
  function driveRivals(dt) {
    const pace = reducedMotion ? 0.25 : 1;
    for (const r of rivals) {
      const step = r.speed * pace * dt;
      r.u = (r.u + step / trackLength) % 1;
      curve.getPointAt(r.u, rp);
      curve.getTangentAt(r.u, rt);
      rs.crossVectors(rt, UP).normalize();
      r.car.group.position.copy(rp).addScaledVector(rs, r.lane);
      r.car.group.rotation.y = Math.atan2(rt.x, rt.z);
      r.car.spin(step);
      r.car.tick(elapsed + r.u0 * 10);
    }
  }

  // Optional photoreal model: drop a glTF at assets/f1-car.glb to replace the procedural car.
  // assets/f1-car.json may set { "rotateY": degrees, "length": metres }.
  fetch('assets/f1-car.glb', { method: 'HEAD' })
    .then(async (res) => {
      if (!res.ok) return;
      const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
      const cfg = await fetch('assets/f1-car.json').then((r) => (r.ok ? r.json() : {})).catch(() => ({}));
      const gltf = await new GLTFLoader().loadAsync('assets/f1-car.glb');
      const model = gltf.scene;
      model.rotation.y = THREE.MathUtils.degToRad(cfg.rotateY || 0);
      const box = new THREE.Box3().setFromObject(model);
      const size = box.getSize(new THREE.Vector3());
      model.scale.setScalar((cfg.length || 5.6) / Math.max(size.x, size.z));
      box.setFromObject(model);
      const centre = box.getCenter(new THREE.Vector3());
      model.position.sub(new THREE.Vector3(centre.x, box.min.y, centre.z));
      model.traverse((o) => {
        if (o.isMesh) o.castShadow = o.receiveShadow = true;
      });
      const holder = new THREE.Group();
      holder.add(model);
      scene.remove(car.group);
      scene.add(holder);
      car = { group: holder, spin() {}, steer() {}, tick() {} };
    })
    .catch(() => {});

  // ---------- Camera rig ----------
  const state = {
    target: 0, // fractional stop index set by the page
    f: 0,
    mouse: new THREE.Vector2(),
    mouseSmooth: new THREE.Vector2(),
    speedKmh: 0,
    frameSmooth: stops[0]?.frame ?? 0,
  };
  const clock = new THREE.Clock();
  const v = {
    pos: new THREE.Vector3(),
    fwd: new THREE.Vector3(),
    side: new THREE.Vector3(),
    dir: new THREE.Vector3(),
    parked: new THREE.Vector3(),
    chase: new THREE.Vector3(),
    lookParked: new THREE.Vector3(),
    lookChase: new THREE.Vector3(),
    cam: new THREE.Vector3(),
    look: new THREE.Vector3(),
    air: new THREE.Vector3(),
    prevFwd: new THREE.Vector3(0, 0, 1),
  };
  let lastU = 0;
  let steer = 0;
  let elapsed = 0;

  // Hold at each stop for the first part of the scroll between stops, then drive
  function lapState(f) {
    const last = stops.length - 1;
    const fc = Math.min(Math.max(f, 0), last);
    const i = Math.min(Math.floor(fc), last - 1);
    const e = smoothstep(0.2, 0.92, fc - i);
    const a = stops[i];
    const b = stops[i + 1];
    const ub = b.u < a.u ? b.u + 1 : b.u;
    const mix = (k) => (a[k] || 0) + ((b[k] || 0) - (a[k] || 0)) * e;
    return { u: a.u + (ub - a.u) * e, moving: Math.sin(Math.PI * e), cam: mix('cam'), frame: mix('frame'), aerial: mix('aerial'), pit: mix('pit') };
  }

  function update(dt) {
    elapsed += dt;
    state.f += (state.target - state.f) * (reducedMotion ? 1 : 1 - Math.exp(-dt * 2.4));
    state.mouseSmooth.lerp(state.mouse, 1 - Math.exp(-dt * 4));
    const L = lapState(state.f);

    const u = ((L.u % 1) + 1) % 1;
    curve.getPointAt(u, v.pos);
    curve.getTangentAt(u, v.fwd);
    v.side.crossVectors(v.fwd, UP).normalize();
    v.pos.addScaledVector(v.side, pitOffset(u));
    driveRivals(dt);
    waveFlags(elapsed);

    // Car placement, wheel spin and steering
    car.group.position.copy(v.pos);
    car.group.rotation.y = Math.atan2(v.fwd.x, v.fwd.z);
    const dist = (L.u - lastU) * trackLength;
    lastU = L.u;
    car.spin(dist);
    const turn = v.prevFwd.x * v.fwd.z - v.prevFwd.z * v.fwd.x;
    v.prevFwd.copy(v.fwd);
    const steerTarget = Math.abs(dist) > 0.01 ? THREE.MathUtils.clamp((-turn / Math.abs(dist)) * 8, -0.4, 0.4) : 0;
    steer += (steerTarget - steer) * (1 - Math.exp(-dt * 6));
    car.steer(steer);
    car.tick(elapsed);

    const kmh = dt > 0 ? Math.min(338, (Math.abs(dist) / dt) * 3.6 * 1.6) : 0;
    state.speedKmh += (kmh - state.speedKmh) * (1 - Math.exp(-dt * 5));

    const mx = state.mouseSmooth.x;
    const my = state.mouseSmooth.y;

    // Parked: low three-quarter front view from the camera side, slowly drifting
    const drift = reducedMotion ? 0 : Math.sin(elapsed * 0.15) * 0.22;
    const ang = 0.95 * L.cam + drift + mx * 0.3;
    v.dir.copy(v.fwd).multiplyScalar(Math.cos(ang)).addScaledVector(v.side, Math.sin(ang));
    v.parked.copy(v.pos).addScaledVector(v.dir, (isSmall ? 12 : 8.4) + L.pit * 2.5);
    v.parked.y = 1.45 + L.pit * 1.6 + my * 0.5;
    v.lookParked.copy(v.pos).setY(isSmall ? -2.4 : 0.55);

    // Chase: low and close behind the car
    v.chase.copy(v.pos).addScaledVector(v.fwd, -7.2).addScaledVector(v.side, mx * 1.2);
    v.chase.y = 2.1 + my * 0.4;
    v.lookChase.copy(v.pos).addScaledVector(v.fwd, 8).setY(0.6);

    v.cam.lerpVectors(v.parked, v.chase, L.moving);
    v.look.lerpVectors(v.lookParked, v.lookChase, L.moving);

    // Finish: crane up over the chequered line
    if (L.aerial > 0) {
      v.air.copy(v.pos).addScaledVector(v.fwd, 7).addScaledVector(v.side, -9).setY(15);
      v.cam.lerp(v.air, L.aerial);
      v.look.lerp(v.pos, L.aerial);
    }

    camera.position.copy(v.cam);
    camera.lookAt(v.look);
    camera.fov = (camera.aspect < 1 ? 52 : 36) + L.moving * 12;
    state.frameSmooth += (L.frame - state.frameSmooth) * (reducedMotion ? 1 : 1 - Math.exp(-dt * 3));
    camera.filmOffset = isSmall ? 0 : state.frameSmooth * 8;
    camera.updateProjectionMatrix();

    // Lights travel with the car
    key.position.copy(v.pos).add(new THREE.Vector3(6, 18, 8));
    key.target.position.copy(v.pos);
    rim.position.copy(v.pos).addScaledVector(v.fwd, -6).addScaledVector(v.side, -5).setY(4);
    rim.target.position.copy(v.pos);
    fill.position.copy(v.pos).addScaledVector(v.fwd, 6).addScaledVector(v.side, 6).setY(4);
    fill.target.position.copy(v.pos);
  }

  renderer.setAnimationLoop(() => {
    update(Math.min(clock.getDelta(), 0.05));
    composer.render();
  });

  function resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
    composer.setSize(w, h);
    bloom.setSize(w / 2, h / 2);
  }
  window.addEventListener('resize', resize);
  resize();

  return {
    trackLength,
    setStop(f) {
      state.target = f;
    },
    setPointer(x, y) {
      state.mouse.set(x, y);
    },
    // n = number of gantry lights on (0-5)
    setStartLights(n) {
      gantryLights.forEach((m, i) => m.material.color.set(i < n ? 0xff2a1f : 0x2a0b0b));
    },
    get speed() {
      return state.speedKmh;
    },
  };
}
