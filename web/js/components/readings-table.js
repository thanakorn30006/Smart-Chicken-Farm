// Table of past readings, newest first, 50 more rows per "ดูเพิ่ม". Each row is judged against its coop's target.
// mountReadingsTable(el, {coopId, fixed, onCount}) returns {refresh, coopId}.
import { MAX_POINTS } from "../config.js";
import { ic } from "../core/icons.js";
import { fmt, when, esc } from "../core/format.js";
import { status } from "../core/status.js";
import { api } from "../services/api.js";
import { farm } from "../services/farm.js";
import { coopSelectHTML, coopOptions, coopName } from "./coop-select.js";

const PAGE = 50;

export function mountReadingsTable(el, { coopId = 0, fixed = false, onCount } = {}) {
  let filter = coopId, limit = PAGE;   // 0 = every coop of the farm
  el.classList.add("panel");
  el.classList.toggle("fixed-house", fixed);
  el.innerHTML = `
    ${fixed ? "" : `<div class="tools">${coopSelectHTML("tblCoop")}</div>`}
    <div class="scroll"><table>
      <thead><tr><th>วัน-เวลา</th><th class="col-house">โรงเรือน</th><th class="n">อุณหภูมิ</th><th class="n">ความชื้น</th><th>สภาพแวดล้อม</th></tr></thead>
      <tbody><tr><td colspan="5" class="empty">กำลังโหลด...</td></tr></tbody>
    </table></div>
    <button class="more">ดูเพิ่ม ${PAGE} รายการ</button>`;
  const body = el.querySelector("tbody"), more = el.querySelector(".more"), sel = el.querySelector(".coop-select");

  async function load() {
    let rows;
    try { rows = await api.readings({ coopId: filter || null, limit, order: "desc" }); }
    catch (e) { body.innerHTML = `<tr><td colspan="5" class="empty">โหลดข้อมูลไม่ได้: ${esc(e.message)}</td></tr>`; return; }
    body.innerHTML = rows.length ? rows.map(r => {
      const c = farm.coop(r.coop_id);
      const [cls, icon, msg] = status(r, true, c ? c.target : undefined);
      return `<tr class="${cls === "ok" ? "" : "bad"}"><td>${when(r.created_at)}</td><td class="col-house">${esc(coopName(r.coop_id))}</td>
        <td class="n">${fmt(r.temp)} °C</td><td class="n">${fmt(r.humidity)} %</td>
        <td><span class="sv"><b class="badge sm ${cls}" title="${esc(msg)}">${ic(icon)}</b><span class="txt">${esc(msg)}</span></span></td></tr>`;
    }).join("") : `<tr><td colspan="5" class="empty">ยังไม่มีข้อมูล</td></tr>`;
    onCount?.(rows.length);
    more.hidden = rows.length < limit || limit >= MAX_POINTS;
  }

  if (sel) {
    const fill = () => coopOptions(sel);
    fill(); farm.on("data", fill);
    sel.addEventListener("change", () => { filter = +sel.value; limit = PAGE; load(); });
  }
  more.onclick = () => { limit = Math.min(limit + PAGE, MAX_POINTS); load(); };
  farm.ready(load);
  return {
    refresh: () => { if (limit === PAGE) load(); },   // live refresh only on the first page
    get coopId() { return filter; },
  };
}
