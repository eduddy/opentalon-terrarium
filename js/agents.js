// ============================================================
// agents.js — Stylized agent worker characters (Scout/Scribe/
// Maker/Keeper). Procedural capsule-bot bodies with idle bob,
// walk bob, and path-following along board traces.
// ============================================================
import * as THREE from "three";
import { STATIONS, routeToPoints } from "./board.js";

function emissive(color, i = 0.6) {
  return new THREE.MeshStandardMaterial({
    color, emissive: color, emissiveIntensity: i, roughness: 0.4, metalness: 0.3,
  });
}

export class Agent {
  constructor(id, meta) {
    this.id = id;
    this.meta = meta;
    this.color = new THREE.Color(meta.color);
    this.group = new THREE.Group();
    this.state = "idle";
    this.home = STATIONS[meta.home] || STATIONS.CORE;
    this.path = null;       // array of Vector3 when walking
    this.pathT = 0;         // 0..1 progress
    this.pathSpeed = 0;
    this.afterArrive = null;
    this.bob = Math.random() * Math.PI * 2;
    this._build();
    this.group.position.set(this.home.x, 0.2, this.home.z + 1.2);
    this.basePos = this.group.position.clone();
  }

  _build() {
    const c = this.meta.color;
    // body capsule
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.32, 0.5, 4, 12),
      new THREE.MeshStandardMaterial({ color: 0xdfe9ef, roughness: 0.5, metalness: 0.3 }));
    body.position.y = 0.7; body.castShadow = true; this.group.add(body);
    // glowing chest core (agent color)
    const core = new THREE.Mesh(new THREE.SphereGeometry(0.14, 12, 12), emissive(c, 1.0));
    core.position.set(0, 0.78, 0.26); this.group.add(core);
    // head
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.26, 16, 16),
      new THREE.MeshStandardMaterial({ color: 0xeef4f7, roughness: 0.4, metalness: 0.3 }));
    head.position.y = 1.28; head.castShadow = true; this.group.add(head);
    // visor (color glow)
    const visor = new THREE.Mesh(new THREE.SphereGeometry(0.2, 16, 16, 0, Math.PI),
      emissive(c, 0.9));
    visor.position.set(0, 1.3, 0.08); visor.rotation.x = -0.2; this.group.add(visor);
    // little antenna
    const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.3),
      emissive(c, 0.7));
    ant.position.y = 1.62; this.group.add(ant);
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 8), emissive(c, 1.2));
    tip.position.y = 1.78; this.group.add(tip);
    // feet
    [-0.16, 0.16].forEach((x) => {
      const foot = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.1, 0.24),
        new THREE.MeshStandardMaterial({ color: 0x222831 }));
      foot.position.set(x, 0.12, 0.02); this.group.add(foot);
      if (x < 0) this.lFoot = foot; else this.rFoot = foot;
    });
    // soft ground halo
    const halo = new THREE.Mesh(new THREE.CircleGeometry(0.5, 24),
      new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.18 }));
    halo.rotation.x = -Math.PI / 2; halo.position.y = 0.05; this.group.add(halo);
    this.core = core; this.tip = tip;
  }

  walkRoute(path, speed = 0.35, after = null) {
    const pts = routeToPoints(path);
    if (pts.length < 2) return;
    this.curve = new THREE.CatmullRomCurve3(pts);
    this.pathT = 0;
    this.pathSpeed = speed;
    this.state = "walking";
    this.afterArrive = after;
  }

  returnHome(speed = 0.3) {
    const start = this.group.position.clone(); start.y = 0.18;
    const homePt = new THREE.Vector3(this.home.x, 0.18, this.home.z + 1.2);
    this.curve = new THREE.CatmullRomCurve3([start, homePt]);
    this.pathT = 0; this.pathSpeed = speed; this.state = "returning";
    this.afterArrive = () => { this.state = "idle"; };
  }

  update(dt, t) {
    this.bob += dt * (this.state === "idle" ? 2.0 : 6.0);
    if ((this.state === "walking" || this.state === "returning") && this.curve) {
      this.pathT += dt * this.pathSpeed;
      if (this.pathT >= 1) {
        this.pathT = 1;
        const pos = this.curve.getPoint(1);
        this.group.position.set(pos.x, 0.18, pos.z);
        const cb = this.afterArrive; this.afterArrive = null; this.curve = null;
        if (this.state === "walking") this.state = "working";
        if (cb) cb();
      } else {
        const pos = this.curve.getPoint(this.pathT);
        const ahead = this.curve.getPoint(Math.min(1, this.pathT + 0.02));
        this.group.position.set(pos.x, 0.18 + Math.abs(Math.sin(this.bob)) * 0.06, pos.z);
        this.group.lookAt(ahead.x, 0.18, ahead.z);
        // step bob on feet
        if (this.lFoot && this.rFoot) {
          this.lFoot.position.y = 0.12 + Math.max(0, Math.sin(this.bob)) * 0.08;
          this.rFoot.position.y = 0.12 + Math.max(0, Math.sin(this.bob + Math.PI)) * 0.08;
        }
      }
    } else {
      // idle / working bob
      const baseY = 0.18 + Math.sin(this.bob) * 0.04;
      this.group.position.y = baseY;
      if (this.state === "working") {
        // small busy sway
        this.group.rotation.y = Math.sin(t * 2 + this.bob) * 0.15;
      }
    }
    // pulse the core + antenna tip
    const pulse = 0.7 + Math.sin(t * 3 + this.bob) * 0.3;
    this.core.material.emissiveIntensity = pulse;
    this.tip.material.emissiveIntensity = 0.8 + Math.sin(t * 6) * 0.4;
  }
}

export function buildAgents(scene, agentsMeta) {
  const agents = {};
  for (const [id, meta] of Object.entries(agentsMeta)) {
    const a = new Agent(id, meta);
    scene.add(a.group);
    agents[id] = a;
  }
  return agents;
}
