// Light history of the last 7 days: one row = one time a light was on (on, off, duration).
// led_events = one row per state the node confirmed; each "on" is paired with the next "off" of the same coop.
// mountLightHistory(el, {coopId, fixed, summaryEl}) returns {refresh}.
import { ic } from "../core/icons.js";
import { hm, dur, dayLabel, esc } from "../core/format.js";
import { api } from "../services/api.js";
import { farm } from "../services/farm.js";
import { coopSelectHTML, coopOptions, coopName } from "./coop-select.js";

const EV_PAGE = 15;

export function mountLightHistory(el, { coopId = 0, fixed = false, summaryEl = null } = {}) {
  let filter = coopId, limit = EV_PAGE, sessions = [];
  el.classList.add("panel", "ev-panel");
  el.classList.toggle("fixed-house", fixed);
  el.innerHTML = `
    ${fixed ? "" : `<div class="tools">${coopSelectHTML("evCoop")}</div>`}
    <div class="scroll"><table>
      <thead><tr><th class="col-house">โรงเรือน</th><th>เปิดไฟ</th><th>ปิดไฟ</th><th>เปิดนาน</th></tr></thead>
      <tbody><tr><td class="empty" colspan="4">กำลังโหลด...</td></tr></tbody>
    </table></div>
    <button class="more" hidden>ดูเพิ่ม</button>`;
  const body = el.querySelector("tbody"), more = el.querySelector(".more"), sel = el.querySelector(".coop-select");

  async function load() {
    let ev;
    try { ev = await api.ledEvents({ coopId: fixed ? coopId : null, sinceMs: Date.now() - 7 * 864e5 }); }
    catch (e) {
      if (summaryEl) summaryEl.innerHTML = "";
      body.innerHTML = `<tr><td class="empty" colspan="4">โหลดข้อมูลไม่ได้: ${esc(e.message)}</td></tr>`;
      return;
    }
    const open = {};
    sessions = [];
    for (const e of ev) {
      const t = Date.parse(e.created_at);
      if (e.state) { if (open[e.coop_id] == null) open[e.coop_id] = t; }
      else { sessions.push({ coop: e.coop_id, on: open[e.coop_id] ?? null, off: t }); open[e.coop_id] = null; }
    }
    for (const [id, t] of Object.entries(open)) if (t != null) sessions.push({ coop: +id, on: t, off: null });
    sessions.sort((a, b) => (b.on ?? b.off) - (a.on ?? a.off));
    render();
  }

  function render() {
    if (summaryEl) renderSummary();
    const list = sessions.filter(s => !filter || s.coop === filter);
    const now = Date.now();
    let day = "", html = "";
    for (const s of list.slice(0, limit)) {
      const d = dayLabel(s.on ?? s.off);
      if (d !== day) { day = d; html += `<tr class="day"><td colspan="4">${d}</td></tr>`; }
      html += `<tr><td class="col-house">${esc(coopName(s.coop))}</td><td>${s.on ? hm(s.on) : "–"}</td>
        <td>${s.off ? hm(s.off) : `<span class="tag on">ยังเปิดอยู่</span>`}</td>
        <td>${s.on ? dur((s.off ?? now) - s.on) : "–"}</td></tr>`;
    }
    body.innerHTML = html || `<tr><td class="empty" colspan="4">ยังไม่มีการเปิด-ปิดไฟใน 7 วันที่ผ่านมา</td></tr>`;
    more.hidden = list.length <= limit;
  }

  // One tile per coop: on/off now and since when, how many times and how long today.
  function renderSummary() {
    const now = Date.now(), dayStart = new Date().setHours(0, 0, 0, 0);
    summaryEl.innerHTML = farm.coops().map(c => {
      const mine = sessions.filter(s => s.coop === c.id);
      const today = mine.filter(s => (s.off ?? now) >= dayStart);
      const onMs = today.reduce((sum, s) => sum + (s.off ?? now) - Math.max(s.on ?? dayStart, dayStart), 0);
      const isOn = c.ledKnown ? c.led : mine.some(s => s.off == null);
      const since = isOn ? mine.find(s => s.off == null)?.on : mine.find(s => s.off != null)?.off;
      return `<div class="evs ${isOn ? "on" : ""}">${ic("bulb")}<div><b>${esc(c.name)}</b>
        <span>${isOn ? "ไฟเปิดอยู่" : "ไฟปิดอยู่"}${since ? ` · มา ${dur(now - since)}` : ""}</span>
        <small>วันนี้เปิด ${today.length} ครั้ง · รวม ${dur(onMs)}</small></div></div>`;
    }).join("") || `<div class="empty">ยังไม่มีโรงเรือน</div>`;
  }

  if (sel) {
    const fill = () => coopOptions(sel);
    fill(); farm.on("data", () => { fill(); render(); });
    sel.addEventListener("change", () => { filter = +sel.value; limit = EV_PAGE; render(); });
  }
  more.onclick = () => { limit += EV_PAGE; render(); };
  farm.ready(load);
  return { refresh: load };
}
