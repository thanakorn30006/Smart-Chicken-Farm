// Who is logged in. The token is signed by Node-RED; this file only keeps it and the user's display data.
// The rights listed here only decide which buttons to show: Node-RED checks every request again.
const KEY = "scf.session", FARM = "scf.farm";
const read = (k, d = null) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const write = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } };

let state = read(KEY);   // {token, user:{id, username, display_name, role, role_label, farm_id, perms}}

export const session = {
  get token() { return state && state.token; },
  get user() { return state && state.user; },
  get loggedIn() { return !!(state && state.token); },
  save(token, user) { state = { token, user }; write(KEY, state); },
  setToken(token) { if (state) { state.token = token; write(KEY, state); } },
  updateUser(user) { if (state) { state.user = Object.assign({}, state.user, user); write(KEY, state); } },
  can: perm => !!(state && state.user && state.user.perms && state.user.perms.includes(perm)),
  get isAdmin() { return !!(state && state.user && state.user.role === "admin"); },

  // the farm on screen: always the user's own farm, admins can switch
  get farmId() { return this.isAdmin ? read(FARM) : (state && state.user && state.user.farm_id); },
  setFarm(id) { write(FARM, id); },

  clear() { state = null; write(KEY, null); },
  // send to the login page and come back here afterwards
  toLogin(reason = "") {
    const back = location.pathname.endsWith("login.html") ? "" : location.pathname.split("/").pop() + location.search;
    location.replace("login.html" + (back || reason ? "?" : "") + new URLSearchParams({ ...(back ? { next: back } : {}), ...(reason ? { r: reason } : {}) }));
  },
  logout(reason) { this.clear(); this.toLogin(reason); },
  requireLogin() { if (!this.loggedIn) { this.toLogin(); return false; } return true; },
};
