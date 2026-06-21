// ============================================================
// signals.js — Circuit-trace network + traveling request pulses.
// Draws glowing motherboard traces between stations and animates
// data packets along them, like circuitry routing on a board.
// ============================================================
import * as THREE from "three";
import { TRACES, STATIONS, routeToPoints, PALETTE } from "./board.js";

const KIND_COLOR = {
  perception: PALETTE.cyan,
  memory: PALETTE.purple,
  build: PALETTE.amber,
  approval: PALETTE.green,
  inference: PALETTE.amber,
  reasoning: PALETTE.amber,
};

// Build the static glowing trace lines once.
export function buildTraceNetwork(scene) {
  const group = new THREE.Group();
  for (const seg of Object.values(TRACES)) {
    const curve = new THREE.CatmullRomCurve3(seg.map((v) => v.clone()));
    const pts = curve.getPoints(40);
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({
      color: 0x1d6a8a, transparent: true, opacity: 0.55,
    }));
    line.position.y = 0.02;
    group.add(line);
    // copper pad endpoints
    seg.forEach((v) => {
      const pad = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.04, 12),
        new THREE.MeshStandardMaterial({ color: PALETTE.copper, emissive: 0x3a2a10,
          emissiveIntensity: 0.4, metalness: 0.6, roughness: 0.4 }));
      pad.position.set(v.x, 0.04, v.z);
      group.add(pad);
    });
  }
  scene.add(group);
  return group;
}

export class SignalLayer {
  constructor(scene) {
    this.scene = scene;
    this.pulses = [];
    // ambient base traces glow breathing
    this.t = 0;
  }

  // Spawn a pulse that travels along a route (list of station ids).
  spawn(path, kind = "perception", reason = false) {
    const pts = routeToPoints(path);
    if (pts.length < 2) return;
    const curve = new THREE.CatmullRomCurve3(pts);
    const color = KIND_COLOR[kind] || PALETTE.cyan;

    // glowing head sphere
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 12),
      new THREE.MeshBasicMaterial({ color }));
    head.position.copy(curve.getPoint(0));
    this.scene.add(head);

    // bright halo
    const halo = new THREE.Mesh(new THREE.SphereGeometry(0.4, 12, 12),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.3 }));
    head.add(halo);

    // comet trail (a thin tube following recent path)
    const trailGeo = new THREE.BufferGeometry();
    const trailPts = new Float32Array(20 * 3);
    trailGeo.setAttribute("position", new THREE.BufferAttribute(trailPts, 3));
    const trail = new THREE.Line(trailGeo,
      new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.6 }));
    this.scene.add(trail);

    const speed = reason ? 0.32 : 0.5;
    this.pulses.push({ curve, head, halo, trail, trailPts, color, t: 0, speed, reason, history: [] });
  }

  update(dt, t) {
    this.t = t;
    for (let i = this.pulses.length - 1; i >= 0; i--) {
      const pl = this.pulses[i];
      pl.t += dt * pl.speed;
      if (pl.t >= 1) {
        // burst at destination then remove
        this.scene.remove(pl.head);
        this.scene.remove(pl.trail);
        pl.head.geometry.dispose();
        this.pulses.splice(i, 1);
        continue;
      }
      const pos = pl.curve.getPoint(pl.t);
      pos.y = 0.25 + Math.sin(t * 6 + i) * 0.04;
      pl.head.position.copy(pos);
      // pulsing halo
      const s = 1 + Math.sin(t * 12) * 0.25;
      pl.halo.scale.setScalar(s);

      // update trail history
      pl.history.unshift(pos.clone());
      if (pl.history.length > 20) pl.history.pop();
      for (let h = 0; h < 20; h++) {
        const src = pl.history[Math.min(h, pl.history.length - 1)] || pos;
        pl.trailPts[h * 3] = src.x;
        pl.trailPts[h * 3 + 1] = src.y;
        pl.trailPts[h * 3 + 2] = src.z;
      }
      pl.trail.geometry.attributes.position.needsUpdate = true;
    }
  }

  get activeCount() { return this.pulses.length; }
}
