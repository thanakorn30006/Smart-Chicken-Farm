// Frame of every page after login: sidebar (short menu by role), top bar (where you are · farm · connection · account), footer, toast.
// Admins switch farms from the box at the top; everyone else always sees their own single farm.
// initLayout("<menu key>") checks the login, draws the frame and starts the live farm connection.
import { ic, hydrateIcons } from "../core/icons.js";
import { $, esc } from "../core/format.js";
import { SVG_DEFS } from "./coop-svg.js";
import { farm } from "../services/farm.js";
import { session } from "../services/session.js";
import { api } from "../services/api.js";
import { openModal } from "./modal.js";
import { setupHTML, backupHTML, bindMfa, codeInput } from "./mfa.js";

const LOGO = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M9 7.5C9 5 10.8 3.5 13 3.5S17 5 17 7.5c0 1-.3 1.8-.8 2.5 2.2.8 3.8 2.9 3.8 5.5a5.5 5.5 0 0 1-5.5 5.5h-3A5.5 5.5 0 0 1 6 15.5c0-2.2 1.2-4 3-5"/>
  <path d="M17 6.5l2.5-.5-2 2M12 21v-2M15 21v-2M13.2 7h.01"/></svg>`;

let active = "";
// page key -> [title, section] for the top bar
const PAGES = {
  home: ["ภาพรวมฟาร์ม", "ติดตาม"], reports: ["รายงาน", "ติดตาม"], settings: ["รุ่นไก่และเวลาไฟ", "การเลี้ยง"],
  manage: ["จัดการฟาร์ม", "การจัดการ"], boards: ["ตั้งค่าบอร์ด", "การจัดการ"], start: ["เริ่มต้นใช้งาน", "การจัดการ"], users: [session.can("users_manage") ? "ผู้ใช้งานและสิทธิ์" : "ผู้ดูแลโรงเรือน", "การจัดการ"], audit: ["บันทึกการใช้งาน", "การจัดการ"],
};

// The menu is short and fixed: coops are reached from the overview cards or the coop switcher (no long list).
function menu() {
  const item = (key, href, icon, label, on = key === active) =>
    `<a href="${href}" class="${on ? "act" : ""}"${on ? ' aria-current="page"' : ""}>${ic(icon)}<span>${esc(label)}</span></a>`;
  const first = farm.coops()[0];
  let h = `<div class="navlabel">ติดตาม</div>` +
    item("home", "index.html", "home", "ภาพรวมฟาร์ม") +
    item("coop", first ? "coop.html?id=" + first.id : "index.html", "barn", "โรงเรือน", active.startsWith("coop")) +
    item("reports", "reports.html", "chart", "รายงาน");
  if (session.can("flock") || session.can("coop_settings")) h += `<div class="navlabel">การเลี้ยง</div>` + item("settings", "settings.html", "hen", "รุ่นไก่และเวลาไฟ");
  const mng = [];
  if (session.can("coop_manage")) mng.push(item("start", "start.html", "list", "เริ่มต้นใช้งาน"));
  if (session.can("coop_manage")) mng.push(item("manage", "manage.html", "gear", session.can("farm_manage") ? "จัดการฟาร์ม" : "จัดการโรงเรือน"));
  if (session.can("coop_manage")) mng.push(item("boards", "boards.html", "chip", "ตั้งค่าบอร์ด"));
  if (session.can("users_manage")) mng.push(item("users", "users.html", "users", "ผู้ใช้งานและสิทธิ์"));
  else if (session.can("staff_manage")) mng.push(item("users", "users.html", "users", "ผู้ดูแลโรงเรือน"));
  if (session.can("audit_view")) mng.push(item("audit", "audit.html", "shield", "บันทึกการใช้งาน"));
  if (mng.length) h += `<div class="navlabel">การจัดการ</div>` + mng.join("");
  $("nav").innerHTML = h;
}

// the farm on screen (top bar): a fixed name for everyone but the admin, who picks it from a dropdown
let farmsCache = null;
async function farmBox() {
  const box = $("farmBox");
  if (!session.isAdmin) { box.innerHTML = `${ic("farm")}<span class="fb-text"><small>ฟาร์ม</small><b>${esc(farm.info ? farm.info.name : "...")}</b></span>`; return; }
  // (re)load the list when missing, or when the farm on screen is not in it yet (a farm just added)
  if (!farmsCache || (farm.info && !farmsCache.some(f => f.id === farm.info.id))) {
    try { farmsCache = (await api.me()).farms; } catch { farmsCache = farmsCache || []; }
  }
  const farms = farmsCache;
  if (!farms.length) { box.innerHTML = `${ic("farm")}<span class="fb-text"><small>ฟาร์ม</small><b>ยังไม่มีฟาร์ม</b></span>`; return; }
  const cur = farm.info ? farm.info.id : session.farmId;
  if ($("farmSel") && +$("farmSel").value === cur && $("farmSel").options.length === farms.length) return;
  box.innerHTML = `${ic("farm")}<label class="fb-text"><small>ฟาร์มที่กำลังดู · ${farms.length} ฟาร์ม</small>
    <select id="farmSel" aria-label="เลือกฟาร์ม">${farms.map(f => `<option value="${f.id}" ${f.id === cur ? "selected" : ""}>${esc(f.name)}${f.active ? "" : " (ปิด)"}</option>`).join("")}</select></label>`;
  $("farmSel").addEventListener("change", e => { session.setFarm(Number(e.target.value)); location.reload(); });
}

// one status pill in the top bar: live data + gateways (details on hover)
function renderConn(c) {
  const el = $("conn"), gws = farm.gateways.filter(g => g.active), on = gws.filter(g => g.online).length;
  let cls = "wait", text = "กำลังเชื่อมต่อ...";
  if (c.api === false) { cls = "err"; text = "โหลดข้อมูลไม่ได้"; }
  else if (c.live === false) { cls = "err"; text = "ข้อมูลสดหลุด"; }
  else if (c.live === true && farm.loaded) {
    cls = !gws.length ? "wait" : on === gws.length ? "ok" : "err";
    text = !gws.length ? "ยังไม่มี gateway" : `ออนไลน์ · Gateway ${on}/${gws.length}`;
  }
  el.className = "conn-pill " + cls;
  el.textContent = text;
  el.title = [c.apiError, gws.map(g => g.name + (g.online ? " ✓" : " ✗")).join(" · ")].filter(Boolean).join("\n");
}

function changePassword() {
  openModal({
    title: "เปลี่ยนรหัสผ่าน",
    body: `<label>รหัสผ่านเดิม<input type="password" name="old" required autocomplete="current-password"></label>
      <label><span>รหัสผ่านใหม่ <em>อย่างน้อย 8 ตัว มีทั้งตัวอักษรและตัวเลข</em></span><input type="password" name="pw" required minlength="8" autocomplete="new-password"></label>
      <label>ยืนยันรหัสผ่านใหม่<input type="password" name="pw2" required minlength="8" autocomplete="new-password"></label>
      <p class="hint">เปลี่ยนแล้ว เครื่องอื่นที่ใช้บัญชีนี้อยู่จะถูกออกจากระบบ</p>`,
    onSubmit: async f => {
      if (f.pw.value !== f.pw2.value) throw new Error("รหัสผ่านใหม่ทั้งสองช่องไม่ตรงกัน");
      const r = await api.changePassword(f.old.value, f.pw.value);
      session.setToken(r.token);
      toast("เปลี่ยนรหัสผ่านแล้ว");
    },
  });
}

// account menu: 2-step login (authenticator app) on / off, new backup codes
function showCodes(codes) {
  const m = openModal({ title: "รหัสสำรองชุดใหม่", submit: "เก็บไว้แล้ว", cancel: null, body: backupHTML(codes) });
  bindMfa(m.el, codes);
}
async function twoStep() {
  const u = session.user;
  if (!u.mfa) {
    let r;
    try { r = await api.mfaSelf({ action: "setup" }); } catch (e) { toast(e.message, true); return; }
    const m = openModal({ title: "ตั้งค่ายืนยันตัวตน 2 ขั้น", submit: "ยืนยันและเปิดใช้",
      body: `<p class="hint">ตอนเข้าสู่ระบบ นอกจากรหัสผ่านต้องกรอกรหัสจากแอปในมือถือด้วย คนที่รู้รหัสผ่านอย่างเดียวจึงเข้าไม่ได้</p>${setupHTML(r.secret, r.otpauth)}`,
      onSubmit: async f => {
        const x = await api.mfaSelf({ action: "enable", code: f.code.value });
        session.updateUser({ mfa: true });
        $("mfaBtn").querySelector(".tag").className = "tag mfa"; $("mfaBtn").querySelector(".tag").textContent = "เปิด";
        toast("เปิดใช้ยืนยันตัวตน 2 ขั้นแล้ว");
        setTimeout(() => showCodes(x.backup_codes), 50);
      } });
    bindMfa(m.el);
    return;
  }
  const m = openModal({ title: "ยืนยันตัวตน 2 ขั้น", submit: null, cancel: "ปิดหน้าต่าง",
    body: `<p><span class="tag mfa">เปิดใช้อยู่</span> ${u.mfa_required ? `<span class="hint">บทบาท${esc(u.role_label)}ต้องใช้เสมอ</span>` : ""}</p>
      <p class="hint">เข้าสู่ระบบทุกครั้งต้องกรอกรหัส 6 หลักจากแอป · มือถือหาย: ใช้รหัสสำรอง หรือให้ผู้ดูแลรีเซ็ตให้</p>
      <fieldset class="fs"><legend>${ic("key")}สร้างรหัสสำรองชุดใหม่</legend>
        <p class="hint">ชุดเดิมจะใช้ไม่ได้ทันที</p><label>รหัส 6 หลักจากแอป${codeInput("bcode")}</label>
        <button type="button" class="btn sm" id="newCodes">สร้างรหัสสำรองใหม่</button></fieldset>
      ${u.mfa_required ? "" : `<fieldset class="fs"><legend>${ic("alert")}ปิดยืนยันตัวตน 2 ขั้น</legend>
        <label>รหัสผ่าน<input type="password" name="pw" autocomplete="current-password"></label>
        <label>รหัส 6 หลักจากแอป${codeInput("dcode")}</label>
        <button type="button" class="btn sm danger" id="offMfa">ปิดการใช้งาน</button></fieldset>`}
      <p class="form-error" id="mfaErr" hidden></p>` });
  m.form.querySelectorAll("input.otp").forEach(i => { i.dataset.auto = "0"; });
  bindMfa(m.el);
  const err = t => { const e = m.el.querySelector("#mfaErr"); e.textContent = t; e.hidden = false; };
  m.el.querySelector("#newCodes").addEventListener("click", async () => {
    try { const x = await api.mfaSelf({ action: "backup", code: m.form.bcode.value }); m.close(); showCodes(x.backup_codes); } catch (e) { err(e.message); }
  });
  m.el.querySelector("#offMfa")?.addEventListener("click", async () => {
    try {
      await api.mfaSelf({ action: "disable", password: m.form.pw.value, code: m.form.dcode.value });
      session.updateUser({ mfa: false }); m.close(); toast("ปิดยืนยันตัวตน 2 ขั้นแล้ว");
      $("mfaBtn").querySelector(".tag").className = "tag off"; $("mfaBtn").querySelector(".tag").textContent = "ปิด";
    } catch (e) { err(e.message); }
  });
}

export function initLayout(key) {
  if (!session.requireLogin()) return false;
  active = key;
  const u = session.user;
  document.body.insertAdjacentHTML("afterbegin", SVG_DEFS);
  const [title, section] = PAGES[key] || (key.startsWith("coop") ? ["โรงเรือน", "ติดตาม"] : ["", ""]);
  $("side").innerHTML = `
    <a class="brand" href="${homeHref()}"><div class="logo">${LOGO}</div>
      <div><h1>Smart Chicken Farm</h1><p>Farm Management</p></div></a>
    <nav id="nav"></nav>
    <div class="side-foot">v3.3 · ESP32 · MQTT · Node-RED</div>`;
  // top bar: where am I (left) -> farm, connection, account (right)
  document.querySelector(".content").insertAdjacentHTML("afterbegin", `
    <header class="topbar">
      <div class="crumb"><span>${esc(section)}</span>${ic("arrow")}<b id="crumbTitle">${esc(title)}</b></div>
      <div class="top-right">
        <div class="farm-box" id="farmBox"></div>
        <span class="conn-pill wait" id="conn">กำลังเชื่อมต่อ...</span>
        <div class="me">
          <button class="me-btn" id="meBtn" aria-haspopup="menu" aria-label="บัญชีของฉัน">
            <span class="avatar" aria-hidden="true">${esc((u.display_name || u.username).slice(0, 1))}</span>
            <span class="who"><b>${esc(u.display_name)}</b><small>${esc(u.role_label)}</small></span>${ic("chevron")}
          </button>
          <div class="menu-pop" id="meMenu" hidden role="menu">
            <span class="menu-user"><b>${esc(u.display_name)}</b>@${esc(u.username)} · <span class="role-chip ${esc(u.role)}">${esc(u.role_label)}</span></span>
            <button role="menuitem" id="pwBtn">${ic("key")}เปลี่ยนรหัสผ่าน</button>
            <button role="menuitem" id="mfaBtn">${ic("shield")}ยืนยันตัวตน 2 ขั้น<span class="tag ${u.mfa ? "mfa" : "off"}">${u.mfa ? "เปิด" : "ปิด"}</span></button>
            <button role="menuitem" id="outBtn" class="danger">${ic("logout")}ออกจากระบบ</button>
          </div>
        </div>
      </div>
    </header>`);
  $("footer").innerHTML = `<span>© 2569 Smart Chicken Farm · ระบบจัดการโรงเรือนไก่เนื้ออัจฉริยะ</span><span>ESP32 + SHT31 · ESP-NOW (HMAC) · MQTT · Node-RED · Supabase</span>`;
  document.body.insertAdjacentHTML("beforeend", `<div class="toast" id="toast" role="status"></div>`);
  hydrateIcons();
  $("meBtn").addEventListener("click", e => { e.stopPropagation(); $("meMenu").hidden = !$("meMenu").hidden; });
  document.addEventListener("click", () => { $("meMenu").hidden = true; });
  $("pwBtn").addEventListener("click", changePassword);
  $("mfaBtn").addEventListener("click", twoStep);
  $("outBtn").addEventListener("click", () => session.logout());

  menu();
  farmBox();
  farm.on("data", () => { menu(); farmBox(); renderConn(farm.conn()); });
  farm.on("conn", renderConn);
  farm.on("notice", toast);
  farm.start();
  return true;
}

// For pages only some roles may open: a clear message instead of an empty page (Node-RED refuses anyway).
export function requirePerm(perm, what) {
  if (session.can(perm)) return true;
  document.querySelector("main").innerHTML = `<div class="panel empty-state"><div class="es-icon">${ic("shield")}</div>
    <h3>ไม่มีสิทธิ์เข้าหน้านี้</h3><p>${esc(what)} ใช้ได้เฉพาะบทบาทที่กำหนด ติดต่อผู้ดูแลระบบ</p>
    <a class="btn primary" href="${homeHref()}">กลับหน้าหลัก</a></div>`;
  return false;
}

export const homeHref = () => "index.html";

let toastTimer;
export function toast(msg, err = false) {
  const t = $("toast");
  if (!t) return;
  t.innerHTML = (err ? ic("alert") : ic("check")) + `<span></span>`;
  t.querySelector("span").textContent = msg;
  t.className = "toast show" + (err ? " err" : "");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 3600);
}
