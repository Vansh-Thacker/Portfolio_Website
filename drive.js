// Arcade F1 handling: a single-track (bicycle) model with strong lateral grip,
// aero drag, big brakes, and a handbrake that lets the rear step out.
// Units are metres and seconds. The car faces +z at yaw 0 and turns right
// with a positive steer input.

const WHEELBASE = 3.6;
const VMAX_TRACK = 86; // m/s, about 310 km/h
const VMAX_GRASS = 34;
const BRAKE = 34; // m/s² at full pedal
const REVERSE_MAX = 12;

// Gear ratios as top speed per gear (m/s); used for the dash and the engine note
export const GEARS = [0, 22, 32, 42, 52, 62, 71, 79, 86];

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const approach = (v, target, rate) => (v < target ? Math.min(target, v + rate) : Math.max(target, v - rate));

export class CarController {
  constructor() {
    this.x = 0;
    this.z = 0;
    this.yaw = 0;
    this.vx = 0;
    this.vz = 0;
    this.yawRate = 0;
    this.steer = 0; // smoothed wheel angle, radians (positive = right)
    this.slip = 0; // lateral sliding speed, m/s
    this.braking = 0;
    this.throttle = 0;
    this.gear = 0;
    this.rpm = 0.2; // 0-1 within the current gear
    this.onTrack = true;
    this.impact = 0; // last collision speed, for camera shake and sound
    this.colliders = [];
  }

  place(x, z, yaw) {
    Object.assign(this, { x, z, yaw, vx: 0, vz: 0, yawRate: 0, steer: 0, slip: 0 });
  }

  get forward() {
    return [Math.sin(this.yaw), Math.cos(this.yaw)];
  }

  get speed() {
    const [fx, fz] = this.forward;
    return this.vx * fx + this.vz * fz;
  }

  // input: { throttle 0-1, brake 0-1, steer -1..1, handbrake bool }
  // surface(x, z) returns { grip, vmax } for the ground under the car
  update(dt, input, surface) {
    const [fx, fz] = this.forward;
    const rx = -fz; // right vector
    const rz = fx;
    let vf = this.vx * fx + this.vz * fz;
    let vr = this.vx * rx + this.vz * rz;

    const ground = surface(this.x, this.z);
    this.onTrack = ground.track;
    const vmax = ground.track ? VMAX_TRACK : VMAX_GRASS;

    // Longitudinal: engine, aero drag, brakes and reverse
    this.throttle = input.throttle;
    this.braking = 0;
    if (input.throttle > 0) {
      const p = clamp(vf / vmax, 0, 1);
      vf += input.throttle * 15 * (1 - p * p) * dt;
    }
    if (input.brake > 0) {
      if (vf > 0.6) {
        vf = Math.max(0, vf - BRAKE * input.brake * dt);
        this.braking = input.brake;
      } else {
        vf = Math.max(-REVERSE_MAX, vf - 7 * input.brake * dt);
      }
    }
    // Drag and rolling resistance; grass slows the car hard
    vf -= Math.sign(vf) * (0.0012 * vf * vf + (ground.track ? 0.35 : 3.5)) * dt;
    if (!input.throttle && !input.brake && Math.abs(vf) < 0.4) vf = 0;
    if (vf > vmax) vf = approach(vf, vmax, 30 * dt);

    // Steering: lock reduces with speed so the car stays stable at 300 km/h
    const speedAbs = Math.abs(vf);
    const maxLock = 0.52 / (1 + speedAbs / 22);
    this.steer = approach(this.steer, input.steer * maxLock, 2.6 * dt);
    // Grip limit: downforce raises it with speed, roughly 2.3 g slow to 4 g fast
    const aMax = (ground.track ? 22 : 12) + 0.25 * speedAbs;
    const limit = aMax / Math.max(speedAbs, 1);
    const targetRate = clamp((-vf * Math.tan(this.steer)) / WHEELBASE, -limit, limit);

    // Handbrake unloads the rear: less lateral grip, extra rotation
    const hand = input.handbrake && speedAbs > 4;
    const yawGrip = hand ? 2.5 : ground.track ? 12 : 5;
    const want = hand ? targetRate * 1.7 : targetRate;
    this.yawRate += (want - this.yawRate) * Math.min(1, yawGrip * dt);

    const latGrip = hand ? 0.9 : ground.track ? 9 : 2.6;
    // Sliding sideways converts some yaw into lateral velocity (oversteer feel)
    vr += -this.yawRate * vf * (hand ? 0.35 : 0.04) * dt;
    vr *= Math.exp(-latGrip * dt);
    if (hand) vf -= Math.sign(vf) * 4 * dt;

    this.slip = Math.abs(vr);
    this.yaw += this.yawRate * dt;

    const [nfx, nfz] = this.forward;
    this.vx = nfx * vf + -nfz * vr;
    this.vz = nfz * vf + nfx * vr;
    this.x += this.vx * dt;
    this.z += this.vz * dt;

    this.collide();

    // Gearbox for the dash and the engine note
    const s = Math.abs(this.speed);
    let g = 1;
    while (g < GEARS.length - 1 && s > GEARS[g] * 0.97) g++;
    this.gear = this.speed < -0.5 ? -1 : s < 0.3 && !input.throttle ? 0 : g;
    const lo = g > 1 ? GEARS[g - 1] * 0.82 : 0;
    this.rpm = clamp((s - lo) / (GEARS[g] - lo), 0, 1) * 0.8 + 0.2 * (input.throttle > 0 ? 1 : 0.5);
  }

