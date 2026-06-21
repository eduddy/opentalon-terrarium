// ============================================================
// simulator.js — In-browser port of the Python TerrariumSimulator.
// Runs entirely client-side; no backend required for the static
// deployment. Produces the same event schema as the Python version.
// ============================================================

export const NODES = {
  ETH:        { label: "Comms Gateway",      region: "ethernet",  owner: null },
  CORE:       { label: "PI CORE",            region: "soc",       owner: "core" },
  MEMORY:     { label: "Memory Archive",     region: "ram",       owner: "scribe" },
  WORKSHOP:   { label: "Maker Workshop",     region: "usb",       owner: "maker" },
  PERCEPTION: { label: "Perception Wing",    region: "gpio",      owner: "scout" },
  GATE:       { label: "Keeper Gate",        region: "power",     owner: "keeper" },
  NITRO:      { label: "NitroLLM Uplink",    region: "offboard",  owner: null },
};

export const AGENTS = {
  scout:  { name: "Scout",  role: "Observer & Explorer",    home: "PERCEPTION", color: "#3fd0ff" },
  scribe: { name: "Scribe", role: "Historian & Chronicler", home: "MEMORY",     color: "#a875ff" },
  maker:  { name: "Maker",  role: "Builder & Inventor",     home: "WORKSHOP",   color: "#ffb347" },
  keeper: { name: "Keeper", role: "Guardian & Evaluator",   home: "GATE",       color: "#46e08a" },
};

const ROUTE_TEMPLATES = [
  { kind: "perception", path: ["ETH","CORE","PERCEPTION"],              agent: "scout",  reason: false },
  { kind: "memory",     path: ["ETH","CORE","MEMORY"],                  agent: "scribe", reason: false },
  { kind: "build",      path: ["ETH","CORE","WORKSHOP"],                agent: "maker",  reason: false },
  { kind: "approval",   path: ["ETH","CORE","GATE"],                    agent: "keeper", reason: false },
  { kind: "inference",  path: ["ETH","CORE","NITRO","CORE","MEMORY"],   agent: "scribe", reason: true  },
  { kind: "reasoning",  path: ["ETH","CORE","NITRO","CORE","WORKSHOP"], agent: "maker",  reason: true  },
];

const MQTT_TOPICS = {
  perception: "talon/perception/presence",
  memory:     "talon/memory/write",
  build:      "talon/agent/maker/task",
  approval:   "talon/approval/queue",
  inference:  "talon/nitro/inference",
  reasoning:  "talon/nitro/inference",
};

const FEED_TEXTS = {
  perception: ["Presence delta detected","Acoustic profile updated","Radar sweep complete"],
  memory:     ["Memory archive expanded","Journal entry created","WAL checkpoint flushed"],
  build:      ["Draft script generated","Proposal: add WebSocket bridge","Artifact compiled"],
  approval:   ["Reviewed proposal (Low Risk)","Policy check passed","Risk re-evaluated"],
  inference:  ["NitroLLM inference returned","Context window summarized","Embedding batch done"],
  reasoning:  ["NitroLLM reasoning chain complete","Plan synthesized","Tool call resolved"],
};

function rand(lo, hi) { return lo + Math.random() * (hi - lo); }
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function uid() { return Math.random().toString(36).slice(2, 10); }

class Metric {
  constructor(value, lo, hi, noise, inertia = 0.06) {
    this.value = value; this.target = value;
    this.lo = lo; this.hi = hi; this.noise = noise; this.inertia = inertia;
  }
  step(dt) {
    if (Math.random() < 0.01) {
      const span = this.hi - this.lo;
      this.target = Math.min(this.hi, Math.max(this.lo, this.target + rand(-0.18, 0.18) * span));
    }
    this.value += (this.target - this.value) * this.inertia;
    this.value += rand(-this.noise, this.noise);
    this.value = Math.min(this.hi, Math.max(this.lo, this.value));
    return this.value;
  }
}

