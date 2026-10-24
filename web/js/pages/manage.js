// manage.html: the farm on screen and (admin) every farm.
//   keeper (ผู้ดูแลฟาร์ม): coops of their own farm (add in one form: board, lights, flock · edit), gateway status
//   admin:   + farms (add = farm + gateway + first keeper in one form, so every farm has someone; edit/close),
//            gateways (add, rename, switch off, new MQTT password), delete coops, delete farms
import { $, n0, esc, when, ymd } from "../core/format.js";
import { ic } from "../core/icons.js";
import { initLayout, requirePerm, toast } from "../components/layout.js";
import { openModal, secretModal } from "../components/modal.js";
import { farm } from "../services/farm.js";
import { session } from "../services/session.js";
import { api } from "../services/api.js";
import { addFarm, addCoop, addPerson } from "../components/quick-add.js";

if (initLayout("manage") && requirePerm("coop_manage", "หน้าจัดการฟาร์ม")) {
  const isAdmin = session.can("farm_manage");
  const yes = b => b ? `<span class="tag ok">ใช้งาน</span>` : `<span class="tag off">ปิดใช้งาน</span>`;
  $("mTitle").textContent = isAdmin ? "จัดการฟาร์ม" : "จัดการโรงเรือน";

  // ------------------------------------------------------------------ quick actions: every "add" in one place, short forms
  function renderQuick() {
    const can = p => session.can(p), on = !!(farm.info && farm.info.active);
    const acts = [
      isAdmin && ["farm", "เพิ่มฟาร์ม", "ใส่ชื่อ + เลือกจำนวนโรงเรือน", "q-farm"],
      isAdmin && farm.info && ["users", "เพิ่มผู้ดูแลฟาร์ม", "ดูแลทั้งฟาร์ม", "q-keeper"],
      can("coop_manage") && on && ["barn", "เพิ่มโรงเรือน", "ใน " + farm.info.name, "q-coop"],
      can("staff_manage") && on && ["hen", "เพิ่มผู้ดูแลโรงเรือน", "ดูแลเฉพาะโรงที่เลือก", "q-ck"],
      can("coop_manage") && on && ["chip", "ตั้งค่าบอร์ด", "ไฟล์พร้อมแฟลช + เช็คสถานะ", "q-boards"],
    ].filter(Boolean);
    $("quick").innerHTML = acts.map(([icon, label, sub, id]) =>
      `<button class="quick-btn" id="${id}"><span class="q-ic">${ic(icon)}</span><span><b>${ic("plus")}${label}</b><small>${esc(sub)}</small></span></button>`).join("");
  }

  // ------------------------------------------------------------------ farm header + checklist
  function renderFarm() {
    const f = farm.info;
    if (!f) { $("farmCard").innerHTML = `<div class="empty">ยังไม่มีฟาร์ม${isAdmin ? " · กด \"เพิ่มฟาร์ม\" ด้านล่าง" : ""}</div>`; return; }
    const gws = farm.gateways.filter(g => g.active), coops = farm.coops(), keepers = farm.keepers;
    // setup steps: only what is still missing is listed, finished ones fold into one line
    const steps = [
      [keepers.length > 0, "มีผู้ดูแลฟาร์มอย่างน้อย 1 คน", "users.html"],
      [gws.length > 0, "มี gateway (ตัวแม่) อย่างน้อย 1 ตัว", "#gateways"],
      [coops.length > 0, "มีโรงเรือนอย่างน้อย 1 หลัง", "#coops"],
      [coops.length > 0 && coops.every(c => c.hasDevice), "ทุกโรงเรือนผูกกับบอร์ดลูกแล้ว", "boards.html"],
      [gws.length > 0 && gws.some(g => g.online), "ตัวแม่ (gateway) ออนไลน์", "boards.html"],
    ];
    const todo = steps.filter(s => !s[0]), doneN = steps.length - todo.length;
    const checklist = todo.map(([, text, href]) => `<li>${ic("alert")}<span>${text}</span>${isAdmin || href !== "users.html" ? `<a class="link" href="${href}">ไปทำ ${ic("arrow")}</a>` : ""}</li>`).join("") +
      (doneN ? `<li class="done">${ic("check")}<span>${todo.length ? `เรียบร้อยแล้ว ${doneN} จาก ${steps.length} ขั้น` : "ตั้งค่าฟาร์มครบทุกขั้นแล้ว"}</span></li>` : "");
    $("farmCard").innerHTML = `
      <div class="farm-head">
        <div class="farm-icon">${ic("farm")}</div>
        <div><h3>${esc(f.name)} ${f.active ? "" : yes(false)}</h3><p class="hint">${esc(f.location || "ไม่ได้ระบุที่ตั้ง")}</p></div>
        ${isAdmin ? `<button class="btn sm" id="editFarm">${ic("edit")}แก้ไขฟาร์ม</button>` : ""}
      </div>
      <div class="farm-meta">
        <div><span>ผู้ดูแลฟาร์ม</span><b class="${keepers.length ? "" : "warn-text"}">${keepers.length ? keepers.map(esc).join(", ") : "ยังไม่มี (ต้องมี)"}</b></div>
        <div><span>โรงเรือนที่ใช้งาน</span><b>${coops.length}</b></div>
        <div><span>ผูกบอร์ดลูกแล้ว</span><b>${coops.filter(c => c.hasDevice).length} / ${coops.length}</b></div>
        <div><span>ไก่ในฟาร์ม</span><b>${n0(coops.reduce((s, c) => s + (c.flock ? c.flock.alive : 0), 0))} ตัว</b></div>
      </div>
      <ol class="checklist">${checklist}</ol>`;
    $("editFarm")?.addEventListener("click", () => farmModal(f));
  }

  // ------------------------------------------------------------------ coops of this farm
  function renderCoops() {
    const all = farm.coops({ all: true }), gws = farm.gateways, many = gws.length > 1;
    $("coopAdd").hidden = !farm.info || !farm.info.active;
    $("coopBody").innerHTML = all.length ? all.map(c => {
      const g = gws.find(g => g.id === c.gateway_id);
      return `<tr class="${c.active ? "" : "muted-row"}">
        <td><b>${esc(c.name)}</b></td>
        <td>${g ? `โหนด <b>${c.node_id}</b>${many ? ` · ${esc(g.name)}` : ""}` : `<span class="warn-text">ยังไม่ผูก</span>`}</td>
        <td>${!c.active ? yes(false) : !c.hasDevice ? "–" : c.online ? `<span class="tag ok">ออนไลน์</span>` : `<span class="tag off">ขาดการติดต่อ</span>`}</td>
        <td>${c.flock ? `${esc(c.flock.breed)} · ${n0(c.flock.alive)} ตัว` : "–"}</td>
        <td class="caretakers">${c.caretakers && c.caretakers.length ? c.caretakers.map(esc).join(", ") : !c.active ? "–" : "ยังไม่มี"}${c.active && session.can("staff_manage")
          ? ` <button class="btn sm ghost" data-ck-add="${c.id}" aria-label="เพิ่มผู้ดูแล${esc(c.name)}">${ic("plus")}เพิ่ม</button>` : ""}</td>
        <td class="n">${c.capacity ? n0(c.capacity) : "–"}</td>
        <td class="actions"><button class="btn sm" data-coop-edit="${c.id}">แก้ไข</button>${session.can("coop_delete")
          ? `<button class="btn sm ghost" data-coop-del="${c.id}" aria-label="ลบ${esc(c.name)}">ลบ</button>` : ""}</td></tr>`;
    }).join("") : `<tr><td colspan="7" class="empty">ยังไม่มีโรงเรือน · กด "เพิ่มโรงเรือน"</td></tr>`;

    const unknown = farm.unknownDevices;
    $("unknownBox").hidden = !unknown.length;
    $("unknownList").innerHTML = unknown.map(d => {
      const g = gws.find(g => g.mqtt_user === d.mqtt_user);
      return `<li>${ic("chip")}<div><b>บอร์ดลูก โหนด ${d.node_id}${g ? " · " + esc(g.name) : ""}</b><span>ส่งข้อมูลล่าสุด ${when(d.last_seen)}</span></div>
        <button class="btn sm primary" data-register="${g ? g.id : ""}:${d.node_id}">${ic("plus")}ลงทะเบียนเป็นโรงเรือน</button></li>`;
    }).join("");
  }

  // Add (everything in one form: board, lights, flock) or edit a coop.
  function coopModal(c, preset = {}) {
    const gws = farm.gateways.filter(g => g.active || (c && g.id === c.gateway_id));
    const others = farm.coops({ all: true }).filter(x => x.active && (!c || x.id !== c.id) && x.gateway_id);
    const usedBy = (gid, n) => others.find(x => x.gateway_id === +gid && x.node_id === n);
    const firstGw = gws[0] ? gws[0].id : "";
    // a new coop gets the gateway, the first free node number and the first unused name by default
    const freeNode = gid => { for (let n = 1; n <= 20; n++) if (!usedBy(gid, n)) return n; return ""; };
    const names = new Set(farm.coops({ all: true }).map(x => x.name));
    let num = 1; while (names.has(`โรงเรือน ${num}`)) num++;
    const v = Object.assign({ name: `โรงเรือน ${num}`, capacity: "", gateway_id: firstGw, node_id: freeNode(firstGw), active: true }, c || {}, preset);
    if (c && !c.gateway_id) v.gateway_id = "";
    const nodeOptions = gid => `<option value="">ยังไม่ผูกบอร์ดลูก</option>` + Array.from({ length: 20 }, (_, i) => i + 1).map(n => {
      const u = gid && usedBy(gid, n);
      return `<option value="${n}" ${n === Number(v.node_id) && v.gateway_id ? "selected" : ""} ${u ? "disabled" : ""}>โหนด ${n}${u ? ` · ใช้กับ ${esc(u.name)}` : ""}</option>`;
    }).join("");

    const basics = `<label>ชื่อโรงเรือน<input name="name" required maxlength="60" value="${esc(v.name)}"></label>
        <div class="fields">
          <label><span>ความจุ (ตัว) <em>ไม่บังคับ</em></span><input name="capacity" type="number" min="1" max="1000000" step="1" value="${esc(v.capacity ?? "")}"></label>
          <label><span>บอร์ดลูก <em>NODE_ID ที่แฟลชไว้</em></span><select name="node_id">${nodeOptions(v.gateway_id || firstGw)}</select></label>
        </div>
        <label ${gws.length > 1 ? "" : "hidden"}>Gateway<select name="gateway_id">
          ${gws.map(g => `<option value="${g.id}" ${g.id === Number(v.gateway_id || firstGw) ? "selected" : ""}>${esc(g.name)}</option>`).join("")}</select></label>
        ${gws.length ? "" : `<p class="hint warn-text">${ic("alert")} ฟาร์มนี้ยังไม่มี gateway ที่ใช้งานได้ จึงผูกบอร์ดลูกไม่ได้</p>`}`;

    const extras = `
      <fieldset class="fs"><legend>${ic("bulb")}ไฟส่องสว่าง</legend>
        <div class="seg" role="radiogroup"><label><input type="radio" name="light_mode" value="manual" checked>สั่งเอง</label><label><input type="radio" name="light_mode" value="auto">ตั้งเวลา</label></div>
        <div class="fields times muted"><label>เปิดไฟ<input type="time" name="light_on" value="06:00"></label><label>ปิดไฟ<input type="time" name="light_off" value="22:00"></label></div>
      </fieldset>
      <fieldset class="fs"><legend>${ic("hen")}รุ่นไก่</legend>
        <label class="check"><input type="checkbox" name="has_flock"> ลงไก่แล้ว <em>ระบบจะปรับเป้าหมายอุณหภูมิตามอายุไก่ให้เอง</em></label>
        <div class="fields flock-fields" hidden>
          <label>วันลงไก่<input type="date" name="started_on" value="${ymd()}" max="${ymd()}"></label>
          <label>จำนวนไก่ (ตัว)<input type="number" name="birds" min="1" max="1000000" step="1"></label>
          <label><span>สายพันธุ์ <em>ไม่บังคับ</em></span><input name="breed" maxlength="40" placeholder="เช่น Ross 308"></label>
        </div>
      </fieldset>`;

    const m = openModal({
      title: c ? "แก้ไขโรงเรือน" : `เพิ่มโรงเรือน · ${farm.info.name}`, wide: !c, submit: c ? "บันทึก" : "เพิ่มโรงเรือน",
      body: c ? basics + `<label class="check"><input type="checkbox" name="active" ${v.active ? "checked" : ""}> ใช้งาน <em>ปิดแล้วจะไม่รับข้อมูลจากบอร์ดนี้ (ประวัติยังอยู่)</em></label>`
              : `<fieldset class="fs"><legend>${ic("barn")}ข้อมูลโรงเรือน</legend>${basics}</fieldset>${extras}`,
      onSubmit: async f => {
        const node = f.node_id.value ? +f.node_id.value : null;
        const body = { name: f.name.value, capacity: f.capacity.value, gateway_id: node && f.gateway_id.value ? +f.gateway_id.value : null, node_id: node };
        if (c) Object.assign(body, { id: c.id, active: f.active.checked });
        else {
          Object.assign(body, { light_mode: f.light_mode.value, light_on: f.light_on.value, light_off: f.light_off.value });
          if (f.has_flock.checked) body.flock = { started_on: f.started_on.value, birds: +f.birds.value, breed: f.breed.value };
        }
        await api.saveCoop(body);
        await farm.reload();
        toast(c ? "บันทึกโรงเรือนแล้ว" : `เพิ่ม${body.name}แล้ว`);
      },
    });
    const f = m.form;
    f.gateway_id.addEventListener("change", e => { v.gateway_id = e.target.value; f.node_id.innerHTML = nodeOptions(e.target.value); });
    if (c) return;
    // show only the fields that the current choices need
    const sync = () => {
      const flock = f.has_flock.checked;
      f.querySelector(".times").classList.toggle("muted", f.light_mode.value !== "auto");
      f.querySelector(".flock-fields").hidden = !flock;
      f.birds.required = flock;
      f.querySelectorAll(".seg label").forEach(l => l.classList.toggle("act", l.querySelector("input").checked));
    };
    f.addEventListener("change", sync); sync();
  }

  // Delete a coop with all its history (admin): type its name to confirm.
  function deleteCoop(c) {
    openModal({
      title: `ลบโรงเรือน "${c.name}"`, submit: "ลบถาวร", danger: true,
      body: `<p class="warn-text">${ic("alert")} ลบโรงเรือนพร้อม<b>ประวัติทั้งหมด</b> (ค่าวัด การเปิดปิดไฟ รุ่นไก่ บันทึกประจำวัน แจ้งเตือน) และกู้คืนไม่ได้</p>
        ${c.flock ? `<p>มีไก่กำลังเลี้ยงอยู่ ${n0(c.flock.alive)} ตัว</p>` : ""}
        <p class="hint">ถ้าแค่หยุดใช้ชั่วคราว ให้กด "แก้ไข" แล้วเอาเครื่องหมาย "ใช้งาน" ออกแทน (ประวัติยังอยู่)</p>
        <label><span>พิมพ์ <b>${esc(c.name)}</b> เพื่อยืนยัน</span><input name="confirm" required autocomplete="off"></label>`,
      onSubmit: async f => {
        if (f.confirm.value.trim() !== c.name) throw new Error("ชื่อโรงเรือนไม่ตรง");
        await api.deleteCoop(c.id, f.confirm.value.trim());
        await farm.reload();
        toast("ลบ" + c.name + "แล้ว");
      },
    });
  }

  // ------------------------------------------------------------------ gateways
  function renderGateways() {
    const gws = farm.gateways;
    $("gwAdd").hidden = !session.can("gateway_manage") || !farm.info;
    $("gwBody").innerHTML = gws.length ? gws.map(g => `<tr>
        <td><b>${esc(g.name)}</b></td><td><code>${esc(g.mqtt_user || "–")}</code></td>
        <td>${g.active ? (g.online ? `<span class="tag ok">ออนไลน์</span>` : `<span class="tag off">ออฟไลน์</span>`) : yes(false)}</td>
        <td class="hint">${g.last_seen ? when(g.last_seen) : "ยังไม่เคยเชื่อมต่อ"}</td>
        <td class="n">${farm.coops({ all: true }).filter(c => c.gateway_id === g.id && c.active).length}</td>
        <td class="actions">${g.active ? `<a class="btn sm primary" href="boards.html?gw=${g.id}">${ic("chip")}ตั้งค่าบอร์ด</a>` : ""}${session.can("gateway_manage") ? `<button class="btn sm" data-gw-edit="${g.id}">แก้ไข</button>
          ${g.active ? `<button class="btn sm" data-gw-pw="${g.id}">${ic("key")}รหัสใหม่</button>` : ""}` : ""}</td></tr>`).join("")
      : `<tr><td colspan="6" class="empty">ฟาร์มนี้ยังไม่มี gateway${isAdmin ? " · กด \"เพิ่ม gateway\"" : " · ติดต่อผู้ดูแลระบบ"}</td></tr>`;
  }

  function secretsSnippet(r, withKey) {
    const host = location.hostname === "localhost" ? "IP_ของเครื่อง_server" : location.hostname;
    const gw = `#define WIFI_SSID "ชื่อ Wi-Fi 2.4 GHz"\n#define WIFI_PASS "รหัส Wi-Fi"\n#define MQTT_HOST "${host}"\n#define MQTT_PORT 1883\n#define MQTT_USER "${r.mqtt_user}"\n#define MQTT_PASS "${r.mqtt_password}"\n#define FARM_KEY  "${withKey ? r.farm_key : "(ใช้กุญแจเดิมของฟาร์ม)"}"`;
    const node = `#define WIFI_SSID "ชื่อ Wi-Fi 2.4 GHz"\n#define FARM_KEY  "${withKey ? r.farm_key : "(ใช้กุญแจเดิมของฟาร์ม)"}"`;
    return `<h4 class="snip-title">firmware/gateway/secrets.h</h4><pre class="snippet">${esc(gw)}</pre>
      <h4 class="snip-title">firmware/node/secrets.h (ทุกบอร์ดลูกในฟาร์มนี้)</h4><pre class="snippet">${esc(node)}</pre>`;
  }

  function gatewayModal(g) {
    openModal({
      title: g ? "แก้ไข gateway" : `เพิ่ม gateway · ${farm.info.name}`,
      body: `<label>ชื่อ<input name="name" required maxlength="60" value="${esc(g ? g.name : "")}" placeholder="เช่น Gateway โรงเรือนฝั่งเหนือ"></label>
        ${g ? `<label class="check"><input type="checkbox" name="active" ${g.active ? "checked" : ""}> ใช้งาน <em>ปิดแล้วบัญชี MQTT ของตัวนี้ถูกตัดทันที</em></label>`
            : `<p class="hint">ระบบจะสร้างชื่อผู้ใช้ MQTT รหัสผ่าน และกุญแจฟาร์มให้ และแสดง <b>ครั้งเดียว</b></p>`}`,
      onSubmit: async f => {
        const r = await api.saveGateway(g ? { id: g.id, name: f.name.value, active: f.active.checked } : { farm_id: farm.info.id, name: f.name.value });
        await farm.reload();
        if (!g) secretModal("Gateway ใหม่: ค่าสำหรับแฟลชบอร์ด", "ค่าต่อไปนี้แสดงครั้งเดียว ระบบไม่เก็บรหัสผ่านไว้ให้ดูอีก",
          [["MQTT_USER", r.mqtt_user], ["MQTT_PASS", r.mqtt_password], ["FARM_KEY", r.farm_key]], secretsSnippet(r, true));
        else toast("บันทึกแล้ว");
      },
    });
  }

  function gatewayPassword(g) {
    openModal({
      title: "ออกรหัส MQTT ใหม่: " + g.name, submit: "ออกรหัสใหม่", danger: true,
      body: `<p>รหัสเดิมจะใช้ไม่ได้ทันที ต้องแฟลช gateway ใหม่ด้วยรหัสที่ได้</p>
        <label class="check"><input type="checkbox" name="key"> สร้างกุญแจฟาร์ม (FARM_KEY) ใหม่ด้วย <em>ต้องแฟลชบอร์ดลูกทุกตัวในฟาร์มใหม่</em></label>`,
      onSubmit: async f => {
        const r = await api.gatewayPassword(g.id, f.key.checked);
        const items = [["MQTT_USER", r.mqtt_user], ["MQTT_PASS", r.mqtt_password]];
        if (r.farm_key) items.push(["FARM_KEY", r.farm_key]);
        secretModal("รหัสใหม่ของ " + g.name, "แสดงครั้งเดียว ระบบไม่เก็บรหัสผ่านไว้ให้ดูอีก", items, secretsSnippet(r, !!r.farm_key));
      },
    });
  }

  // ------------------------------------------------------------------ all farms (admin)
  let farmsList = [];
  async function renderFarms() {
    if (!isAdmin) return;
    $("farmsBox").hidden = false;
    try { farmsList = await api.farms(); } catch (e) { $("farmsBody").innerHTML = `<tr><td colspan="7" class="empty">${esc(e.message)}</td></tr>`; return; }
    const cur = farm.info && farm.info.id;
    $("farmsBody").innerHTML = farmsList.map(f => `<tr class="${f.active ? "" : "muted-row"}">
      <td><b>${esc(f.name)}</b>${f.id === cur ? ` <span class="tag">กำลังดู</span>` : ""}<div class="hint">${esc(f.location || "")}</div></td>
      <td>${f.keepers.length ? f.keepers.map(esc).join(", ") : `<span class="warn-text">${ic("alert")}ยังไม่มี</span>`}${f.active ? ` <button class="btn sm ghost" data-keeper-add="${f.id}">${ic("plus")}เพิ่ม</button>` : ""}</td>
      <td class="n">${f.coops}</td><td class="n">${n0(f.birds)}</td><td class="n">${f.gateways}</td><td>${yes(f.active)}</td>
      <td class="actions">${f.id === cur ? "" : `<button class="btn sm" data-farm-open="${f.id}">เปิดดู</button>`}<button class="btn sm" data-farm-edit="${f.id}">แก้ไข</button><button class="btn sm ghost" data-farm-del="${f.id}" aria-label="ลบ${esc(f.name)}">ลบ</button></td></tr>`).join("")
      || `<tr><td colspan="7" class="empty">ยังไม่มีฟาร์ม · กด "เพิ่มฟาร์ม"</td></tr>`;
  }

  // Delete a whole farm (admin): coops with their history, gateways (MQTT access cut), its keepers and viewers. Type the name to confirm.
  function deleteFarm(f) {
    openModal({
      title: `ลบฟาร์ม "${f.name}"`, submit: "ลบฟาร์มถาวร", danger: true,
      body: `<p class="warn-text">${ic("alert")} ลบทุกอย่างในฟาร์มนี้ และ<b>กู้คืนไม่ได้</b>:</p>
        <ul class="del-list">
          <li><b>${f.coops}</b> โรงเรือน พร้อมประวัติทั้งหมด (ค่าวัด ไฟ รุ่นไก่ บันทึกประจำวัน แจ้งเตือน)${f.birds ? ` · มีไก่อยู่ ${n0(f.birds)} ตัว` : ""}</li>
          <li><b>${f.gateways}</b> gateway · บัญชี MQTT ถูกตัดทันที</li>
          <li><b>${f.staff}</b> บัญชีผู้ดูแลฟาร์ม/ผู้ดู ของฟาร์มนี้ (ออกจากระบบทันที)</li>
        </ul>
        <p class="hint">ถ้าแค่หยุดใช้ชั่วคราว ให้กด "แก้ไข" แล้วเอาเครื่องหมาย "ใช้งาน" ออกแทน (ข้อมูลยังอยู่) · บันทึกการใช้งาน (audit) ยังเก็บไว้</p>
        <label><span>พิมพ์ <b>${esc(f.name)}</b> เพื่อยืนยัน</span><input name="confirm" required autocomplete="off"></label>`,
      onSubmit: async x => {
        if (x.confirm.value.trim() !== f.name) throw new Error("ชื่อฟาร์มไม่ตรง");
        await api.deleteFarm(f.id, x.confirm.value.trim());
        toast(`ลบฟาร์ม ${f.name} แล้ว`);
        if (farm.info && farm.info.id === f.id) { session.setFarm(null); setTimeout(() => location.reload(), 600); return; }
        renderFarms();
      },
    });
  }

  // edit a farm, or add one together with its gateway and first keeper (every farm must have someone)
  function farmModal(f) {
    openModal({
      title: f ? "แก้ไขฟาร์ม" : "เพิ่มฟาร์ม", wide: !f, submit: f ? "บันทึก" : "เพิ่มฟาร์ม",
      body: `<fieldset class="fs"><legend>${ic("farm")}ข้อมูลฟาร์ม</legend>
          <div class="fields"><label>ชื่อฟาร์ม<input name="name" required maxlength="80" value="${esc(f ? f.name : "")}"></label>
          <label><span>ที่ตั้ง <em>ไม่บังคับ</em></span><input name="location" maxlength="120" value="${esc(f && f.location || "")}"></label></div>
          ${f ? `<label class="check"><input type="checkbox" name="active" ${f.active ? "checked" : ""}> ใช้งาน <em>ปิดแล้วผู้ใช้ของฟาร์มนี้เข้าระบบไม่ได้</em></label>` : ""}
        </fieldset>
        ${f ? "" : `<fieldset class="fs"><legend>${ic("chip")}Gateway (ตัวแม่)</legend>
          <label><span>ชื่อ gateway <em>เว้นว่าง = "Gateway ชื่อฟาร์ม"</em></span><input name="gateway_name" maxlength="60"></label>
          <p class="hint">ระบบสร้างบัญชี MQTT และกุญแจฟาร์มให้ แสดงครั้งเดียวหลังกดเพิ่มฟาร์ม</p>
        </fieldset>
        <fieldset class="fs"><legend>${ic("users")}ผู้ดูแลฟาร์มคนแรก</legend>
          <p class="hint">ทุกฟาร์มต้องมีผู้ดูแล · คนนี้เข้าได้เฉพาะฟาร์มนี้ฟาร์มเดียว</p>
          <div class="fields">
            <label>ชื่อที่แสดง<input name="k_display" required maxlength="60" placeholder="เช่น สมชาย"></label>
            <label><span>ชื่อผู้ใช้ <em>a-z 0-9 . _ -</em></span><input name="k_username" required maxlength="32" pattern="[a-z0-9._\\-]{3,32}" autocapitalize="none" spellcheck="false"></label>
          </div>
          <label><span>รหัสผ่านเริ่มต้น <em>เว้นว่าง = ให้ระบบสุ่มให้</em></span><input name="k_password" type="text" autocomplete="off" minlength="8" maxlength="128"></label>
        </fieldset>`}`,
      onSubmit: async x => {
        if (f) {
          await api.saveFarm({ id: f.id, name: x.name.value, location: x.location.value, active: x.active.checked });
          toast("บันทึกฟาร์มแล้ว");
          await farm.reload(); renderFarms();
          return;
        }
        const r = await api.saveFarm({ name: x.name.value, location: x.location.value, gateway_name: x.gateway_name.value,
          keeper: { display_name: x.k_display.value, username: x.k_username.value.trim().toLowerCase(), password: x.k_password.value || undefined } });
        const items = [["MQTT_USER", r.mqtt_user], ["MQTT_PASS", r.mqtt_password], ["FARM_KEY", r.farm_key], ["ผู้ดูแลฟาร์ม", r.username]];
        if (r.temp_password) items.push(["รหัสผ่านผู้ดูแล", r.temp_password]);
        session.setFarm(r.id);
        secretModal(`เพิ่มฟาร์ม "${x.name.value}" แล้ว`, "ค่าต่อไปนี้แสดงครั้งเดียว: จดไว้ แล้วกดปุ่มด้านล่างเพื่อเปิดฟาร์มใหม่", items, secretsSnippet(r, true))
          .el.addEventListener("close", () => location.reload());
      },
    });
  }

  // ------------------------------------------------------------------ events
  document.querySelector("main").addEventListener("click", e => {
    const t = e.target.closest("button"); if (!t) return;
    const gw = id => farm.gateways.find(g => g.id === +id);
    if (t.id === "coopAdd" || t.id === "q-coop") addCoop();
    else if (t.id === "q-ck") addPerson("coop_keeper");
    else if (t.id === "q-boards") location.href = "boards.html";
    else if (t.id === "q-keeper") addPerson("keeper", { onDone: renderFarms });
    else if (t.id === "farmAdd" || t.id === "q-farm") addFarm();
    else if (t.dataset.ckAdd) addPerson("coop_keeper", { coopIds: [+t.dataset.ckAdd] });
    else if (t.dataset.keeperAdd) addPerson("keeper", { farmId: +t.dataset.keeperAdd, onDone: renderFarms });
    else if (t.id === "gwAdd") gatewayModal(null);
    else if (t.dataset.gwEdit) gatewayModal(gw(t.dataset.gwEdit));
    else if (t.dataset.gwPw) gatewayPassword(gw(t.dataset.gwPw));
    else if (t.dataset.coopEdit) coopModal(farm.coop(t.dataset.coopEdit));
    else if (t.dataset.coopDel) deleteCoop(farm.coop(t.dataset.coopDel));
    else if (t.dataset.register) { const [g, n] = t.dataset.register.split(":"); addCoop({ preset: { gateway_id: g, node_id: +n } }); }
    else if (t.dataset.farmOpen) { session.setFarm(+t.dataset.farmOpen); location.reload(); }
    else if (t.dataset.farmEdit) farmModal(farmsList.find(f => f.id === +t.dataset.farmEdit));
    else if (t.dataset.farmDel) deleteFarm(farmsList.find(f => f.id === +t.dataset.farmDel));
  });

  const render = () => { renderQuick(); renderFarm(); renderCoops(); renderGateways(); };
  farm.on("data", render);
  farm.on("conn", renderGateways);
  farm.ready(() => { render(); renderFarms(); });
}
