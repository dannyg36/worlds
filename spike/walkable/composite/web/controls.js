import * as THREE from "three";

export class Input {
  constructor(el, joyEl, knobEl) {
    this.el = el;
    this.joyEl = joyEl;
    this.knobEl = knobEl;
    this.move = new THREE.Vector2();
    this.look = new THREE.Vector2();
    this.keys = new Set();
    this.joy = null;
    this.lookPtr = null;
    this.touched = false;
    this.radius = 56;
    el.addEventListener("pointerdown", (e) => this.onDown(e));
    window.addEventListener("pointermove", (e) => this.onMove(e));
    window.addEventListener("pointerup", (e) => this.onUp(e));
    window.addEventListener("pointercancel", (e) => this.onUp(e));
    window.addEventListener("keydown", (e) => {
      this.keys.add(e.code);
      this.touched = true;
    });
    window.addEventListener("keyup", (e) => this.keys.delete(e.code));
    window.addEventListener("blur", () => this.keys.clear());
  }
  onDown(e) {
    e.preventDefault();
    this.touched = true;
    const leftZone = e.clientX < innerWidth * 0.5 && e.clientY > innerHeight * 0.35;
    if (leftZone && !this.joy) {
      this.joy = { id: e.pointerId, x0: e.clientX, y0: e.clientY };
      this.joyEl.style.display = "block";
      this.joyEl.style.left = e.clientX + "px";
      this.joyEl.style.top = e.clientY + "px";
      this.knobEl.style.transform = "translate(0px, 0px)";
    } else if (!this.lookPtr) {
      this.lookPtr = { id: e.pointerId, x: e.clientX, y: e.clientY };
    }
  }
  onMove(e) {
    if (this.joy && e.pointerId === this.joy.id) {
      let dx = e.clientX - this.joy.x0, dy = e.clientY - this.joy.y0;
      const len = Math.hypot(dx, dy);
      if (len > this.radius) {
        dx *= this.radius / len;
        dy *= this.radius / len;
      }
      this.knobEl.style.transform = "translate(" + dx + "px, " + dy + "px)";
      this.move.set(dx / this.radius, -dy / this.radius);
    } else if (this.lookPtr && e.pointerId === this.lookPtr.id) {
      this.look.x += e.clientX - this.lookPtr.x;
      this.look.y += e.clientY - this.lookPtr.y;
      this.lookPtr.x = e.clientX;
      this.lookPtr.y = e.clientY;
    }
  }
  onUp(e) {
    if (this.joy && e.pointerId === this.joy.id) {
      this.joy = null;
      this.move.set(0, 0);
      this.joyEl.style.display = "none";
    }
    if (this.lookPtr && e.pointerId === this.lookPtr.id) this.lookPtr = null;
  }
  axes() {
    let x = this.move.x, y = this.move.y;
    const k = this.keys;
    if (k.has("KeyW") || k.has("ArrowUp")) y += 1;
    if (k.has("KeyS") || k.has("ArrowDown")) y -= 1;
    if (k.has("KeyA")) x -= 1;
    if (k.has("KeyD")) x += 1;
    const turn = (k.has("ArrowRight") ? 1 : 0) - (k.has("ArrowLeft") ? 1 : 0);
    const len = Math.hypot(x, y);
    if (len > 1) {
      x /= len;
      y /= len;
    }
    return { x, y, turn };
  }
}

export function makeAvatar(color) {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.6 });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 0.62, 6, 16), mat);
  body.position.y = 0.55;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.19, 24, 16), new THREE.MeshStandardMaterial({ color: 0xf3d2b3, roughness: 0.7 }));
  head.position.y = 1.18;
  const eyeMat = new THREE.MeshBasicMaterial({ color: 0x1b1b1b });
  for (const sx of [-0.07, 0.07]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.028, 8, 6), eyeMat);
    eye.position.set(sx, 1.21, 0.165);
    g.add(eye);
  }
  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.2, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2.2), mat);
  cap.position.y = 1.2;
  g.add(body, head, cap);
  g.traverse((o) => {
    if (o.isMesh) o.castShadow = true;
  });
  return g;
}

