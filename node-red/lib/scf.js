// Smart Chicken Farm: building blocks shared by the Node-RED flows (loaded in settings.js as global "scf").
// Domain logic (who may do what, alert rules, schedules) lives in the flows; this file only provides
// the plumbing: database access, password hashing, signed tokens, permissions table, MQTT account queue.
"use strict";
const crypto = require("crypto");
const fs = require("fs");

const env = k => process.env[k] || "";

// ---------------------------------------------------------------- Supabase (PostgREST)
let transport = async (method, path, body, prefer) => {
  const key = env("SUPABASE_KEY");
  const headers = { apikey: key, "Content-Type": "application/json" };
  if (key.startsWith("eyJ")) headers.Authorization = "Bearer " + key;   // legacy JWT keys
  if (prefer) headers.Prefer = prefer;
  const res = await fetch(env("SUPABASE_URL") + "/rest/v1/" + path, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) {
    const e = new Error(`Supabase ${res.status}: ${(data && data.message) || text}`);
    e.status = res.status; e.code = data && data.code;
    throw e;
  }
  return data;
};

const db = {
  get: path => transport("GET", path),
  insert: (table, row) => transport("POST", table, row, "return=representation"),
  upsert: (table, row, onConflict) => transport("POST", `${table}?on_conflict=${onConflict}`, row, "resolution=merge-duplicates,return=representation"),
  update: (table, filter, patch) => transport("PATCH", `${table}?${filter}`, patch, "return=representation"),
  rpc: (fn, args) => transport("POST", "rpc/" + fn, args, "return=representation"),
  del: (table, filter) => transport("DELETE", `${table}?${filter}`, undefined, "return=representation"),
};

// value safe to put in a PostgREST filter (only ints and ISO dates ever reach a URL)
const int = v => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : null; };
const inList = ids => `in.(${ids.map(Number).filter(Number.isInteger).join(",")})`;

// ---------------------------------------------------------------- passwords (scrypt + random salt)
const SCRYPT = { N: 16384, r: 8, p: 1 };
function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const h = crypto.scryptSync(String(pw), salt, 64, SCRYPT);
  return `scrypt$${salt.toString("base64")}$${h.toString("base64")}`;
}
function verifyPassword(pw, stored) {
  const [alg, s, h] = String(stored || "").split("$");
  if (alg !== "scrypt" || !s || !h) return false;
  const want = Buffer.from(h, "base64");
  const got = crypto.scryptSync(String(pw), Buffer.from(s, "base64"), want.length, SCRYPT);
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}
function passwordProblem(pw) {
  pw = String(pw || "");
  if (pw.length < 8) return "รหัสผ่านต้องยาวอย่างน้อย 8 ตัวอักษร";
  if (pw.length > 128) return "รหัสผ่านยาวเกินไป";
  if (!/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw)) return "รหัสผ่านต้องมีทั้งตัวอักษรและตัวเลข";
  return null;
}
// random password from an unambiguous alphabet (for gateways and password resets)
function randomPassword(len = 16) {
  const abc = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  const bytes = crypto.randomBytes(len);
  let s = "";
  for (const b of bytes) s += abc[b % abc.length];
  return s;
}
const randomHex = n => crypto.randomBytes(n).toString("hex");
// a free username like "farm2.coop3" when the person adding someone leaves the username empty
function nextUsername(prefix, taken) {
  const used = new Set(taken);
  for (let n = 1; n < 10000; n++) if (!used.has(prefix + n)) return prefix + n;
  throw new Error("no free username");
}
const USERNAME_PREFIX = { admin: "admin", keeper: "keeper", coop_keeper: "coop", viewer: "viewer" };
const usernamePrefix = (role, farmId) => role === "admin" ? "admin" : "farm" + farmId + "." + (USERNAME_PREFIX[role] || "user");

