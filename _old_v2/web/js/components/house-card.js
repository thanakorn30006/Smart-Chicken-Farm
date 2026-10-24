// One house card: flock line, temperature/humidity against the house's target, condition, light switch.
// Cards are built once and updated in place (big = house page card, adds the coop picture).
import { HOUSES } from "../config.js";
import { ic } from "../core/icons.js";
import { ago, tween, reduceMotion, n0, fmt, esc } from "../core/format.js";
import { status } from "../core/status.js";
import { coopSVG } from "./coop-svg.js";
import { farm } from "../services/farm.js";
import { api } from "../services/api.js";

const SPARK = `<svg class="spark" viewBox="0 0 100 26" preserveAspectRatio="none" aria-hidden="true"><path class="area"/><path class="line"/></svg>`;
const GAUGE = `<div class="gauge" aria-hidden="true"><span class="zone"></span><span class="mark"></span></div>`;

export function cardHTML(h, extra = "") {
  const big = extra.includes("big");
  return `
    <div class="card ${extra}" data-house="${h}">
      <div class="card-head">
        <div><h3><a href="house.html?h=${h}">โรงเรือนที่ ${h}</a></h3><div class="flock-line"></div></div>
        <span class="chip">ขาดการติดต่อ</span>
      </div>
      ${big ? `<div class="art">${coopSVG(h)}</div>` : ""}
      <div class="meas">
        <div class="mc t"><label>อุณหภูมิ</label><div><b class="vt">–</b><small>°C</small></div>${GAUGE}<small class="tgt"></small>${big ? SPARK : ""}</div>
        <div class="mc h"><label>ความชื้น</label><div><b class="vh">–</b><small>%</small></div>${GAUGE}<small class="tgt"></small>${big ? SPARK : ""}</div>
      </div>
      <span class="pill"></span>
      <div class="light">
        <span class="bulb">${ic("bulb")}</span>
        <span class="lt"><b class="ls">ไฟปิดอยู่</b><small class="lm"></small></span>
        <button class="switch" data-led="${h}" data-state="1"></button>
      </div>
    </div>`;
}

// Place the green "target" zone and the current-value marker on a small bar.
function gauge(el, value, min, max, pad, floor = -Infinity, ceil = Infinity) {
  const lo = Math.max(floor, min - pad), hi = Math.min(ceil, max + pad), pc = v => (Math.min(hi, Math.max(lo, v)) - lo) / (hi - lo) * 100;
  const zone = el.querySelector(".zone"), mark = el.querySelector(".mark");
  zone.style.left = pc(min) + "%"; zone.style.width = (pc(max) - pc(min)) + "%";
  mark.hidden = value == null;
  if (value != null) {
    mark.style.left = pc(value) + "%";
    mark.classList.toggle("out", value < min || value > max);
  }
}

function updateCard(card, d) {
  const t = d.cfg.target, f = d.cfg.flock;
  const [cls, icon, msg] = status(d, d.online, t);
  card.classList.toggle("online", d.online);
  card.classList.toggle("lit", d.led);
  card.classList.toggle("alarm", d.online && cls !== "ok");
  const art = card.querySelector(".art svg");   // chickens stop moving when the house is offline
  if (art) { if (d.online && !reduceMotion) art.unpauseAnimations(); else art.pauseAnimations(); }
  card.querySelector(".chip").textContent = d.online ? "ออนไลน์" : "ขาดการติดต่อ";
  card.querySelector(".chip").title = ago(d.ts);

  const fl = card.querySelector(".flock-line");
  const flHTML = f ? `${esc(f.breed)} · อายุ <b>${f.age_days}</b> วัน · ${n0(f.alive)} ตัว`
                   : `<a href="settings.html#house${d.house}">ยังไม่มีไก่ · เริ่มรุ่นใหม่</a>`;
  if (fl.innerHTML !== flHTML) fl.innerHTML = flHTML;

  tween(card.querySelector(".vt"), d.temp);
  tween(card.querySelector(".vh"), d.humidity);
  const [gt, gh] = card.querySelectorAll(".gauge"), [tt, th] = card.querySelectorAll(".tgt");
  gauge(gt, d.online ? d.temp : null, t.temp_min, t.temp_max, 6);
  gauge(gh, d.online ? d.humidity : null, t.hum_min, t.hum_max, 20, 0, 100);
  tt.textContent = `${t.by_age ? "เป้าหมาย" : "เกณฑ์"} ${fmt(t.temp_min)}–${fmt(t.temp_max)}`;
  th.textContent = `เกณฑ์ ${t.hum_min}–${t.hum_max}`;

  const pill = card.querySelector(".pill");
  if (pill.dataset.key !== cls + msg) {
    pill.innerHTML = ic(icon) + msg;
    pill.className = "pill " + cls;
    pill.dataset.key = cls + msg;
  }

  const waiting = d.pending != null, auto = d.cfg.light_mode === "auto";
  card.querySelector(".ls").textContent = waiting ? (d.pending ? "กำลังเปิดไฟ..." : "กำลังปิดไฟ...") : d.led ? "ไฟเปิดอยู่" : "ไฟปิดอยู่";
  const lm = card.querySelector(".lm");
  lm.innerHTML = waiting ? "รอบอร์ดยืนยัน" : auto ? `${ic("clock")}ตั้งเวลา ${d.cfg.light_on}–${d.cfg.light_off}` : "สั่งเอง";
  lm.classList.toggle("auto", auto && !waiting);
  const sw = card.querySelector(".switch");
  sw.dataset.state = d.led ? 0 : 1;
  sw.disabled = waiting;
  sw.classList.toggle("pending", waiting);
  sw.classList.toggle("want-on", d.pending === true);
  sw.classList.toggle("want-off", d.pending === false);
  sw.setAttribute("aria-label", `${d.led ? "ปิด" : "เปิด"}ไฟโรงเรือนที่ ${d.house}`);
  sw.title = auto ? "กดแล้วจะเปลี่ยนเป็นสั่งเอง (ปิดการตั้งเวลา)" : "";
}

export function updateCards(root, houses) {
  for (const d of houses) for (const card of root.querySelectorAll(`.card[data-house="${d.house}"]`)) updateCard(card, d);
}

// Clicking a switch publishes light/set over MQTT (via farm.setLight).
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

// 30-minute trend lines (house page card), from the history API.
export async function loadSparks(root, houses = HOUSES) {
  const sinceMs = Date.now() - 30 * 60000;
  const all = await Promise.all(houses.map(h => api.readings({ house: h, sinceMs, order: "asc", limit: 400 })));
  all.forEach((rows, i) => {
    for (const card of root.querySelectorAll(`.card[data-house="${houses[i]}"]`)) {
      const st = card.querySelector(".mc.t .spark"), sh = card.querySelector(".mc.h .spark");
      if (st) sparkline(st, rows.map(r => r.temp));
      if (sh) sparkline(sh, rows.map(r => r.humidity));
    }
  });
}
