// Node-RED settings for Smart Chicken Farm (only what differs from the defaults).
const crypto = require("crypto");

// The Node-RED editor can change every rule of the system, so it has its own password (NR_EDITOR_PASSWORD in .env).
// No password set = nobody can open the editor.
const EDITOR_PASSWORD = process.env.NR_EDITOR_PASSWORD || "";
const same = (a, b) => crypto.timingSafeEqual(crypto.createHash("sha256").update(String(a)).digest(),
                                              crypto.createHash("sha256").update(String(b)).digest());
const editorUser = { username: "admin", permissions: "*" };

module.exports = {
  flowFile: "flows.json",
  flowFilePretty: true,
  credentialSecret: false,          // MQTT credentials come from flows_cred.json written by start.sh

  uiPort: process.env.PORT || 1880,
  httpAdminRoot: "/admin",          // editor:     http://<server>:1880/admin   (user: admin)
  httpNodeRoot: "/",                // API:        /auth/login, /api/*, /ws/live, /health
  httpStatic: process.env.WEB_DIR || "/web",   // web app:    http://<server>:1880/

  adminAuth: {
    type: "credentials",
    users: async username => (username === "admin" && EDITOR_PASSWORD.length >= 8 ? editorUser : null),
    authenticate: async (username, password) =>
      (username === "admin" && EDITOR_PASSWORD.length >= 8 && same(password, EDITOR_PASSWORD) ? editorUser : null),
  },

  // available in function nodes as global.get("scf"): database, passwords, tokens, permissions
  functionGlobalContext: { scf: require("./lib/scf.js") },

  logging: { console: { level: "info", metrics: false, audit: false } },
  editorTheme: { projects: { enabled: false }, tours: false },
};
