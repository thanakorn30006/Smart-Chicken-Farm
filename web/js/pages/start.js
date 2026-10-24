// start.html: getting started, step by step. Every step ticks itself from the live farm data.
//   admin: the whole setup (password, farm, keeper, boards, coop keepers, flock)
//   farm keeper: their farm (coops, boards, coop keepers, flock)
import { $, esc } from "../core/format.js";
import { ic } from "../core/icons.js";
import { initLayout, requirePerm } from "../components/layout.js";
import { farm } from "../services/farm.js";
import { session } from "../services/session.js";
import { api } from "../services/api.js";
import { addFarm, addCoop, addPerson } from "../components/quick-add.js";

if (initLayout("start") && requirePerm("coop_manage", "หน้าเริ่มต้นใช้งาน")) {
  const isAdmin = session.can("farm_manage");
  let lan = "";
  api.me().then(r => { lan = r.lan_url || ""; render(); }).catch(() => {});

  function render() {
    const f = farm.info, coops = farm.coops(), gws = farm.gateways.filter(g => g.active);
    const online = gws.filter(g => g.online), sending = coops.filter(c => c.online);
    const cared = coops.filter(c => c.caretakers && c.caretakers.length), flocks = coops.filter(c => c.flock);
    const btn = (label, attr, primary = true) => `<button class="btn sm ${primary ? "primary" : ""}" ${attr}>${label}</button>`;
    const link = (label, href, primary = true) => `<a class="btn sm ${primary ? "primary" : ""}" href="${href}">${label}</a>`;
    // [done, title, detail, actions, optional]
    const steps = [
      [true, "ติดตั้งโปรแกรมและเปิดระบบ", `Docker Desktop ทำงานอยู่ · ฐานข้อมูล Supabase พร้อม (รัน <code>supabase/setup.sql</code> แล้ว) · ระบบเปิดด้วย <code>start.command</code>
        ${lan ? `<br>มือถือ/เครื่องอื่นในวง Wi-Fi เดียวกันเปิด <b>${esc(lan)}</b>` : ""}`, ""],
      isAdmin && [null, "เปลี่ยนรหัสผ่านผู้ดูแลระบบ", "รหัสแรกมาจากไฟล์ <code>.env</code> ควรเปลี่ยนเป็นรหัสของคุณเอง", btn("เปลี่ยนรหัสผ่าน", 'data-a="pw"', false), true],
      [!!f && coops.length > 0, "ฟาร์มและโรงเรือน", f ? `${esc(f.name)} · ${coops.length} โรงเรือน` : "ยังไม่มีฟาร์ม",
        (isAdmin ? btn(ic("plus") + "เพิ่มฟาร์ม", 'data-a="farm"', !f) : "") + (f ? btn(ic("plus") + "เพิ่มโรงเรือน", 'data-a="coop"', !coops.length) : "")],
      [!!f && farm.keepers.length > 0, "ผู้ดูแลฟาร์ม", farm.keepers.length ? esc(farm.keepers.join(", ")) : "ทุกฟาร์มต้องมีผู้ดูแลอย่างน้อย 1 คน",
        isAdmin && f ? btn(ic("plus") + "เพิ่มผู้ดูแลฟาร์ม", 'data-a="keeper"', !farm.keepers.length) : ""],
      [online.length > 0 && coops.length > 0 && sending.length === coops.length, "ตั้งค่าบอร์ดและแฟลช",
        `ดาวน์โหลดไฟล์ที่ใส่ค่าครบแล้ว กด Upload ใน Arduino IDE · ตัวแม่ออนไลน์ ${online.length}/${gws.length} · โรงเรือนส่งค่า ${sending.length}/${coops.length}`,
        link(ic("chip") + "ไปตั้งค่าบอร์ด", "boards.html", !(online.length && sending.length === coops.length))],
      [coops.length > 0 && cared.length === coops.length, "ผู้ดูแลโรงเรือน", `มีผู้ดูแล ${cared.length}/${coops.length} โรง · ผู้ดูแลโรงเรือนเห็นและสั่งงานได้เฉพาะโรงของตัวเอง`,
        coops.length ? btn(ic("plus") + "เพิ่มผู้ดูแลโรงเรือน", 'data-a="ck"', cared.length < coops.length) : "", true],
      [flocks.length > 0, "ลงไก่และตั้งเวลาไฟ", flocks.length ? `เลี้ยงอยู่ ${flocks.length} โรง` : "บันทึกรุ่นไก่ ระบบจะปรับเป้าหมายอุณหภูมิตามอายุไก่ให้เอง", link("ไปหน้ารุ่นไก่และเวลาไฟ", "settings.html", !flocks.length), true],
      [null, "ใช้งานประจำวัน", "ดูภาพรวมฟาร์ม · สั่งไฟ · บันทึกประจำวัน (ไก่ตาย อาหาร น้ำหนัก) · ดูรายงาน · แจ้งเตือนขึ้นเองเมื่อร้อน/หนาว/ขาดการติดต่อ", link("ไปหน้าภาพรวม", "index.html", false)],
    ].filter(Boolean);
    const must = steps.filter(s => s[0] !== null && !s[4]), done = must.filter(s => s[0]).length;
    $("sProg").innerHTML = `<div class="prog-bar"><span style="width:${Math.round(done / must.length * 100)}%"></span></div>
      <b>${done === must.length ? "พร้อมใช้งานแล้ว" : `เสร็จแล้ว ${done} จาก ${must.length} ขั้นหลัก`}</b>`;
    $("steps").innerHTML = steps.map(([ok, title, detail, actions, optional], i) => `
      <section class="panel step-panel ${ok ? "done" : ""}"><div class="step-no">${ok ? ic("check") : i + 1}</div><div class="step-body">
        <h3>${title}${optional ? ` <span class="hint">ไม่บังคับ</span>` : ""}${ok ? ` <span class="tag ok">เสร็จแล้ว</span>` : ""}</h3>
        <p class="hint">${detail}</p>${actions ? `<div class="btn-row left">${actions}</div>` : ""}</div></section>`).join("");
  }

  $("steps").addEventListener("click", e => {
    const b = e.target.closest("[data-a]"); if (!b) return;
    const a = b.dataset.a;
    if (a === "pw") document.getElementById("pwBtn").click();
    else if (a === "farm") addFarm();
    else if (a === "coop") addCoop();
    else if (a === "keeper") addPerson("keeper");
    else if (a === "ck") addPerson("coop_keeper");
  });
  let t;
  const later = () => { clearTimeout(t); t = setTimeout(render, 300); };
  farm.on("data", render);
  farm.on("conn", later);
  farm.on("telemetry", later);
  farm.ready(render);
}
