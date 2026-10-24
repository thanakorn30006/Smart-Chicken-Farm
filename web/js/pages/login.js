// login.html: step 1 username + password -> step 2 the 6-digit code from the authenticator app (or a backup code)
// -> signed token from Node-RED, then back to the page the user wanted.
// Admins and farm keepers must use step 2: the first time, they set it up here (QR code) and get 8 backup codes.
import { $, esc } from "../core/format.js";
import { ic, hydrateIcons } from "../core/icons.js";
import { api } from "../services/api.js";
import { session } from "../services/session.js";
import { setupHTML, backupHTML, bindMfa, codeInput } from "../components/mfa.js";

const params = new URLSearchParams(location.search);
// only go back to one of our own pages (never an outside URL)
const next = /^[a-z]+\.html(\?[\w=&%.-]*)?$/.test(params.get("next") || "") ? params.get("next") : "index.html";

if (session.loggedIn && !params.get("r")) location.replace(next);
if (params.get("r") === "expired") { $("notice").textContent = "หมดเวลาการใช้งาน หรือบัญชีถูกเปลี่ยนสิทธิ์ กรุณาเข้าสู่ระบบใหม่"; $("notice").hidden = false; }
session.clear();
hydrateIcons();
$("username").focus();

const brand = $("loginForm").querySelector(".login-brand").outerHTML;
let ticket = null, expires = 0, timer = null;

$("loginForm").addEventListener("submit", async e => {
  e.preventDefault();
  const u = $("username").value.trim(), p = $("password").value;
  if (!u || !p) { show("err", "กรุณากรอกชื่อผู้ใช้และรหัสผ่าน"); return; }
  busy($("go"), true, "กำลังตรวจรหัสผ่าน...");
  try {
    const r = await api.login(u, p);
    if (r.mfa) { step2(r); return; }
    finish(r);
  } catch (err) {
    show("err", err.message);
    $("password").value = ""; $("password").focus();
  }
  busy($("go"), false, "เข้าสู่ระบบ");
});

// ---- step 2: code (already set up) or setup (first time)
function step2(r) {
  ticket = r.mfa_token; expires = Date.now() + (r.expires_in || 300) * 1000;
  const f = $("mfaForm"), setup = r.mfa === "setup";
  f.innerHTML = `${brand}
    <div class="login-steps"><span class="done">${ic("check")}รหัสผ่าน</span><span class="cur">2 ยืนยันตัวตน</span></div>
    <h2>${setup ? "ตั้งค่ายืนยันตัวตน 2 ขั้น" : "ยืนยันตัวตนขั้นที่ 2"}</h2>
    ${setup ? `<p class="hint">บัญชี <b>${esc(r.display_name || r.username)}</b> ต้องใช้ยืนยันตัวตน 2 ขั้น (ตั้งครั้งเดียว ใช้เวลา 1 นาที)</p>${setupHTML(r.secret, r.otpauth)}`
      : `<p class="hint">เปิดแอป Authenticator ในมือถือ แล้วกรอกรหัส 6 หลักของ <b>Smart Chicken Farm</b></p>
         <label class="code-field">รหัส 6 หลัก${codeInput()}</label>
         <label class="code-field" hidden>รหัสสำรอง<input name="backup" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="9" placeholder="ABCD-EFGH"></label>
         <button type="button" class="link-btn" id="useBackup">ใช้รหัสสำรองแทน (มือถือหาย)</button>`}
    <p class="form-error" id="err2" role="alert" hidden></p>
    <button class="btn primary block" type="submit" id="go2">${setup ? "ยืนยันและเปิดใช้" : "ยืนยัน"}</button>
    <div class="login-foot"><button type="button" class="link-btn" id="back">${ic("arrow")}กลับ</button><span class="hint" id="left"></span></div>`;
  $("loginForm").hidden = true; f.hidden = false;
  bindMfa(f);
  $("useBackup")?.addEventListener("click", () => {
    const [codeL, backupL] = f.querySelectorAll(".code-field"), toBackup = backupL.hidden;
    codeL.hidden = toBackup; backupL.hidden = !toBackup;
    codeL.querySelector("input").required = !toBackup; backupL.querySelector("input").required = toBackup;
    $("useBackup").textContent = toBackup ? "ใช้รหัส 6 หลักจากแอป" : "ใช้รหัสสำรองแทน (มือถือหาย)";
    (toBackup ? backupL : codeL).querySelector("input").focus();
  });
  $("back").addEventListener("click", () => location.reload());
  clearInterval(timer);
  timer = setInterval(() => {
    const s = Math.max(0, Math.round((expires - Date.now()) / 1000));
    $("left").textContent = s ? `เหลือเวลา ${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}` : "หมดเวลา กด กลับ แล้วเข้าสู่ระบบใหม่";
  }, 1000);
  f.querySelector("input").focus();
}

