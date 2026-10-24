// The farm on screen: its coops (any number), gateways and live values, shared by every component.
// Admins switch farms; everyone else only ever receives their own farm from Node-RED.
//   first paint: GET /api/farm-data (coops, flocks, targets, last readings, light states)
//   after that:  WebSocket events (readings, light ACKs, alerts, gateway status, "config changed")
// Components subscribe with farm.on("change" | "data" | "telemetry" | "light" | "alert" | "conn" | "notice", fn).
import { ONLINE_MS, ACK_TIMEOUT_MS } from "../config.js";
import { defaultTarget } from "../core/status.js";
import { api } from "./api.js";
import { connectLive } from "./live.js";
import { session } from "./session.js";

let data = { farm: null, coops: [], gateways: [], keepers: [], unknown_devices: [] };
const live = {};      // coop id -> {temp, humidity, ts, led, ledKnown}
const pending = {};   // coop id -> {want, timer}
const conn = { live: null, api: null, apiError: "" };
const handlers = { change: new Set(), data: new Set(), telemetry: new Set(), light: new Set(), alert: new Set(), conn: new Set(), notice: new Set() };
const emit = (t, ...a) => handlers[t].forEach(fn => fn(...a));
let started = false, loaded = false;

const view = c => {
  const l = live[c.id] || {};
  return Object.assign({}, c, {
    target: c.target || defaultTarget(),
    temp: l.temp ?? null, humidity: l.humidity ?? null, ts: l.ts ?? null,
    online: l.ts != null && Date.now() - l.ts <= ONLINE_MS,
    led: !!l.led, ledKnown: !!l.ledKnown, pending: pending[c.id] ? pending[c.id].want : null,
    hasDevice: !!(c.gateway_id && c.node_id),
  });
};
const changed = () => emit("change", farm.coops());
const bulk = new Set();   // coops still confirming "ปิดไฟทั้งหมด": one toast for all of them, not one per coop
// mark a coop as waiting for its node's ACK; give up after ACK_TIMEOUT_MS
function wait(c, on) {
  pending[c.id] = { want: on, timer: setTimeout(() => {
    delete pending[c.id]; bulk.delete(c.id);
    farm.notice(`${c.name} ไม่ตอบรับคำสั่ง: เช็กว่า gateway และบอร์ดออนไลน์`, true);
    changed();
  }, ACK_TIMEOUT_MS) };
}

function apply(d) {
  data = d;
  if (session.isAdmin && d.farm && session.farmId !== d.farm.id) session.setFarm(d.farm.id);
  for (const c of d.coops) {
    const l = c.live || {};
    const cur = live[c.id] || {};
    live[c.id] = {
      temp: l.temp ?? cur.temp ?? null, humidity: l.humidity ?? cur.humidity ?? null,
      ts: l.at ? Math.max(Date.parse(l.at), cur.ts || 0) : (cur.ts ?? null),
      led: cur.ledKnown ? cur.led : !!l.led, ledKnown: cur.ledKnown || !!l.ledKnown,
    };
  }
  loaded = true;
  emit("data", data);
  changed();
}

