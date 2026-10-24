// settings.html: per coop, the flock (start / end) and the light schedule. Keepers (their own coop) and admins.
import { $, n0, thaiDate, esc } from "../core/format.js";
import { ic } from "../core/icons.js";
import { initLayout, requirePerm } from "../components/layout.js";
import { flockFormHTML, bindFlockForm } from "../components/flock-form.js";
import { confirmModal } from "../components/modal.js";
import { farm } from "../services/farm.js";
import { api } from "../services/api.js";

const HINT = {
  manual: "กดเปิด-ปิดเองจากหน้าภาพรวม",
  auto: "Node-RED เปิด-ปิดไฟให้ตามเวลา (ข้ามเที่ยงคืนได้ เช่น 18:00–06:00) · ถ้ากดสวิตช์เองจะเปลี่ยนกลับเป็นสั่งเอง",
};

if (initLayout("settings") && requirePerm("flock", "หน้ารุ่นไก่และเวลาไฟ")) {
  const box = $("coopsSettings");
  let shown = "";

  function build(coops) {
    const key = coops.map(c => c.id).join(",");
    if (key === shown) return false;
    shown = key;
    box.innerHTML = coops.length ? coops.map(c => `
      <section class="panel setting" id="coop${c.id}" data-coop="${c.id}">
        <div class="panel-head"><h3>${esc(c.name)}</h3><a class="link" href="coop.html?id=${c.id}">ดูโรงเรือน ${ic("arrow")}</a></div>
        <div class="setting-grid">
          <div>
            <h4>${ic("hen")}รุ่นไก่</h4>
            <div class="flock-now"></div>
            <details class="new-flock"><summary>${ic("plus")}เริ่มรุ่นใหม่</summary>${flockFormHTML(c)}</details>
          </div>
          <div>
            <h4>${ic("bulb")}ไฟส่องสว่าง</h4>
            <form class="form light-form">
              <div class="seg mode" role="radiogroup" aria-label="โหมดไฟ">
                <button type="button" data-mode="manual">สั่งเอง</button><button type="button" data-mode="auto">ตั้งเวลา</button>
              </div>
              <p class="hint mode-hint"></p>
              <div class="fields times">
                <label>เปิดไฟ<input type="time" name="light_on" required></label>
                <label>ปิดไฟ<input type="time" name="light_off" required></label>
              </div>
              <button class="btn primary" type="submit">${ic("check")}บันทึกการตั้งค่าไฟ</button>
            </form>
          </div>
        </div>
      </section>`).join("") : `<div class="panel empty-state"><h3>ยังไม่มีโรงเรือน</h3><p>เพิ่มโรงเรือนได้ที่หน้า จัดการโรงเรือน</p></div>`;
    for (const c of coops) bind($("coop" + c.id), c.id);
    return true;
  }

  function bind(sec, id) {
    const form = sec.querySelector(".light-form");
    bindFlockForm(sec.querySelector(".flock-form"), { onDone: () => { sec.querySelector("details").open = false; } });
    form.querySelector(".mode").addEventListener("click", e => { const b = e.target.closest("button"); if (b) setMode(form, b.dataset.mode, true); });
    form.addEventListener("input", () => form.dataset.dirty = "1");
    form.addEventListener("submit", async e => {
      e.preventDefault();
      const btn = form.querySelector("button[type=submit]");
      btn.disabled = true;
      try {
        await api.saveSettings({ coop_id: id, light_mode: form.dataset.mode, light_on: form.elements.light_on.value, light_off: form.elements.light_off.value });
        farm.notice(`บันทึกการตั้งค่าไฟ${farm.coop(id).name}แล้ว`);
        form.dataset.dirty = "";
        await farm.reload();
      } catch (err) { farm.notice("บันทึกไม่สำเร็จ: " + err.message, true); }
      btn.disabled = false;
    });
  }

  function setMode(form, mode, dirty = false) {
    form.dataset.mode = mode;
    if (dirty) form.dataset.dirty = "1";
    form.querySelectorAll(".mode button").forEach(b => { b.classList.toggle("act", b.dataset.mode === mode); b.setAttribute("aria-checked", b.dataset.mode === mode); });
    form.querySelector(".times").classList.toggle("muted", mode !== "auto");
    form.querySelector(".mode-hint").textContent = HINT[mode];
  }

  function render() {
    const coops = farm.coops();
    build(coops);
    for (const c of coops) {
      const sec = $("coop" + c.id), f = c.flock;
      if (!sec) continue;
      sec.querySelector(".flock-now").innerHTML = f ? `
        <dl class="facts">
          <div><dt>สายพันธุ์</dt><dd>${esc(f.breed)}</dd></div>
          <div><dt>วันลงไก่</dt><dd>${thaiDate(f.started_on)} <small>(อายุ ${f.age_days} วัน)</small></dd></div>
          <div><dt>ลง / คงเหลือ</dt><dd>${n0(f.birds)} / ${n0(f.alive)} ตัว</dd></div>
          <div><dt>เป้าหมายตอนนี้</dt><dd>${c.target.temp_min}–${c.target.temp_max} °C · ${c.target.hum_min}–${c.target.hum_max} %</dd></div>
        </dl>
        <button class="btn ghost end-flock" type="button">จบรุ่น (จับไก่แล้ว)</button>`
        : `<p class="hint">ยังไม่มีไก่ ระบบใช้เกณฑ์มาตรฐาน ${c.target.temp_min}–${c.target.temp_max} °C</p>`;
      if (sec.dataset.hasFlock !== String(!!f)) { sec.querySelector("details").open = !f; sec.dataset.hasFlock = String(!!f); }
      sec.querySelector(".end-flock")?.addEventListener("click", async () => {
        if (!await confirmModal("จบรุ่น", `จบรุ่น ${esc(f.breed)} ใน${esc(c.name)}? (คงเหลือ ${n0(f.alive)} ตัว · ประวัติและบันทึกยังเก็บไว้)`, { submit: "จบรุ่น", danger: true })) return;
        try { await api.endFlock(c.id); farm.notice(`จบรุ่น${c.name}แล้ว`); await farm.reload(); }
        catch (err) { farm.notice("ไม่สำเร็จ: " + err.message, true); }
      });
      const form = sec.querySelector(".light-form");
      if (!form.dataset.dirty) {   // never overwrite what someone is typing
        form.elements.light_on.value = c.light_on;
        form.elements.light_off.value = c.light_off;
        setMode(form, c.light_mode);
        form.dataset.dirty = "";
      }
    }
  }

  farm.on("data", render);
  farm.ready(() => { render(); if (location.hash) setTimeout(() => document.querySelector(location.hash)?.scrollIntoView({ behavior: "smooth" }), 200); });
}