$("mfaForm").addEventListener("submit", async e => {
  e.preventDefault();
  const f = $("mfaForm"), backup = f.backup && !f.backup.closest("label").hidden;
  const code = backup ? f.backup.value.trim() : f.code.value.trim();
  if (backup ? code.replace(/[^a-z0-9]/gi, "").length !== 8 : !/^\d{6}$/.test(code)) { show("err2", backup ? "รหัสสำรองมี 8 ตัว เช่น ABCD-EFGH" : "กรอกรหัส 6 หลัก"); return; }
  busy($("go2"), true, "กำลังตรวจ...");
  try {
    const r = await api.mfa(ticket, code);
    clearInterval(timer);
    if (r.backup_codes) { showBackup(r); return; }
    if (r.backup_left != null) { showLeft(r); return; }
    finish(r);
  } catch (err) {
    show("err2", err.message);
    if (/หมดเวลา/.test(err.message)) { setTimeout(() => location.reload(), 1800); return; }
    const i = f.querySelector(".code-field:not([hidden]) input, input.otp"); if (i) { i.value = ""; i.focus(); }
    busy($("go2"), false, "ยืนยัน");
  }
});

// first time: show the backup codes once, the user ticks that they kept them
function showBackup(r) {
  const f = $("mfaForm");
  f.innerHTML = `${brand}
    <div class="login-steps"><span class="done">${ic("check")}รหัสผ่าน</span><span class="done">${ic("check")}ยืนยันตัวตน</span></div>
    <h2>เปิดใช้ยืนยันตัวตน 2 ขั้นแล้ว</h2>
    ${backupHTML(r.backup_codes)}
    <label class="check"><input type="checkbox" id="kept"> ฉันเก็บรหัสสำรองไว้แล้ว</label>
    <button class="btn primary block" type="button" id="go3" disabled>เข้าสู่ระบบ</button>`;
  bindMfa(f, r.backup_codes);
  $("kept").addEventListener("change", e => { $("go3").disabled = !e.target.checked; });
  $("go3").addEventListener("click", () => finish(r));
}
// logged in with a backup code: say how many are left
function showLeft(r) {
  const f = $("mfaForm");
  f.innerHTML = `${brand}<h2>เข้าสู่ระบบด้วยรหัสสำรอง</h2>
    <p class="${r.backup_left <= 2 ? "warn-text" : "hint"}">${ic("alert")} เหลือรหัสสำรอง <b>${r.backup_left}</b> ชุด · ถ้ามือถือหาย ให้ผู้ดูแลรีเซ็ตยืนยันตัวตน 2 ขั้นให้ แล้วตั้งค่าใหม่ หรือสร้างรหัสสำรองชุดใหม่ที่เมนูบัญชี</p>
    <button class="btn primary block" type="button" id="go3">เข้าสู่ระบบ</button>`;
  $("go3").addEventListener("click", () => finish(r));
}

function finish(r) { session.save(r.token, r.user); location.replace(next); }
function busy(b, on, text) { b.disabled = on; b.textContent = text; }
function show(id, msg) { $(id).textContent = msg; $(id).hidden = false; }
