// Live data from Node-RED over WebSocket (/ws/live). The page must authenticate first; Node-RED then
// sends only the events of the farm this user may see. Reconnects by itself.
import { WS_URL } from "../config.js";
import { session } from "./session.js";

let ws = null, handlers = null, retry = 1000, pingTimer = null, closedByUs = false;

export function connectLive(h) {
  handlers = h;
  open();
}

function open() {
  try { ws = new WebSocket(WS_URL); } catch { schedule(); return; }
  ws.onopen = () => ws.send(JSON.stringify({ type: "auth", token: session.token, farm_id: session.farmId }));
  ws.onmessage = e => {
    let m;
    try { m = JSON.parse(e.data); } catch { return; }
    if (m.type === "ready") { retry = 1000; handlers.onStatus(true); startPing(); return; }
    if (m.type === "auth-failed" || m.type === "auth-expired") { closedByUs = true; ws.close(); session.logout("expired"); return; }
    if (m.type === "pong") return;
    handlers.onEvent(m);
  };
  ws.onclose = () => { stopPing(); handlers.onStatus(false); if (!closedByUs) schedule(); };
  ws.onerror = () => {};
}
function schedule() { setTimeout(open, retry); retry = Math.min(retry * 2, 15000); }
function startPing() { stopPing(); pingTimer = setInterval(() => ws && ws.readyState === 1 && ws.send('{"type":"ping"}'), 25000); }
function stopPing() { clearInterval(pingTimer); }