  // Pushes the car out of static colliders. The car is three circles along its length.
  collide() {
    const [fx, fz] = this.forward;
    this.impact = 0;
    for (const off of [-1.9, 0, 1.9]) {
      const cx = this.x + fx * off;
      const cz = this.z + fz * off;
      const r = 1.0;
      for (const c of this.colliders) {
        let nx;
        let nz;
        let pen;
        if (c.r) {
          const dx = cx - c.x;
          const dz = cz - c.z;
          const d = Math.hypot(dx, dz);
          if (d >= c.r + r || d === 0) continue;
          nx = dx / d;
          nz = dz / d;
          pen = c.r + r - d;
        } else {
          // Oriented box: work in its local frame
          const cos = Math.cos(c.rot);
          const sin = Math.sin(c.rot);
          const dx = cx - c.x;
          const dz = cz - c.z;
          const lx = dx * cos - dz * sin;
          const lz = dx * sin + dz * cos;
          const qx = clamp(lx, -c.hw, c.hw);
          const qz = clamp(lz, -c.hd, c.hd);
          let ox = lx - qx;
          let oz = lz - qz;
          let d = Math.hypot(ox, oz);
          if (d >= r) continue;
          if (d === 0) {
            // Centre inside the box: push out along the shallowest axis
            const px = c.hw - Math.abs(lx);
            const pz = c.hd - Math.abs(lz);
            if (px < pz) {
              ox = Math.sign(lx) || 1;
              oz = 0;
              pen = px + r;
            } else {
              ox = 0;
              oz = Math.sign(lz) || 1;
              pen = pz + r;
            }
            d = 1;
          } else pen = r - d;
          const lnx = ox / d;
          const lnz = oz / d;
          nx = lnx * cos + lnz * sin;
          nz = -lnx * sin + lnz * cos;
        }
        this.x += nx * pen;
        this.z += nz * pen;
        const vn = this.vx * nx + this.vz * nz;
        if (vn < 0) {
          this.vx -= 1.3 * vn * nx;
          this.vz -= 1.3 * vn * nz;
          this.vx *= 0.92;
          this.vz *= 0.92;
          this.yawRate *= 0.5;
          this.impact = Math.max(this.impact, -vn);
        }
      }
    }
  }
}