export class Player {
  constructor({ ground, colliders, walkables, raycastDown, spawn, yaw }) {
    this.ground = ground;
    this.colliders = colliders;
    this.walkables = walkables;
    this.raycastDown = raycastDown;
    this.pos = new THREE.Vector3(spawn.x, 0, spawn.z);
    this.pos.y = this.groundAt(spawn.x, spawn.z, 99) ?? 0;
    this.yaw = yaw;
    this.pitch = -0.08;
    this.camPitch = 0.4;
    this.radius = 0.28;
    this.speed = 2.3;
    this.facing = yaw;
    this.moving = 0;
    this.walkPhase = 0;
    this.orbit = 0;
  }
  groundAt(x, z, fromY) {
    let h = this.ground.isLand(x, z) ? this.ground.heightAt(x, z) : null;
    for (const w of this.walkables) {
      const dx = x - w.x, dz = z - w.z;
      const c = Math.cos(w.yaw), s = Math.sin(w.yaw);
      const lx = dx * c - dz * s, lz = dx * s + dz * c;
      if (Math.abs(lx) > w.hx || Math.abs(lz) > w.hz) continue;
      const hit = this.raycastDown(w.object, x, z, fromY + 0.6);
      if (hit && hit.normalY > 0.6 && (h == null || hit.y > h)) h = hit.y;
    }
    return h;
  }
  collide(x, z) {
    for (let iter = 0; iter < 2; iter++) {
      for (const c of this.colliders) {
        const wx = x - c.x, wz = z - c.z;
        const cs = Math.cos(c.yaw), sn = Math.sin(c.yaw);
        const lx = wx * cs - wz * sn, lz = wx * sn + wz * cs;
        if (Math.abs(lx) > c.hx + this.radius || Math.abs(lz) > c.hz + this.radius) continue;
        const qx = Math.max(-c.hx, Math.min(c.hx, lx)), qz = Math.max(-c.hz, Math.min(c.hz, lz));
        let dx = lx - qx, dz = lz - qz;
        let d = Math.hypot(dx, dz);
        let px, pz;
        if (d > 1e-5) {
          if (d >= this.radius) continue;
          px = (dx / d) * (this.radius - d);
          pz = (dz / d) * (this.radius - d);
        } else {
          const ox = c.hx - Math.abs(lx), oz = c.hz - Math.abs(lz);
          if (ox < oz) {
            px = Math.sign(lx || 1) * (ox + this.radius);
            pz = 0;
          } else {
            px = 0;
            pz = Math.sign(lz || 1) * (oz + this.radius);
          }
        }
        x += px * cs + pz * sn;
        z += -px * sn + pz * cs;
      }
    }
    return [x, z];
  }
  tryMove(nx, nz) {
    [nx, nz] = this.collide(nx, nz);
    const h = this.groundAt(nx, nz, this.pos.y);
    if (h == null) return false;
    const dist = Math.hypot(nx - this.pos.x, nz - this.pos.z);
    if (h - this.pos.y > 0.3 + dist * 0.9) return false;
    this.pos.x = nx;
    this.pos.z = nz;
    this.targetY = h;
    return true;
  }
  update(dt, input, mode, auto) {
    const ax = auto ?? input.axes();
    if (mode !== "orbit") {
      this.yaw -= input.look.x * 0.0058 + (ax.turn || 0) * dt * 1.8;
      if (mode === "1p") this.pitch = Math.max(-1.25, Math.min(1.1, this.pitch - input.look.y * 0.0045));
      else this.camPitch = Math.max(-0.05, Math.min(1.2, this.camPitch + input.look.y * 0.004));
    } else {
      this.orbit -= input.look.x * 0.006;
    }
    input.look.set(0, 0);
    if (auto?.yaw != null) this.yaw = auto.yaw;
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    const rx = -Math.cos(this.yaw), rz = Math.sin(this.yaw);
    const mx = (fx * ax.y + rx * ax.x) * this.speed * dt;
    const mz = (fz * ax.y + rz * ax.x) * this.speed * dt;
    const mag = Math.hypot(ax.x, ax.y);
    this.targetY = this.targetY ?? this.pos.y;
    if (mode !== "orbit" && mag > 0.05) {
      if (!this.tryMove(this.pos.x + mx, this.pos.z + mz)) {
        if (!this.tryMove(this.pos.x + mx, this.pos.z)) this.tryMove(this.pos.x, this.pos.z + mz);
      }
      const want = Math.atan2(mx, mz);
      let d = want - this.facing;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      this.facing += d * Math.min(1, dt * 10);
      this.walkPhase += dt * 9 * mag;
    } else {
      const h = this.groundAt(this.pos.x, this.pos.z, this.pos.y);
      if (h != null) this.targetY = h;
    }
    this.moving += ((mag > 0.05 ? 1 : 0) - this.moving) * Math.min(1, dt * 8);
    this.pos.y += (this.targetY - this.pos.y) * Math.min(1, dt * 14);
  }
  applyCamera(camera, mode, dt, avatar) {
    if (avatar) {
      avatar.visible = mode === "3p" || mode === "orbit";
      avatar.position.set(this.pos.x, this.pos.y + Math.abs(Math.sin(this.walkPhase)) * 0.06 * this.moving, this.pos.z);
      avatar.rotation.y = this.facing;
    }
    if (mode === "1p") {
      camera.position.set(this.pos.x, this.pos.y + 1.6 + Math.sin(this.walkPhase * 2) * 0.025 * this.moving, this.pos.z);
      camera.rotation.set(this.pitch, this.yaw + Math.PI, 0, "YXZ");
      return;
    }
    if (mode === "3p") {
      const dist = 4.2;
      const px = this.pos.x, py = this.pos.y + 1.15, pz = this.pos.z;
      const cx = px - Math.sin(this.yaw) * dist * Math.cos(this.camPitch);
      const cz = pz - Math.cos(this.yaw) * dist * Math.cos(this.camPitch);
      let cy = py + dist * Math.sin(this.camPitch);
      const gh = this.ground.heightAt(cx, cz);
      cy = Math.max(cy, gh + 0.35, (this.ground.waterLevel ?? -99) + 0.35);
      camera.position.set(cx, cy, cz);
      camera.lookAt(px, py, pz);
      return;
    }
    const R = this.ground.R;
    this.orbit += dt * 0.12;
    const a = this.orbit;
    camera.position.set(Math.sin(a) * R * 1.55, R * 0.95, Math.cos(a) * R * 1.55);
    camera.lookAt(0, 0.6, 0);
  }
}

export function makeTour(ground, hero, spawn) {
  const R = ground.R;
  const hx = hero?.x ?? 0, hz = hero?.z ?? 0;
  const pts = [];
  for (let k = 0; k <= 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    const r = R * 0.58;
    pts.push({ x: hx + Math.sin(a) * r, z: hz + Math.cos(a) * r });
  }
  const route = [{ x: spawn.x, z: spawn.z - 1.2 }, ...pts, { x: spawn.x, z: spawn.z }].filter((p) => ground.isLand(p.x, p.z));
  let i = 0, t = 0, look = 0;
  return {
    step(player, dt) {
      t += dt;
      if (look > 0) {
        look -= dt;
        return { x: 0, y: 0, yaw: player.yaw + dt * 1.1 };
      }
      const target = route[i % route.length];
      const dx = target.x - player.pos.x, dz = target.z - player.pos.z;
      if (Math.hypot(dx, dz) < 0.5 || t > 6) {
        i++;
        t = 0;
        if (i % 3 === 0) look = 2.5;
      }
      const want = Math.atan2(dx, dz);
      let d = want - player.yaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      return { x: 0, y: 0.75, yaw: player.yaw + d * Math.min(1, dt * 3) };
    },
  };
}
