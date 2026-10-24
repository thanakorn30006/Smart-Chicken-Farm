// Short "add" forms used on the manage and users pages: only what is needed, everything else has a sensible default.
//   addFarm()                       admin: farm name + number of coops -> farm, gateway, coops, keeper account
//   addCoop({ preset })             keeper/admin: name (+ board, flock, coop keeper)  -> coop
//   addPerson("keeper" | "coop_keeper", { farmId, coopIds })   -> account; username and password made by the system
// After an account is made, accountReady() shows the login in one message that can be copied and sent (LINE etc.).
import { esc, n0, ymd } from "../core/format.js";
import { ic } from "../core/icons.js";
import { ROLES } from "../config.js";
import { openModal } from "./modal.js";
import { toast } from "./layout.js";
import { farm } from "../services/farm.js";
import { session } from "../services/session.js";
import { api } from "../services/api.js";

// the address to send to people: this server's Wi-Fi IP when the admin is working on the server itself (localhost)
let lanUrl = null;
const loginUrl = () => (/^(localhost|127\.0\.0\.1)$/.test(location.hostname) && lanUrl) || location.origin + "/";
api.me().then(r => { lanUrl = r.lan_url || null; }).catch(() => {});
const copy = (b, text) => navigator.clipboard?.writeText(text).then(() => { b.textContent = "คัดลอกแล้ว ✓"; }).catch(() => {});

// optional: own username / password (most people leave it to the system)
const ownLogin = () => `<details class="more"><summary>${ic("key")}ตั้งชื่อผู้ใช้หรือรหัสผ่านเอง <em>ไม่บังคับ</em></summary>
  <div class="fields">
    <label><span>ชื่อผู้ใช้ <em>a-z 0-9 . _ -</em></span><input name="username" maxlength="32" pattern="[a-z0-9._\\-]{3,32}" autocapitalize="none" spellcheck="false" placeholder="ระบบตั้งให้"></label>
    <label><span>รหัสผ่าน <em>8 ตัวขึ้นไป มีตัวอักษร+ตัวเลข</em></span><input name="password" type="text" autocomplete="off" minlength="8" maxlength="128" placeholder="ระบบสุ่มให้"></label>
  </div></details>`;

// "the account is ready": one card with the login and a copy-all button
export function accountReady({ title, name, role, username, password }) {
  const msg = `เข้าระบบ Smart Chicken Farm\nเว็บ: ${loginUrl()}\nชื่อผู้ใช้: ${username}` + (password ? `\nรหัสผ่าน: ${password}\n(เข้าแล้วเปลี่ยนรหัสที่เมนูบัญชี)` : "");
  const m = openModal({
    title, submit: "เสร็จแล้ว", cancel: null,
    body: `<div class="ready">
        <div class="ready-icon">${ic("check")}</div>
        <div><b>${esc(name)}</b> <span class="role-chip ${esc(role)}">${esc(ROLES[role] ? ROLES[role].label : role)}</span>
          <p class="hint">ส่งข้อมูลเข้าระบบด้านล่างให้เจ้าของบัญชี${password ? " · รหัสผ่านนี้แสดงครั้งเดียว" : ""}</p></div>
      </div>
      <dl class="acct-card"><div><dt>เว็บ</dt><dd>${esc(loginUrl())}</dd></div>
        <div><dt>ชื่อผู้ใช้</dt><dd><code>${esc(username)}</code></dd></div>
        ${password ? `<div><dt>รหัสผ่าน</dt><dd><code>${esc(password)}</code></dd></div>` : ""}</dl>
      <button type="button" class="btn primary block copy-all">${ic("copy")}คัดลอกข้อความไปส่งให้เจ้าของบัญชี</button>`,
  });
  m.el.querySelector(".copy-all").addEventListener("click", e => copy(e.currentTarget, msg));
  return m;
}

