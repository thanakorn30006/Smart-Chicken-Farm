// users.html: accounts and roles: add, edit, reset password, delete.
//   admin                 every account of every farm
//   keeper (ผู้ดูแลฟาร์ม)    the coop keepers (ผู้ดูแลโรงเรือน) of their own farm: add, edit (which coops), reset password, delete
//                         everyone else of the farm is listed read-only
// admin = every farm · keeper, coop keeper and viewer = exactly ONE farm · a coop keeper looks after 1+ coops of it.
// Node-RED enforces all of this again: every farm keeps at least one active keeper, the system keeps an admin.
import { $, esc, when } from "../core/format.js";
import { ic } from "../core/icons.js";
import { ROLES } from "../config.js";
import { initLayout, requirePerm, toast } from "../components/layout.js";
import { openModal, confirmModal, secretModal } from "../components/modal.js";
import { farm } from "../services/farm.js";
import { session } from "../services/session.js";
import { api } from "../services/api.js";
import { addPerson } from "../components/quick-add.js";

const isAdmin = session.can("users_manage");
if (initLayout("users") && requirePerm(isAdmin ? "users_manage" : "staff_manage", "หน้าผู้ใช้งานและสิทธิ์")) {
  let allFarms = false, farms = [], users = [];

  // the keeper's page is about the coop keepers of the farm
  if (!isAdmin) {
    $("uTitle").textContent = "ผู้ดูแลโรงเรือน";
    $("scope").hidden = true;
    $("uIntro").hidden = false;
  }

  // what each role may do (same table as Node-RED's lib/scf.js PERMS)
  const MATRIX = [
    ["ดูค่าสด กราฟ ประวัติ แจ้งเตือน", 1, 1, "เฉพาะโรงที่ดูแล", 1],
    ["สั่งเปิด-ปิดไฟ · บันทึกประจำวัน · ลงไก่/จบรุ่น · ตั้งเวลาไฟ", 1, 1, "เฉพาะโรงที่ดูแล", 0],
    ["ปิดไฟทั้งฟาร์ม · เพิ่ม/แก้โรงเรือน", 1, 1, 0, 0],
    ["เพิ่ม/แก้/ลบ ผู้ดูแลโรงเรือน และเลือกโรงเรือนให้ดูแล", 1, 1, 0, 0],
    ["ลบโรงเรือน · จัดการผู้ใช้ทุกบทบาท · ดูบันทึกการใช้งาน", 1, 0, 0, 0],
    ["เพิ่มฟาร์ม · gateway", 1, 0, 0, 0],
    ["ขอบเขต", "ทุกฟาร์ม", "1 ฟาร์ม", "โรงเรือนที่ได้รับมอบหมาย", "1 ฟาร์ม"],
  ];
  const cell = x => x === 1 ? `<span class="yes">${ic("check")}</span>` : x === 0 ? `<span class="no">–</span>` : `<span class="hint">${esc(x)}</span>`;
  $("matrix").innerHTML = `<thead><tr><th>สิทธิ์</th>${Object.values(ROLES).map(r => `<th class="c">${r.label}</th>`).join("")}</tr></thead><tbody>` +
    MATRIX.map(([label, ...v]) => `<tr><td>${label}</td>${v.map(x => `<td class="c">${cell(x)}</td>`).join("")}</tr>`).join("") + "</tbody>";

  const farmOf = id => farms.find(f => f.id === id) || null;
  const farmName = id => (farmOf(id) || {}).name || "–";
  const roleChip = u => `<span class="role-chip ${esc(u.role)}">${esc(ROLES[u.role] ? ROLES[u.role].label : u.role)}</span>`;
  const coopsCell = u => u.role !== "coop_keeper" ? `<span class="hint">${u.role === "admin" ? "ทุกฟาร์ม" : "ทั้งฟาร์ม"}</span>`
    : u.coops && u.coops.length ? `<div class="coop-tags">${u.coops.map(n => `<span class="tag">${esc(n)}</span>`).join("")}</div>`
    : `<span class="warn-text">${ic("alert")}ยังไม่มีโรงเรือน</span>`;

  $("scope").addEventListener("click", e => {
    const b = e.target.closest("button"); if (!b) return;
    allFarms = b.dataset.all === "1";
    $("scope").querySelectorAll("button").forEach(x => x.classList.toggle("act", x === b));
    load();
  });

  async function load() {
    try { [farms, users] = await Promise.all([api.farms(), api.users({ allFarms })]); }
    catch (e) { $("uBody").innerHTML = `<tr><td colspan="7" class="empty">${esc(e.message)}</td></tr>`; return; }
    const ck = users.filter(u => u.role === "coop_keeper" && u.active).length;
    $("uCount").textContent = `${users.filter(u => u.active).length} บัญชีที่ใช้งาน · ผู้ดูแลโรงเรือน ${ck} คน · ${allFarms ? "ทุกฟาร์ม" : farm.info ? farm.info.name : ""}`;
    const order = { admin: 0, keeper: 1, coop_keeper: 2, viewer: 3 };
    users.sort((a, b) => (b.active - a.active) || (order[a.role] - order[b.role]) || (a.farm_id || 0) - (b.farm_id || 0) || a.username.localeCompare(b.username));
    $("uBody").innerHTML = users.map(u => `<tr class="${u.active ? "" : "muted-row"}">
      <td><b>${esc(u.display_name)}</b>${u.self ? ` <span class="tag">คุณ</span>` : ""}<div class="hint">@${esc(u.username)}</div></td>
      <td>${roleChip(u)}</td><td>${u.role === "admin" ? `<span class="hint">ทุกฟาร์ม</span>` : `<b>${esc(farmName(u.farm_id))}</b>`}</td>
      <td>${coopsCell(u)}</td>
      <td>${!u.active ? `<span class="tag off">ปิดใช้งาน</span>` : u.locked ? `<span class="tag warn">ล็อกชั่วคราว</span>` : `<span class="tag ok">ใช้งาน</span>`}
        ${u.mfa ? `<span class="tag mfa" title="ยืนยันตัวตน 2 ขั้นเปิดอยู่">${ic("shield")}2 ขั้น</span>` : u.mfa_required ? `<span class="tag warn" title="ต้องตั้งค่าตอนเข้าสู่ระบบครั้งถัดไป">ยังไม่ตั้ง 2 ขั้น</span>` : ""}</td>
      <td class="hint">${u.last_login ? when(u.last_login) : "ยังไม่เคยเข้า"}</td>
      <td class="actions">${u.editable ? `<button class="btn sm" data-edit="${u.id}">แก้ไข</button><button class="btn sm" data-reset="${u.id}">${ic("key")}รีเซ็ตรหัส</button>${u.mfa ? `<button class="btn sm" data-mfa="${u.id}" title="มือถือหาย: ให้ตั้งค่าใหม่ตอนเข้าสู่ระบบครั้งถัดไป">${ic("shield")}รีเซ็ต 2 ขั้น</button>` : ""}<button class="btn sm ghost" data-del="${u.id}" aria-label="ลบ ${esc(u.display_name)}">ลบ</button>` : ""}</td></tr>`).join("")
      || `<tr><td colspan="7" class="empty">ยังไม่มีผู้ใช้</td></tr>`;
    const missing = isAdmin ? farms.filter(f => f.active && !f.keepers.length) : [];
    $("noKeeper").hidden = !missing.length;
    $("noKeeperList").textContent = missing.map(f => f.name).join(", ") + " · ทุกฟาร์มต้องมีผู้ดูแล: เพิ่มบัญชีบทบาท \"ผู้ดูแลฟาร์ม\" แล้วเลือกฟาร์มนั้น";
    // coops that nobody looks after yet (keeper's to-do)
    const f = farmOf(farm.info && farm.info.id);
    const covered = new Set(users.filter(u => u.role === "coop_keeper" && u.active).flatMap(u => u.coop_ids || []));
    const free = f && f.coop_list ? f.coop_list.filter(c => c.active && !covered.has(c.id)) : [];
    $("noCaretaker").hidden = !free.length || allFarms;
    $("noCaretakerList").textContent = free.map(c => c.name).join(", ") + " · กด \"เพิ่มผู้ดูแลโรงเรือน\" หรือแก้ไขผู้ดูแลที่มีอยู่";
  }

  // coops of a farm as checkboxes (the coops this coop keeper looks after)
  const coopBoxes = (farmId, chosen) => {
    const f = farmOf(farmId), list = (f && f.coop_list) || [];
    if (!list.length) return `<p class="hint">ฟาร์มนี้ยังไม่มีโรงเรือน · เพิ่มโรงเรือนที่หน้าจัดการก่อน</p>`;
    return list.filter(c => c.active || chosen.includes(c.id)).map(c => `<label class="coop-opt"><input type="checkbox" name="coop" value="${c.id}" ${chosen.includes(c.id) ? "checked" : ""}>
      <span>${esc(c.name)}${c.active ? "" : " (ปิดใช้งาน)"}</span></label>`).join("");
  };

  function userModal(u) {
    const choices = farms.filter(f => f.active || (u && f.id === u.farm_id));
    const defRole = u ? u.role : isAdmin ? "keeper" : "coop_keeper";
    const startFarm = u ? u.farm_id : (farm.info && farm.info.id);
    const roles = isAdmin ? Object.keys(ROLES) : ["coop_keeper"];
    const m = openModal({
      title: u ? "แก้ไข " + u.display_name : isAdmin ? "เพิ่มผู้ใช้" : "เพิ่มผู้ดูแลโรงเรือน", wide: true,
      body: `${u ? "" : `<label><span>ชื่อผู้ใช้ <em>เว้นว่าง = ระบบตั้งให้ · a-z 0-9 . _ - · เปลี่ยนภายหลังไม่ได้</em></span><input name="username" placeholder="ระบบตั้งให้" pattern="[a-z0-9._\\-]{3,32}" maxlength="32" autocapitalize="none" spellcheck="false"></label>`}
        <label>ชื่อที่แสดง<input name="display_name" required maxlength="60" value="${esc(u ? u.display_name : "")}"></label>
        ${isAdmin ? `<fieldset class="roles"><legend>บทบาท</legend>${roles.map(r => `<label class="role-opt"><input type="radio" name="role" value="${r}" ${defRole === r ? "checked" : ""}>
          <span><b>${ROLES[r].label}</b><em>${ROLES[r].hint}</em></span></label>`).join("")}</fieldset>
        <label class="farm-field"><span>ฟาร์ม <em>เข้าได้ 1 ฟาร์มเท่านั้น</em></span><select name="farm_id">${choices.map(f =>
          `<option value="${f.id}" ${startFarm === f.id ? "selected" : ""}>${esc(f.name)}${f.keepers.length ? "" : " · ยังไม่มีผู้ดูแล"}</option>`).join("")}</select></label>`
        : `<input type="hidden" name="role" value="coop_keeper"><p class="hint">${ic("barn")} บทบาท <b>ผู้ดูแลโรงเรือน</b> · ${esc(ROLES.coop_keeper.hint)}</p>`}
        <fieldset class="coops-field"><legend>โรงเรือนที่ดูแล <em>เลือกได้หลายโรง · อย่างน้อย 1 โรง</em></legend><div class="coop-grid" data-coops></div></fieldset>
        ${u ? `<label class="check"><input type="checkbox" name="active" ${u.active ? "checked" : ""}> ใช้งาน <em>ปิดแล้วออกจากระบบทันทีทุกเครื่อง</em></label>`
            : `<label><span>รหัสผ่านเริ่มต้น <em>เว้นว่าง = ให้ระบบสุ่มให้ · อย่างน้อย 8 ตัว มีตัวอักษรและตัวเลข</em></span><input name="password" type="text" autocomplete="off" minlength="8" maxlength="128"></label>`}`,
      onSubmit: async f => {
        const role = f.role.value;
        const coopIds = [...f.querySelectorAll("[name=coop]:checked")].map(x => +x.value);
        if (role === "coop_keeper" && !coopIds.length) throw new Error("เลือกโรงเรือนที่ดูแลอย่างน้อย 1 โรง");
        const body = { display_name: f.display_name.value, role };
        if (isAdmin) body.farm_id = role !== "admin" ? +f.farm_id.value : null;
        if (role === "coop_keeper") body.coop_ids = coopIds;
        if (u) Object.assign(body, { id: u.id, active: f.active.checked });
        else Object.assign(body, { username: f.username.value.trim().toLowerCase() || undefined, password: f.password.value || undefined });
        const r = await api.saveUser(body);
        await Promise.all([load(), farm.reload()]);
        if (r.temp_password) secretModal("บัญชีใหม่: " + r.username, "ส่งรหัสนี้ให้เจ้าของบัญชี (แสดงครั้งเดียว) แล้วให้เปลี่ยนรหัสเองหลังเข้าสู่ระบบ", [["ชื่อผู้ใช้", r.username], ["รหัสผ่านชั่วคราว", r.temp_password]]);
        else toast(u ? "บันทึกแล้ว" : "เพิ่มผู้ใช้แล้ว");
      },
    });
    // admins do not belong to a farm · only coop keepers pick coops (the list follows the chosen farm)
    const ids = u && u.coop_ids ? u.coop_ids : [];
    let shownFarm = null;
    const sync = () => {
      const role = m.form.role.value, fid = isAdmin ? +m.form.farm_id.value : startFarm;
      if (isAdmin) m.form.querySelector(".farm-field").hidden = role === "admin";
      m.form.querySelector(".coops-field").hidden = role !== "coop_keeper";
      if (fid !== shownFarm) { shownFarm = fid; m.form.querySelector("[data-coops]").innerHTML = coopBoxes(fid, u && u.farm_id === fid ? ids : []); }
    };
    m.form.addEventListener("change", sync); sync();
  }

  async function reset(u) {
    if (!await confirmModal("รีเซ็ตรหัสผ่าน", `ออกรหัสผ่านชั่วคราวให้ <b>${esc(u.display_name)}</b>? รหัสเดิมจะใช้ไม่ได้ และเครื่องที่ใช้อยู่จะถูกออกจากระบบ`, { submit: "รีเซ็ต", danger: true })) return;
    try {
      const r = await api.resetUserPassword(u.id);
      secretModal("รหัสผ่านชั่วคราว", "ส่งให้เจ้าของบัญชี (แสดงครั้งเดียว) แล้วให้เปลี่ยนรหัสเองหลังเข้าสู่ระบบ", [["ชื่อผู้ใช้", r.username], ["รหัสผ่านชั่วคราว", r.temp_password]]);
      load();
    } catch (e) { toast(e.message, true); }
  }

  // lost phone: clear the 2-step setup; next login sets it up again (and every device is logged out)
  async function resetMfa(u) {
    if (!await confirmModal("รีเซ็ตยืนยันตัวตน 2 ขั้น", `ล้างการตั้งค่าแอปยืนยันตัวตนของ <b>${esc(u.display_name)}</b>? เครื่องที่ใช้อยู่จะถูกออกจากระบบ และ${u.mfa_required ? "ต้องสแกน QR ใหม่ตอนเข้าสู่ระบบครั้งถัดไป" : "เข้าสู่ระบบด้วยรหัสผ่านอย่างเดียวจนกว่าจะเปิดใหม่"}`, { submit: "รีเซ็ต", danger: true })) return;
    try { await api.resetUserMfa(u.id); toast("รีเซ็ตยืนยันตัวตน 2 ขั้นของ " + u.display_name + " แล้ว"); load(); } catch (e) { toast(e.message, true); }
  }

  // delete an account for good (to keep the history but stop the login, untick "ใช้งาน" instead)
  async function remove(u) {
    const where = u.role === "admin" ? "" : ` (${esc(farmName(u.farm_id))})`;
    if (!await confirmModal("ลบผู้ใช้", `ลบบัญชี <b>${esc(u.display_name)}</b> @${esc(u.username)}${where} ถาวร?<br>
        <small class="hint">ออกจากระบบทันทีทุกเครื่อง · บันทึกที่เคยทำยังอยู่ · ผู้ดูแลฟาร์มคนสุดท้ายของฟาร์มลบไม่ได้ · ถ้าแค่พักการใช้งาน ให้กด "แก้ไข" แล้วเอา "ใช้งาน" ออกแทน</small>`, { submit: "ลบบัญชี", danger: true })) return;
    try {
      await api.deleteUser(u.id);
      await Promise.all([load(), farm.reload()]);
      toast("ลบบัญชี " + u.display_name + " แล้ว");
    } catch (e) { toast(e.message, true); }
  }

  // short forms for the two everyday cases; the full form ("เพิ่มผู้ใช้อื่น") is for admins and viewers
  $("qKeeper").hidden = $("uAdd").hidden = !isAdmin;
  $("uAdd").addEventListener("click", () => userModal(null));
  $("qKeeper").addEventListener("click", () => addPerson("keeper", { onDone: load }));
  $("qCk").addEventListener("click", () => addPerson("coop_keeper", { onDone: load }));
  $("uBody").addEventListener("click", e => {
    const b = e.target.closest("button"); if (!b) return;
    const u = users.find(x => x.id === +(b.dataset.edit || b.dataset.reset || b.dataset.del || b.dataset.mfa));
    if (b.dataset.edit) userModal(u); else if (b.dataset.reset) reset(u); else if (b.dataset.del) remove(u); else if (b.dataset.mfa) resetMfa(u);
  });
  farm.ready(load);
}
