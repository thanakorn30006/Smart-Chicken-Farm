// One coop card: flock line, temperature/humidity against the coop's target, condition, light switch.
// Built once per coop and updated in place. big = coop page card (adds the coop picture + trend lines).
import { ic } from "../core/icons.js";
import { ago, tween, reduceMotion, n0, fmt, esc } from "../core/format.js";
import { status } from "../core/status.js";
import { coopSVG } from "./coop-svg.js";
import { farm } from "../services/farm.js";
import { session } from "../services/session.js";
import { api } from "../services/api.js";

const SPARK = `<svg class="spark" viewBox="0 0 100 26" preserveAspectRatio="none" aria-hidden="true"><path class="area"/><path class="line"/></svg>`;
const GAUGE = `<div class="gauge" aria-hidden="true"><span class="zone"></span><span class="mark"></span></div>`;

export function cardHTML(c, extra = "") {
  const big = extra.includes("big");
  return `
    <div class="card ${extra}" data-coop="${c.id}">
      <div class="card-head">
        <div><h3><a href="coop.html?id=${c.id}">${esc(c.name)}</a></h3><div class="flock-line"></div></div>
        <span class="chip">ขาดการติดต่อ</span>
      </div>
      ${big ? `<div class="art">${coopSVG(c.id)}</div>` : ""}
      <div class="meas">
        <div class="mc t"><label>อุณหภูมิ</label><div><b class="vt">–</b><small>°C</small></div>${GAUGE}<small class="tgt"></small>${big ? SPARK : ""}</div>
        <div class="mc h"><label>ความชื้น</label><div><b class="vh">–</b><small>%</small></div>${GAUGE}<small class="tgt"></small>${big ? SPARK : ""}</div>
      </div>
      <span class="pill"></span>
      <div class="light">
        <span class="bulb">${ic("bulb")}</span>
        <span class="lt"><b class="ls">ไฟปิดอยู่</b><small class="lm"></small></span>
        <button class="switch" data-led="${c.id}" data-state="1"></button>
      </div>
    </div>`;
}

function gauge(el, value, min, max, pad, floor = -Infinity, ceil = Infinity) {
  const lo = Math.max(floor, min - pad), hi = Math.min(ceil, max + pad), pc = v => (Math.min(hi, Math.max(lo, v)) - lo) / (hi - lo) * 100;
  const zone = el.querySelector(".zone"), mark = el.querySelector(".mark");
  zone.style.left = pc(min) + "%"; zone.style.width = (pc(max) - pc(min)) + "%";
  mark.hidden = value == null;
  if (value != null) { mark.style.left = pc(value) + "%"; mark.classList.toggle("out", value < min || value > max); }
}