export class TerrariumSimulator {
  constructor() {
    this._startTs = Date.now();
    this._lastSpawn = Date.now();
    this._nextGap = this._burstGap();
    this._active = [];   // { id, kind, path, agent, reason, started, duration, risk }
    this.approvals = [];
    this.tasksCompleted = 312;
    this.proposals = 27;
    this.agentState = Object.fromEntries(
      Object.entries(AGENTS).map(([id, m]) => [id, { state: "idle", node: m.home }])
    );
    this.nodeLoad = Object.fromEntries(Object.keys(NODES).map(k => [k, 0.05]));
    this.metrics = {
      cpu:      new Metric(18,  4,  92, 0.6),
      ram:      new Metric(42, 30,  88, 0.4),
      temp:     new Metric(47, 38,  78, 0.25),
      co2:      new Metric(612,420,1400,4.0),
      rtemp:    new Metric(22.4,18, 27, 0.05),
      nitro:    new Metric(6,   2,  96, 1.2),
      mqtt:     new Metric(14,  2, 120, 1.5),
      presence: new Metric(1,   0,   4, 0.05),
      acoustic: new Metric(28, 20,  85, 1.0),
    };
    this._seedApprovals();
  }

  _seedApprovals() {
    [
      ["Install package: numpy",      "maker",  "Low"],
      ["Execute script: cleanup.sh",  "scout",  "Medium"],
      ["Publish devlog to public",    "scribe", "Low"],
    ].forEach(([title, who, risk]) =>
      this.approvals.push({ id: uid(), title, requested_by: who, risk })
    );
  }

  _burstGap() {
    return Math.random() < 0.22 ? rand(0.4, 1.4) : rand(2.2, 6.5);
  }

  _spawnRequest(nowMs) {
    const tmpl = pick(ROUTE_TEMPLATES);
    const risk = Math.random() < 0.7 ? "Low" : Math.random() < 0.8 ? "Medium" : "High";
    const duration = tmpl.reason ? rand(2.6, 4.2) : rand(1.4, 2.6);
    const req = {
      id: uid(), kind: tmpl.kind, path: [...tmpl.path],
      agent: tmpl.agent, reason: tmpl.reason,
      started: nowMs / 1000, duration, risk,
    };
    this._active.push(req);
    this.agentState[req.agent] = { state: "routing", node: req.path[req.path.length - 1] };
    this.metrics.mqtt.target = Math.min(120, this.metrics.mqtt.target + rand(6, 18));
    this.metrics.cpu.target  = Math.min(92,  this.metrics.cpu.target  + rand(3, 9));
    if (req.reason) this.metrics.nitro.target = Math.min(96, this.metrics.nitro.target + rand(20, 45));
    return {
      type: "request", ts: nowMs / 1000,
      id: req.id, kind: req.kind, path: req.path,
      agent: req.agent, reason: req.reason, risk: req.risk, duration: req.duration,
      topic: MQTT_TOPICS[req.kind] || "talon/route/request",
    };
  }

