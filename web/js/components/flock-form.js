// "Start a new flock" form (settings page and an empty coop page). Managers and admins only.
import { ic } from "../core/icons.js";
import { ymd, n0 } from "../core/format.js";
import { api } from "../services/api.js";
import { farm } from "../services/farm.js";
import { confirmModal } from "./modal.js";

const BREEDS = ["Ross 308", "Cobb 500", "Arbor Acres", "ไก่เนื้ออื่น ๆ"];

export function flockFormHTML(c) {
  return `
    <form class="form flock-form" data-coop="${c.id}">
      <div class="fields">
        <label>วันลงไก่<input type="date" name="started_on" required max="${ymd()}" value="${ymd()}"></label>
        <label>จำนวนที่ลง (ตัว)<input type="number" name="birds" required min="1" max="${c.capacity || 1000000}" step="1" inputmode="numeric" placeholder="${c.capacity ? "ไม่เกิน " + n0(c.capacity) : "เช่น 5000"}"></label>
        <label>สายพันธุ์<select name="breed">${BREEDS.map(b => `<option>${b}</option>`).join("")}</select></label>
      </div>
      <button class="btn primary" type="submit">${ic("plus")}เริ่มรุ่นใหม่</button>
    </form>`;
}

export function bindFlockForm(form, { onDone } = {}) {
  form.addEventListener("submit", async e => {
    e.preventDefault();
    const id = +form.dataset.coop, fd = new FormData(form), c = farm.coop(id);
    if (c && c.flock && !await confirmModal("เริ่มรุ่นใหม่", `${c.name} มีไก่รุ่นปัจจุบันอยู่ (${n0(c.flock.alive)} ตัว) เริ่มรุ่นใหม่จะปิดรุ่นเดิมทันที`, { submit: "เริ่มรุ่นใหม่", danger: true })) return;
    const btn = form.querySelector("button[type=submit]");
    btn.disabled = true;
    try {
      await api.startFlock({ coop_id: id, started_on: fd.get("started_on"), birds: +fd.get("birds"), breed: fd.get("breed") });
      farm.notice(`เริ่มรุ่นใหม่ใน${c ? c.name : "โรงเรือน"}แล้ว`);
      form.reset();
      await farm.reload();
      onDone?.();
    } catch (err) { farm.notice("บันทึกไม่สำเร็จ: " + err.message, true); }
    btn.disabled = false;
  });
}