// ---------------------------------------------------------------- signed session tokens (HMAC-SHA256)
const TOKEN_TTL = 12 * 3600;
function secret() {
  const s = env("SESSION_SECRET");
  if (s.length < 32) throw new Error("SESSION_SECRET in .env must be at least 32 characters (run ./start.sh)");
  return s;
}
const sign = body => crypto.createHmac("sha256", secret()).update(body).digest("base64url");
// type: undefined = login session · "mfa" = 5-minute ticket between the password and the 2-step code
function signToken(user, ttl = TOKEN_TTL, type) {
  const body = Buffer.from(JSON.stringify({ uid: user.id, sv: user.session_version || 0, exp: Math.floor(Date.now() / 1000) + ttl,
    ...(type ? { t: type } : {}) })).toString("base64url");
  return body + "." + sign(body);
}
// -> {uid, sv, exp} or null (bad signature, garbage, expired, or a token of another type)
function verifyToken(token, type) {
  if (typeof token !== "string" || token.length > 512) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const want = Buffer.from(sign(body)), got = Buffer.from(sig);
  if (want.length !== got.length || !crypto.timingSafeEqual(want, got)) return null;
  let p;
  try { p = JSON.parse(Buffer.from(body, "base64url").toString()); } catch { return null; }
  if (!p || !Number.isInteger(p.uid) || !p.exp || p.exp * 1000 < Date.now()) return null;
  if ((p.t || null) !== (type || null)) return null;       // an mfa ticket is never a session, and the other way round
  return p;
}
const bearer = req => {
  const h = (req && req.headers && req.headers.authorization) || "";
  return h.startsWith("Bearer ") ? h.slice(7) : null;
};

// ---------------------------------------------------------------- 2-step login (TOTP, RFC 6238: Google/Microsoft Authenticator)
// The secret is stored encrypted (AES-256-GCM, key derived from SESSION_SECRET); backup codes only as HMACs.
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
function base32(buf) {
  let bits = 0, val = 0, out = "";
  for (const b of buf) { val = (val << 8) | b; bits += 8; while (bits >= 5) { out += B32[(val >>> (bits - 5)) & 31]; bits -= 5; } }
  if (bits > 0) out += B32[(val << (5 - bits)) & 31];
  return out;
}
function unbase32(str) {
  let bits = 0, val = 0; const out = [];
  for (const ch of String(str).toUpperCase().replace(/[^A-Z2-7]/g, "")) { val = (val << 5) | B32.indexOf(ch); bits += 5; if (bits >= 8) { out.push((val >>> (bits - 8)) & 255); bits -= 8; } }
  return Buffer.from(out);
}
const newTotpSecret = () => base32(crypto.randomBytes(20));
function totpAt(secretB32, step) {
  const msg = Buffer.alloc(8); msg.writeBigUInt64BE(BigInt(step));
  const h = crypto.createHmac("sha1", unbase32(secretB32)).update(msg).digest();
  const o = h[h.length - 1] & 15;
  return String(((h.readUInt32BE(o) & 0x7fffffff) % 1000000)).padStart(6, "0");
}
const totpStep = (t = Date.now()) => Math.floor(t / 30000);
// -> the accepted time step, or null. ±1 step for clock drift; a step at or before lastStep is refused (no code reuse)
function verifyTotp(secretB32, code, lastStep) {
  code = String(code || "").replace(/\s/g, "");
  if (!/^[0-9]{6}$/.test(code)) return null;
  const now = totpStep();
  for (const s of [now - 1, now, now + 1]) {
    if (lastStep != null && s <= Number(lastStep)) continue;
    const want = Buffer.from(totpAt(secretB32, s)), got = Buffer.from(code);
    if (crypto.timingSafeEqual(want, got)) return s;
  }
  return null;
}
const mfaKey = () => crypto.createHash("sha256").update("scf-totp|" + secret()).digest();
function sealSecret(plain) {
  const iv = crypto.randomBytes(12), c = crypto.createCipheriv("aes-256-gcm", mfaKey(), iv);
  const enc = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return "v1." + Buffer.concat([iv, c.getAuthTag(), enc]).toString("base64url");
}
function openSecret(sealed) {
  try {
    const raw = Buffer.from(String(sealed).replace(/^v1\./, ""), "base64url");
    const d = crypto.createDecipheriv("aes-256-gcm", mfaKey(), raw.subarray(0, 12));
    d.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString("utf8");
  } catch { return null; }
}
const otpauthUrl = (username, secretB32) => "otpauth://totp/" + encodeURIComponent("Smart Chicken Farm:" + username) +
  "?secret=" + secretB32 + "&issuer=" + encodeURIComponent("Smart Chicken Farm") + "&digits=6&period=30";