  tick(dt) {
    const nowMs = Date.now();
    const nowSec = nowMs / 1000;
    const events = [];

    // Spawn
    if ((nowMs - this._lastSpawn) / 1000 >= this._nextGap) {
      this._lastSpawn = nowMs;
      this._nextGap = this._burstGap();
      events.push(this._spawnRequest(nowMs));
    }

    // Advance active requests
    const still = [];
    for (const req of this._active) {
      const elapsed = nowSec - req.started;
      const frac = elapsed / req.duration;
      const seg = Math.min(req.path.length - 1, Math.round(frac * (req.path.length - 1)));
      this.nodeLoad[req.path[seg]] = Math.min(1.0, (this.nodeLoad[req.path[seg]] || 0) + 0.25);
      if (frac >= 1.0) {
        const texts = FEED_TEXTS[req.kind] || ["Event processed"];
        events.push({ type: "feed", ts: nowSec, agent: AGENTS[req.agent].name,
                      text: pick(texts), level: req.risk === "High" ? "warn" : "info" });
        this.agentState[req.agent] = { state: "idle", node: AGENTS[req.agent].home };
        this.tasksCompleted++;
        if (req.kind === "build" && Math.random() < 0.25 && this.approvals.length < 6) {
          const titles = ["Install package: pandas","Execute script: backup.sh",
                          "Publish report to public","Write file: config.yaml","Open port 1883"];
          this.proposals++;
          const item = { id: uid(), title: pick(titles), requested_by: AGENTS[req.agent].name, risk: req.risk };
          this.approvals.push(item);
          events.push({ type: "approval", ts: nowSec, action: "add", item });
        }
      } else {
        still.push(req);
      }
    }
    this._active = still;

    // Idle agent ambient tasks
    for (const [a, st] of Object.entries(this.agentState)) {
      if (st.state === "idle" && Math.random() < 0.012) {
        const acts = {
          scout: "scanning perimeter sensors", scribe: "indexing memory shards",
          maker: "tinkering at the bench",     keeper: "auditing access logs",
        };
        events.push({ type: "agent", ts: nowSec, agent: a,
                      state: "idle_task", node: st.node, detail: acts[a] });
      }
    }

    // Decay node loads
    for (const k of Object.keys(this.nodeLoad))
      this.nodeLoad[k] += (0.05 - this.nodeLoad[k]) * 0.08;
    events.push({ type: "node", ts: nowSec,
                  loads: Object.fromEntries(Object.entries(this.nodeLoad).map(([k,v]) => [k, +v.toFixed(3)])) });

    // Metric drift
    if (!this._active.some(r => r.reason))
      this.metrics.nitro.target += (6 - this.metrics.nitro.target) * 0.05;
    this.metrics.mqtt.target += (14 - this.metrics.mqtt.target) * 0.03;
    this.metrics.cpu.target  += (18 - this.metrics.cpu.target)  * 0.02;
    const md = Object.fromEntries(Object.entries(this.metrics).map(([k,m]) => [k, +m.step(dt).toFixed(2)]));
    md.uptime = Math.floor((nowMs - this._startTs) / 1000);
    md.active_requests = this._active.length;
    md.tasks_completed = this.tasksCompleted;
    md.proposals = this.proposals;
    events.push({ type: "metrics", ts: nowSec, data: md });

    return events;
  }

  snapshot() {
    return {
      type: "snapshot", ts: Date.now() / 1000,
      nodes: NODES, agents: AGENTS,
      agent_state: this.agentState,
      metrics: Object.fromEntries(Object.entries(this.metrics).map(([k,m]) => [k, +m.value.toFixed(2)])),
      approvals: this.approvals.map(a => ({ ...a })),
      node_load: { ...this.nodeLoad },
      tasks_completed: this.tasksCompleted,
      proposals: this.proposals,
    };
  }

  resolveApproval(id, decision) {
    const idx = this.approvals.findIndex(a => a.id === id);
    if (idx === -1) return null;
    this.approvals.splice(idx, 1);
    return { type: "approval", ts: Date.now() / 1000, action: "resolve", id, decision };
  }

  injectRequest(kind) {
    const nowMs = Date.now();
    if (kind) {
      const tmpl = ROUTE_TEMPLATES.find(t => t.kind === kind);
      if (tmpl) {
        const req = {
          id: uid(), kind: tmpl.kind, path: [...tmpl.path],
          agent: tmpl.agent, reason: tmpl.reason,
          started: nowMs / 1000, duration: rand(2.0, 3.5), risk: "Low",
        };
        this._active.push(req);
        this.agentState[req.agent] = { state: "routing", node: req.path[req.path.length - 1] };
        return { type: "request", ts: nowMs / 1000, id: req.id, kind: req.kind,
                 path: req.path, agent: req.agent, reason: req.reason,
                 risk: req.risk, duration: req.duration,
                 topic: MQTT_TOPICS[req.kind] || "talon/route/request" };
      }
    }
    return this._spawnRequest(nowMs);
  }

  get activeCount() { return this._active.length; }
}
