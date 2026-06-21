// ============================================================
// main.js — OpenTalon / The Terrarium orchestrator.
// Builds the isometric scene, wires live data to agents + signal
// pulses + HUD, and runs an RPi5-friendly render loop.
// ============================================================
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { buildBoard, buildRoom, buildMarker, STATIONS, PALETTE } from "./board.js";
import { buildAgents } from "./agents.js";
import { buildTraceNetwork, SignalLayer } from "./signals.js";
import { TerrariumNet } from "./net.js";

// HUD helper defined early so it's safe for any pre-render UI calls.
const el = (id) => document.getElementById(id);
const AGENT_NAMES = { scout: "Scout", scribe: "Scribe", maker: "Maker", keeper: "Keeper" };

// ---- renderer / scene -------------------------------------------------
const sceneEl = document.getElementById("scene");
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x05080c);
scene.fog = new THREE.FogExp2(0x05080c, 0.012);

// WebGL capability guard — render is optional; data/HUD must run regardless.
let renderer = null;
let RENDER_OK = false;
try {
  const testCanvas = document.createElement("canvas");
  const gl = testCanvas.getContext("webgl2") || testCanvas.getContext("webgl");
  if (!gl) throw new Error("no-webgl");
  renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5)); // RPi5 GPU headroom
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  sceneEl.appendChild(renderer.domElement);
  RENDER_OK = true;
} catch (e) {
  console.warn("[talon] WebGL unavailable; running in data-only mode.", e);
  sceneEl.innerHTML =
    '<div style="position:absolute;inset:0;display:grid;place-items:center;color:#6f8a9a;' +
    'font-family:monospace;text-align:center;padding:40px">' +
    '<div><div style="color:#3fd0ff;font-size:18px;letter-spacing:3px;margin-bottom:10px">' +
    'TERRARIUM · DATA MODE</div>3D habitat requires WebGL.<br/>Live telemetry, agents, and ' +
    'signal routing remain active in the HUD.</div></div>';
}

// ---- isometric-style orthographic camera ------------------------------
const aspect = window.innerWidth / window.innerHeight;
const frustum = 38;
const camera = new THREE.OrthographicCamera(
  -frustum * aspect / 2, frustum * aspect / 2, frustum / 2, -frustum / 2, 0.1, 1000
);
camera.position.set(40, 34, 40);
camera.lookAt(2, 0, 3);

const controls = RENDER_OK ? new OrbitControls(camera, renderer.domElement) : null;
if (controls) {
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.minZoom = 0.5; controls.maxZoom = 2.6;
controls.maxPolarAngle = Math.PI / 2.25;
controls.target.set(2, 1, 3);
controls.autoRotate = false;
controls.autoRotateSpeed = 0.35;
}

// ---- lighting ---------------------------------------------------------
scene.add(new THREE.AmbientLight(0x33485c, 0.7));
const key = new THREE.DirectionalLight(0xbfe6ff, 1.1);
key.position.set(20, 40, 18);
key.castShadow = true;
key.shadow.mapSize.set(1024, 1024);
key.shadow.camera.left = -30; key.shadow.camera.right = 30;
key.shadow.camera.top = 30; key.shadow.camera.bottom = -30;
scene.add(key);
const rim = new THREE.DirectionalLight(0x2393c9, 0.5);
rim.position.set(-20, 15, -20); scene.add(rim);

// ---- label sprite helper ----------------------------------------------
function makeLabel(text, color = 0x3fd0ff) {
  const cv = document.createElement("canvas");
  cv.width = 256; cv.height = 64;
  const ctx = cv.getContext("2d");
  ctx.font = "bold 26px 'JetBrains Mono', monospace";
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  const hex = "#" + new THREE.Color(color).getHexString();
  ctx.fillStyle = "rgba(5,12,18,0.0)"; ctx.fillRect(0, 0, 256, 64);
  ctx.shadowColor = hex; ctx.shadowBlur = 12;
  ctx.fillStyle = hex; ctx.fillText(text, 128, 34);
  const tex = new THREE.CanvasTexture(cv);
  tex.anisotropy = 4;
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
  spr.scale.set(4.4, 1.1, 1);
  return spr;
}

// ---- build world ------------------------------------------------------
buildBoard(scene);
buildTraceNetwork(scene);

