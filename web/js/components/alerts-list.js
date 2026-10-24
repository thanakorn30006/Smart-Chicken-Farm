// Alerts raised by Node-RED's rules (table alerts). Used on the dashboard (latest few) and the alerts page.
import { ic } from "../core/icons.js";
import { when, hm, esc, dayLabel } from "../core/format.js";
import { LEVEL } from "../core/status.js";
import { coopName } from "./coop-select.js";
const where = a => a.coop_id ? esc(coopName(a.coop_id)) : "อุปกรณ์";

const rel = t => {
  const s = Math.round((Date.now() - Date.parse(t)) / 1000);
  return s < 60 ? "เมื่อสักครู่" : s < 3600 ? `${Math.floor(s / 60)} นาทีที่แล้ว` : s < 86400 ? `${Math.floor(s / 3600)} ชม.ที่แล้ว` : when(t);
};

/** compact list for the dashboard */
export function alertItems(rows) {
  if (!rows.length) return `<div class="empty">${ic("check")} ยังไม่มีการแจ้งเตือน</div>`;
  return `<ul class="alist">${rows.map(a => {
    const [cls, icon, label] = LEVEL[a.level] || ["", "alert", a.level];
    return `<li><span class="badge ${cls}" title="${esc(label)}">${ic(icon)}</span>
      <div><b>${where(a)}</b> · ${esc(a.message)}<small>${rel(a.created_at)}</small></div></li>`;
  }).join("")}</ul>`;
}

/** full table, grouped by day, for the alerts page */
export function alertRows(rows) {
  if (!rows.length) return `<tr><td colspan="4" class="empty">ไม่มีการแจ้งเตือนในช่วงนี้</td></tr>`;
  let day = "", html = "";
  for (const a of rows) {
    const d = dayLabel(a.created_at);
    if (d !== day) { day = d; html += `<tr class="day"><td colspan="4">${d}</td></tr>`; }
    const [cls, icon, label] = LEVEL[a.level] || ["", "alert", a.level];
    html += `<tr class="${cls === "ok" ? "" : "bad"}"><td>${hm(a.created_at)}</td><td>${where(a)}</td>
      <td><span class="sv"><b class="badge sm ${cls}">${ic(icon)}</b>${esc(label)}</span></td><td class="msg">${esc(a.message)}</td></tr>`;
  }
  return html;
}
