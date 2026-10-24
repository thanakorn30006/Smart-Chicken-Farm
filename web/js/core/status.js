import { LIMITS } from "../config.js";

// Comfort range of a house: from its flock's age (computed by Node-RED, farm/config) or the default.
export const defaultTarget = () => ({ temp_min: LIMITS.TEMP_MIN, temp_max: LIMITS.TEMP_MAX,
  hum_min: LIMITS.HUM_MIN, hum_max: LIMITS.HUM_MAX, temp_ideal: null, by_age: false });

// [css class, icon, meaning] for one reading against a target range.
export function status(r, online = true, t = defaultTarget()) {
  if (!online) return ["off", "wifiOff", "ขาดการติดต่อ"];
  if (r.temp == null) return ["off", "wifiOff", "ยังไม่มีข้อมูล"];
  if (r.temp > t.temp_max) return ["hot", "flame", `ร้อนเกินไป (ควร ≤ ${t.temp_max} °C)`];
  if (r.temp < t.temp_min) return ["cold", "snow", `หนาวเกินไป (ควร ≥ ${t.temp_min} °C)`];
  if (r.humidity > t.hum_max) return ["wet", "wet", `ชื้นเกินไป (ควร ≤ ${t.hum_max} %)`];
  if (r.humidity < t.hum_min) return ["dry", "dry", `แห้งเกินไป (ควร ≥ ${t.hum_min} %)`];
  return ["ok", "check", "อยู่ในเกณฑ์"];
}

export const LEVEL = {
  hot: ["hot", "flame", "ร้อน"], cold: ["cold", "snow", "หนาว"], wet: ["wet", "wet", "ชื้น"],
  dry: ["dry", "dry", "แห้ง"], offline: ["off", "wifiOff", "ขาดการติดต่อ"], ok: ["ok", "check", "กลับสู่ปกติ"],
  unknown: ["hot", "chip", "อุปกรณ์แปลกปลอม"], security: ["hot", "shield", "ความปลอดภัย"],
};
