// Formatting helpers shared by every page (Thai locale).
export const $ = id => document.getElementById(id);
export const fmt = v => v == null ? "–" : v.toFixed(1);
export const when = t => new Date(t).toLocaleString("th-TH",
  { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", second: "2-digit" });
export const hm = t => new Date(t).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" });

export function ago(ts) {
  if (!ts) return "ยังไม่เคยส่งข้อมูล";
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  return s < 60 ? `อัปเดต ${s} วินาทีที่แล้ว` : s < 3600 ? `อัปเดต ${Math.round(s / 60)} นาทีที่แล้ว`
    : `อัปเดตล่าสุด ${new Date(ts).toLocaleString("th-TH")}`;
}

export function dur(ms) {
  const m = Math.round(ms / 60000), h = Math.floor(m / 60);
  return m < 1 ? "ไม่ถึง 1 นาที" : h ? `${h} ชม. ${m % 60} นาที` : `${m} นาที`;
}

export function dayLabel(t) {
  const d = new Date(t), today = new Date(); today.setHours(0, 0, 0, 0);
  const days = Math.round((today - new Date(d).setHours(0, 0, 0, 0)) / 864e5);
  const date = d.toLocaleDateString("th-TH", { weekday: "long", day: "numeric", month: "long" });
  return days === 0 ? `วันนี้ · ${date}` : days === 1 ? `เมื่อวาน · ${date}` : date;
}

// Run fn once things go quiet for `ms` (e.g. reload a table once after a burst of MQTT messages).
export function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

export const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

// Slide a displayed number to its new value instead of jumping.
export function tween(el, to, unit = "") {
  if (to == null) { el.textContent = "–"; el._v = null; return; }
  const from = el._v ?? to;
  el._v = to;
  if (from === to || reduceMotion) { el.textContent = fmt(to) + unit; return; }
  const start = performance.now();
  const step = now => {
    const p = Math.min(1, (now - start) / 500), e = 1 - (1 - p) ** 3;
    el.textContent = fmt(from + (to - from) * e) + unit;
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

export const n0 = v => v == null ? "–" : Math.round(v).toLocaleString("th-TH");
export const pad = n => String(n).padStart(2, "0");
// YYYY-MM-DD in local time (for <input type="date"> and comparing with flock dates)
export const ymd = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const thaiDate = s => new Date(s + "T00:00:00").toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "2-digit" });
export function greeting() {
  const h = new Date().getHours();
  return h < 11 ? "สวัสดีตอนเช้า" : h < 16 ? "สวัสดีตอนบ่าย" : h < 19 ? "สวัสดีตอนเย็น" : "สวัสดีตอนค่ำ";
}
export const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
