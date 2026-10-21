// Real-time 3D scene: a night circuit with a procedurally built F1 car.
// Page scroll drives the car around one lap; the camera blends from a
// showroom orbit (hero) to a chase cam and finally an aerial finish shot.
import * as THREE from 'three';
import { RoomEnvironment } from './vendor/RoomEnvironment.js';

const RED = 0xe10600;
const TRACK_WIDTH = 10;
const UP = new THREE.Vector3(0, 1, 0);

const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export function createScene(canvas, { reducedMotion = false } = {}) {
  const isSmall = window.matchMedia('(max-width: 720px)').matches;

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, isSmall ? 1.5 : 1.75));
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = !isSmall;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x0d0d13, 0.0085);
  {
    // Night sky: near-black overhead with a faint warm glow at the horizon
    const cv = document.createElement('canvas');
    cv.width = 2;
    cv.height = 256;
    const ctx = cv.getContext('2d');
    const grad = ctx.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0, '#060609');
    grad.addColorStop(0.55, '#0d0d13');
    grad.addColorStop(0.7, '#1c0f14');
    grad.addColorStop(1, '#0d0d13');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 2, 256);
    const sky = new THREE.CanvasTexture(cv);
    sky.colorSpace = THREE.SRGBColorSpace;
    scene.background = sky;
  }

  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.55;

  const camera = new THREE.PerspectiveCamera(40, window.innerWidth / window.innerHeight, 0.1, 600);

  // ---------- Lights ----------
  scene.add(new THREE.HemisphereLight(0x9aa2ff, 0x1a0c0c, 0.6));

  const key = new THREE.DirectionalLight(0xffffff, 2.2);
  key.position.set(8, 16, 6);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = -12;
  key.shadow.camera.right = 12;
  key.shadow.camera.top = 12;
  key.shadow.camera.bottom = -12;
  key.shadow.camera.near = 1;
  key.shadow.camera.far = 50;
  key.shadow.bias = -0.0005;
  scene.add(key, key.target);

  const rim = new THREE.PointLight(0xff2a1f, 30, 20, 1.6);
  const fill = new THREE.PointLight(0x6aa8ff, 14, 20, 1.6);
  scene.add(rim, fill);

  // ---------- Ground ----------
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(800, 800),
    new THREE.MeshStandardMaterial({ color: 0x0c0c11, roughness: 0.95, metalness: 0 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const grid = new THREE.GridHelper(800, 160, 0x1d1d28, 0x15151d);
  grid.position.y = 0.005;
  scene.add(grid);

  // ---------- Track ----------
  const curve = new THREE.CatmullRomCurve3(
    [
      [0, 0], [45, -2], [75, -18], [82, -50], [62, -78], [24, -84], [4, -62],
      [-18, -44], [-48, -56], [-78, -38], [-76, 2], [-48, 18], [-20, 10],
    ].map(([x, z]) => new THREE.Vector3(x, 0, z)),
    true,
    'centripetal'
  );
  const trackLength = curve.getLength();
  const SAMPLES = 900;

  // Precompute frames along the centre line
  const frames = [];
  for (let i = 0; i <= SAMPLES; i++) {
    const u = i / SAMPLES;
    const p = curve.getPointAt(u % 1);
    const t = curve.getTangentAt(u % 1);
    const side = new THREE.Vector3().crossVectors(t, UP).normalize();
    frames.push({ p, t, side });
  }

  // Flat strip between two lateral offsets; colorAt(i) gives a per-segment colour
  function strip(a, b, y, material, colorAt) {
    const pos = [];
    const col = [];
    const c = new THREE.Color();
    for (let i = 0; i < SAMPLES; i++) {
      const f0 = frames[i];
      const f1 = frames[i + 1];
      const v = (f, o) => [f.p.x + f.side.x * o, y, f.p.z + f.side.z * o];
      const q = [v(f0, a), v(f0, b), v(f1, a), v(f1, b)];
      pos.push(...q[0], ...q[2], ...q[1], ...q[1], ...q[2], ...q[3]);
      if (colorAt) {
        c.set(colorAt(i));
        for (let k = 0; k < 6; k++) col.push(c.r, c.g, c.b);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    if (colorAt) g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, material);
    m.receiveShadow = true;
    scene.add(m);
    return m;
  }

  // Vertical wall following the track at a lateral offset
  function wall(o, h, material) {
    const pos = [];
    for (let i = 0; i < SAMPLES; i++) {
      const f0 = frames[i];
      const f1 = frames[i + 1];
      const x0 = f0.p.x + f0.side.x * o, z0 = f0.p.z + f0.side.z * o;
      const x1 = f1.p.x + f1.side.x * o, z1 = f1.p.z + f1.side.z * o;
      pos.push(x0, 0, z0, x1, 0, z1, x0, h, z0, x0, h, z0, x1, 0, z1, x1, h, z1);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, material);
    scene.add(m);
    return m;
  }

  const half = TRACK_WIDTH / 2;
  strip(-half, half, 0.02, new THREE.MeshStandardMaterial({ color: 0x26262e, roughness: 0.78, metalness: 0.05 }));

  const lineMat = new THREE.MeshStandardMaterial({ color: 0xdddddd, roughness: 0.6 });
  strip(half - 0.45, half - 0.25, 0.03, lineMat);
  strip(-half + 0.25, -half + 0.45, 0.03, lineMat);

  const kerbMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 });
  const kerbColor = (i) => (Math.floor(i / 3) % 2 ? 0xf2f2f2 : RED);
  strip(half, half + 1.1, 0.035, kerbMat, kerbColor);
  strip(-half - 1.1, -half, 0.035, kerbMat, kerbColor);

  const barrierMat = new THREE.MeshStandardMaterial({ color: 0x15151c, roughness: 0.7, side: THREE.DoubleSide });
  wall(half + 5, 0.9, barrierMat);
  wall(-half - 5, 0.9, barrierMat);
  // Glowing light strips on top of the barriers
  strip(half + 4.9, half + 5.1, 0.92, new THREE.MeshBasicMaterial({ color: 0xff2a1f, fog: true }));
  strip(-half - 5.1, -half - 4.9, 0.92, new THREE.MeshBasicMaterial({ color: 0xf4f4ff, fog: true }));

  // Start / finish line (chequered)
  {
    const cv = document.createElement('canvas');
    cv.width = 64;
    cv.height = 512;
    const ctx = cv.getContext('2d');
    const s = 32;
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 2; x++) {
        ctx.fillStyle = (x + y) % 2 ? '#111' : '#f4f4f4';
        ctx.fillRect(x * s, y * s, s, s);
      }
    }
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    const line = new THREE.Mesh(
      new THREE.PlaneGeometry(1.2, TRACK_WIDTH),
      new THREE.MeshStandardMaterial({ map: tex, roughness: 0.7 })
    );
    const f = frames[0];
    line.position.copy(f.p).setY(0.04);
    line.rotation.x = -Math.PI / 2;
    line.rotation.z = Math.atan2(-f.t.z, f.t.x);
    line.receiveShadow = true;
    scene.add(line);
  }

  // Start gantry with five lights
  const gantryLights = [];
  {
    const u = 0.012;
    const p = curve.getPointAt(u);
    const t = curve.getTangentAt(u);
    const g = new THREE.Group();
    g.position.copy(p);
    g.rotation.y = Math.atan2(t.x, t.z);
    const steel = new THREE.MeshStandardMaterial({ color: 0x2a2a33, roughness: 0.5, metalness: 0.8 });
    for (const x of [-half - 1.6, half + 1.6]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.4, 7, 0.4), steel);
      post.position.set(x, 3.5, 0);
      post.castShadow = true;
      g.add(post);
    }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(TRACK_WIDTH + 3.6, 0.9, 0.5), steel);
    beam.position.y = 6.6;
    g.add(beam);
    const housing = new THREE.Mesh(new THREE.BoxGeometry(5.2, 1.1, 0.5), new THREE.MeshStandardMaterial({ color: 0x050507 }));
    housing.position.set(0, 5.7, -0.05);
    g.add(housing);
    for (let i = 0; i < 5; i++) {
      const m = new THREE.Mesh(
        new THREE.CircleGeometry(0.34, 24),
        new THREE.MeshBasicMaterial({ color: 0x2a0b0b })
      );
      // Faces back down the straight, towards the grid
      m.position.set(-2 + i, 5.7, -0.31);
      m.rotation.y = Math.PI;
      g.add(m);
      gantryLights.push(m);
    }
    scene.add(g);
  }

  // Floodlight towers around the outside of the circuit
  {
    const poleGeo = new THREE.CylinderGeometry(0.15, 0.2, 14, 8);
    const headGeo = new THREE.BoxGeometry(2.4, 0.8, 0.4);
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x24242c, roughness: 0.6, metalness: 0.6 });
    const headMat = new THREE.MeshBasicMaterial({ color: 0xfff6e8 });
    const count = 26;
    const poles = new THREE.InstancedMesh(poleGeo, poleMat, count);
    const heads = new THREE.InstancedMesh(headGeo, headMat, count);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    for (let i = 0; i < count; i++) {
      const f = frames[Math.floor((i / count) * SAMPLES)];
      const o = (i % 2 ? 1 : -1) * (half + 9);
      const x = f.p.x + f.side.x * o;
      const z = f.p.z + f.side.z * o;
      q.setFromAxisAngle(UP, Math.atan2(f.t.x, f.t.z));
      m.compose(new THREE.Vector3(x, 7, z), q, new THREE.Vector3(1, 1, 1));
      poles.setMatrixAt(i, m);
      m.compose(new THREE.Vector3(x, 14, z), q, new THREE.Vector3(1, 1, 1));
      heads.setMatrixAt(i, m);
    }
    scene.add(poles, heads);
  }

  // Grandstand and pit building along the main straight
  {
    const standMat = new THREE.MeshStandardMaterial({ color: 0x1b1b23, roughness: 0.8 });
    const glow = new THREE.MeshBasicMaterial({ color: RED });
    const f = frames[Math.floor(SAMPLES * 0.02)];
    const yaw = Math.atan2(f.t.x, f.t.z);
    const mk = (o, w, h, d, stripY) => {
      const g = new THREE.Group();
      g.position.set(f.p.x + f.side.x * o, 0, f.p.z + f.side.z * o);
      g.rotation.y = yaw;
      const body = new THREE.Mesh(new THREE.BoxGeometry(d, h, w), standMat);
      body.position.y = h / 2;
      body.receiveShadow = true;
      g.add(body);
      const s = new THREE.Mesh(new THREE.BoxGeometry(d + 0.05, 0.15, w), glow);
      s.position.y = stripY;
      g.add(s);
      scene.add(g);
    };
    mk(half + 16, 44, 7, 8, 6.2);
    mk(-half - 15, 36, 4, 6, 3.4);
  }

  // Floating dust for depth
  {
    const n = 600;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 220;
      pos[i * 3 + 1] = Math.random() * 18;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 200 - 35;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    scene.add(new THREE.Points(g, new THREE.PointsMaterial({
      color: 0xff6b5e, size: 0.12, transparent: true, opacity: 0.55, depthWrite: false,
    })));
  }

  // ---------- Car ----------
  const car = buildCar();
  scene.add(car.group);

  // ---------- State ----------
  const state = {
    target: 0,
    u: 0,
    mouse: new THREE.Vector2(),
    mouseSmooth: new THREE.Vector2(),
    frame: 0,
    frameSmooth: 0,
    speedKmh: 0,
  };
  const clock = new THREE.Clock();
  const tmp = {
    pos: new THREE.Vector3(),
    fwd: new THREE.Vector3(),
    side: new THREE.Vector3(),
    camHero: new THREE.Vector3(),
    camChase: new THREE.Vector3(),
    camAir: new THREE.Vector3(),
    lookHero: new THREE.Vector3(),
    lookChase: new THREE.Vector3(),
    look: new THREE.Vector3(),
    camPos: new THREE.Vector3(),
    prevFwd: new THREE.Vector3(0, 0, 1),
  };
  let lastU = 0;
  let steer = 0;
  let elapsed = 0;

  function update(dt) {
    elapsed += reducedMotion ? 0 : dt;
    const ease = reducedMotion ? 1 : 1 - Math.exp(-dt * 3.2);
    state.u += (state.target - state.u) * ease;
    state.mouseSmooth.lerp(state.mouse, 1 - Math.exp(-dt * 4));

    const u = ((state.u % 1) + 1) % 1;
    curve.getPointAt(u, tmp.pos);
    curve.getTangentAt(u, tmp.fwd);
    tmp.side.crossVectors(tmp.fwd, UP).normalize();

    // Car placement, wheel spin and steering
    car.group.position.copy(tmp.pos);
    car.group.rotation.y = Math.atan2(tmp.fwd.x, tmp.fwd.z);
    const dist = (state.u - lastU) * trackLength;
    lastU = state.u;
    car.spin(dist);
    const turn = tmp.prevFwd.x * tmp.fwd.z - tmp.prevFwd.z * tmp.fwd.x;
    tmp.prevFwd.copy(tmp.fwd);
    const steerTarget = Math.abs(dist) > 0.001 ? THREE.MathUtils.clamp((-turn / Math.max(Math.abs(dist), 0.05)) * 6, -0.45, 0.45) : 0;
    steer += (steerTarget - steer) * (1 - Math.exp(-dt * 6));
    car.steer(steer);
    car.tick(elapsed);

    const metresPerSec = dt > 0 ? Math.abs(dist) / dt : 0;
    const kmh = Math.min(352, metresPerSec * 3.6 * 2.2);
    state.speedKmh += (kmh - state.speedKmh) * (1 - Math.exp(-dt * 5));

    // Hero orbit: car framed on the right of the screen on wide viewports
    const p = state.target;
    const mx = state.mouseSmooth.x;
    const my = state.mouseSmooth.y;
    const ang = 2.35 + elapsed * 0.06 + mx * 0.35;
    const r = isSmall ? 11.5 : 10;
    tmp.camHero.set(
      tmp.pos.x + Math.sin(ang + car.group.rotation.y) * r,
      1.6 + my * 0.6,
      tmp.pos.z + Math.cos(ang + car.group.rotation.y) * r
    );
    // On phones the hero text sits at the bottom, so aim low to lift the car up the screen
    tmp.lookHero.copy(tmp.pos).setY(isSmall ? -2.2 : 0.5);

    // Chase cam with a gentle side-to-side swing through the sections
    const swing = Math.sin(p * Math.PI * 6) * 3.2 + mx * 1.5;
    tmp.camChase.copy(tmp.pos)
      .addScaledVector(tmp.fwd, -10.5)
      .addScaledVector(tmp.side, swing)
      .add(new THREE.Vector3(0, 3.4 + my * 0.8, 0));
    tmp.lookChase.copy(tmp.pos).addScaledVector(tmp.fwd, 5).setY(0.8);

    // High finish shot looking down on the car as it takes the chequered flag
    tmp.camAir.copy(tmp.pos).addScaledVector(tmp.fwd, -9).add(new THREE.Vector3(0, 13, 0)).addScaledVector(tmp.side, -7);

    const toChase = smoothstep(0.02, 0.16, p);
    const toAir = smoothstep(0.86, 0.99, p);
    tmp.camPos.lerpVectors(tmp.camHero, tmp.camChase, toChase).lerp(tmp.camAir, toAir);
    tmp.look.lerpVectors(tmp.lookHero, tmp.lookChase, toChase).lerp(tmp.pos, toAir);
    camera.position.copy(tmp.camPos);
    camera.lookAt(tmp.look);

    // Slide the frame so the car sits beside the content, not under it
    state.frameSmooth += (state.frame - state.frameSmooth) * (reducedMotion ? 1 : 1 - Math.exp(-dt * 2.5));
    camera.filmOffset = isSmall ? 0 : state.frameSmooth * 9;
    camera.updateProjectionMatrix();

    // Keep lights and shadow centred on the car
    key.position.copy(tmp.pos).add(new THREE.Vector3(8, 16, 6));
    key.target.position.copy(tmp.pos);
    rim.position.copy(tmp.pos).addScaledVector(tmp.fwd, -3.5).addScaledVector(tmp.side, -3).setY(2.2);
    fill.position.copy(tmp.pos).addScaledVector(tmp.fwd, 3).addScaledVector(tmp.side, 3.5).setY(2.5);
  }

  function render() {
    const dt = Math.min(clock.getDelta(), 0.05);
    update(dt);
    renderer.render(scene, camera);
  }
  renderer.setAnimationLoop(render);

  function resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    camera.aspect = w / h;
    camera.fov = w < h ? 55 : 40;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
  }
  window.addEventListener('resize', resize);
  resize();

  return {
    setProgress(p) {
      state.target = p;
    },
    // -1 puts the car on the right of the screen, 1 on the left, 0 centred
    setFrame(x) {
      state.frame = x;
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

// Low-poly F1 car assembled from primitives. Forward is +z.
function buildCar() {
  const group = new THREE.Group();

  const paint = new THREE.MeshPhysicalMaterial({
    color: 0xc80a05, metalness: 0.35, roughness: 0.28, clearcoat: 1, clearcoatRoughness: 0.08,
  });
  const carbon = new THREE.MeshStandardMaterial({ color: 0x0d0d10, roughness: 0.45, metalness: 0.4 });
  const white = new THREE.MeshPhysicalMaterial({ color: 0xf1f1f1, roughness: 0.3, clearcoat: 1 });
  const tyre = new THREE.MeshStandardMaterial({ color: 0x111113, roughness: 0.9 });
  const rimMat = new THREE.MeshStandardMaterial({ color: 0x8a8a95, roughness: 0.3, metalness: 1 });
  const helmetMat = new THREE.MeshPhysicalMaterial({ color: 0xffd200, roughness: 0.2, clearcoat: 1 });

  const add = (geo, mat, x, y, z, parent = group) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    parent.add(m);
    return m;
  };

  // Floor / plank
  add(new THREE.BoxGeometry(1.5, 0.05, 3.9), carbon, 0, 0.1, -0.3);

  // Monocoque: tapered hull via a lathe-like box with scaled top
  const tub = add(new THREE.BoxGeometry(0.78, 0.5, 2.4), paint, 0, 0.4, 0.15);
  tub.geometry.translate(0, 0, 0);

  // Nose cone
  const nose = add(new THREE.CylinderGeometry(0.1, 0.34, 1.9, 12), paint, 0, 0.32, 2.2);
  nose.rotation.x = Math.PI / 2;
  nose.scale.set(1, 1, 0.55);

  // White livery stripe along the nose
  const stripe = add(new THREE.BoxGeometry(0.12, 0.02, 1.7), white, 0, 0.45, 1.85);
  stripe.rotation.x = 0.1;

  // Sidepods
  for (const s of [-1, 1]) {
    const pod = add(new THREE.BoxGeometry(0.5, 0.42, 1.7), paint, s * 0.62, 0.33, -0.25);
    pod.rotation.y = s * -0.06;
    add(new THREE.BoxGeometry(0.44, 0.34, 0.04), carbon, s * 0.62, 0.35, 0.62); // inlet
  }

  // Engine cover tapering to the rear
  const cover = add(new THREE.CylinderGeometry(0.16, 0.42, 1.9, 4), paint, 0, 0.58, -1.25);
  cover.rotation.x = -Math.PI / 2;
  cover.rotation.y = Math.PI / 4;
  cover.scale.set(1, 1, 0.9);

  // Airbox and shark fin
  add(new THREE.BoxGeometry(0.3, 0.32, 0.5), carbon, 0, 0.88, -0.45);
  add(new THREE.BoxGeometry(0.03, 0.34, 1.3), paint, 0, 0.92, -1.3);

  // Cockpit and driver
  add(new THREE.BoxGeometry(0.5, 0.06, 0.7), carbon, 0, 0.66, 0.35);
  add(new THREE.SphereGeometry(0.17, 20, 16), helmetMat, 0, 0.78, 0.3);
  add(new THREE.BoxGeometry(0.3, 0.06, 0.02), carbon, 0, 0.8, 0.46); // visor

  // Halo
  const halo = add(new THREE.TorusGeometry(0.34, 0.035, 8, 24, Math.PI), carbon, 0, 0.88, 0.32);
  halo.rotation.x = -Math.PI / 2;
  halo.scale.set(1, 1.15, 1);
  const pillar = add(new THREE.BoxGeometry(0.05, 0.28, 0.05), carbon, 0, 0.76, 0.72);
  pillar.rotation.x = 0.35;

  // Front wing: two elements and endplates
  add(new THREE.BoxGeometry(1.85, 0.03, 0.42), carbon, 0, 0.1, 2.85);
  const flap = add(new THREE.BoxGeometry(1.75, 0.03, 0.24), paint, 0, 0.17, 2.72);
  flap.rotation.x = 0.35;
  for (const s of [-1, 1]) add(new THREE.BoxGeometry(0.03, 0.22, 0.55), carbon, s * 0.93, 0.18, 2.8);

  // Rear wing: main plane, DRS flap, endplates, pillar, beam wing
  add(new THREE.BoxGeometry(1.0, 0.04, 0.34), carbon, 0, 0.92, -2.15);
  const drs = add(new THREE.BoxGeometry(1.0, 0.03, 0.2), paint, 0, 1.02, -2.28);
  drs.rotation.x = -0.4;
  for (const s of [-1, 1]) {
    const ep = add(new THREE.BoxGeometry(0.03, 0.55, 0.62), paint, s * 0.51, 0.82, -2.2);
    ep.castShadow = true;
  }
  add(new THREE.BoxGeometry(0.06, 0.5, 0.08), carbon, 0, 0.62, -2.05);
  add(new THREE.BoxGeometry(0.85, 0.03, 0.2), carbon, 0, 0.4, -2.1);

  // Rain light
  const rain = add(new THREE.BoxGeometry(0.12, 0.06, 0.02), new THREE.MeshBasicMaterial({ color: 0xff2a1f }), 0, 0.42, -2.22);

  // Diffuser
  const diff = add(new THREE.BoxGeometry(1.0, 0.18, 0.4), carbon, 0, 0.18, -2.15);
  diff.rotation.x = -0.35;

  // Wheels: each in a steer pivot (y) containing a spin pivot (x)
  const spinners = [];
  const steerers = [];
  const wheel = (x, z, radius, width, front) => {
    const steerPivot = new THREE.Group();
    steerPivot.position.set(x, radius, z);
    group.add(steerPivot);
    const spin = new THREE.Group();
    steerPivot.add(spin);
    const t = add(new THREE.CylinderGeometry(radius, radius, width, 28), tyre, 0, 0, 0, spin);
    t.rotation.z = Math.PI / 2;
    const r = add(new THREE.CylinderGeometry(radius * 0.62, radius * 0.62, width + 0.02, 10), rimMat, 0, 0, 0, spin);
    r.rotation.z = Math.PI / 2;
    // Sidewall marking so the spin is visible
    const mark = add(new THREE.TorusGeometry(radius * 0.8, 0.018, 6, 28), front ? helmetMat : white, (width / 2 + 0.005) * Math.sign(x), 0, 0, spin);
    mark.rotation.y = Math.PI / 2;
    const spoke = add(new THREE.BoxGeometry(0.02, radius * 1.15, 0.06), carbon, (width / 2 + 0.012) * Math.sign(x), 0, 0, spin);
    spoke.castShadow = false;
    spinners.push({ spin, radius });
    if (front) steerers.push(steerPivot);
    // Suspension arms
    const arm = add(new THREE.BoxGeometry(Math.abs(x) - 0.3, 0.025, 0.05), carbon, x / 2, radius + 0.04, z);
    arm.castShadow = false;
  };
  wheel(-0.86, 1.62, 0.34, 0.36, true);
  wheel(0.86, 1.62, 0.34, 0.36, true);
  wheel(-0.84, -1.62, 0.37, 0.46, false);
  wheel(0.84, -1.62, 0.37, 0.46, false);

  return {
    group,
    spin(dist) {
      for (const w of spinners) w.spin.rotation.x += dist / w.radius;
    },
    steer(a) {
      for (const s of steerers) s.rotation.y = a;
    },
    tick(t) {
      rain.visible = Math.floor(t * 4) % 2 === 0;
    },
  };
}