function updateCard(card, c) {
  const t = c.target, f = c.flock;
  const [cls, icon, msg] = c.hasDevice ? status(c, c.online, t) : ["off", "chip", "ยังไม่ได้ผูกอุปกรณ์"];
  card.classList.toggle("online", c.online);
  card.classList.toggle("lit", c.led);
  card.classList.toggle("alarm", c.online && cls !== "ok");
  const art = card.querySelector(".art svg");
  if (art) { if (c.online && !reduceMotion) art.unpauseAnimations(); else art.pauseAnimations(); }
  const chip = card.querySelector(".chip");
  chip.textContent = !c.hasDevice ? "ไม่มีอุปกรณ์" : c.online ? "ออนไลน์" : "ขาดการติดต่อ";
  chip.title = ago(c.ts);

  const fl = card.querySelector(".flock-line");
  const flHTML = f ? `${esc(f.breed)} · อายุ <b>${f.age_days}</b> วัน · ${n0(f.alive)} ตัว`
    : session.can("flock") ? `<a href="settings.html#coop${c.id}">ยังไม่มีไก่ · เริ่มรุ่นใหม่</a>` : "ยังไม่มีไก่";
  if (fl.innerHTML !== flHTML) fl.innerHTML = flHTML;

  tween(card.querySelector(".vt"), c.temp);
  tween(card.querySelector(".vh"), c.humidity);
  const [gt, gh] = card.querySelectorAll(".gauge"), [tt, th] = card.querySelectorAll(".tgt");
  gauge(gt, c.online ? c.temp : null, t.temp_min, t.temp_max, 6);
  gauge(gh, c.online ? c.humidity : null, t.hum_min, t.hum_max, 20, 0, 100);
  tt.textContent = `${t.by_age ? "เป้าหมาย" : "เกณฑ์"} ${fmt(t.temp_min)}–${fmt(t.temp_max)}`;
  th.textContent = `เกณฑ์ ${t.hum_min}–${t.hum_max}`;

  const pill = card.querySelector(".pill");
  if (pill.dataset.key !== cls + msg) { pill.innerHTML = ic(icon) + esc(msg); pill.className = "pill " + cls; pill.dataset.key = cls + msg; }

  const waiting = c.pending != null, auto = c.light_mode === "auto";
  const canLight = session.can("light") && c.hasDevice;
  card.querySelector(".ls").textContent = waiting ? (c.pending ? "กำลังเปิดไฟ..." : "กำลังปิดไฟ...") : c.led ? "ไฟเปิดอยู่" : "ไฟปิดอยู่";
  const lm = card.querySelector(".lm");
  lm.innerHTML = waiting ? "รอบอร์ดยืนยัน" : auto ? `${ic("clock")}ตั้งเวลา ${esc(c.light_on)}–${esc(c.light_off)}` : "สั่งเอง";
  lm.classList.toggle("auto", auto && !waiting);
  const sw = card.querySelector(".switch");
  sw.dataset.state = c.led ? 0 : 1;
  sw.disabled = waiting || !canLight;
  sw.classList.toggle("pending", waiting);
  sw.classList.toggle("want-on", c.pending === true);
  sw.classList.toggle("want-off", c.pending === false);
  sw.classList.toggle("locked", !canLight);
  sw.setAttribute("aria-label", `${c.led ? "ปิด" : "เปิด"}ไฟ${c.name}`);
  sw.title = !session.can("light") ? "บทบาทของคุณดูได้อย่างเดียว" : !c.hasDevice ? "ยังไม่ได้ผูกอุปกรณ์"
    : auto ? "กดแล้วจะเปลี่ยนเป็นสั่งเอง (ปิดการตั้งเวลา)" : "";
}

export function updateCards(root, coops) {
  for (const c of coops) for (const card of root.querySelectorAll(`.card[data-coop="${c.id}"]`)) updateCard(card, c);
}

export function bindLightSwitches(root) {
  root.addEventListener("click", e => {
    const btn = e.target.closest("button[data-led]");
    if (btn && !btn.disabled) farm.setLight(+btn.dataset.led, btn.dataset.state === "1");
  });
}

function sparkline(svg, v) {
  const [area, line] = svg.children;
  if (v.length < 2) { area.setAttribute("d", ""); line.setAttribute("d", ""); return; }
  let lo = Math.min(...v), hi = Math.max(...v);
  if (hi - lo < .5) { lo -= .25; hi += .25; }
  const d = v.map((y, i) => `${i ? "L" : "M"}${(i / (v.length - 1) * 100).toFixed(1)} ${(23 - (y - lo) / (hi - lo) * 21).toFixed(1)}`).join("");
  line.setAttribute("d", d);
  area.setAttribute("d", d + "L100 26L0 26Z");
}

export async function loadSparks(root, coopId) {
  const rows = await api.readings({ coopId, sinceMs: Date.now() - 30 * 60000, order: "asc", limit: 400 });
  for (const card of root.querySelectorAll(`.card[data-coop="${coopId}"]`)) {
    const st = card.querySelector(".mc.t .spark"), sh = card.querySelector(".mc.h .spark");
    if (st) sparkline(st, rows.map(r => r.temp));
    if (sh) sparkline(sh, rows.map(r => r.humidity));
  }
}
