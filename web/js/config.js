// All settings of the web app in one place. No keys or passwords here: the page only talks to Node-RED,
// which checks the login and the user's rights on every request.

export const API_BASE = "";                       // same server as the page (Node-RED)
export const WS_URL = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws/live`;

export const ONLINE_MS = 30000;       // no reading for 30 s -> coop shown offline
export const ACK_TIMEOUT_MS = 8000;   // light command not confirmed by the node within this -> error
export const MAX_POINTS = 1000;       // the API returns at most 1000 rows

// Default comfort range when a coop has no flock (with a flock, Node-RED sets it from the birds' age).
export const LIMITS = { TEMP_MIN: 18, TEMP_MAX: 30, HUM_MIN: 50, HUM_MAX: 70 };

// Many farms. Everyone except the admin belongs to exactly one farm; a coop keeper only to some coops of it.
export const ROLES = {
  admin: { label: "ผู้ดูแลระบบ", hint: "ทุกฟาร์ม · เพิ่มฟาร์ม gateway ผู้ใช้ และลบโรงเรือน" },
  keeper: { label: "ผู้ดูแลฟาร์ม", hint: "1 ฟาร์ม · ทุกโรงเรือน · ปิดไฟทั้งฟาร์ม เพิ่ม/แก้โรงเรือน · เพิ่ม/แก้/ลบผู้ดูแลโรงเรือน" },
  coop_keeper: { label: "ผู้ดูแลโรงเรือน", hint: "เฉพาะโรงเรือนที่ได้รับมอบหมาย · สั่งไฟ ตั้งเวลาไฟ รุ่นไก่ บันทึกประจำวัน" },
  viewer: { label: "ผู้ดู", hint: "1 ฟาร์ม · ดูอย่างเดียว" },
};
