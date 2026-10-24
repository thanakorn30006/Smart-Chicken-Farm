// Temperature + humidity chart over a time range, with hover tooltip and max/min/avg summary.
// mountChart(el, {coopId, fixed}) draws into el and returns {refresh, coopId}.
import { MAX_POINTS } from "../config.js";
import { fmt, when, hm } from "../core/format.js";
import { api } from "../services/api.js";
import { coopSelectHTML, coopOptions } from "./coop-select.js";
import { farm } from "../services/farm.js";

const RANGES = [[15, "15 นาที"], [60, "1 ชม."], [360, "6 ชม."], [1440, "24 ชม."]];

export function mountChart(el, { coopId = null, fixed = false } = {}) {
  let selected = coopId, minutes = 60, chart = null;
  el.classList.add("panel");
  el.innerHTML = `
    <div class="tools">
      ${fixed ? "" : coopSelectHTML("coopSel", false)}
      <div class="seg" data-role="range">${RANGES.map(([m, label]) =>
        `<button data-m="${m}" class="${m === minutes ? "act" : ""}">${label}</button>`).join("")}</div>
      <div class="keys"><span><i style="background:var(--temp)"></i>อุณหภูมิ (°C)</span><span><i style="background:var(--hum)"></i>ความชื้น (%)</span></div>
    </div>
    <div class="chartbox">
      <canvas></canvas>
      <div class="cursor" hidden></div>
      <div class="dot dot-t" style="background:var(--temp)" hidden></div>
      <div class="dot dot-h" style="background:var(--hum)" hidden></div>
      <div class="tip" hidden></div>
    </div>
    <div class="summary"></div>`;
  const q = s => el.querySelector(s);
  const cv = q("canvas"), box = q(".chartbox"), hover = [q(".cursor"), q(".dot-t"), q(".dot-h"), q(".tip")];

  const pick = (role, attr, set) => q(`[data-role="${role}"]`)?.addEventListener("click", e => {
    const b = e.target.closest("button"); if (!b) return;
    set(+b.dataset[attr]);
    q(`[data-role="${role}"]`).querySelectorAll("button").forEach(x => x.classList.toggle("act", x === b));
    draw();
  });
  pick("range", "m", v => minutes = v);
  const sel = q(".coop-select");
  if (sel) {
    // filled from the farm's coops; keeps the choice when the list reloads
    const fill = () => { coopOptions(sel, false); if (selected) sel.value = String(selected); if (!selected && sel.value) { selected = +sel.value; draw(); } };
    fill();
    farm.on("data", fill);
    sel.addEventListener("change", () => { selected = +sel.value; draw(); });
  }

  async function draw() {
    if (!selected) return paintMessage("ยังไม่มีโรงเรือน");
    let rows;
    try {
      // newest MAX_POINTS rows, then reverse into time order
      rows = (await api.readings({ coopId: selected, sinceMs: Date.now() - minutes * 60000, limit: MAX_POINTS, order: "desc" }))
        .reverse().map(r => ({ ts: Date.parse(r.created_at), temp: r.temp, humidity: r.humidity }));
    } catch {
      chart = null;
      return paintMessage("โหลดข้อมูลไม่ได้: เช็กว่า Node-RED ทำงานอยู่");
    }
    renderSummary(rows);
    paint(rows);
  }

  function setup() {
    const dpr = window.devicePixelRatio || 1, w = cv.clientWidth, h = cv.clientHeight;
    if (!w) return null;   // not on screen
    cv.width = w * dpr; cv.height = h * dpr;
    const g = cv.getContext("2d"); g.scale(dpr, dpr); g.clearRect(0, 0, w, h);
    const css = getComputedStyle(document.documentElement);
    const col = n => css.getPropertyValue(n).trim();
    g.font = "12px \"IBM Plex Sans Thai\", sans-serif"; g.fillStyle = col("--mute");
    return { g, w, h, col };
  }

  function paintMessage(text) {
    const s = setup(); if (!s) return;
    s.g.textAlign = "center"; s.g.fillText(text, s.w / 2, s.h / 2);
  }

  function paint(rows) {
    chart = null;
    const s = setup(); if (!s) return;
    const { g, w, h, col } = s;
    if (!rows.length) { g.textAlign = "center"; g.fillText("ยังไม่มีข้อมูลในช่วงเวลานี้", w / 2, h / 2); return; }

    const L = 44, R = w - 44, T = 12, B = h - 26;
    const t0 = rows[0].ts, t1 = Math.max(rows[rows.length - 1].ts, t0 + 1);
    const x = ts => L + (ts - t0) / (t1 - t0) * (R - L);
    g.strokeStyle = col("--line"); g.lineWidth = 1;
    for (let i = 0; i <= 4; i++) { const y = T + (B - T) * i / 4; g.beginPath(); g.moveTo(L, y); g.lineTo(R, y); g.stroke(); }

    const ys = {};
    for (const [k, c, ax, al, unit] of [["temp", "--temp", L - 8, "right", "°"], ["humidity", "--hum", R + 8, "left", "%"]]) {
      const v = rows.map(r => r[k]);
      let lo = Math.min(...v), hi = Math.max(...v);
      if (hi - lo < 2) { lo -= 1; hi += 1; }
      const y = ys[k] = val => B - (val - lo) / (hi - lo) * (B - T);
      g.textAlign = al; g.fillStyle = col(c);
      for (let i = 0; i <= 4; i++) g.fillText((hi - (hi - lo) * i / 4).toFixed(1) + unit, ax, T + (B - T) * i / 4 + 4);
      g.strokeStyle = col(c); g.lineWidth = 2.2; g.lineJoin = "round"; g.beginPath();
      rows.forEach((r, i) => i ? g.lineTo(x(r.ts), y(r[k])) : g.moveTo(x(r.ts), y(r[k])));
      g.stroke();
      g.lineTo(x(rows[rows.length - 1].ts), B); g.lineTo(x(rows[0].ts), B); g.closePath();
      g.globalAlpha = .08; g.fill(); g.globalAlpha = 1;
    }
    chart = { rows, x, ys, T, B };
    g.fillStyle = col("--mute");
    g.textAlign = "left"; g.fillText(hm(t0), L, h - 6);
    g.textAlign = "center"; g.fillText(hm((t0 + t1) / 2), (L + R) / 2, h - 6);
    g.textAlign = "right"; g.fillText(hm(t1), R, h - 6);
  }

  // Max / min / average of the rows on the chart.
  function renderSummary(rows) {
    const out = q(".summary");
    if (!rows.length) { out.innerHTML = ""; return; }
    const stat = (k, unit, label) => {
      let hi = rows[0], lo = rows[0], sum = 0;
      for (const r of rows) { if (r[k] > hi[k]) hi = r; if (r[k] < lo[k]) lo = r; sum += r[k]; }
      return `<div>${label}สูงสุด<b>${fmt(hi[k])}${unit}</b><small>เวลา ${hm(hi.ts)}</small></div>
        <div>${label}ต่ำสุด<b>${fmt(lo[k])}${unit}</b><small>เวลา ${hm(lo.ts)}</small></div>
        <div>${label}เฉลี่ย<b>${fmt(sum / rows.length)}${unit}</b><small>จาก ${rows.length} ค่า</small></div>`;
    };
    out.innerHTML = stat("temp", " °C", "อุณหภูมิ") + stat("humidity", " %", "ความชื้น");
  }

  // Hover: a cursor line, a dot on each series and a tooltip for the nearest reading.
  box.addEventListener("pointermove", e => {
    if (!chart) return;
    const r = cv.getBoundingClientRect(), mx = e.clientX - r.left;
    const { rows, x, ys, T, B } = chart;
    let best = rows[0];
    for (const row of rows) if (Math.abs(x(row.ts) - mx) < Math.abs(x(best.ts) - mx)) best = row;
    const px = x(best.ts), [cur, dotT, dotH, tip] = hover;
    Object.assign(cur.style, { left: px + "px", height: (B - T) + "px" });
    Object.assign(dotT.style, { left: px + "px", top: ys.temp(best.temp) + "px" });
    Object.assign(dotH.style, { left: px + "px", top: ys.humidity(best.humidity) + "px" });
    tip.innerHTML = `<b>${when(best.ts)}</b><br><i style="background:var(--temp)"></i>อุณหภูมิ ${fmt(best.temp)} °C
      <br><i style="background:var(--hum)"></i>ความชื้น ${fmt(best.humidity)} %`;
    hover.forEach(n => n.hidden = false);
    tip.style.left = (px > r.width / 2 ? px - tip.offsetWidth - 14 : px + 14) + "px";
  });
  box.addEventListener("pointerleave", () => hover.forEach(n => n.hidden = true));
  window.addEventListener("resize", () => chart && paint(chart.rows));

  farm.ready(draw);
  return { refresh: draw, get coopId() { return selected; } };
}
