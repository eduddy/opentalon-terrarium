// ============================================================
// board.js — Builds the RPi5-board-as-office isometric scene.
// Procedural Three.js geometry only (no external models), so it
// stays light enough to render on an RPi5 16GB host.
// ============================================================
import * as THREE from "three";

export const PALETTE = {
  pcb: 0x0c5a3a,        // raspberry-pi green board
  pcbEdge: 0x0a3d2a,
  silk: 0xeef6ff,
  copper: 0xc98a3a,
  glass: 0x9ee0ff,
  floorWood: 0x6b4a36,  // warm wood (cozy-office reference)
  floorWoodAlt: 0x7d5742,
  wallDark: 0x191a22,
  woodSlat: 0xa8643c,
  rug: 0xffb347,
  rugDark: 0x2b2f3a,
  cyan: 0x3fd0ff,
  amber: 0xffb347,
  green: 0x46e08a,
  purple: 0xa875ff,
  metal: 0x2a3138,
};

// Station definitions: id, position on the board grid, accent color, role.
// Layout mirrors the confirmed board-to-office mapping.
export const STATIONS = {
  CORE:       { x: 0,    z: 0,    w: 6,  d: 6,  color: PALETTE.cyan,   label: "PI CORE",
                region: "BCM2712 SoC", desc: "Sovereign Coordinator. Hosts dashboard, MQTT broker, SQLite WAL memory, MCP sandbox." },
  MEMORY:     { x: -8,   z: -1,   w: 5,  d: 5,  color: PALETTE.purple, label: "MEMORY ARCHIVE",
                region: "LPDDR4X RAM", desc: "Scribe's domain. SQLite WAL memory, journals, chronicle archive." },
  WORKSHOP:   { x: 8.5,  z: -3.5, w: 5,  d: 4,  color: PALETTE.amber,  label: "MAKER WORKSHOP",
                region: "USB 3.0 Bank", desc: "Maker's bench. MCP execution sandbox, build artifacts, tooling." },
  PERCEPTION: { x: -2,   z: 9,    w: 7,  d: 4.5,color: PALETTE.cyan,   label: "PERCEPTION WING",
                region: "40-pin GPIO", desc: "Scout's sensor array. Presence radar, acoustic profiling, CO2/temp via ESPHome." },
  GATE:       { x: 8,    z: 6.5,  w: 5,  d: 4.5,color: PALETTE.green,  label: "KEEPER GATE",
                region: "Power / PCIe", desc: "Keeper's guardpost. Approval queue, risk evaluation, access control." },
  ETH:        { x: -10,  z: 7,    w: 3.5,d: 3.5,color: PALETTE.cyan,   label: "COMMS GATEWAY",
                region: "Gigabit Ethernet", desc: "Nervous-system ingress. Inbound requests enter the board here." },
  NITRO:      { x: 14.5, z: 9.5,  w: 4.5,d: 4,  color: PALETTE.amber,  label: "NITRO LLM UPLINK",
                region: "Off-board link", desc: "Reasoning Engine (Nitro 5, 64GB). Llama.cpp inference, heavy Python. Cloud API fallback." },
};

// Trace network: ordered point lists (board-space) used by signal pulses
// and agent walk paths. Y is height above board.
const PAD = 0.18;
function p(x, z) { return new THREE.Vector3(x, PAD, z); }

export const TRACES = {
  "ETH-CORE":         [p(-10,7), p(-6,4), p(-2,2), p(0,0)],
  "CORE-MEMORY":      [p(0,0), p(-4,-0.5), p(-8,-1)],
  "CORE-WORKSHOP":    [p(0,0), p(4,-1.5), p(8.5,-3.5)],
  "CORE-PERCEPTION":  [p(0,0), p(-1,4), p(-2,9)],
  "CORE-GATE":        [p(0,0), p(4,3), p(8,6.5)],
  "CORE-NITRO":       [p(0,0), p(6,3), p(11,6), p(14.5,9.5)],
};

