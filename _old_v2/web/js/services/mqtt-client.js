// MQTT over WebSocket: the live channel between this page and the farm.
//   subscribe: telemetry, light/state, alert, gateway status, farm config
//   publish:   light/set   (the page never touches the database to switch a light)
import { MQTT_URL, MQTT_LIB, TOPICS } from "../config.js";

const HOUSE_TOPIC = /^farm\/house\/([1-3])\/(telemetry|light\/state|alert)$/;
let client = null;

// Load mqtt.js (UMD build, sets window.mqtt): local copy first, then the CDN.
function loadLibrary() {
  if (window.mqtt) return Promise.resolve(window.mqtt);
  return MQTT_LIB.reduce((prev, src) => prev.catch(() => new Promise((ok, fail) => {
    const s = document.createElement("script");
    s.src = src;
    s.onload = () => window.mqtt ? ok(window.mqtt) : fail(new Error("no mqtt global"));
    s.onerror = () => { s.remove(); fail(new Error("cannot load " + src)); };
    document.head.appendChild(s);
  })), Promise.reject(new Error("start")));
}

/**
 * handlers: onConnection(ok, reason), onTelemetry(house, {temp, humidity}),
 *           onLightState(house, on), onAlert(house, alert, retained), onGateway("online"|"offline"),
 *           onConfig({houses: [...]})   (flocks, targets, light schedule; published by Node-RED)
 */
export async function connect(h) {
  let mqtt;
  try { mqtt = await loadLibrary(); }
  catch { h.onConnection(false, "โหลดไลบรารี mqtt.js ไม่ได้"); return; }

  client = mqtt.connect(MQTT_URL, {
    clientId: "scf-web-" + Math.random().toString(16).slice(2, 10),
    reconnectPeriod: 2000,
    connectTimeout: 5000,
    clean: true,
  });
  client.on("connect", () => {
    client.subscribe(["farm/house/+/telemetry", "farm/house/+/light/state", "farm/house/+/alert", TOPICS.gateway, TOPICS.config], { qos: 1 });
    h.onConnection(true);
  });
  client.on("close", () => h.onConnection(false, "ต่อ MQTT broker ไม่ได้ (" + MQTT_URL + ")"));
  client.on("message", (topic, buf, packet) => {
    const text = buf.toString();
    if (topic === TOPICS.gateway) return h.onGateway(text);
    if (topic === TOPICS.config) { try { h.onConfig(JSON.parse(text)); } catch { /* ignore */ } return; }
    const m = HOUSE_TOPIC.exec(topic);
    if (!m) return;
    const house = +m[1];
    try {
      if (m[2] === "telemetry") {
        const d = JSON.parse(text);
        if (Number.isFinite(d.temp) && Number.isFinite(d.humidity)) h.onTelemetry(house, d);
      } else if (m[2] === "light/state") {
        h.onLightState(house, text.trim().toUpperCase() === "ON");
      } else {
        h.onAlert(house, JSON.parse(text), !!packet.retain);
      }
    } catch { /* ignore malformed messages */ }
  });
}

export const isConnected = () => !!(client && client.connected);

// Retained, so the gateway gets the wanted state even if it (re)connects later.
export function publishLight(house, on) {
  client.publish(TOPICS.lightSet(house), on ? "ON" : "OFF", { qos: 1, retain: true });
}
