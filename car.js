// Procedural Formula 1 car (2022+ regulations silhouette), built from lofted
// cross-sections, extruded aerofoils and lathed tyres. Units are metres and
// the car faces +z with the ground at y = 0.
import * as THREE from 'three';

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
    t.repeat.set(repeat[0], repeat[1]);
  }
  return t;
}

// Livery for lofted bodywork: u runs around the section (0 = right side,
// 0.25 = top, 0.5 = left, 0.75 = underside), v runs nose to tail.
function liveryTexture(base, number) {
  return canvasTexture(1024, 1024, (ctx, w, h) => {
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, w, h);
    // Darker red shading towards the lower flanks
    const g = ctx.createLinearGradient(0, 0, w, 0);
    g.addColorStop(0, 'rgba(0,0,0,0.25)');
    g.addColorStop(0.25, 'rgba(0,0,0,0)');
    g.addColorStop(0.5, 'rgba(0,0,0,0.25)');
    g.addColorStop(1, 'rgba(0,0,0,0.25)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    // Carbon-black lower half with a swept boundary and white pinstripe
    const sweep = (v) => 0.03 + 0.05 * Math.sin(v * Math.PI * 1.2);
    for (const side of [0, 0.5]) {
      ctx.beginPath();
      for (let y = 0; y <= h; y += 8) {
        const v = y / h;
        const x = (side + 0.5 + 0.0 - sweep(v)) * w;
        y === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.lineTo((side + 0.5) * w + 2, h);
      ctx.lineTo((side + 0.5) * w + 2, 0);
      ctx.closePath();
      ctx.fillStyle = '#121214';
      ctx.fill();
    }
    ctx.fillStyle = '#121214';
    ctx.fillRect(0.5 * w, 0, 0.5 * w, h);
    ctx.fillRect(0, 0, 0.012 * w, h);
    ctx.strokeStyle = '#f4f4f4';
    ctx.lineWidth = 6;
    for (const side of [0, 0.5]) {
      ctx.beginPath();
      for (let y = 0; y <= h; y += 8) {
        const x = (side + 0.5 - sweep(y / h) - 0.012) * w;
        y === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    // White centre stripe over the top
    ctx.fillStyle = '#f4f4f4';
    ctx.fillRect(0.25 * w - 10, 0, 20, h);
    ctx.fillStyle = base;
    ctx.fillRect(0.25 * w - 4, 0, 8, h);
    // Race number on the nose
    ctx.save();
    ctx.translate(0.25 * w, 0.2 * h);
    ctx.rotate(Math.PI / 2);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'italic 900 64px "Titillium Web", Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(number, 0, -60);
    ctx.fillText(number, 0, 60);
    ctx.restore();
  });
}

function carbonTexture() {
  return canvasTexture(64, 64, (ctx, w) => {
    const s = w / 4;
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 4; x++) {
        const g = ctx.createLinearGradient(x * s, y * s, (x + 1) * s, (y + 1) * s);
        const light = (x + y) % 2 ? '#2a2a2f' : '#18181b';
        g.addColorStop(0, '#0e0e10');
        g.addColorStop(0.5, light);
        g.addColorStop(1, '#0e0e10');
        ctx.fillStyle = g;
        ctx.fillRect(x * s, y * s, s, s);
      }
    }
  }, { repeat: [24, 24] });
}

function sidewallTexture(band) {
  return canvasTexture(512, 512, (ctx, w) => {
    const c = w / 2;
    ctx.fillStyle = '#141416';
    ctx.fillRect(0, 0, w, w);
    ctx.strokeStyle = band;
    ctx.lineWidth = 9;
    ctx.beginPath();
    ctx.arc(c, c, w * 0.43, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = '#e8e8e8';
    ctx.font = '700 34px Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const words = ['PIRELLI', 'P ZERO', 'PIRELLI', 'P ZERO'];
    words.forEach((word, k) => {
      ctx.save();
      ctx.translate(c, c);
      ctx.rotate((k / words.length) * Math.PI * 2);
      const r = w * 0.37;
      const chars = word.split('');
      const span = chars.length * 0.085;
      chars.forEach((ch, i) => {
        ctx.save();
        ctx.rotate(-span / 2 + i * 0.085);
        ctx.fillText(ch, 0, -r);
        ctx.restore();
      });
      ctx.restore();
    });
  });
}

function wheelCoverTexture() {
  return canvasTexture(256, 256, (ctx, w) => {
    const c = w / 2;
    const g = ctx.createRadialGradient(c, c, 4, c, c, c);
    g.addColorStop(0, '#2c2c31');
    g.addColorStop(1, '#0c0c0e');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, w);
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 3;
    for (let i = 0; i < 10; i++) {
      ctx.beginPath();
      ctx.moveTo(c, c);
      const a = (i / 10) * Math.PI * 2;
      ctx.lineTo(c + Math.cos(a) * c, c + Math.sin(a) * c);
      ctx.stroke();
    }
    ctx.fillStyle = '#e10600';
    ctx.beginPath();
    ctx.arc(c, c, 26, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = 'italic 900 26px Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('VT', c, c + 1);
  });
}

// ---------- Geometry helpers ----------

const cr = (p0, p1, p2, p3, t) =>
  0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t);

// Smooth body through superellipse cross-sections.
// Each section: { z, x = 0, y, w, h, n = 2.6, b = 1 } where b scales the lower half.
function loft(sections, { ring = 40, steps = 8, caps = true } = {}) {
  const keys = ['z', 'x', 'y', 'w', 'h', 'n', 'b'];
  const S = sections.map((s) => ({ x: 0, n: 2.6, b: 1, ...s }));
  const rings = [];
  for (let i = 0; i < S.length - 1; i++) {
    for (let k = 0; k < steps; k++) {
      const t = k / steps;
      const r = {};
      for (const key of keys) {
        const p0 = S[Math.max(0, i - 1)][key];
        const p3 = S[Math.min(S.length - 1, i + 2)][key];
        r[key] = cr(p0, S[i][key], S[i + 1][key], p3, t);
      }
      rings.push(r);
    }
  }
  rings.push(S[S.length - 1]);

  const pos = [];
  const uv = [];
  const idx = [];
  rings.forEach((r, i) => {
    for (let j = 0; j <= ring; j++) {
      const a = (j / ring) * Math.PI * 2;
      const c = Math.cos(a);
      const s = Math.sin(a);
      const e = 2 / Math.max(r.n, 0.5);
      const px = r.x + Math.max(r.w, 0.001) * Math.sign(c) * Math.abs(c) ** e;
      const hh = s < 0 ? r.h * r.b : r.h;
      const py = r.y + Math.max(hh, 0.001) * Math.sign(s) * Math.abs(s) ** e;
      pos.push(px, py, r.z);
      uv.push(j / ring, i / (rings.length - 1));
    }
  });
  const row = ring + 1;
  for (let i = 0; i < rings.length - 1; i++) {
    for (let j = 0; j < ring; j++) {
      const a = i * row + j;
      const b = a + row;
      // Sections run nose (+z) to tail (-z); wind so normals face outwards
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  if (caps) {
    for (const [ri, flip] of [[0, false], [rings.length - 1, true]]) {
      const r = rings[ri];
      const centre = pos.length / 3;
      pos.push(r.x, r.y, r.z);
      uv.push(0.25, ri ? 1 : 0);
      for (let j = 0; j < ring; j++) {
        const a = ri * row + j;
        flip ? idx.push(centre, a, a + 1) : idx.push(centre, a + 1, a);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// Cambered aerofoil extruded across the car (span along x, chord towards -z)
function wingElement({ chord, span, thick = 0.12, camber = -0.06, aoa = 0 }) {
  const shape = new THREE.Shape();
  const N = 24;
  const up = [];
  const lo = [];
  for (let i = 0; i <= N; i++) {
    const t = (1 - Math.cos((i / N) * Math.PI)) / 2;
    const yt = 5 * thick * (0.2969 * Math.sqrt(t) - 0.126 * t - 0.3516 * t * t + 0.2843 * t ** 3 - 0.1036 * t ** 4);
    const yc = camber * 4 * t * (1 - t);
    up.push([t * chord, (yc + yt) * chord]);
    lo.push([t * chord, (yc - yt) * chord]);
  }
  shape.moveTo(up[0][0], up[0][1]);
  for (const p of up.slice(1)) shape.lineTo(p[0], p[1]);
  for (const p of lo.reverse()) shape.lineTo(p[0], p[1]);
  const g = new THREE.ExtrudeGeometry(shape, { depth: span, bevelEnabled: false, curveSegments: 4 });
  g.translate(0, 0, -span / 2);
  g.rotateY(Math.PI / 2);
  g.rotateX(aoa);
  return g;
}

// Flat plate from a (z, y) outline, extruded thinly along x
function plate(points, thickness) {
  const shape = new THREE.Shape(points.map(([z, y]) => new THREE.Vector2(z, y)));
  const g = new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false, curveSegments: 12 });
  g.translate(0, 0, -thickness / 2);
  g.rotateY(-Math.PI / 2);
  return g;
}

function tube(points, radius, segs = 48) {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p)));
  return new THREE.TubeGeometry(curve, segs, radius, 10, false);
}

// ---------- Car ----------

// Livery defaults to the hero car; rivals pass their own colours and number.
export function buildCar({ base = '#c40d0a', number = '07', helmetColor = 0xffcf1a } = {}) {
  const group = new THREE.Group();
  const livery = liveryTexture(base, number);

  const paint = new THREE.MeshPhysicalMaterial({
    map: livery, metalness: 0.25, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.06,
  });
  const paintSolid = new THREE.MeshPhysicalMaterial({
    color: base, metalness: 0.25, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.06,
  });
  const carbon = new THREE.MeshPhysicalMaterial({
    color: 0x8a8a8a, map: carbonTexture(), metalness: 0.3, roughness: 0.38, clearcoat: 0.7, clearcoatRoughness: 0.2,
  });
  const matte = new THREE.MeshStandardMaterial({ color: 0x0b0b0d, roughness: 0.7 });
  const white = new THREE.MeshPhysicalMaterial({ color: 0xf2f2f2, roughness: 0.3, clearcoat: 1 });
  const rubber = new THREE.MeshStandardMaterial({ color: 0x18181a, roughness: 0.92, side: THREE.DoubleSide });
  const metal = new THREE.MeshStandardMaterial({ color: 0x9a9aa4, roughness: 0.25, metalness: 1 });
  const visor = new THREE.MeshPhysicalMaterial({ color: 0x0a0a12, roughness: 0.05, metalness: 0.6, clearcoat: 1 });
  const helmet = new THREE.MeshPhysicalMaterial({ color: helmetColor, roughness: 0.25, clearcoat: 1 });

  const add = (geo, mat, opts = {}) => {
    const m = new THREE.Mesh(geo, mat);
    if (opts.p) m.position.set(...opts.p);
    if (opts.r) m.rotation.set(...opts.r);
    m.castShadow = opts.shadow !== false;
    m.receiveShadow = true;
    (opts.parent || group).add(m);
    return m;
  };
  const mirrorX = (fn) => [-1, 1].forEach(fn);

  // Survival cell, nose and engine cover as one smooth loft
  add(loft([
    { z: 2.98, y: 0.25, w: 0.03, h: 0.03 },
    { z: 2.85, y: 0.26, w: 0.09, h: 0.06 },
    { z: 2.45, y: 0.31, w: 0.15, h: 0.1, b: 0.8 },
    { z: 1.9, y: 0.38, w: 0.2, h: 0.14, b: 0.8 },
    { z: 1.35, y: 0.45, w: 0.26, h: 0.19, b: 0.85 },
    { z: 0.85, y: 0.49, w: 0.32, h: 0.24, n: 3 },
    { z: 0.4, y: 0.5, w: 0.37, h: 0.27, n: 3.2 },
    { z: -0.1, y: 0.52, w: 0.4, h: 0.3, n: 3.2 },
    { z: -0.55, y: 0.53, w: 0.38, h: 0.33, n: 2.8 },
    { z: -1.1, y: 0.49, w: 0.27, h: 0.28, n: 2.4 },
    { z: -1.7, y: 0.43, w: 0.16, h: 0.2, n: 2.2 },
    { z: -2.15, y: 0.38, w: 0.09, h: 0.12, n: 2.2 },
    { z: -2.3, y: 0.37, w: 0.05, h: 0.07 },
  ], { ring: 48, steps: 10 }), paint);

  // Cockpit opening
  add(loft([
    { z: 0.62, y: 0.765, w: 0.08, h: 0.015 },
    { z: 0.45, y: 0.775, w: 0.22, h: 0.02 },
    { z: 0.0, y: 0.8, w: 0.25, h: 0.02 },
    { z: -0.18, y: 0.81, w: 0.2, h: 0.02 },
    { z: -0.25, y: 0.81, w: 0.05, h: 0.015 },
  ], { ring: 24, steps: 6 }), matte, { shadow: false });

  // Driver helmet and visor
  add(new THREE.SphereGeometry(0.135, 32, 24), helmet, { p: [0, 0.86, 0.06] });
  add(new THREE.SphereGeometry(0.137, 32, 12, -0.9, 1.8, 1.15, 0.45), visor, { p: [0, 0.86, 0.06] });

  // Airbox / roll hoop and intake
  add(loft([
    { z: 0.0, y: 0.93, w: 0.11, h: 0.1 },
    { z: -0.15, y: 0.94, w: 0.14, h: 0.12 },
    { z: -0.45, y: 0.9, w: 0.13, h: 0.1 },
    { z: -0.8, y: 0.82, w: 0.08, h: 0.06 },
  ], { ring: 32, steps: 6 }), paint);
  add(new THREE.CircleGeometry(0.085, 24), matte, { p: [0, 0.94, 0.005], shadow: false });
  add(new THREE.BoxGeometry(0.1, 0.035, 0.08), new THREE.MeshStandardMaterial({ color: 0xffd400, roughness: 0.4 }), { p: [0, 1.045, -0.12] });

  // Shark fin
  add(plate([[-0.6, 0.9], [-1.95, 0.8], [-1.95, 0.62], [-0.9, 0.72]], 0.012), paintSolid);

  // Halo with centre pillar
  add(tube([[-0.28, 0.72, -0.12], [-0.31, 0.88, 0.08], [-0.24, 0.95, 0.36], [0, 0.97, 0.47], [0.24, 0.95, 0.36], [0.31, 0.88, 0.08], [0.28, 0.72, -0.12]], 0.028), carbon);
  add(tube([[0, 0.97, 0.47], [0, 0.88, 0.62], [0, 0.76, 0.7]], 0.026, 16), carbon);

  // Sidepods with inlets
  mirrorX((s) => {
    add(loft([
      { z: 0.78, x: s * 0.6, y: 0.43, w: 0.17, h: 0.16, n: 3.4 },
      { z: 0.55, x: s * 0.62, y: 0.42, w: 0.24, h: 0.2, n: 3.4, b: 0.7 },
      { z: 0.05, x: s * 0.6, y: 0.4, w: 0.26, h: 0.2, n: 3, b: 0.6 },
      { z: -0.55, x: s * 0.53, y: 0.33, w: 0.22, h: 0.15, n: 2.6, b: 0.7 },
      { z: -1.15, x: s * 0.42, y: 0.26, w: 0.14, h: 0.1, n: 2.4 },
      { z: -1.55, x: s * 0.32, y: 0.22, w: 0.06, h: 0.06 },
    ], { ring: 40, steps: 8 }), paint);
    add(new THREE.PlaneGeometry(0.34, 0.18), matte, { p: [s * 0.61, 0.45, 0.785], shadow: false });
    // Mirror on a stalk
    add(tube([[s * 0.42, 0.62, 0.62], [s * 0.5, 0.7, 0.6], [s * 0.55, 0.72, 0.58]], 0.012, 8), carbon);
    add(loft([
      { z: 0.64, x: s * 0.57, y: 0.73, w: 0.07, h: 0.035 },
      { z: 0.58, x: s * 0.57, y: 0.73, w: 0.075, h: 0.04 },
      { z: 0.52, x: s * 0.57, y: 0.73, w: 0.06, h: 0.03 },
    ], { ring: 20, steps: 3 }), paintSolid);
  });

  // Floor with edge wings
  {
    const outline = [
      [0.12, 1.3], [0.45, 0.95], [0.82, 0.55], [0.86, -1.5], [0.62, -2.1], [-0.62, -2.1],
      [-0.86, -1.5], [-0.82, 0.55], [-0.45, 0.95], [-0.12, 1.3],
    ];
    const shape = new THREE.Shape(outline.map(([x, z]) => new THREE.Vector2(x, z)));
    const g = new THREE.ExtrudeGeometry(shape, { depth: 0.025, bevelEnabled: false });
    g.rotateX(Math.PI / 2);
    add(g, carbon, { p: [0, 0.095, 0] });
    // Diffuser ramp
    add(plate([[-1.5, 0.07], [-2.18, 0.07], [-2.18, 0.3], [-1.9, 0.18]], 1.1), carbon);
  }

  // Front wing: main plane, two flaps, endplates and nose pylons
  {
    const fw = new THREE.Group();
    fw.position.set(0, 0.0, 2.92);
    group.add(fw);
    add(wingElement({ chord: 0.32, span: 1.95, camber: -0.07, aoa: 0.05 }), carbon, { p: [0, 0.09, 0], parent: fw });
    add(wingElement({ chord: 0.24, span: 1.85, camber: -0.08, aoa: 0.35 }), paintSolid, { p: [0, 0.14, -0.22], parent: fw });
    add(wingElement({ chord: 0.18, span: 1.75, camber: -0.08, aoa: 0.6 }), white, { p: [0, 0.2, -0.36], parent: fw });
    mirrorX((s) => {
      add(plate([[0.05, 0.06], [-0.55, 0.06], [-0.6, 0.18], [-0.45, 0.3], [-0.1, 0.24], [0.05, 0.14]], 0.015), carbon, { p: [s * 0.98, 0, 0], parent: fw });
    });
    mirrorX((s) => add(new THREE.BoxGeometry(0.02, 0.18, 0.18), carbon, { p: [s * 0.07, 0.19, -0.18], parent: fw }));
  }

  // Rear wing: main plane, DRS flap, rounded endplates, swan neck, beam wing
  {
    const rw = new THREE.Group();
    rw.position.set(0, 0, -2.08);
    group.add(rw);
    add(wingElement({ chord: 0.36, span: 1.0, camber: -0.09, aoa: 0.12 }), carbon, { p: [0, 0.88, 0], parent: rw });
    add(wingElement({ chord: 0.24, span: 0.98, camber: -0.07, aoa: 0.75 }), paintSolid, { p: [0, 0.96, -0.3], parent: rw });
    mirrorX((s) => {
      add(plate([[0.06, 0.62], [0.06, 0.98], [-0.05, 1.1], [-0.42, 1.12], [-0.55, 1.0], [-0.55, 0.62]], 0.018), carbon, { p: [s * 0.5, 0, 0], parent: rw });
    });
    add(tube([[0, 0.42, 0.1], [0, 0.75, 0.05], [0, 0.95, -0.15]], 0.03, 16), carbon, { parent: rw });
    add(wingElement({ chord: 0.2, span: 0.8, camber: -0.05, aoa: 0.2 }), carbon, { p: [0, 0.38, -0.05], parent: rw });
    // Rain light
    const rain = add(new THREE.BoxGeometry(0.14, 0.05, 0.02), new THREE.MeshBasicMaterial({ color: 0xff3020 }), { p: [0, 0.4, -0.13], parent: rw, shadow: false });
    group.userData.rainLight = rain;
  }

  // Wheels and suspension
  const spinners = [];
  const steerers = [];
  const tyreProfile = (R, W) => {
    const rim = R * 0.64;
    const r = 0.055;
    const pts = [new THREE.Vector2(rim, -W / 2 + 0.012), new THREE.Vector2(R - r, -W / 2)];
    for (let i = 1; i <= 6; i++) {
      const a = (i / 6) * (Math.PI / 2);
      pts.push(new THREE.Vector2(R - r + Math.sin(a) * r, -W / 2 + r - Math.cos(a) * r));
    }
    for (let i = 0; i <= 6; i++) {
      const a = (i / 6) * (Math.PI / 2);
      pts.push(new THREE.Vector2(R - r + Math.cos(a) * r, W / 2 - r + Math.sin(a) * r));
    }
    pts.push(new THREE.Vector2(rim, W / 2 - 0.012));
    return pts;
  };
  const sidewalls = {
    front: sidewallTexture('#f2c200'),
    rear: sidewallTexture('#f2c200'),
  };
  const coverTex = wheelCoverTexture();

  const wheel = (x, z, R, W, front) => {
    const steerPivot = new THREE.Group();
    steerPivot.position.set(x, R, z);
    group.add(steerPivot);
    const spin = new THREE.Group();
    steerPivot.add(spin);
    const tyreGeo = new THREE.LatheGeometry(tyreProfile(R, W), 64);
    tyreGeo.rotateZ(Math.PI / 2);
    add(tyreGeo, rubber, { parent: spin });
    const sideMat = new THREE.MeshStandardMaterial({ map: front ? sidewalls.front : sidewalls.rear, roughness: 0.85 });
    const s = Math.sign(x);
    for (const face of [-1, 1]) {
      const ring = new THREE.RingGeometry(R * 0.64, R - 0.035, 64, 1);
      // Planar UVs so the circular sidewall art maps correctly
      const uvs = ring.attributes.uv;
      const p = ring.attributes.position;
      for (let i = 0; i < p.count; i++) uvs.setXY(i, 0.5 + p.getX(i) / (2 * R), 0.5 + p.getY(i) / (2 * R));
      const m = add(ring, sideMat, { parent: spin, shadow: false });
      m.rotation.y = face * Math.PI / 2;
      m.position.x = face * (W / 2 + 0.006);
    }
    // Wheel cover on the outer face, rim lip on both
    const cover = add(new THREE.CircleGeometry(R * 0.64, 48), new THREE.MeshPhysicalMaterial({ map: coverTex, metalness: 0.6, roughness: 0.35, clearcoat: 1 }), { parent: spin, shadow: false });
    cover.rotation.y = s * Math.PI / 2;
    cover.position.x = s * (W / 2 + 0.008);
    for (const face of [-1, 1]) {
      const lip = add(new THREE.TorusGeometry(R * 0.64, 0.01, 8, 48), metal, { parent: spin, shadow: false });
      lip.rotation.y = Math.PI / 2;
      lip.position.x = face * (W / 2 + 0.004);
    }
    // Brake duct drum
    add(new THREE.CylinderGeometry(R * 0.55, R * 0.55, 0.12, 24), carbon, { r: [0, 0, Math.PI / 2], p: [-s * (W / 2 + 0.05), 0, 0], parent: steerPivot });
    spinners.push({ spin, radius: R });
    if (front) steerers.push(steerPivot);

    // Wishbones and pushrod
    const inX = s * 0.26;
    const hub = new THREE.Vector3(x - s * (W / 2 + 0.08), R, z);
    const link = (a, b, r = 0.014) => {
      const A = new THREE.Vector3(...a);
      const B = b;
      const len = A.distanceTo(B);
      const m = add(new THREE.CylinderGeometry(r, r, len, 8), carbon);
      m.position.copy(A).add(B).multiplyScalar(0.5);
      m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), B.clone().sub(A).normalize());
    };
    const top = hub.clone().add(new THREE.Vector3(0, 0.1, 0));
    const bot = hub.clone().add(new THREE.Vector3(0, -0.1, 0));
    link([inX, front ? 0.52 : 0.46, z + 0.22], top);
    link([inX, front ? 0.52 : 0.46, z - 0.22], top);
    link([inX, 0.3, z + 0.25], bot);
    link([inX, 0.3, z - 0.25], bot);
    link([inX * 0.8, 0.62, z + (front ? -0.12 : 0.12)], bot, 0.012);
  };
  wheel(-0.8, 1.78, 0.36, 0.31, true);
  wheel(0.8, 1.78, 0.36, 0.31, true);
  wheel(-0.79, -1.82, 0.36, 0.41, false);
  wheel(0.79, -1.82, 0.36, 0.41, false);

  // Soft contact shadow so the car sits on the track
  {
    const tex = canvasTexture(256, 256, (ctx, w) => {
      const g = ctx.createRadialGradient(w / 2, w / 2, 10, w / 2, w / 2, w / 2);
      g.addColorStop(0, 'rgba(0,0,0,0.85)');
      g.addColorStop(0.55, 'rgba(0,0,0,0.5)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, w);
    }, { srgb: false });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 6.4), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
    m.rotation.x = -Math.PI / 2;
    m.position.y = 0.012;
    m.renderOrder = 1;
    group.add(m);
  }

  const rain = group.userData.rainLight;
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
