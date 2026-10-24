// coop.html?id=N: one coop: live card, chart, flock numbers + daily record, readings and light history.
import { $, debounce, n0, esc } from "../core/format.js";
import { ic } from "../core/icons.js";
import { initLayout, homeHref } from "../components/layout.js";
import { cardHTML, updateCards, bindLightSwitches, loadSparks } from "../components/coop-card.js";
import { mountChart } from "../components/history-chart.js";
import { mountReadingsTable } from "../components/readings-table.js";
import { mountLightHistory } from "../components/light-history.js";
import { mountFlockPanel } from "../components/flock-panel.js";
import { farm } from "../services/farm.js";

const id = parseInt(new URLSearchParams(location.search).get("id"), 10) || 0;
// coop switcher (dropdown) instead of a long list in the menu
function switcher() {
  const sel = $("coopSwitch");
  if (!sel) return;
  sel.innerHTML = farm.coops().map(c => `<option value="${c.id}" ${c.id === id ? "selected" : ""}>${esc(c.name)}${c.online ? "" : " · ขาดการติดต่อ"}</option>`).join("");
  sel.closest(".coop-switch").hidden = farm.coops().length < 2;
}

if (initLayout("coop" + id)) {
  let mounted = false, chart, table, lights;
  const cardBox = $("hCard");
  bindLightSwitches(cardBox);

  // wait for the farm data: the coop must exist AND belong to a farm this user may see
  $("coopSwitch").addEventListener("change", e => { location.href = "coop.html?id=" + e.target.value; });
  farm.on("data", () => {
    // no id (menu "โรงเรือน" before the farm loaded): open the first coop
    if (!id && farm.coops().length) { location.replace("coop.html?id=" + farm.coops()[0].id); return; }
    switcher();
    const c = farm.coop(id);
    if (!c) {
      document.querySelector("main").innerHTML = `<div class="panel empty-state"><div class="es-icon">${ic("barn")}</div>
        <h3>ไม่พบโรงเรือนนี้</h3><p>โรงเรือนอาจถูกปิดใช้งาน หรือไม่ใช่โรงเรือนที่คุณดูแล</p>
        <a class="btn primary" href="${homeHref()}">กลับหน้าหลัก</a></div>`;
      return;
    }
    document.title = `${c.name} · Smart Chicken Farm`;
    $("hTitle").textContent = c.name;
    const f = c.flock;
    $("hSub").innerHTML = (f ? `${esc(f.breed)} · อายุ ${f.age_days} วัน · ${n0(f.alive)} ตัว · เป้าหมาย ${c.target.temp_min}–${c.target.temp_max} °C`
                             : "ยังไม่มีไก่ในโรงเรือนนี้") + (c.capacity ? ` · ความจุ ${n0(c.capacity)} ตัว` : "") +
                   (c.caretakers && c.caretakers.length ? ` · ผู้ดูแลโรงเรือน: ${c.caretakers.map(esc).join(", ")}` : "");
    if (mounted) return;
    mounted = true;
    cardBox.innerHTML = cardHTML(c, "big");
    chart = mountChart($("hChart"), { coopId: id, fixed: true });
    mountFlockPanel($("hFlock"), id);
    table = mountReadingsTable($("hTable"), { coopId: id, fixed: true });
    lights = mountLightHistory($("hEvents"), { coopId: id, fixed: true });
    loadSparks(cardBox, id).catch(() => {});
    if (location.hash === "#log") setTimeout(() => { $("log")?.scrollIntoView({ behavior: "smooth" }); $("log")?.querySelector("[name=deaths]")?.focus({ preventScroll: true }); }, 300);
  });

  const reloadReadings = debounce(() => { chart?.refresh(); table?.refresh(); loadSparks(cardBox, id).catch(() => {}); }, 1500);
  const reloadLights = debounce(() => lights?.refresh(), 1500);
  farm.on("change", coops => updateCards(cardBox, coops));
  farm.on("telemetry", c => { if (c === id) reloadReadings(); });
  farm.on("light", c => { if (c === id) reloadLights(); });
  setInterval(() => lights?.refresh(), 60000);
}