// Resolve a route (list of station ids) into a smooth polyline in board space.
export function routeToPoints(path) {
  const pts = [];
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i], b = path[i + 1];
    let seg = TRACES[`${a}-${b}`] || TRACES[`${b}-${a}`];
    if (seg) {
      let s = seg.map((v) => v.clone());
      if (TRACES[`${b}-${a}`] && !TRACES[`${a}-${b}`]) s = s.reverse();
      if (i > 0) s = s.slice(1); // avoid duplicate joint
      pts.push(...s);
    } else {
      pts.push(STATIONS[a] ? p(STATIONS[a].x, STATIONS[a].z) : p(0,0));
      pts.push(STATIONS[b] ? p(STATIONS[b].x, STATIONS[b].z) : p(0,0));
    }
  }
  return pts;
}

// ---- material helpers -------------------------------------------------
function emissive(color, intensity = 0.6) {
  return new THREE.MeshStandardMaterial({
    color, emissive: color, emissiveIntensity: intensity,
    roughness: 0.5, metalness: 0.2,
  });
}

// ---- the big board (PCB) ----------------------------------------------
export function buildBoard(scene) {
  const group = new THREE.Group();

  // PCB slab
  const board = new THREE.Mesh(
    new THREE.BoxGeometry(40, 0.6, 30),
    new THREE.MeshStandardMaterial({ color: PALETTE.pcb, roughness: 0.7, metalness: 0.25 })
  );
  board.position.y = -0.3;
  board.receiveShadow = true;
  group.add(board);

  // beveled darker rim
  const rim = new THREE.Mesh(
    new THREE.BoxGeometry(41, 0.3, 31),
    new THREE.MeshStandardMaterial({ color: PALETTE.pcbEdge, roughness: 0.8 })
  );
  rim.position.y = -0.55;
  group.add(rim);

  // silkscreen grid lines (subtle) — single LineSegments for performance
  const gridG = new THREE.BufferGeometry();
  const verts = [];
  for (let x = -19; x <= 19; x += 2) { verts.push(x, 0.02, -15, x, 0.02, 15); }
  for (let z = -14; z <= 14; z += 2) { verts.push(-19, 0.02, z, 19, 0.02, z); }
  gridG.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
  const grid = new THREE.LineSegments(gridG,
    new THREE.LineBasicMaterial({ color: 0x14784e, transparent: true, opacity: 0.35 }));
  grid.position.y = 0.02;
  group.add(grid);

  scene.add(group);
  return group;
}

