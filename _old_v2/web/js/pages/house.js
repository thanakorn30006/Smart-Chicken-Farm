// house.html?h=1..3: one house: live card, chart, flock numbers + daily record, readings and light history.
import { $, debounce, n0, esc } from "../core/format.js";
import { initLayout } from "../components/layout.js";
import { cardHTML, updateCards, bindLightSwitches, loadSparks } from "../components/house-card.js";
import { mountChart } from "../components/history-chart.js";
import { mountReadingsTable } from "../components/readings-table.js";
import { mountLightHistory } from "../components/light-history.js";
import { mountFlockPanel } from "../components/flock-panel.js";
import { farm } from "../services/farm.js";

const h = Math.min(3, Math.max(1, parseInt(new URLSearchParams(location.search).get("h"), 10) || 1));
document.title = `โรงเรือนที่ ${h} · Smart Chicken Farm`;
$("hTitle").textContent = `โรงเรือนที่ ${h}`;

const cardBox = $("hCard");
cardBox.innerHTML = cardHTML(h, "big");
bindLightSwitches(cardBox);

const chart = mountChart($("hChart"), { house: h, fixedHouse: true });
mountFlockPanel($("hFlock"), h);
const table = mountReadingsTable($("hTable"), { house: h, fixedHouse: true });
const lights = mountLightHistory($("hEvents"), { house: h, fixedHouse: true });

// New reading on MQTT -> give Node-RED a moment to store it, then reload the history views once.
const reloadReadings = debounce(() => { chart.refresh(); table.refresh(); loadSparks(cardBox, [h]).catch(() => {}); }, 1500);
const reloadLights = debounce(() => lights.refresh(), 1500);

function subtitle() {
  const d = farm.house(h), f = d.cfg.flock;
  $("hSub").innerHTML = f ? `${esc(f.breed)} · อายุ ${f.age_days} วัน · ${n0(f.alive)} ตัว · เป้าหมาย ${d.cfg.target.temp_min}–${d.cfg.target.temp_max} °C`
                          : "ยังไม่มีไก่ในโรงเรือนนี้";
}

farm.on("change", data => updateCards(cardBox, data));
farm.on("config", subtitle);
farm.on("telemetry", house => { if (house === h) reloadReadings(); });
farm.on("light", house => { if (house === h) reloadLights(); });
initLayout(`house${h}`);
subtitle();

loadSparks(cardBox, [h]).catch(() => {});
setInterval(() => lights.refresh(), 60000);   // keeps "open for N min" moving
// from the dashboard's "บันทึกประจำวัน" to-do: jump to the form once it exists
if (location.hash === "#log") {
  const off = farm.on("config", () => { off(); setTimeout(() => { $("log")?.scrollIntoView({ behavior: "smooth" }); $("log")?.querySelector("[name=deaths]")?.focus({ preventScroll: true }); }, 100); });
}