const rooms = {};
const markers = {};
const pickables = [];
for (const [id, st] of Object.entries(STATIONS)) {
  const room = buildRoom(st);
  scene.add(room);
  rooms[id] = room;
  st.h = room.userData.height;
  const marker = buildMarker(st, makeLabel);
  scene.add(marker);
  markers[id] = marker;
  // invisible pick box over the room
  const pick = new THREE.Mesh(
    new THREE.BoxGeometry(st.w, st.h + 2, st.d),
    new THREE.MeshBasicMaterial({ visible: false })
  );
  pick.position.set(st.x, st.h / 2, st.z);
  pick.userData.stationId = id;
  scene.add(pick);
  pickables.push(pick);
}

const signals = new SignalLayer(scene);

// Agents created after snapshot (need agent meta) — placeholder ref.
let agents = {};
const AGENT_META = {
  scout:  { name: "Scout",  role: "Observer & Explorer",    home: "PERCEPTION", color: "#3fd0ff" },
  scribe: { name: "Scribe", role: "Historian & Chronicler", home: "MEMORY",     color: "#a875ff" },
  maker:  { name: "Maker",  role: "Builder & Inventor",     home: "WORKSHOP",   color: "#ffb347" },
  keeper: { name: "Keeper", role: "Guardian & Evaluator",   home: "GATE",       color: "#46e08a" },
};
agents = buildAgents(scene, AGENT_META);
renderAgentStatus();

// ---- HUD helpers ------------------------------------------------------

function fmtUptime(s) {
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  return `${d}d ${h}h ${m}m`;
}

function setBar(barId, pct, warnAt = 70, critAt = 88) {
  const bar = el(barId);
  bar.classList.remove("warn", "crit");
  if (pct >= critAt) bar.classList.add("crit");
  else if (pct >= warnAt) bar.classList.add("warn");
  bar.querySelector("i").style.width = Math.min(100, pct) + "%";
}

function updateMetrics(d) {
  el("m-cpu").textContent = d.cpu.toFixed(0) + "%";
  el("m-ram").textContent = d.ram.toFixed(0) + "%";
  el("m-temp").textContent = d.temp.toFixed(0) + "°C";
  el("m-nitro").textContent = d.nitro.toFixed(0) + "%";
  el("m-mqtt").textContent = d.mqtt.toFixed(0) + " msg/s";
  el("m-uptime").textContent = fmtUptime(d.uptime);
  setBar("bar-cpu", d.cpu);
  setBar("bar-ram", d.ram);
  setBar("bar-temp", (d.temp - 30) / 0.5);  // 30-80°C → 0-100
  setBar("bar-nitro", d.nitro);
  if (d.tasks_completed != null) el("s-tasks").textContent = d.tasks_completed;
  if (d.proposals != null) el("s-proposals").textContent = d.proposals;
  const status = d.temp > 72 || d.cpu > 88 ? "Strained" : "Optimal";
  const hs = el("health-status");
  hs.textContent = status;
  hs.style.color = status === "Optimal" ? "var(--green)" : "var(--amber)";
}

function addFeed(agent, text, level) {
  const list = el("feed-list");
  const t = new Date().toLocaleTimeString("en-US", { hour12: false });
  const key = (agent || "system").toLowerCase();
  const div = document.createElement("div");
  div.className = "feed-item " + (level === "warn" ? "warn" : "");
  div.innerHTML = `<span class="t">${t}</span>` +
    `<span class="a a-${key}">${agent}</span>` +
    `<span class="m">${text}</span>`;
  list.prepend(div);
  while (list.children.length > 40) list.removeChild(list.lastChild);
}

let approvals = [];
function renderApprovals() {
  const list = el("approval-list");
  el("approval-count").textContent = approvals.length + " PENDING";
  list.innerHTML = "";
  approvals.forEach((a) => {
    const div = document.createElement("div");
    div.className = "approval";
    div.innerHTML =
      `<div class="title">${a.title}</div>` +
      `<div class="meta">Requested by ${a.requested_by} · <span class="risk ${a.risk}">${a.risk}</span></div>` +
      `<div class="btns">
        <button class="btn approve" data-id="${a.id}" data-d="approve">Approve</button>
        <button class="btn deny" data-id="${a.id}" data-d="deny">Deny</button>
      </div>`;
    list.appendChild(div);
  });
  list.querySelectorAll(".btn").forEach((b) => b.addEventListener("click", () => {
    if (mode !== "sysop") { flashHint("Switch to SYSOP mode to act on approvals"); return; }
    net.send({ action: "approval", id: b.dataset.id, decision: b.dataset.d });
  }));
}

