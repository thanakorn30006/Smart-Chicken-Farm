// reports.html: everything recorded about the farm, in four tabs (one page instead of four):
//   chart (temperature/humidity) · readings table · light on/off history · alerts
// A tab is built the first time it is opened; #chart / #readings / #lights / #alerts opens it directly.
import { $, debounce, esc } from "../core/format.js";
import { initLayout } from "../components/layout.js";
import { mountChart } from "../components/history-chart.js";
import { mountReadingsTable } from "../components/readings-table.js";
import { mountLightHistory } from "../components/light-history.js";
import { alertRows } from "../components/alerts-list.js";
import { coopSelectHTML, coopOptions } from "../components/coop-select.js";
import { farm } from "../services/farm.js";
import { api } from "../services/api.js";

const TABS = ["chart", "readings", "lights", "alerts"];

if (initLayout("reports")) {
  const built = {};
  const build = {
    chart() {
      const chart = mountChart($("chartPanel"));
      const reload = debounce(() => chart.refresh(), 1500);
      farm.on("telemetry", id => { if (id === chart.coopId) reload(); });
    },
    readings() {
      const table = mountReadingsTable($("tblPanel"));
      const reload = debounce(() => table.refresh(), 1500);
      farm.on("telemetry", id => { if (!table.coopId || id === table.coopId) reload(); });
    },
    lights() {
      const lights = mountLightHistory($("evPanel"), { summaryEl: $("evSum") });
      farm.on("light", debounce(() => lights.refresh(), 1500));
      setInterval(() => lights.refresh(), 60000);
    },
    alerts() {
      let coop = 0, days = 7;
      $("aCoop").outerHTML = coopSelectHTML("aCoop");
      const sel = $("aCoop");
      const fill = () => coopOptions(sel);
      fill(); farm.on("data", fill);
      sel.addEventListener("change", () => { coop = +sel.value; load(); });
      $("aDays").innerHTML = [[1, "วันนี้"], [7, "7 วัน"], [30, "30 วัน"]].map(([v, l]) => `<button data-v="${v}" class="${v === days ? "act" : ""}">${l}</button>`).join("");
      $("aDays").addEventListener("click", e => {
        const b = e.target.closest("button"); if (!b) return;
        days = +b.dataset.v;
        $("aDays").querySelectorAll("button").forEach(x => x.classList.toggle("act", x === b));
        load();
      });
      async function load() {
        const since = new Date(); since.setHours(0, 0, 0, 0); since.setDate(since.getDate() - (days - 1));
        try {
          const rows = await api.alerts({ coopId: coop || null, sinceMs: +since, limit: 1000 });
          $("aBody").innerHTML = alertRows(rows);
          const bad = rows.filter(r => r.level !== "ok").length;
          $("aCount").textContent = `ผิดปกติ ${bad} ครั้ง · กลับสู่ปกติ ${rows.length - bad} ครั้ง`;
        } catch (e) { $("aBody").innerHTML = `<tr><td colspan="4" class="empty">โหลดไม่ได้: ${esc(e.message)}</td></tr>`; }
      }
      farm.on("alert", debounce(load, 1500));
      farm.ready(load);
    },
  };

  function open(tab) {
    if (!TABS.includes(tab)) tab = "chart";
    document.querySelectorAll("#tabs button").forEach(b => { const on = b.dataset.tab === tab; b.classList.toggle("act", on); b.setAttribute("aria-selected", on); });
    document.querySelectorAll(".tab-panel").forEach(p => { p.hidden = p.dataset.panel !== tab; });
    if (!built[tab]) { built[tab] = true; build[tab](); }
    if (location.hash !== "#" + tab) history.replaceState(null, "", "#" + tab);
  }
  $("tabs").addEventListener("click", e => { const b = e.target.closest("button"); if (b) open(b.dataset.tab); });
  open(location.hash.slice(1));
}
