// audit.html: who did what and when (logins, light commands, settings, flocks, users, devices, security).
import { $, esc, when, dayLabel, hm } from "../core/format.js";
import { initLayout, requirePerm } from "../components/layout.js";
import { coopName } from "../components/coop-select.js";
import { farm } from "../services/farm.js";
import { ROLES } from "../config.js";
import { api } from "../services/api.js";

const ACTION = {
  login_ok: ["เข้าสู่ระบบ", ""], login_fail: ["เข้าสู่ระบบไม่สำเร็จ", "warn"], login_locked: ["พยายามเข้าบัญชีที่ถูกล็อก", "warn"],
  password_change: ["เปลี่ยนรหัสผ่านตัวเอง", ""], light: ["สั่งไฟ", ""], lights_off_all: ["ปิดไฟทั้งหมด", "warn"], light_schedule: ["ตั้งค่าไฟ", ""],
  flock_start: ["เริ่มรุ่นไก่", ""], flock_end: ["จบรุ่นไก่", ""], daily_log: ["บันทึกประจำวัน", ""],
  farm_create: ["เพิ่มฟาร์ม", ""], farm_update: ["แก้ไขฟาร์ม", ""], farm_delete: ["ลบฟาร์ม", "bad"], coop_create: ["เพิ่มโรงเรือน", ""], coop_update: ["แก้ไขโรงเรือน", ""], coop_delete: ["ลบโรงเรือน", "bad"],
  gateway_create: ["เพิ่ม gateway", ""], gateway_update: ["แก้ไข gateway", ""], gateway_password: ["ออกรหัส gateway ใหม่", "warn"],
  user_create: ["เพิ่มผู้ใช้", ""], user_update: ["แก้ไขผู้ใช้", ""], user_password_reset: ["รีเซ็ตรหัสผ่านผู้ใช้", "warn"], user_delete: ["ลบผู้ใช้", "bad"],
  login_password_ok: ["รหัสผ่านถูก รอยืนยันตัวตน 2 ขั้น", ""], mfa_enable: ["เปิดยืนยันตัวตน 2 ขั้น", ""], mfa_disable: ["ปิดยืนยันตัวตน 2 ขั้น", "warn"],
  mfa_backup_codes: ["สร้างรหัสสำรองใหม่", ""], mfa_reset: ["รีเซ็ตยืนยันตัวตน 2 ขั้น", "warn"], board_kit: ["ดาวน์โหลดไฟล์บอร์ด", ""],
  unknown_device: ["พบอุปกรณ์ไม่ลงทะเบียน", "bad"], sensor_security: ["แพ็กเก็ตปลอม/ส่งซ้ำ", "bad"], bootstrap_admin: ["สร้างผู้ดูแลระบบแรก", ""],
};