function renderAgentStatus() {
  const box = el("agent-status");
  box.innerHTML = "";
  for (const [id, meta] of Object.entries(AGENT_META)) {
    const st = agents[id] ? agents[id].state : "idle";
    const stLabel = st === "walking" || st === "routing" ? "ROUTING" : "ACTIVE";
    const div = document.createElement("div");
    div.className = "agent-row";
    div.innerHTML =
      `<div class="agent-chip" style="color:${meta.color};box-shadow:0 0 10px ${meta.color}66">◆</div>` +
      `<div><div class="name">${meta.name}</div><div class="role">${meta.role}</div></div>` +
      `<div class="st ${stLabel === 'ROUTING' ? 'routing' : 'active'}" id="st-${id}">${stLabel}</div>`;
    box.appendChild(div);
  }
}

// ---- networking -------------------------------------------------------
const net = new TerrariumNet();

net.on("snapshot", (ev) => {
  if (ev.metrics) updateMetrics({ ...ev.metrics, uptime: 0,
    tasks_completed: ev.tasks_completed, proposals: ev.proposals });
  approvals = ev.approvals || [];
  renderApprovals();
  hideBoot();
});

net.on("source", (ev) => {
  const pill = el("source"); const txt = el("source-txt");
  if (ev.bridge) { pill.classList.add("live"); txt.textContent = "LIVE · " + (ev.source || "MQTT"); }
  else { pill.classList.remove("live"); txt.textContent = "SIMULATING"; }
});

net.on("metrics", (ev) => updateMetrics(ev.data));

net.on("request", (ev) => {
  // visual pulse along the route + send the owning agent to walk it
  signals.spawn(ev.path, ev.kind, ev.reason);
  const a = agents[ev.agent];
  if (a && a.state === "idle") {
    a.walkRoute(ev.path, ev.reason ? 0.28 : 0.42, () => {
      setTimeout(() => a.returnHome(), 900 + Math.random() * 800);
    });
    const stEl = el("st-" + ev.agent);
    if (stEl) { stEl.textContent = "ROUTING"; stEl.className = "st routing"; }
    setTimeout(() => {
      const e2 = el("st-" + ev.agent);
      if (e2) { e2.textContent = "ACTIVE"; e2.className = "st active"; }
    }, 3500);
  }
});

net.on("feed", (ev) => addFeed(ev.agent, ev.text, ev.level));

net.on("agent", (ev) => {
  if (ev.state === "idle_task" && ev.detail) addFeed(AGENT_NAMES[ev.agent] || ev.agent, ev.detail, "info");
});

net.on("approval", (ev) => {
  if (ev.action === "add") { approvals.push(ev.item); renderApprovals(); }
  else if (ev.action === "resolve") {
    approvals = approvals.filter((a) => a.id !== ev.id);
    renderApprovals();
    addFeed("Keeper", `Approval ${ev.decision === "approve" ? "granted" : "denied"}`, "info");
  }
});

net.on("status", (ev) => {
  if (!ev.connected) { el("source-txt").textContent = "RECONNECTING…"; }
});

// ---- interaction: hover/click stations --------------------------------
const ray = new THREE.Raycaster();
const mouse = new THREE.Vector2();
const tooltip = el("tooltip");
let hovered = null;

function onMove(e) {
  mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
  mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
  ray.setFromCamera(mouse, camera);
  const hit = ray.intersectObjects(pickables)[0];
  if (hit) {
    const id = hit.object.userData.stationId;
    hovered = id;
    const st = STATIONS[id];
    tooltip.style.display = "block";
    tooltip.style.left = Math.min(e.clientX + 16, window.innerWidth - 260) + "px";
    tooltip.style.top = (e.clientY + 16) + "px";
    tooltip.innerHTML = `<h4>${st.label}</h4><div class="reg">${st.region}</div><p>${st.desc}</p>`;
  } else { hovered = null; tooltip.style.display = "none"; }
}
window.addEventListener("mousemove", onMove);

window.addEventListener("click", () => {
  if (!hovered) return;
  // focus camera target gently on clicked station
  const st = STATIONS[hovered];
  if (controls) controls.target.set(st.x, 1, st.z);
});

// ---- modes ------------------------------------------------------------
let mode = "insight";
function setMode(m) {
  mode = m;
  document.querySelectorAll(".mode").forEach((x) =>
    x.classList.toggle("active", x.dataset.mode === m));
  // Ambient: relaxed, slow auto-rotate, dim HUD side panels
  if (controls) controls.autoRotate = (m === "ambient");
  const left = el("left"), right = el("right");
  if (m === "ambient") { left.style.opacity = 0.35; right.style.opacity = 0.35; }
  else if (m === "public") { left.style.opacity = 0.85; right.style.opacity = 0.0; right.style.pointerEvents = "none"; }
  else { left.style.opacity = 1; right.style.opacity = 1; right.style.pointerEvents = "auto"; }
  // Sysop: enable inject on click of CORE
  if (m === "sysop") flashHint("SYSOP: click stations to inject a request");
}
document.querySelectorAll(".mode").forEach((x) =>
  x.addEventListener("click", () => setMode(x.dataset.mode)));