const normBackup = c => String(c || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const hashBackup = c => crypto.createHmac("sha256", mfaKey()).update(normBackup(c)).digest("hex");
// 8 one-time backup codes "ABCD-EFGH" (for a lost phone): shown once, kept only as HMACs
function newBackupCodes() {
  const abc = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789", codes = [];
  for (let i = 0; i < 8; i++) { const b = crypto.randomBytes(8); let s = ""; for (const x of b) s += abc[x % abc.length]; codes.push(s.slice(0, 4) + "-" + s.slice(4)); }
  return { codes, hashes: codes.map(hashBackup) };
}
// roles that must use the 2-step login (MFA_REQUIRED_ROLES in .env, default admin + farm keeper; empty = optional for all)
const mfaRequiredRoles = () => { const v = process.env.MFA_REQUIRED_ROLES; return (v == null ? "admin,keeper" : v).split(",").map(x => x.trim()).filter(Boolean); };
const mfaRequired = user => !!user && mfaRequiredRoles().includes(user.role);

// ---------------------------------------------------------------- roles and permissions
// One table for the whole system. The web uses the same names to hide buttons, but Node-RED decides.
// Many farms, many coops per farm. Everyone except the admin belongs to exactly ONE farm.
//   admin        every farm
//   keeper       ผู้ดูแลฟาร์ม: the whole farm + its coop keepers (add / edit / delete)
//   coop_keeper  ผู้ดูแลโรงเรือน: only the coops given to him/her (user.coop_ids), never the rest of the farm
//   viewer       sees the whole farm, changes nothing
const ROLES = {
  admin:       { level: 4, label: "ผู้ดูแลระบบ" },
  keeper:      { level: 3, label: "ผู้ดูแลฟาร์ม" },
  coop_keeper: { level: 2, label: "ผู้ดูแลโรงเรือน" },
  viewer:      { level: 1, label: "ผู้ดู" },
};
const PERMS = {
  view: 1,           // see dashboards, history, alerts
  light: 2,          // switch lights
  daily_log: 2,      // daily record (deaths, feed, weight)
  coop_settings: 2,  // light schedule
  flock: 2,          // start / end a flock
  light_all: 3,      // switch off every light of the farm at once
  coop_manage: 3,    // add / edit coops of the farm
  staff_manage: 3,   // add / edit / delete the coop keepers of the farm
  coop_delete: 4,    // delete a coop with its history
  users_manage: 4,   // every account of every farm
  audit_view: 4,
  farm_manage: 4,    // add / edit farms
  gateway_manage: 4, // add gateways, MQTT passwords
};
const coopIdsOf = user => (user && Array.isArray(user.coop_ids) ? user.coop_ids.map(Number) : []);
// May this user do `perm` in farm `farmId` (and coop `coopId`, when the action is about one coop)?
// admin: every farm · everyone else: only their own single farm · coop keeper: only his/her own coops
function can(user, perm, farmId, coopId) {
  if (!user || !user.active || !ROLES[user.role] || !(perm in PERMS)) return false;
  if (ROLES[user.role].level < PERMS[perm]) return false;
  if (user.role === "admin") return true;
  if (farmId == null || Number(farmId) !== Number(user.farm_id)) return false;
  if (user.role === "coop_keeper" && coopId != null && !coopIdsOf(user).includes(Number(coopId))) return false;
  return true;
}
const seesFarm = (user, farmId) => !!user && (user.role === "admin" || Number(farmId) === Number(user.farm_id));
// a coop keeper only ever sees his/her own coops; everyone else sees every coop of the farm(s) they see
const seesCoop = (user, coop) => !!coop && seesFarm(user, coop.farm_id) &&
  (user.role !== "coop_keeper" || coopIdsOf(user).includes(Number(coop.id)));
const permsOf = user => Object.keys(PERMS).filter(p => user && ROLES[user.role] && ROLES[user.role].level >= PERMS[p]);
const publicUser = u => u && ({ id: u.id, username: u.username, display_name: u.display_name, role: u.role,
  role_label: ROLES[u.role] ? ROLES[u.role].label : u.role, farm_id: u.farm_id || null, active: u.active,
  coop_ids: u.role === "coop_keeper" ? coopIdsOf(u) : undefined,
  mfa: !!u.totp_enabled, mfa_required: mfaRequired(u),
  last_login: u.last_login || null, locked: !!(u.locked_until && Date.parse(u.locked_until) > Date.now()) });

// ---------------------------------------------------------------- MQTT accounts (Mosquitto password file)
// Node-RED never writes the password file itself: it queues "add <user> <password>" / "del <user>"
// and the Mosquitto container applies it with the official mosquitto_passwd, then reloads.
const MQTT_USER_RE = /^gw[a-z0-9-]{1,30}$/;
function mqttAccount(op, user, password) {
  if (!MQTT_USER_RE.test(user)) throw new Error("bad MQTT username");
  if (op === "add" && !/^[A-Za-z0-9]{12,64}$/.test(password || "")) throw new Error("bad MQTT password");
  const file = env("MQTT_QUEUE_FILE") || "/mqtt-auth/queue";
  fs.appendFileSync(file, op === "add" ? `add ${user} ${password}\n` : `del ${user}\n`);
}

// ---------------------------------------------------------------- board kit (web > ตั้งค่าบอร์ด)
// The Arduino sources the web packs into a ready-to-flash zip (secrets are added per board by the web).
// docker-compose.yml mounts ./firmware read-only at /firmware; only these three files are ever read.
function firmwareSources() {
  const dir = env("FIRMWARE_DIR") || "/firmware";
  const read = f => fs.readFileSync(dir + "/" + f, "utf8");
  return { gateway_ino: read("gateway/gateway.ino"), node_ino: read("node/node.ino"), packet_h: read("gateway/scf_packet.h") };
}
const FARM_KEY_RE = /^[0-9a-f]{32}$/;

// ---------------------------------------------------------------- HTTP helpers
function reply(msg, code, body) {
  msg.statusCode = code;
  msg.headers = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
  msg.payload = JSON.stringify(body === undefined ? { ok: true } : body);
  return msg;
}
// turn a database/validation error into a safe message for the web
function errorReply(msg, e) {
  if (e && e.http) return reply(msg, e.http, { error: e.message });
  const code = e && e.code;
  if (code === "23505") return reply(msg, 409, { error: "ข้อมูลซ้ำกับที่มีอยู่แล้ว (ชื่อผู้ใช้ หรือหมายเลขโหนดซ้ำ)" });
  if (code === "23503") return reply(msg, 409, { error: "ข้อมูลที่อ้างถึงถูกลบไปแล้ว ลองรีเฟรชหน้า" });
  if (code === "23514" || code === "23502" || code === "22P02") return reply(msg, 400, { error: "ข้อมูลไม่ถูกต้อง" });
  return reply(msg, 502, { error: "ฐานข้อมูลไม่ตอบ ลองใหม่อีกครั้ง" });
}
// throw fail(400, "...") inside a flow -> errorReply sends it as is
const fail = (http, message) => Object.assign(new Error(message), { http });

module.exports = {
  db, int, inList,
  hashPassword, verifyPassword, passwordProblem, randomPassword, randomHex, nextUsername, usernamePrefix,
  signToken, verifyToken, bearer, TOKEN_TTL,
  newTotpSecret, totpAt, totpStep, verifyTotp, sealSecret, openSecret, otpauthUrl, newBackupCodes, hashBackup, mfaRequired,
  ROLES, PERMS, can, seesFarm, seesCoop, coopIdsOf, permsOf, publicUser,
  mqttAccount, MQTT_USER_RE, firmwareSources, FARM_KEY_RE,
  reply, errorReply, fail,
  _setTransport: fn => { transport = fn; },   // tests only
};
