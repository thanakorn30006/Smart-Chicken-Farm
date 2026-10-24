// Pieces of the 2-step login (TOTP) used by the login page and the account menu:
//   setupHTML(secret, otpauth)  install app -> scan QR (or type the key) -> type the 6-digit code
//   backupHTML(codes)           the 8 one-time backup codes, with copy / save as a file
//   bindMfa(root)               wires the copy / save buttons inside root
import { esc } from "../core/format.js";
import { ic } from "../core/icons.js";
import { qrSvg } from "../core/qr.js";

const group = s => String(s).replace(/(.{4})/g, "$1 ").trim();
const mobile = /iPhone|iPad|Android/i.test(navigator.userAgent);

export const codeInput = (name = "code") => `<input name="${name}" class="otp" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6"
  placeholder="••••••" aria-label="รหัส 6 หลักจากแอป" required>`;

export function setupHTML(secret, otpauth) {
  return `<ol class="mfa-steps">
    <li><b>ติดตั้งแอปยืนยันตัวตนในมือถือ</b><span>Google Authenticator หรือ Microsoft Authenticator (ฟรี ใน App Store / Play Store)</span></li>
    <li><b>เพิ่มบัญชีในแอป</b><span>กด + แล้วเลือก "สแกนคิวอาร์โค้ด" สแกนรูปนี้</span>
      <div class="qr-box">${qrSvg(otpauth, 4)}</div>
      ${mobile ? `<a class="btn sm block" href="${esc(otpauth)}">${ic("key")}เปิดในแอปบนเครื่องนี้</a>` : ""}
      <details class="more"><summary>${ic("key")}สแกนไม่ได้? พิมพ์รหัสเอง</summary>
        <p class="hint">ในแอปเลือก "ป้อนคีย์การตั้งค่า" · ชื่อบัญชี: Smart Chicken Farm · ประเภท: ตามเวลา</p>
        <div class="key-row"><code class="mfa-key">${esc(group(secret))}</code><button type="button" class="btn sm copy" data-v="${esc(secret)}">คัดลอก</button></div>
      </details></li>
    <li><b>กรอกรหัส 6 หลักที่แอปแสดง</b><span>รหัสเปลี่ยนทุก 30 วินาที</span>${codeInput()}</li>
  </ol>`;
}

export function backupHTML(codes) {
  return `<div class="backup">
    <p class="warn-text">${ic("alert")} เก็บรหัสสำรองนี้ไว้ที่ปลอดภัย (จด/พิมพ์/เซฟ) ใช้แทนแอปได้ตอนมือถือหาย <b>รหัสละ 1 ครั้ง</b> และจะไม่แสดงอีก</p>
    <ul class="backup-codes">${codes.map(c => `<li><code>${esc(c)}</code></li>`).join("")}</ul>
    <div class="btn-row left"><button type="button" class="btn sm copy" data-v="${esc(codes.join("\n"))}">${ic("copy")}คัดลอกทั้งหมด</button>
      <button type="button" class="btn sm save-codes">${ic("note")}บันทึกเป็นไฟล์</button></div>
  </div>`;
}

export function bindMfa(root, codes) {
  root.addEventListener("click", e => {
    const c = e.target.closest(".copy[data-v]");
    if (c) navigator.clipboard?.writeText(c.dataset.v).then(() => { c.textContent = "คัดลอกแล้ว ✓"; }).catch(() => {});
    if (e.target.closest(".save-codes") && codes) {
      const text = `Smart Chicken Farm · รหัสสำรองยืนยันตัวตน 2 ขั้น\nสร้างเมื่อ ${new Date().toLocaleString("th-TH")}\nใช้ได้รหัสละ 1 ครั้ง · เก็บเป็นความลับ\n\n${codes.join("\n")}\n`;
      const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
      Object.assign(document.createElement("a"), { href: url, download: "smart-chicken-farm-backup-codes.txt" }).click();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
    }
  });
  // digits only, and submit by itself once 6 digits are in
  root.querySelectorAll("input.otp").forEach(inp => inp.addEventListener("input", () => {
    inp.value = inp.value.replace(/\D/g, "").slice(0, 6);
    if (inp.value.length === 6 && inp.form && inp.dataset.auto !== "0") inp.form.requestSubmit();
  }));
}