// Sysop inject: clicking a station injects a request of its kind
window.addEventListener("click", () => {
  if (mode !== "sysop" || !hovered) return;
  const kindMap = { PERCEPTION: "perception", MEMORY: "memory", WORKSHOP: "build",
    GATE: "approval", NITRO: "reasoning", CORE: null, ETH: null };
  net.send({ action: "inject", kind: kindMap[hovered] });
  flashHint("Injected request → " + hovered);
});

let hintTimer;
function flashHint(text) {
  const h = document.querySelector(".hint");
  const prev = h.innerHTML;
  h.innerHTML = text;
  h.style.color = "var(--cyan)";
  clearTimeout(hintTimer);
  hintTimer = setTimeout(() => { h.innerHTML = prev; h.style.color = "var(--text-dim)"; }, 2200);
}

// ---- tabs (camera presets / focus) ------------------------------------
const TAB_FOCUS = {
  habitat: [0, 0, 2], agents: [-2, 0, 9], memory: [-8, 0, -1],
  tasks: [8.5, 0, -3.5], system: [0, 0, 0],
};
document.querySelectorAll(".tab").forEach((t) =>
  t.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((x) => x.classList.remove("active"));
    t.classList.add("active");
    const f = TAB_FOCUS[t.dataset.tab] || [0, 0, 2];
    if (controls) controls.target.set(f[0], 1, f[2]);
  }));

// ---- clock ------------------------------------------------------------
function tickClock() {
  const now = new Date();
  el("clock").childNodes[0].nodeValue = now.toLocaleTimeString("en-US", { hour12: false });
  el("date").textContent = now.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
setInterval(tickClock, 1000); tickClock();

// ---- boot loader sequence ---------------------------------------------
const BOOT_LINES = [
  "initializing terrarium substrate…",
  "mounting EagleClaw · RPi5 16GB…",
  "linking NitroLLM reasoning engine…",
  "spawning agents: Scout · Scribe · Maker · Keeper…",
  "opening MQTT nervous system…",
  "habitat online.",
];
let bootIdx = 0;
const bootTimer = setInterval(() => {
  bootIdx++;
  if (bootIdx < BOOT_LINES.length) el("bootline").textContent = BOOT_LINES[bootIdx];
  else { clearInterval(bootTimer); }
}, 480);
let booted = false;
function hideBoot() {
  if (booted) return; booted = true;
  setTimeout(() => { el("boot").classList.add("hidden"); }, 1400);
}
// failsafe: hide boot even if no snapshot arrives
setTimeout(hideBoot, 6000);

// ---- render loop ------------------------------------------------------
const clock = new THREE.Clock();
let acc = 0;
function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(0.05, clock.getDelta());
  const t = clock.elapsedTime;

  if (!RENDER_OK) return;
  if (controls) controls.update();
  signals.update(dt, t);
  for (const id in agents) agents[id].update(dt, t);

  // animate station markers (spin diamond, bob)
  for (const id in markers) {
    const m = markers[id];
    if (m.userData.diamond) m.userData.diamond.rotation.y += dt * 1.2;
    if (m.userData.ring) m.userData.ring.rotation.z += dt * 0.6;
    m.position.y = (STATIONS[id].h || 5) * 0.95 + 1.6 + Math.sin(t * 1.5 + id.length) * 0.12;
  }

  renderer.render(scene, camera);
}
animate();

// ---- resize -----------------------------------------------------------
window.addEventListener("resize", () => {
  const a = window.innerWidth / window.innerHeight;
  camera.left = -frustum * a / 2; camera.right = frustum * a / 2;
  camera.top = frustum / 2; camera.bottom = -frustum / 2;
  camera.updateProjectionMatrix();
  if (renderer) renderer.setSize(window.innerWidth, window.innerHeight);
});

// Keep the scene alive: if no pulses are traveling for a while, nudge an
// ambient route so circuit traces always show motion (idle liveliness).
setInterval(() => {
  if (signals.activeCount === 0) {
    const idlePaths = [["ETH","CORE","PERCEPTION"], ["CORE","MEMORY"], ["ETH","CORE","GATE"]];
    const pick = idlePaths[Math.floor(Math.random() * idlePaths.length)];
    signals.spawn(pick, "perception", false);
  }
}, 4200);

// expose for debugging
window.__talon = { scene, agents, signals, net };