// ---- a warm cozy "room" cutaway per station --------------------------
// Two back walls (L-shape), wood floor, slat paneling, rug, desk, shelf,
// accent light — distilled from the cozy-office reference image.
export function buildRoom(st) {
  const g = new THREE.Group();
  g.position.set(st.x, 0, st.z);
  const w = st.w, d = st.d, h = Math.min(w, d) * 0.95;

  const woodMat = new THREE.MeshStandardMaterial({ color: PALETTE.floorWood, roughness: 0.85 });
  const wallMat = new THREE.MeshStandardMaterial({ color: PALETTE.wallDark, roughness: 0.95 });
  const slatMat = new THREE.MeshStandardMaterial({ color: PALETTE.woodSlat, roughness: 0.7, metalness: 0.05 });

  // floor
  const floor = new THREE.Mesh(new THREE.BoxGeometry(w, 0.2, d), woodMat);
  floor.position.y = 0.1; floor.receiveShadow = true; g.add(floor);

  // geometric accent rug (amber/dark checker, from reference)
  const rug = new THREE.Group();
  const cols = 3, rows = 3, rw = (w * 0.5) / cols, rd = (d * 0.5) / rows;
  for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
    const c = (i + j) % 3 === 0 ? PALETTE.rug : ((i + j) % 2 === 0 ? PALETTE.rugDark : 0x8a8f9c);
    const tile = new THREE.Mesh(new THREE.BoxGeometry(rw * 0.96, 0.04, rd * 0.96),
      new THREE.MeshStandardMaterial({ color: c, roughness: 0.9 }));
    tile.position.set(-w * 0.25 + i * rw + rw / 2, 0.22, d * 0.1 + j * rd - rd);
    rug.add(tile);
  }
  g.add(rug);

  // back wall (along -z) and side wall (along -x) → L cutaway
  const backWall = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.2), wallMat);
  backWall.position.set(0, h / 2 + 0.1, -d / 2);
  backWall.receiveShadow = true; g.add(backWall);

  const sideWall = new THREE.Mesh(new THREE.BoxGeometry(0.2, h, d), wallMat);
  sideWall.position.set(-w / 2, h / 2 + 0.1, 0);
  sideWall.receiveShadow = true; g.add(sideWall);

  // wood slat paneling strip on the side wall
  const slatCount = 6;
  for (let i = 0; i < slatCount; i++) {
    const slat = new THREE.Mesh(new THREE.BoxGeometry(0.06, h * 0.7, 0.18), slatMat);
    slat.position.set(-w / 2 + 0.12, h / 2 + 0.1, -d / 2 + 0.6 + i * (d * 0.7 / slatCount));
    g.add(slat);
  }

  // floating accent shelf on the back wall with glowing items
  for (let s = 0; s < 2; s++) {
    const shelf = new THREE.Mesh(new THREE.BoxGeometry(w * 0.7, 0.08, 0.45), slatMat);
    shelf.position.set(w * 0.08, h * (0.55 + s * 0.28), -d / 2 + 0.28);
    g.add(shelf);
    for (let k = 0; k < 3; k++) {
      const item = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3 + Math.random() * 0.3, 0.3),
        emissive(st.color, 0.35));
      item.position.set(w * 0.08 - w * 0.22 + k * (w * 0.22), h * (0.55 + s * 0.28) + 0.25, -d / 2 + 0.3);
      g.add(item);
    }
  }

  // desk
  const desk = new THREE.Mesh(new THREE.BoxGeometry(w * 0.5, 0.12, d * 0.28),
    new THREE.MeshStandardMaterial({ color: 0x14181f, roughness: 0.4, metalness: 0.5 }));
  desk.position.set(w * 0.05, 1.0, d * 0.05); desk.castShadow = true; g.add(desk);
  // desk legs
  [-1, 1].forEach((sx) => [-1, 1].forEach((sz) => {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.0, 0.08),
      new THREE.MeshStandardMaterial({ color: 0x0d1116 }));
    leg.position.set(w * 0.05 + sx * w * 0.22, 0.5, d * 0.05 + sz * d * 0.1); g.add(leg);
  }));
  // glowing monitor on the desk
  const mon = new THREE.Mesh(new THREE.BoxGeometry(w * 0.34, 0.5, 0.05), emissive(st.color, 0.8));
  mon.position.set(w * 0.05, 1.42, d * 0.05 - d * 0.1); g.add(mon);

  // station floor light (accent glow)
  const glow = new THREE.PointLight(st.color, 0.9, w * 2.4, 2);
  glow.position.set(0, h * 0.6, d * 0.1);
  g.add(glow);

  g.userData.station = st;
  g.userData.height = h;
  return g;
}

// ---- holographic station marker (floating diamond + label plane) ------
export function buildMarker(st, makeLabel) {
  const grp = new THREE.Group();
  grp.position.set(st.x, (st.h || Math.min(st.w, st.d)) * 0.95 + 1.6, st.z);
  const diamond = new THREE.Mesh(new THREE.OctahedronGeometry(0.4),
    emissive(st.color, 1.1));
  grp.add(diamond);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.7, 0.04, 8, 32),
    emissive(st.color, 0.8));
  ring.rotation.x = Math.PI / 2;
  grp.add(ring);
  grp.userData.diamond = diamond;
  grp.userData.ring = ring;
  if (makeLabel) {
    const label = makeLabel(st.label, st.color);
    label.position.y = 1.0;
    grp.add(label);
  }
  return grp;
}
