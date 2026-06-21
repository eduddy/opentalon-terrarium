// ============================================================
// net.js (static build) — In-browser event bus backed by the
// JS TerrariumSimulator. Presents the same API as the WS version
// so main.js needs zero changes. Runs the simulator tick loop
// at TICK_HZ and dispatches events to registered handlers.
// ============================================================
import { TerrariumSimulator } from "./simulator.js";

const TICK_HZ = 8;

export class TerrariumNet {
  constructor() {
    this.handlers = {};
    this.sim = new TerrariumSimulator();
    this._lastTick = performance.now();
    this._running = false;
    this._start();
  }

  on(type, fn) { (this.handlers[type] ||= []).push(fn); return this; }

  emit(type, ev) {
    (this.handlers[type] || []).forEach(f => f(ev));
    (this.handlers["*"] || []).forEach(f => f(ev));
  }

  send(obj) {
    // Handle inject and approval actions locally.
    const action = obj?.action;
    if (action === "inject") {
      const ev = this.sim.injectRequest(obj.kind);
      this.emit(ev.type, ev);
    } else if (action === "approval") {
      const ev = this.sim.resolveApproval(obj.id, obj.decision);
      if (ev) this.emit(ev.type, ev);
    }
  }

  _start() {
    if (this._running) return;
    this._running = true;

    // Emit snapshot immediately so the HUD populates on first frame.
    const snap = this.sim.snapshot();
    // Defer one microtask so handlers registered after construction receive it.
    Promise.resolve().then(() => {
      this.emit("snapshot", snap);
      this.emit("source", { source: "sim", bridge: false });
      this.emit("status", { connected: true });
    });

    const loop = () => {
      const now = performance.now();
      const dt = Math.min(0.05, (now - this._lastTick) / 1000);
      this._lastTick = now;
      const events = this.sim.tick(dt);
      for (const ev of events) this.emit(ev.type, ev);
      setTimeout(loop, 1000 / TICK_HZ);
    };
    setTimeout(loop, 1000 / TICK_HZ);
  }
}
