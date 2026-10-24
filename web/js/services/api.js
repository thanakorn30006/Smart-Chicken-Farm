// HTTP API of Node-RED. Every call carries the login token; Node-RED checks the token, the role
// and the farm before touching the database. A 401 means the session is over -> back to login.
import { API_BASE } from "../config.js";
import { session } from "./session.js";

async function call(method, path, params = {}, body) {
  const url = new URL(API_BASE + path, location.href);
  for (const [k, v] of Object.entries(params)) if (v != null && v !== "") url.searchParams.set(k, v);
  const headers = {};
  if (session.token) headers.Authorization = "Bearer " + session.token;
  if (body) headers["Content-Type"] = "application/json";
  let res;
  try { res = await fetch(url, { method, cache: "no-store", headers, body: body ? JSON.stringify(body) : undefined }); }
  catch { throw new Error("ติดต่อเซิร์ฟเวอร์ไม่ได้"); }
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
  if (res.status === 401 && !path.startsWith("/auth/")) { session.logout("expired"); throw new Error("กรุณาเข้าสู่ระบบใหม่"); }
  if (!res.ok) { const e = new Error((data && data.error) || `เกิดข้อผิดพลาด (${res.status})`); e.status = res.status; throw e; }
  return data;
}
const get = (r, params) => call("GET", "/api/" + r, params);
const post = (r, body) => call("POST", "/api/" + r, {}, body);
const iso = ms => ms ? new Date(ms).toISOString() : null;
// admins choose the farm; for everyone else Node-RED uses their own farm anyway
const farmParam = () => session.isAdmin ? session.farmId : null;

export const api = {
  login: (username, password) => call("POST", "/auth/login", {}, { username, password }),
  mfa: (mfaToken, code) => call("POST", "/auth/mfa", {}, { mfa_token: mfaToken, code }),   // step 2: code from the app or a backup code
  mfaSelf: body => post("mfa", body),                       // {action: setup | enable | backup | disable}
  resetUserMfa: id => post("user-mfa-reset", { id }),
  me: () => get("me"),

  // ---- read
  farms: () => get("farms"),
  farmData: () => get("farm-data", { farm_id: farmParam() }),
  // no coopId = every coop of the farm on screen
  readings: ({ coopId, sinceMs, limit = 100, order = "desc" } = {}) =>
    get("readings", { coop_id: coopId, farm_id: coopId ? null : farmParam(), since: iso(sinceMs), limit, order }),
  ledEvents: ({ coopId, sinceMs } = {}) => get("led-events", { coop_id: coopId, farm_id: coopId ? null : farmParam(), since: iso(sinceMs) }),
  alerts: ({ coopId, sinceMs, limit = 100 } = {}) => get("alerts", { coop_id: coopId, farm_id: coopId ? null : farmParam(), since: iso(sinceMs), limit }),
  dailyLogs: coopId => get("daily-logs", { coop_id: coopId }),
  audit: ({ sinceMs, limit = 200, allFarms = false } = {}) => get("audit", { farm_id: allFarms ? null : farmParam(), all: allFarms ? 1 : null, since: iso(sinceMs), limit }),
  users: ({ allFarms = false } = {}) => get("users", { farm_id: allFarms ? null : farmParam(), all: allFarms ? 1 : null }),

  // ---- coop work
  light: (coopId, on) => post("light", { coop_id: coopId, on }),
  lightsOff: () => post("lights-off", { farm_id: farmParam() }),
  saveSettings: s => post("settings", s),
  startFlock: f => post("flock", f),
  endFlock: coopId => post("flock-end", { coop_id: coopId }),
  saveDailyLog: log => post("daily-log", log),

  // ---- farm structure + people
  saveFarm: f => post("farm", f),
  deleteFarm: (id, confirm) => post("farm-delete", { id, confirm }),          // a new farm carries its gateway and first keeper in the same call
  saveCoop: c => post("coop", Object.assign({ farm_id: farmParam() }, c)),   // a new coop may carry light schedule and flock
  deleteCoop: (id, confirm) => post("coop-delete", { id, confirm }),
  saveGateway: g => post("gateway", g),
  gatewayPassword: (id, newFarmKey) => post("gateway-password", { id, new_farm_key: !!newFarmKey }),
  boardKit: k => post("board-kit", k),          // ready-to-flash board files (web > ตั้งค่าบอร์ด)
  saveUser: u => post("user", u),
  resetUserPassword: id => post("user-password", { id }),
  deleteUser: id => post("user-delete", { id }),
  changePassword: (oldPassword, newPassword) => post("password", { old_password: oldPassword, new_password: newPassword }),
};