// ------------------------------------------------------------------ ฟาร์มใหม่ (admin): ชื่อ + จำนวนโรงเรือน
// The system makes the gateway account, farm key, the coops (board NODE_ID 1..N) and the farm keeper's login.
// Board settings are not shown here: when a board is flashed, "รหัสใหม่" on the manage page gives them.
export function addFarm() {
  const counts = [1, 2, 3, 4, 5, 6, 8, 10];
  const m = openModal({
    title: "เพิ่มฟาร์ม", submit: "เพิ่มฟาร์ม",
    body: `<label>ชื่อฟาร์ม<input name="name" required maxlength="80" placeholder="เช่น ฟาร์มบ้านนา"></label>
      <fieldset class="coops-field"><legend>จำนวนโรงเรือน</legend>
        <div class="count-pick" role="radiogroup">${counts.map(n => `<label><input type="radio" name="n" value="${n}" ${n === 3 ? "checked" : ""}><span>${n}</span></label>`).join("")}
          <label><input type="radio" name="n" value="other"><span>อื่น ๆ</span></label>
          <input type="number" name="n_other" min="0" max="20" step="1" placeholder="0–20" hidden aria-label="จำนวนโรงเรือน"></div>
        <p class="hint" data-names></p></fieldset>
      <details class="more"><summary>${ic("users")}ผู้ดูแลฟาร์ม และตัวเลือกอื่น <em>ไม่บังคับ</em></summary>
        <label><span>ชื่อผู้ดูแลฟาร์ม <em>เว้นว่าง = "ผู้ดูแล + ชื่อฟาร์ม"</em></span><input name="k_display" maxlength="60" placeholder="เช่น สมชาย ใจดี"></label>
        <label><span>ที่ตั้ง</span><input name="location" maxlength="120"></label>
        <div class="fields">
          <label><span>ชื่อผู้ใช้ผู้ดูแล</span><input name="username" maxlength="32" pattern="[a-z0-9._\\-]{3,32}" autocapitalize="none" spellcheck="false" placeholder="ระบบตั้งให้"></label>
          <label><span>รหัสผ่านผู้ดูแล</span><input name="password" type="text" autocomplete="off" minlength="8" maxlength="128" placeholder="ระบบสุ่มให้"></label>
        </div>
      </details>`,
    onSubmit: async x => {
      const n = x.n.value === "other" ? Number(x.n_other.value || 0) : Number(x.n.value);
      if (!Number.isInteger(n) || n < 0 || n > 20) throw new Error("จำนวนโรงเรือนต้องเป็น 0–20 หลัง");
      const r = await api.saveFarm({ name: x.name.value, location: x.location.value, coops: n,
        keeper: { display_name: x.k_display.value, username: x.username.value.trim().toLowerCase() || undefined, password: x.password.value || undefined } });
      session.setFarm(r.id);
      accountReady({ title: `เพิ่มฟาร์ม "${x.name.value}" แล้ว` + (r.coops ? ` · ${r.coops} โรงเรือน` : ""), name: r.keeper_name, role: "keeper",
        username: r.username, password: r.temp_password }).el.addEventListener("close", () => location.reload());
    },
  });
  const f = m.form;
  const sync = () => {
    const other = f.n.value === "other";
    f.n_other.hidden = !other;
    const n = other ? Number(f.n_other.value || 0) : Number(f.n.value);
    f.querySelector("[data-names]").textContent = n > 0 && n <= 20
      ? `จะได้ "โรงเรือน 1"${n > 1 ? ` ถึง "โรงเรือน ${n}"` : ""} พร้อมผูกบอร์ดลูก NODE_ID 1${n > 1 ? "–" + n : ""} · เปลี่ยนชื่อทีหลังได้`
      : n === 0 ? "ยังไม่สร้างโรงเรือน (เพิ่มทีหลังได้)" : "";
  };
  f.addEventListener("change", sync); f.addEventListener("input", sync); sync();
}

