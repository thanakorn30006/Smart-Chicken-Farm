// boards.html: ready-to-flash board files for one gateway of the farm on screen, in 4 steps.
//   1 choose boards (gateway = admin only, issues a new MQTT password · coops = farm keeper and up)
//   2 Wi-Fi (+ server IP for the gateway): typed here, put into the files in this browser, never sent to the server
//   3 download one zip: gateway/ + node<N>/ sketches with secrets.h filled (FARM_KEY, NODE_ID ...) + how to flash
//   4 live check: gateway online, every coop sending readings, with what to fix when something is missing
import { $, esc, ago } from "../core/format.js";
import { ic } from "../core/icons.js";
import { makeZip } from "../core/zip.js";
import { initLayout, requirePerm, toast } from "../components/layout.js";
import { confirmModal } from "../components/modal.js";
import { farm } from "../services/farm.js";
import { session } from "../services/session.js";
import { api } from "../services/api.js";

const KEY = "scf.boards";
const remember = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } };
const store = v => { try { localStorage.setItem(KEY, JSON.stringify(Object.assign(remember(), v))); } catch { /* private mode */ } };
const cstr = s => String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"');   // inside a C "string"
const ascii = s => /^[\x20-\x7e]*$/.test(s);

if (initLayout("boards") && requirePerm("coop_manage", "หน้าตั้งค่าบอร์ด")) {
  const canGw = session.can("gateway_manage");
  let lanHost = "", gwId = +new URLSearchParams(location.search).get("gw") || null, checking = [], lastKit = "";
  api.me().then(r => { if (r.lan_url) lanHost = new URL(r.lan_url).hostname; if ($("host") && !$("host").value) $("host").value = lanHost; }).catch(() => {});

  function render() {
    const gws = farm.gateways.filter(g => g.active);
    if (!farm.info) { $("kit").innerHTML = `<div class="panel empty">ยังไม่มีฟาร์ม</div>`; return; }
    if (!gws.length) {
      $("kit").innerHTML = `<div class="panel empty-state"><div class="es-icon">${ic("chip")}</div><h3>ฟาร์มนี้ยังไม่มี gateway ที่ใช้งานได้</h3>
        <p>${canGw ? `เพิ่ม gateway ที่หน้าจัดการฟาร์มก่อน` : "ติดต่อผู้ดูแลระบบให้เพิ่ม gateway"}</p><a class="btn primary" href="manage.html#gateways">ไปหน้าจัดการฟาร์ม</a></div>`;
      return;
    }
    if (!gws.some(g => g.id === gwId)) gwId = gws[0].id;
    const g = gws.find(g => g.id === gwId);
    const coops = farm.coops();
    // a reload of the farm data re-draws the page: keep what was typed and ticked
    const prev = $("ssid") ? { ssid: $("ssid").value, wpass: $("wpass").value, host: $("host").value, withGw: $("withGw").checked,
      coops: [...document.querySelectorAll("[name=coop]")].map(x => [+x.value, x.checked]) } : null;
    const saved = remember();
    $("kit").innerHTML = `
      <section class="panel step-panel"><div class="step-no">1</div><div class="step-body">
        <h3>เลือกบอร์ดที่จะแฟลช</h3>
        ${gws.length > 1 ? `<label class="inline">Gateway<select id="gwSel">${gws.map(x => `<option value="${x.id}" ${x.id === gwId ? "selected" : ""}>${esc(x.name)}</option>`).join("")}</select></label>` : ""}
        <div class="board-list">
          <label class="board-opt ${canGw ? "" : "disabled"}"><input type="checkbox" id="withGw" ${canGw && (saved.withGw ?? !g.online) ? "checked" : ""} ${canGw ? "" : "disabled"}>
            <span class="b-ic">${ic("wifi")}</span><span><b>ตัวแม่ · ${esc(g.name)}</b>
            <em>${canGw ? `${g.online ? "ออนไลน์อยู่ · " : ""}ระบบออกรหัส MQTT ใหม่ ตัวแม่ที่แฟลชไว้ก่อนต้องแฟลชใหม่` : "เฉพาะผู้ดูแลระบบ"}</em></span></label>
          ${coops.map(c => {
            const other = c.gateway_id && c.gateway_id !== g.id;
            return `<label class="board-opt ${other ? "disabled" : ""}"><input type="checkbox" name="coop" value="${c.id}" ${other ? "disabled" : c.online ? "" : "checked"}>
              <span class="b-ic">${ic("barn")}</span><span><b>ตัวลูก · ${esc(c.name)}</b>
              <em>${other ? "ผูกกับ gateway อื่น" : c.hasDevice ? `NODE_ID ${c.node_id}${c.online ? " · ส่งค่าอยู่" : ""}` : "ยังไม่ผูกบอร์ด · ระบบให้เลขที่ว่าง"}</em></span></label>`;
          }).join("")}
        </div>
        ${coops.length ? "" : `<p class="hint">ยังไม่มีโรงเรือน · <a class="link" href="manage.html">เพิ่มโรงเรือน</a></p>`}
      </div></section>

      <section class="panel step-panel"><div class="step-no">2</div><div class="step-body">
        <h3>Wi-Fi ที่บอร์ดจะใช้</h3>
        <p class="hint">ต้องเป็น <b>2.4 GHz</b> และเป็นเครือข่ายเดียวกับเครื่องที่เปิดระบบ (iPhone: Personal Hotspot → เปิด "Maximize Compatibility") · รหัส Wi-Fi ใส่ลงไฟล์ในเครื่องนี้เท่านั้น ไม่ส่งไปที่ server</p>
        <div class="form"><div class="fields">
          <label>ชื่อ Wi-Fi (SSID)<input id="ssid" maxlength="32" value="${esc(saved.ssid || "")}" placeholder="เช่น igus" autocapitalize="none" spellcheck="false"></label>
          <label class="gw-only">รหัส Wi-Fi<input id="wpass" type="text" maxlength="63" autocomplete="off" placeholder="รหัสผ่าน Wi-Fi"></label>
          <label class="gw-only"><span>IP เครื่องที่เปิดระบบ <em>ดูได้จาก start.sh ข้อ 3/7</em></span><input id="host" maxlength="64" value="${esc(saved.host || lanHost)}" placeholder="เช่น 172.20.10.9"></label>
        </div></div>
      </div></section>

      <section class="panel step-panel"><div class="step-no">3</div><div class="step-body">
        <h3>ดาวน์โหลดไฟล์แล้วแฟลช</h3>
        <button class="btn primary" id="getKit">${ic("chip")}ดาวน์โหลดไฟล์บอร์ด (.zip)</button>
        <div id="kitResult">${lastKit}</div>
        <details class="more"><summary>${ic("gear")}ติดตั้ง Arduino IDE ครั้งแรก</summary>
          <ol class="howto">
            <li>ติดตั้ง <b>Arduino IDE 2</b> (arduino.cc/en/software)</li>
            <li>Boards Manager → ค้นหา <b>esp32</b> → ติดตั้ง "esp32 by Espressif Systems"</li>
            <li>Library Manager → ติดตั้ง <b>PubSubClient</b> (Nick O'Leary) และ <b>Adafruit SHT31 Library</b> (กด Install All)</li>
            <li>Mac ที่ไม่เห็น Port: ติดตั้งไดรเวอร์ USB ของบอร์ด (CP210x หรือ CH340) แล้วเสียบสาย USB ที่ส่งข้อมูลได้</li>
          </ol></details>
        <details class="more"><summary>${ic("thermo")}ต่อสายเซนเซอร์ SHT31 กับตัวลูก</summary>
          <ul class="howto"><li>VIN → 3V3 · GND → GND · SDA → GPIO 21 · SCL → GPIO 22</li><li>ไฟส่องสว่าง (ทดสอบ) = LED บนบอร์ด GPIO 2 · ต่อรีเลย์ที่ GPIO 2 ได้</li></ul></details>
      </div></section>

      <section class="panel step-panel"><div class="step-no">4</div><div class="step-body">
        <h3>ตรวจว่าใช้ได้ <span class="hint">อัปเดตเองทันทีเมื่อบอร์ดส่งข้อมูลเข้ามา</span></h3>
        <ul class="live-check" id="live"></ul>
        <details class="more"><summary>${ic("alert")}ไม่ขึ้นสักที: ดู Serial Monitor (115200) ของตัวแม่</summary>
          <table class="trouble"><tbody>
            <tr><td><code>Connecting to ...</code> ค้าง</td><td>ชื่อ/รหัส Wi-Fi ผิด หรือ Wi-Fi ไม่ใช่ 2.4 GHz</td></tr>
            <tr><td><code>state=-2</code></td><td>หาเครื่อง server ไม่เจอ: IP ไม่ตรง (IP เปลี่ยนเมื่อต่อ hotspot ใหม่) · คนละ Wi-Fi · Firewall ของ Mac บล็อก (System Settings → Network → Firewall)</td></tr>
            <tr><td><code>state=5</code></td><td>รหัส MQTT ไม่ตรง: ดาวน์โหลดไฟล์ตัวแม่ใหม่แล้วแฟลชอีกครั้ง (ไฟล์เก่าใช้ไม่ได้แล้ว)</td></tr>
            <tr><td><code>rejected ... bad HMAC</code></td><td>ตัวลูกใช้กุญแจฟาร์มคนละชุด: แฟลชตัวลูกด้วยไฟล์ชุดล่าสุด</td></tr>
            <tr><td>ตัวแม่ต่อได้ แต่ไม่มี <code>Node N ...</code></td><td>ตัวลูกไม่ได้เปิด · SSID ของตัวลูกไม่ตรงกับตัวแม่ · อยู่ไกลเกินไป · ดู Serial ของตัวลูก (<code>SHT31 not found</code> = ต่อสายเซนเซอร์ผิด)</td></tr>
          </tbody></table></details>
      </div></section>`;

    if (prev) {
      $("ssid").value = prev.ssid; $("wpass").value = prev.wpass; $("host").value = prev.host;
      if (canGw) $("withGw").checked = prev.withGw;
      for (const [id, on] of prev.coops) { const x = document.querySelector(`[name=coop][value="${id}"]`); if (x && !x.disabled) x.checked = on; }
    }
    const sync = () => { $("kit").querySelectorAll(".gw-only").forEach(x => { x.hidden = !$("withGw").checked; }); };
    $("withGw").addEventListener("change", sync); sync();
    $("gwSel")?.addEventListener("change", e => { gwId = +e.target.value; render(); });
    $("getKit").addEventListener("click", getKit);
    if (!checking.length) checking = coops.filter(c => !c.online && (!c.gateway_id || c.gateway_id === g.id)).map(c => c.id);
    renderLive();
  }

  // step 4: one line per board, ticked when the system sees it
  function renderLive() {
    const el = $("live"); if (!el) return;
    const g = farm.gateways.find(x => x.id === gwId); if (!g) return;
    const coops = farm.coops().filter(c => c.gateway_id === g.id || checking.includes(c.id));
    const row = (ok, title, detail) => `<li class="${ok ? "ok" : ""}">${ic(ok ? "check" : "clock")}<div><b>${title}</b><span>${detail}</span></div></li>`;
    el.innerHTML = row(g.online, "ตัวแม่ · " + esc(g.name), g.online ? "ออนไลน์ เชื่อมต่อ server แล้ว" : "รอเชื่อมต่อ · แฟลชตัวแม่แล้วเสียบไฟ")
      + coops.map(c => row(c.online, esc(c.name) + (c.node_id ? ` · NODE_ID ${c.node_id}` : ""),
          c.online ? `ส่งค่าแล้ว ${c.temp != null ? c.temp.toFixed(1) + " °C · " : ""}${ago(c.ts)}` : !g.online ? "รอตัวแม่ออนไลน์ก่อน" : c.ts ? `ข้อมูลล่าสุด ${ago(c.ts)} · เช็คว่าบอร์ดเปิดอยู่` : "รอข้อมูลจากตัวลูก")).join("")
      || row(false, "ยังไม่มีโรงเรือนที่ผูกกับ gateway นี้", "เลือกโรงเรือนในขั้นที่ 1");
    const all = g.online && coops.length && coops.every(c => c.online);
    if (all && !el.dataset.done) { el.dataset.done = "1"; toast("บอร์ดทุกตัวเชื่อมต่อแล้ว ใช้งานได้"); }
  }

  async function getKit() {
    const withGw = $("withGw").checked;
    const coopIds = [...document.querySelectorAll("[name=coop]:checked")].map(x => +x.value);
    const ssid = $("ssid").value.trim(), wpass = $("wpass").value, host = $("host").value.trim();
    try {
      if (!withGw && !coopIds.length) throw new Error("เลือกตัวแม่ หรือโรงเรือนอย่างน้อย 1 โรง");
      if (!ssid) throw new Error("กรอกชื่อ Wi-Fi");
      if (!ascii(ssid) || !ascii(wpass)) throw new Error("ชื่อและรหัส Wi-Fi ต้องเป็นตัวอักษรภาษาอังกฤษ/ตัวเลข (บอร์ดอ่านภาษาไทยไม่ได้)");
      if (withGw && !wpass) throw new Error("กรอกรหัส Wi-Fi สำหรับตัวแม่");
      if (withGw && !/^[A-Za-z0-9.-]{3,64}$/.test(host)) throw new Error("กรอก IP เครื่องที่เปิดระบบ เช่น 172.20.10.9");
      if (withGw && /^(localhost|127\.)/.test(host)) throw new Error("ใช้ IP ใน Wi-Fi ของเครื่อง (เช่น 172.20.10.9) ไม่ใช่ localhost");
    } catch (e) { toast(e.message, true); return; }
    const g = farm.gateways.find(x => x.id === gwId);
    if (withGw && g.online && !await confirmModal("ออกรหัสตัวแม่ใหม่",
      `<b>${esc(g.name)}</b> ออนไลน์อยู่ ถ้าดาวน์โหลดไฟล์ตัวแม่ รหัสเดิมจะใช้ไม่ได้ทันที และตัวแม่จะหลุดจนกว่าจะแฟลชไฟล์ใหม่`, { submit: "ดาวน์โหลด", danger: true })) return;
    store({ ssid, host, withGw });
    const btn = $("getKit"); btn.disabled = true;
    try {
      const r = await api.boardKit({ gateway_id: gwId, gateway: withGw, coop_ids: coopIds });
      const fname = `SmartChickenFarm-${r.gateway.mqtt_user}.zip`, top = `SmartChickenFarm-${r.gateway.mqtt_user}/`;
      const stamp = `// made by the web (ตั้งค่าบอร์ด) ${new Date().toLocaleString("th-TH")} · ${farm.info.name} · keep private, do not share\n#pragma once\n`;
      const files = [];
      if (withGw) {
        files.push({ name: top + "gateway/gateway.ino", text: r.sources.gateway_ino }, { name: top + "gateway/scf_packet.h", text: r.sources.packet_h },
          { name: top + "gateway/secrets.h", text: `// secrets.h (gateway ${r.gateway.mqtt_user})\n${stamp}#define WIFI_SSID "${cstr(ssid)}"\n#define WIFI_PASS "${cstr(wpass)}"\n#define MQTT_HOST "${cstr(host)}"\n#define MQTT_PORT ${r.mqtt_port}\n#define MQTT_USER "${r.gateway.mqtt_user}"\n#define MQTT_PASS "${r.gateway.mqtt_password}"\n#define FARM_KEY  "${r.farm_key}"\n` });
      }
      for (const n of r.nodes) {
        const d = `node${n.node_id}`;
        files.push({ name: `${top}${d}/${d}.ino`, text: r.sources.node_ino }, { name: `${top}${d}/scf_packet.h`, text: r.sources.packet_h },
          { name: `${top}${d}/secrets.h`, text: `// secrets.h (node ${n.node_id} = ${n.coop})\n${stamp}#define WIFI_SSID "${cstr(ssid)}"\n#define FARM_KEY  "${r.farm_key}"\n#define SCF_NODE_ID ${n.node_id}\n` });
      }
      const lines = [`Smart Chicken Farm · ${farm.info.name} · ${r.gateway.name} (${r.gateway.mqtt_user})`, "",
        "แฟลชทีละบอร์ด: เปิดไฟล์ .ino ใน Arduino IDE > Tools > Board: ESP32 Dev Module > เลือก Port > Upload", ""];
      if (withGw) lines.push("gateway/gateway.ino  ->  ตัวแม่ (ต้องมี library PubSubClient)");
      for (const n of r.nodes) lines.push(`node${n.node_id}/node${n.node_id}.ino  ->  ตัวลูกของ "${n.coop}" (NODE_ID ${n.node_id}, ต้องมี library Adafruit SHT31)`);
      lines.push("", "หลังแฟลช: เว็บ > ตั้งค่าบอร์ด > ขั้นที่ 4 จะติ๊กเขียวเมื่อบอร์ดเชื่อมต่อ", "ไฟล์ secrets.h มีรหัสผ่าน: อย่าส่งต่อหรืออัปโหลดขึ้น GitHub");
      files.push({ name: top + "อ่านก่อนแฟลช.txt", text: lines.join("\n") + "\n" });
      const url = URL.createObjectURL(makeZip(files));
      const a = Object.assign(document.createElement("a"), { href: url, download: fname });
      document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 60000);
      checking = [...new Set([...checking, ...r.nodes.map(n => n.coop_id)])];
      lastKit = `<div class="alert ok kit-done">${ic("check")}<div><b>ดาวน์โหลด ${esc(fname)} แล้ว</b>
        แตกไฟล์ แล้วแฟลชตามรายการนี้ (เปิดไฟล์ .ino ใน Arduino IDE → เลือกบอร์ด ESP32 Dev Module + Port → Upload)
        <ol class="howto">${withGw ? `<li><code>gateway/gateway.ino</code> → <b>ตัวแม่</b></li>` : ""}${r.nodes.map(n => `<li><code>node${n.node_id}/node${n.node_id}.ino</code> → ตัวลูกของ <b>${esc(n.coop)}</b></li>`).join("")}</ol>
        ${r.new_farm_key ? `<p class="warn-text">${ic("alert")} สร้างกุญแจฟาร์มใหม่แล้ว: บอร์ดทุกตัวของฟาร์มนี้ต้องแฟลชด้วยไฟล์ชุดนี้</p>` : ""}
        ${withGw ? `<p class="hint">ไฟล์ตัวแม่มีรหัส MQTT ใหม่ที่ใช้ได้ชุดเดียว ถ้าทำหายให้ดาวน์โหลดใหม่</p>` : ""}</div></div>`;
      $("kitResult").innerHTML = lastKit;
      await farm.reload();
    } catch (e) { toast(e.message, true); }
    btn.disabled = false;
  }

  farm.on("data", render);
  farm.on("change", renderLive);
  farm.on("conn", renderLive);
  farm.ready(render);
}