function detail(a) {
  const d = a.detail || {};
  switch (a.action) {
    case "light": return `${esc(d.coop || coopName(d.coop_id))} → ${d.on ? "เปิด" : "ปิด"}${d.to_manual ? " (เลิกตั้งเวลา)" : ""}`;
    case "lights_off_all": return `${d.coops} โรงเรือน${d.to_manual ? ` (${d.to_manual} โรงเลิกตั้งเวลา)` : ""}`;
    case "light_schedule": return `${esc(d.coop)} · ${d.mode === "auto" ? `ตั้งเวลา ${esc(d.on)}–${esc(d.off)}` : "สั่งเอง"}`;
    case "flock_start": return `${esc(d.coop)} · ${esc(d.breed || "")} ${Number(d.birds).toLocaleString("th-TH")} ตัว`;
    case "flock_end": return `${esc(d.coop)} · คงเหลือ ${Number(d.alive).toLocaleString("th-TH")} ตัว`;
    case "daily_log": return `${esc(d.coop)} · ${esc(d.log_date)} ตาย ${d.deaths} อาหาร ${d.feed_kg} กก.`;
    case "login_fail": return { password: "รหัสผิด", no_user: "ไม่มีชื่อผู้ใช้นี้", inactive: "บัญชีถูกปิด", locked_now: "ผิดครบ 5 ครั้ง → ล็อก", format: "รูปแบบไม่ถูกต้อง", farm_inactive: "ฟาร์มถูกปิด", coop_inactive: "โรงเรือนที่ดูแลถูกปิด", mfa: "รหัสยืนยัน 2 ขั้นผิด", mfa_locked_now: "รหัส 2 ขั้นผิดครบ 5 ครั้ง → ล็อก" }[d.reason] || esc(d.reason || "");
    case "coop_delete": return esc(d.coop || "");
    case "farm_delete": return esc(`${d.farm} · ${d.coops} โรงเรือน · ${(d.users || []).length} บัญชี`);
    case "user_create": case "user_update": case "user_password_reset": case "user_delete":
      return esc([d.target, ROLES[d.role] ? ROLES[d.role].label : d.role, d.coop_id ? coopName(d.coop_id) : "", d.active === false ? "ปิดใช้งาน" : ""].filter(Boolean).join(" · "));
    case "gateway_create": case "gateway_update": case "gateway_password": return esc(d.gateway || "");
    case "unknown_device": return `${esc(d.mqtt_user)} โหนด ${esc(d.node_id)}`;
    case "sensor_security": return `${esc(d.gateway)} · HMAC ผิด ${d.bad_tag} · ส่งซ้ำ ${d.replay}`;
    case "login_ok": return d.mfa ? (d.mfa === "backup" ? "ยืนยัน 2 ขั้นด้วยรหัสสำรอง" : "ยืนยัน 2 ขั้นแล้ว") + (d.mfa_setup ? " · ตั้งค่าครั้งแรก" : "") : "";
    case "mfa_reset": return esc(d.target || "");
    case "board_kit": return esc(`${d.gateway}${d.new_mqtt_password ? " · ตัวแม่ (รหัส MQTT ใหม่)" : ""}${d.nodes && d.nodes.length ? " · ตัวลูก NODE_ID " + d.nodes.join(", ") : ""}`);
    default: return esc(d.name || d.coop || "");
  }
}

if (initLayout("audit") && requirePerm("audit_view", "หน้าบันทึกการใช้งาน")) {
  let days = 7, filter = "";
  $("aDays").addEventListener("click", e => {
    const b = e.target.closest("button"); if (!b) return;
    days = +b.dataset.v; $("aDays").querySelectorAll("button").forEach(x => x.classList.toggle("act", x === b)); load();
  });
  $("aType").addEventListener("change", e => { filter = e.target.value; load(); });

  async function load() {
    const since = new Date(); since.setHours(0, 0, 0, 0); since.setDate(since.getDate() - (days - 1));
    let rows;
    try { rows = await api.audit({ sinceMs: +since, limit: 1000 }); }
    catch (e) { $("lBody").innerHTML = `<tr><td colspan="4" class="empty">${esc(e.message)}</td></tr>`; return; }
    const groups = { security: ["login_fail", "login_locked", "unknown_device", "sensor_security", "gateway_password", "user_password_reset"],
                     control: ["light", "lights_off_all", "light_schedule"], farm: ["flock_start", "flock_end", "daily_log", "coop_create", "coop_update", "coop_delete", "farm_create", "farm_update", "farm_delete", "gateway_create", "gateway_update"],
                     users: ["user_create", "user_update", "user_delete", "user_password_reset", "password_change", "login_ok"] };
    if (filter) rows = rows.filter(r => groups[filter].includes(r.action));
    $("lCount").textContent = `${rows.length} รายการ${farm.info ? " · " + farm.info.name : ""}`;
    let day = "", html = "";
    for (const a of rows) {
      const d = dayLabel(a.created_at);
      if (d !== day) { day = d; html += `<tr class="day"><td colspan="4">${d}</td></tr>`; }
      const [label, cls] = ACTION[a.action] || [a.action, ""];
      html += `<tr class="${cls === "bad" ? "bad" : ""}"><td title="${esc(when(a.created_at))}">${hm(a.created_at)}</td><td>${esc(a.username || "ระบบ")}</td>
        <td><span class="act-tag ${cls}">${esc(label)}</span></td><td class="msg">${detail(a)}</td></tr>`;
    }
    $("lBody").innerHTML = html || `<tr><td colspan="4" class="empty">ไม่มีรายการในช่วงนี้</td></tr>`;
  }
  farm.ready(load);
}