// ------------------------------------------------------------------ ผู้ดูแลฟาร์ม / ผู้ดูแลโรงเรือน
// keeper: admin only, pick the farm · coop_keeper: the farm on screen, pick the coops
export async function addPerson(role, { farmId = farm.info && farm.info.id, coopIds = [], onDone } = {}) {
  let farms = [];
  if (role === "keeper") { try { farms = (await api.farms()).filter(f => f.active); } catch (e) { toast(e.message, true); return; } }
  const coops = farm.coops();
  if (role === "coop_keeper" && !coops.length) { toast("ฟาร์มนี้ยังไม่มีโรงเรือน: เพิ่มโรงเรือนก่อน", true); return; }
  const label = ROLES[role].label;
  openModal({
    title: "เพิ่ม" + label, submit: "เพิ่ม" + label,
    body: `<label>ชื่อ${label}<input name="display_name" required maxlength="60" placeholder="เช่น น้องเอ"></label>
      ${role === "keeper" ? `<label>ดูแลฟาร์ม<select name="farm_id">${farms.map(f => `<option value="${f.id}" ${f.id === farmId ? "selected" : ""}>${esc(f.name)}${f.keepers.length ? "" : " · ยังไม่มีผู้ดูแล"}</option>`).join("")}</select></label>`
        : `<fieldset class="coops-field"><legend>ดูแลโรงเรือน <em>เลือกได้หลายโรง</em></legend><div class="coop-grid">${coops.map(c =>
          `<label class="coop-opt"><input type="checkbox" name="coop" value="${c.id}" ${coopIds.includes(c.id) || coops.length === 1 ? "checked" : ""}><span>${esc(c.name)}</span></label>`).join("")}</div></fieldset>`}
      <p class="hint">${ic("check")} ${esc(ROLES[role].hint)}</p>
      ${ownLogin()}`,
    onSubmit: async f => {
      const body = { display_name: f.display_name.value, role, username: f.username.value.trim().toLowerCase() || undefined, password: f.password.value || undefined };
      if (role === "keeper") body.farm_id = +f.farm_id.value;
      else {
        body.coop_ids = [...f.querySelectorAll("[name=coop]:checked")].map(x => +x.value);
        if (!body.coop_ids.length) throw new Error("เลือกโรงเรือนที่ดูแลอย่างน้อย 1 โรง");
        if (session.isAdmin) body.farm_id = farm.info.id;
      }
      const r = await api.saveUser(body);
      await farm.reload();
      onDone && onDone();
      accountReady({ title: "เพิ่ม" + label + "แล้ว", name: body.display_name, role, username: r.username, password: r.temp_password });
    },
  });
}

