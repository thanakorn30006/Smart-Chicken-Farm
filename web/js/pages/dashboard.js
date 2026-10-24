// index.html: farm totals, every coop of the farm, then what needs attention and the latest alerts.
// Reading order: summary tiles -> coop cards -> to-do / alerts.
import { $, n0, greeting, ymd, debounce, esc } from "../core/format.js";
import { ic } from "../core/icons.js";
import { status } from "../core/status.js";
import { initLayout } from "../components/layout.js";
import { cardHTML, updateCards, bindLightSwitches } from "../components/coop-card.js";
import { alertItems } from "../components/alerts-list.js";
import { confirmModal } from "../components/modal.js";
import { farm } from "../services/farm.js";
import { session } from "../services/session.js";
import { api } from "../services/api.js";

const TODO_SHOWN = 5;

if (initLayout("home")) {
  $("hello").textContent = `${greeting()} คุณ${session.user.display_name}`;
  $("today2").textContent = new Date().toLocaleDateString("th-TH", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const cards = $("cards");
  bindLightSwitches(cards);
  let shown = "", todoOpen = false;

  // one button switches off every light of the farm (keeper of this farm, admin)
  if (session.can("light_all")) {
    $("allOff").hidden = false;
    $("allOff").addEventListener("click", async () => {
      const coops = farm.coops().filter(c => c.hasDevice), lit = coops.filter(c => c.led);
      const auto = coops.filter(c => c.light_mode === "auto").length;
      if (!await confirmModal("ปิดไฟทั้งหมด", `ปิดไฟทุกโรงเรือน (${coops.length} โรงเรือน${lit.length ? ` · เปิดอยู่ ${lit.length}` : ""})?` +
          (auto ? `<br><small class="hint">${auto} โรงเรือนที่ตั้งเวลาไว้จะเปลี่ยนเป็นสั่งเอง เพื่อไม่ให้ไฟเปิดกลับเอง</small>` : ""),
          { submit: "ปิดไฟทั้งหมด", danger: true })) return;
      farm.lightsOff();
    });
  }

  // (re)build the grid only when the list of coops changes, so animations and focus survive updates
  function build(coops) {
    const key = coops.map(c => c.id + ":" + c.name).join("|");
    if (key === shown) return;
    shown = key;
    cards.innerHTML = coops.length ? coops.map(c => cardHTML(c)).join("") : `<div class="panel empty-state wide-empty"><div class="es-icon">${ic("barn")}</div>
      <h3>ฟาร์มนี้ยังไม่มีโรงเรือน</h3><p>${session.can("coop_manage") ? "เพิ่มโรงเรือนและผูกกับอุปกรณ์ได้ที่หน้า จัดการโรงเรือน" : "รอผู้ดูแลฟาร์มเพิ่มโรงเรือน"}</p>
      ${session.can("coop_manage") ? `<a class="btn primary" href="manage.html">${ic("plus")}เพิ่มโรงเรือน</a>` : ""}</div>`;
  }

  function renderStats(coops) {
    const on = coops.filter(c => c.online), flocks = coops.filter(c => c.flock), lit = coops.filter(c => c.led);
    $("sBirds").textContent = flocks.length ? n0(flocks.reduce((s, c) => s + c.flock.alive, 0)) : "–";
    $("sBirdsSub").textContent = flocks.length ? `ใน ${flocks.length} จาก ${coops.length} โรงเรือน` : "ยังไม่ได้ลงไก่";
    $("sOnline").textContent = `${on.length} / ${coops.filter(c => c.hasDevice).length}`;
    $("sLight").textContent = `${lit.length} / ${coops.length}`;
    $("sAuto").textContent = `${coops.filter(c => c.light_mode === "auto").length} โรงเรือนตั้งเวลา`;
    $("coopCount").textContent = coops.length ? `${coops.length} โรงเรือน · ออนไลน์ ${on.length}` : "";
    const btn = $("allOff");
    btn.disabled = !coops.some(c => c.hasDevice) || coops.some(c => c.pending === false);
    $("allOffN").textContent = lit.length ? lit.length : "";
    btn.classList.toggle("has-lit", lit.length > 0);
  }

  // The to-do list: every row is something a person should go and do (only what their role can do).
  // Problems first, then today's work; the rest folds away so the list never pushes the page down.
  function renderTodo(coops) {
    const today = ymd(), items = [];
    if (farm.loaded && farm.info && !farm.keepers.length && session.can("users_manage"))
      items.push(["err", "users", `${farm.info.name} ยังไม่มีผู้ดูแลฟาร์ม`, "ทุกฟาร์มต้องมีผู้ดูแล: เพิ่มบัญชีผู้ดูแลฟาร์ม", "users.html"]);
    // farm set up but no gateway online yet: the board setup page walks through it
    if (farm.loaded && farm.info && session.can("coop_manage") && coops.some(c => c.hasDevice) && !farm.gateways.some(g => g.active && g.online))
      items.push(["err", "chip", "ตัวแม่ (gateway) ยังไม่ออนไลน์", "ตั้งค่าบอร์ด: ดาวน์โหลดไฟล์พร้อมแฟลช แล้วเช็คสถานะทีละขั้น", "boards.html"]);
    if (farm.unknownDevices.length && session.can("coop_manage"))
      items.push(["task", "chip", `พบอุปกรณ์ใหม่ ${farm.unknownDevices.length} ตัวที่ยังไม่ลงทะเบียน`, "ผูกเป็นโรงเรือนเพื่อเริ่มเก็บข้อมูล", "manage.html"]);
    for (const c of coops) {
      if (!c.hasDevice) { if (session.can("coop_manage")) items.push(["task", "chip", `${c.name} ยังไม่ได้ผูกบอร์ด`, "ตั้งค่าบอร์ด: ระบบให้ NODE_ID และไฟล์พร้อมแฟลช", "boards.html"]); continue; }
      const [cls, , msg] = status(c, c.online, c.target);
      if (!c.online) items.push(["err", "wifiOff", `${c.name} ขาดการติดต่อ`, "เช็กไฟเลี้ยงบอร์ดและ gateway", `coop.html?id=${c.id}`]);
      else if (cls !== "ok") items.push(["err", "alert", `${c.name} ${msg}`, `ตอนนี้ ${c.temp.toFixed(1)} °C · ${c.humidity.toFixed(1)} %`, `coop.html?id=${c.id}`]);
      if (c.flock && c.flock.last_log_date !== today && session.can("daily_log"))
        items.push(["task", "note", `บันทึกประจำวัน ${c.name}`, "ไก่ตาย อาหาร น้ำหนัก ของวันนี้", `coop.html?id=${c.id}#log`]);
      if (!c.flock && session.can("flock"))
        items.push(["task", "hen", `${c.name} ยังไม่มีรุ่นไก่`, "ลงไก่แล้ว? บันทึกรุ่นเพื่อให้ระบบปรับเป้าหมายตามอายุ", `settings.html#coop${c.id}`]);
    }
    items.sort((a, b) => (a[0] === "err" ? 0 : 1) - (b[0] === "err" ? 0 : 1));
    const box = $("todo");
    if (!farm.loaded) return;
    const errs = items.filter(i => i[0] === "err").length;
    const list = todoOpen ? items : items.slice(0, TODO_SHOWN);
    const html = items.length
      ? `<div class="todo-head"><b>สิ่งที่ต้องดูตอนนี้</b><span>${errs ? `<em class="warn-text">ผิดปกติ ${errs}</em> · ` : ""}${items.length} รายการ</span></div>` +
        list.map(([cls, icon, title, sub, href]) => `<a class="todo-item ${cls}" href="${href}">${ic(icon)}<div><b>${esc(title)}</b><span>${esc(sub)}</span></div>${ic("arrow")}</a>`).join("") +
        (items.length > TODO_SHOWN ? `<button class="todo-more" type="button">${todoOpen ? "ย่อรายการ" : `แสดงอีก ${items.length - TODO_SHOWN} รายการ`}</button>` : "")
      : `${ic("check")}<div><b>ทุกอย่างเรียบร้อย</b><span>ทุกโรงเรือนอยู่ในเกณฑ์ และงานวันนี้ครบแล้ว</span></div>`;
    box.className = items.length ? "todo" : "todo done";
    if (box._html !== html) { box.innerHTML = html; box._html = html; }
  }
  $("todo").addEventListener("click", e => { if (e.target.closest(".todo-more")) { todoOpen = !todoOpen; renderTodo(last); } });

  async function loadAlerts() {
    try {
      const start = new Date(); start.setHours(0, 0, 0, 0);
      const [latest, today] = await Promise.all([api.alerts({ limit: 6 }), api.alerts({ sinceMs: +start, limit: 1000 })]);
      $("recent").innerHTML = alertItems(latest);
      $("sAlerts").textContent = today.filter(a => a.level !== "ok").length;
    } catch { $("recent").innerHTML = `<div class="empty">โหลดการแจ้งเตือนไม่ได้</div>`; }
  }

  let last = [];
  farm.on("change", coops => { last = coops; build(coops); renderStats(coops); updateCards(cards, coops); renderTodo(coops); });
  farm.on("alert", debounce(loadAlerts, 1500));
  farm.ready(loadAlerts);
  setInterval(() => renderTodo(last), 60000);   // "today's record" is asked again after midnight
}