export const farm = {
  on(t, fn) { handlers[t].add(fn); return () => handlers[t].delete(fn); },
  get loaded() { return loaded; },
  // run fn once the farm is known
  ready(fn) { if (loaded) fn(); else { const off = farm.on("data", () => { off(); fn(); }); } },
  get info() { return data.farm; },
  get gateways() { return data.gateways; },
  get keepers() { return data.keepers || []; },      // active keepers (ผู้ดูแลฟาร์ม) of this farm
  get unknownDevices() { return data.unknown_devices || []; },
  coops: ({ all = false } = {}) => data.coops.filter(c => all || c.active).map(view),
  coop: id => { const c = data.coops.find(c => c.id === Number(id)); return c ? view(c) : null; },
  conn: () => ({ ...conn }),
  notice: (msg, err = false) => emit("notice", msg, err),
  reload: () => { const asked = session.isAdmin ? session.farmId : null; return api.farmData().then(d => {
    // the admin switched farm while this was loading: drop the stale answer and load the chosen farm
    if (session.isAdmin && session.farmId !== asked) return farm.reload();
    conn.api = true; apply(d);
  }).catch(e => {
    // an admin's remembered farm may have been removed: fall back to the first farm once
    if (e.status === 404 && session.isAdmin && session.farmId) { session.setFarm(null); return farm.reload(); }
    conn.api = false; conn.apiError = e.message; emit("conn", farm.conn());
  }); },

  // Ask for a light change; the switch only flips when the node confirms (WebSocket "light" event).
  async setLight(id, on) {
    const c = farm.coop(id);
    if (!c || pending[id]) return;
    wait(c, on);
    changed();
    try {
      const r = await api.light(id, on);
      if (r.to_manual) farm.notice(`${c.name} เปลี่ยนเป็นสั่งเอง (ปิดการตั้งเวลา)`);
    } catch (e) {
      clearTimeout(pending[id] && pending[id].timer);
      delete pending[id];
      farm.notice("สั่งไฟไม่สำเร็จ: " + e.message, true);
      changed();
    }
  },

  // One button: every light of the farm off. Lit coops show "กำลังปิดไฟ..." until their node confirms.
  async lightsOff() {
    const lit = farm.coops().filter(c => c.hasDevice && c.led && !pending[c.id]);
    lit.forEach(c => { wait(c, false); bulk.add(c.id); });
    changed();
    try {
      const r = await api.lightsOff();
      farm.notice(`ส่งคำสั่งปิดไฟ ${r.coops.length} โรงเรือนแล้ว` + (r.to_manual ? ` · ${r.to_manual} โรงเรือนเลิกตั้งเวลา` : ""));
    } catch (e) {
      lit.forEach(c => { clearTimeout(pending[c.id] && pending[c.id].timer); delete pending[c.id]; bulk.delete(c.id); });
      farm.notice("ปิดไฟทั้งหมดไม่สำเร็จ: " + e.message, true);
      changed();
    }
  },

  start() {
    if (started) return;
    started = true;
    farm.reload().finally(() => connectLive({
      onStatus(ok) { conn.live = ok; emit("conn", farm.conn()); if (ok && loaded) farm.reload(); },
      onEvent(m) {
        if (m.type === "telemetry") {
          live[m.coop_id] = Object.assign({}, live[m.coop_id], { temp: m.temp, humidity: m.humidity, ts: Date.now() });
          changed(); emit("telemetry", m.coop_id);
        } else if (m.type === "light") {
          live[m.coop_id] = Object.assign({}, live[m.coop_id], { led: m.on, ledKnown: true });
          const p = pending[m.coop_id];
          if (p && p.want === m.on) {
            clearTimeout(p.timer); delete pending[m.coop_id];
            const c = farm.coop(m.coop_id);
            if (!bulk.delete(m.coop_id)) farm.notice(`${m.on ? "เปิด" : "ปิด"}ไฟ${c ? c.name : ""} แล้ว · บอร์ดยืนยันแล้ว`);
            else if (!bulk.size) farm.notice("ปิดไฟครบทุกโรงเรือนแล้ว · บอร์ดยืนยันแล้ว");
          }
          changed(); emit("light", m.coop_id);
        } else if (m.type === "alert") {
          const c = m.coop_id ? farm.coop(m.coop_id) : null;
          farm.notice((c ? c.name + ": " : "") + m.message, m.level !== "ok");
          emit("alert", m);
        } else if (m.type === "gateway") {
          const g = data.gateways.find(g => g.id === m.gateway_id);
          if (g) { g.online = m.online; emit("conn", farm.conn()); }
        } else if (m.type === "config") {
          farm.reload();
        }
      },
    }));
    setInterval(changed, 1000);   // "updated N s ago" and online/offline move with the clock
  },
};
export { session };