// ------------------------------------------------------------------ โรงเรือนใหม่
export async function addCoop({ preset = {}, onDone } = {}) {
  const gws = farm.gateways.filter(g => g.active);
  const others = farm.coops({ all: true }).filter(x => x.active && x.gateway_id);
  const usedBy = (gid, n) => others.find(x => x.gateway_id === +gid && x.node_id === n);
  const freeNode = gid => { for (let n = 1; n <= 20; n++) if (!usedBy(gid, n)) return n; return ""; };
  const names = new Set(farm.coops({ all: true }).map(x => x.name));
  let num = 1; while (names.has(`โรงเรือน ${num}`)) num++;
  const gid0 = preset.gateway_id ? +preset.gateway_id : gws[0] ? gws[0].id : "";
  const node0 = preset.node_id || (gid0 ? freeNode(gid0) : "");
  // coop keepers of this farm, to give the new coop to (keepers and admins only)
  let keepers = [];
  if (session.can("staff_manage")) { try { keepers = (await api.users()).filter(u => u.role === "coop_keeper" && u.active && u.farm_id === farm.info.id); } catch { /* optional */ } }
  const nodeOptions = gid => `<option value="">ยังไม่ผูก (ผูกทีหลังได้)</option>` + Array.from({ length: 20 }, (_, i) => i + 1).map(n => {
    const u = gid && usedBy(gid, n);
    return `<option value="${n}" ${n === Number(node0) && +gid === gid0 ? "selected" : ""} ${u ? "disabled" : ""}>บอร์ดลูก NODE_ID ${n}${u ? ` · ${esc(u.name)}` : ""}</option>`;
  }).join("");

  const m = openModal({
    title: "เพิ่มโรงเรือน · " + farm.info.name, submit: "เพิ่มโรงเรือน",
    body: `<label>ชื่อโรงเรือน<input name="name" required maxlength="60" value="${esc(preset.name || `โรงเรือน ${num}`)}"></label>
      <label><span>บอร์ดลูก <em>เลือกเลขที่ว่างให้แล้ว · ต้องตรงกับ NODE_ID ที่แฟลช</em></span>${gws.length
        ? `<select name="node_id">${nodeOptions(gid0)}</select>` : `<input disabled value="ยังไม่มี gateway · ผูกบอร์ดทีหลังได้"><input type="hidden" name="node_id" value="">`}</label>
      <label ${gws.length > 1 ? "" : "hidden"}>Gateway<select name="gateway_id">${gws.map(g => `<option value="${g.id}" ${g.id === gid0 ? "selected" : ""}>${esc(g.name)}</option>`).join("")}</select></label>
      ${keepers.length ? `<fieldset class="coops-field"><legend>ผู้ดูแลโรงเรือน <em>ไม่บังคับ</em></legend><div class="coop-grid">${keepers.map(u =>
        `<label class="coop-opt"><input type="checkbox" name="caretaker" value="${u.id}"><span>${esc(u.display_name)}</span></label>`).join("")}</div></fieldset>` : ""}
      <label class="check"><input type="checkbox" name="has_flock"> ลงไก่แล้ว</label>
      <div class="fields flock-fields" hidden>
        <label>จำนวนไก่ (ตัว)<input type="number" name="birds" min="1" max="1000000" step="1"></label>
        <label>วันลงไก่<input type="date" name="started_on" value="${ymd()}" max="${ymd()}"></label>
      </div>
      <details class="more"><summary>${ic("gear")}ตัวเลือกเพิ่มเติม <em>ความจุ · สายพันธุ์ · ตั้งเวลาไฟ</em></summary>
        <div class="fields">
          <label><span>ความจุ (ตัว)</span><input name="capacity" type="number" min="1" max="1000000" step="1"></label>
          <label><span>สายพันธุ์ไก่</span><input name="breed" maxlength="40" placeholder="เช่น Ross 308"></label>
        </div>
        <label class="check"><input type="checkbox" name="auto"> ตั้งเวลาเปิด-ปิดไฟอัตโนมัติ</label>
        <div class="fields times" hidden><label>เปิดไฟ<input type="time" name="light_on" value="06:00"></label><label>ปิดไฟ<input type="time" name="light_off" value="22:00"></label></div>
      </details>`,
    onSubmit: async f => {
      const node = f.node_id.value ? +f.node_id.value : null;
      const body = { name: f.name.value, capacity: f.capacity.value, node_id: node,
        gateway_id: node ? +(f.gateway_id.value || gid0) : null,
        light_mode: f.auto.checked ? "auto" : "manual", light_on: f.light_on.value, light_off: f.light_off.value,
        caretaker_ids: [...f.querySelectorAll("[name=caretaker]:checked")].map(x => +x.value) };
      if (f.has_flock.checked) body.flock = { started_on: f.started_on.value, birds: +f.birds.value, breed: f.breed.value };
      await api.saveCoop(body);
      await farm.reload();
      onDone && onDone();
      toast(`เพิ่ม${body.name}แล้ว` + (body.flock ? ` · ไก่ ${n0(body.flock.birds)} ตัว` : ""));
    },
  });
  const f = m.form;
  f.gateway_id.addEventListener("change", e => { if (f.node_id.tagName === "SELECT") f.node_id.innerHTML = nodeOptions(e.target.value); });
  const sync = () => {
    f.querySelector(".flock-fields").hidden = !f.has_flock.checked;
    f.birds.required = f.has_flock.checked;
    f.querySelector(".times").hidden = !f.auto.checked;
  };
  f.addEventListener("change", sync); sync();
}
