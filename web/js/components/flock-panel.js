// Coop page: the current flock's numbers (age, birds left, survival, feed, weight, FCR),
// the daily record form (keepers and admins) and the list of past records.
// mountFlockPanel(el, coopId) returns {refresh}; it redraws by itself when the farm data changes.
import { ic } from "../core/icons.js";
import { n0, fmt, ymd, thaiDate, esc } from "../core/format.js";
import { api } from "../services/api.js";
import { farm } from "../services/farm.js";
import { flockFormHTML, bindFlockForm } from "./flock-form.js";
import { session } from "../services/session.js";

export function mountFlockPanel(el, id) {
  let flockId = null, logs = [];

  function render() {
    const c = farm.coop(id);
    if (!c) return;
    const f = c.flock;
    if (!f) {
      flockId = null;
      const canStart = session.can("flock");
      el.innerHTML = `<div class="panel empty-state">
        <div class="es-icon">${ic("hen")}</div>
        <h3>โรงเรือนนี้ยังไม่มีไก่</h3>
        <p>${canStart ? "เริ่มรุ่นใหม่เพื่อให้ระบบรู้อายุไก่ ปรับเป้าหมายอุณหภูมิให้อัตโนมัติ และเริ่มบันทึกประจำวัน"
                      : "เมื่อผู้ดูแลฟาร์มเริ่มรุ่นใหม่ จะบันทึกประจำวันได้ที่นี่"}</p>
        ${canStart ? flockFormHTML(c) : ""}</div>`;
      if (canStart) bindFlockForm(el.querySelector("form"));
      return;
    }
    const survival = f.birds ? f.alive / f.birds * 100 : null;
    const fcr = f.avg_weight_g && f.alive ? f.feed_kg / (f.alive * f.avg_weight_g / 1000) : null;
    const kpi = (icon, label, value, sub = "") => `<div class="kpi">${ic(icon)}<span>${label}</span><b>${value}</b><small>${sub}</small></div>`;
    const rebuild = flockId !== f.id || !el.querySelector(".log-form");
    flockId = f.id;
    const kpis = kpi("clock", "อายุไก่", `${f.age_days} วัน`, `ลงไก่ ${thaiDate(f.started_on)}`) +
      kpi("hen", "ไก่คงเหลือ", n0(f.alive), `จากที่ลง ${n0(f.birds)} ตัว`) +
      kpi("check", "อัตรารอด", survival == null ? "–" : fmt(survival) + " %", `ตายสะสม ${n0(f.deaths)} ตัว`) +
      kpi("feed", "อาหารสะสม", `${n0(f.feed_kg)} กก.`, f.alive ? `≈ ${fmt(f.feed_kg * 1000 / f.alive)} ก./ตัว` : "") +
      kpi("scale", "น้ำหนักเฉลี่ย", f.avg_weight_g ? `${n0(f.avg_weight_g)} ก.` : "–", f.avg_weight_g ? "จากการชั่งล่าสุด" : "ยังไม่ได้ชั่ง") +
      kpi("chart", "FCR", fcr ? fcr.toFixed(2) : "–", "อาหาร ÷ น้ำหนักไก่ (ยิ่งต่ำยิ่งดี)");
    if (!rebuild) { el.querySelector(".kpis").innerHTML = kpis; return; }

    el.innerHTML = `
      <div class="panel">
        <div class="panel-head"><h3>${esc(f.breed)} · รุ่นปัจจุบัน</h3>${session.can("flock") ? `<a class="link" href="settings.html#coop${id}">จัดการรุ่น ${ic("arrow")}</a>` : ""}</div>
        <div class="kpis">${kpis}</div>
      </div>
      <div class="panel" id="log">
        <div class="panel-head"><h3>บันทึกประจำวัน</h3><span class="hint">${session.can("daily_log") ? "บันทึกซ้ำวันเดิม = แก้ไข" : "บทบาทของคุณดูได้อย่างเดียว"}</span></div>
        <form class="form log-form" ${session.can("daily_log") ? "" : "hidden"}>
          <div class="fields">
            <label>วันที่<input type="date" name="log_date" required></label>
            <label>ไก่ตาย/คัดทิ้ง (ตัว)<input type="number" name="deaths" min="0" step="1" inputmode="numeric" value="0"></label>
            <label>อาหาร (กก.)<input type="number" name="feed_kg" min="0" step="0.1" inputmode="decimal" placeholder="0"></label>
            <label><span>น้ำหนักเฉลี่ย (ก.) <em>ถ้าชั่ง</em></span><input type="number" name="avg_weight_g" min="1" step="1" inputmode="numeric" placeholder="–"></label>
            <label class="wide">หมายเหตุ<input type="text" name="note" maxlength="200" placeholder="เช่น ให้วัคซีน, เปลี่ยนแกลบ"></label>
          </div>
          <button class="btn primary" type="submit">${ic("check")}บันทึก</button>
        </form>
        <div class="scroll short"><table>
          <thead><tr><th>วันที่</th><th class="n">อายุ</th><th class="n">ตาย</th><th class="n">อาหาร (กก.)</th><th class="n">น้ำหนัก (ก.)</th><th>หมายเหตุ</th></tr></thead>
          <tbody class="logs"><tr><td colspan="6" class="empty">กำลังโหลด...</td></tr></tbody>
        </table></div>
      </div>`;
    const form = el.querySelector(".log-form");
    const dateIn = form.elements.log_date;
    dateIn.min = f.started_on; dateIn.max = ymd(); dateIn.value = ymd();
    dateIn.addEventListener("change", () => fill(dateIn.value));
    form.addEventListener("submit", save);
    el.querySelector(".logs").addEventListener("click", e => {
      const tr = e.target.closest("tr[data-date]");
      if (tr) { dateIn.value = tr.dataset.date; fill(tr.dataset.date); form.elements.deaths.focus(); }
    });
    loadLogs();
  }

  // Picking a date that already has a record loads it into the form for editing.
  function fill(date) {
    const form = el.querySelector(".log-form"), r = logs.find(x => x.log_date === date);
    form.elements.deaths.value = r ? r.deaths : 0;
    form.elements.feed_kg.value = r ? r.feed_kg : "";
    form.elements.avg_weight_g.value = r && r.avg_weight_g ? r.avg_weight_g : "";
    form.elements.note.value = r && r.note ? r.note : "";
    form.querySelector("button").innerHTML = ic("check") + (r ? "บันทึกการแก้ไข" : "บันทึก");
  }

  async function loadLogs() {
    if (!flockId) return;
    const body = el.querySelector(".logs");
    try { logs = await api.dailyLogs(id); }
    catch { body.innerHTML = `<tr><td colspan="6" class="empty">โหลดบันทึกไม่ได้: เช็กว่า Node-RED ทำงานอยู่</td></tr>`; return; }
    const start = Date.parse(farm.coop(id).flock.started_on + "T00:00:00");
    body.innerHTML = logs.length ? logs.map(r => `<tr data-date="${r.log_date}" ${session.can("daily_log") ? 'title="แตะเพื่อแก้ไข"' : ""}>
      <td>${thaiDate(r.log_date)}</td><td class="n">${Math.round((Date.parse(r.log_date + "T00:00:00") - start) / 864e5)}</td>
      <td class="n${r.deaths ? " warn" : ""}">${n0(r.deaths)}</td><td class="n">${fmt(r.feed_kg)}</td>
      <td class="n">${r.avg_weight_g ? n0(r.avg_weight_g) : "–"}</td><td class="note">${esc(r.note || "")}</td></tr>`).join("")
      : `<tr><td colspan="6" class="empty">ยังไม่มีบันทึก เริ่มบันทึกวันนี้ได้เลย</td></tr>`;
    fill(el.querySelector(".log-form").elements.log_date.value);
  }

  async function save(e) {
    e.preventDefault();
    const form = e.target, fd = new FormData(form), btn = form.querySelector("button");
    btn.disabled = true;
    try {
      await api.saveDailyLog({ coop_id: id, flock_id: flockId, log_date: fd.get("log_date"), deaths: +fd.get("deaths") || 0,
        feed_kg: +fd.get("feed_kg") || 0, avg_weight_g: fd.get("avg_weight_g"), note: fd.get("note") });
      farm.notice(`บันทึกประจำวัน ${thaiDate(fd.get("log_date"))} แล้ว`);
      await Promise.all([loadLogs(), farm.reload()]);
    } catch (err) { farm.notice("บันทึกไม่สำเร็จ: " + err.message, true); }
    btn.disabled = false;
  }

  farm.on("data", render);
  render();
  return { refresh: render };
}
