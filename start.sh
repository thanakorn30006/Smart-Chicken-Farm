#!/bin/bash
# Smart Chicken Farm: prepare everything and start the server with one command.
#   ./start.sh          real boards
#   ./start.sh demo     no boards: Node-RED simulates every registered coop
#   ./stop.sh           stop
set -u
cd "$(dirname "$0")"

G='\033[32m'; Y='\033[33m'; R='\033[31m'; B='\033[1m'; N='\033[0m'
ok()   { printf "${G}✔${N} %s\n" "$*"; }
warn() { printf "${Y}!${N} %s\n" "$*"; }
fail() { printf "${R}✘ %s${N}\n" "$*"; exit 1; }
step() { printf "\n${B}%s${N}\n" "$*"; }
sedi() { sed -i '' "$@" 2>/dev/null || sed -i "$@"; }                          # macOS + Linux
gen()  { LC_ALL=C tr -dc 'A-Za-z0-9' </dev/urandom | head -c "$1"; }
hex()  { LC_ALL=C tr -dc 'a-f0-9' </dev/urandom | head -c "$1"; }
get_env() { grep -E "^$1=" .env 2>/dev/null | head -1 | cut -d= -f2-; }
set_env() { if grep -qE "^$1=" .env; then sedi "s|^$1=.*|$1=$2|" .env; else printf '%s=%s\n' "$1" "$2" >> .env; fi; }
MODE="${1:-real}"
FIRST_ADMIN=""

# ------------------------------------------------------------------ 1. Docker
step "1/7 ตรวจ Docker"
command -v docker >/dev/null || fail "ไม่พบ Docker: ติดตั้ง Docker Desktop ก่อน (https://www.docker.com/products/docker-desktop/)"
if ! docker info >/dev/null 2>&1; then
  warn "Docker ยังไม่เปิด กำลังเปิด Docker Desktop..."
  open -a Docker 2>/dev/null
  for i in $(seq 1 60); do docker info >/dev/null 2>&1 && break; sleep 2; done
  docker info >/dev/null 2>&1 || fail "เปิด Docker ไม่สำเร็จ: เปิด Docker Desktop เองแล้วรัน ./start.sh ใหม่"
fi
ok "Docker พร้อม"

# ------------------------------------------------------------------ 2. secrets in .env
step "2/7 กุญแจและรหัสผ่านของระบบ (.env)"
[ -f .env ] || cp .env.example .env
chmod 600 .env 2>/dev/null
KEY=$(get_env SUPABASE_KEY)
case "$KEY" in
  ""|*PUT_YOUR*)
    echo "ต้องใช้ Secret key ของ Supabase (เก็บไว้ในเครื่องนี้เท่านั้น)"
    echo "Supabase > Project Settings > API Keys > Secret keys > คัดลอก (sb_secret_...)"
    printf "วาง Secret key แล้วกด Enter (ตัวอักษรจะไม่แสดง): "
    read -rs KEY; echo
    KEY=$(printf %s "$KEY" | tr -d '[:space:]')
    [ -n "$KEY" ] || fail "ไม่ได้ใส่ key"
    set_env SUPABASE_KEY "$KEY" ;;
esac
case "$KEY" in sb_publishable_*) fail "นี่คือ publishable key: ต้องใช้ Secret key (sb_secret_...)";; esac
[ -n "$(get_env SUPABASE_URL)" ] || set_env SUPABASE_URL "https://qagcsesgiixpbyawonuu.supabase.co"
NEW=0
SS=$(get_env SESSION_SECRET); [ ${#SS} -ge 32 ] || { set_env SESSION_SECRET "$(gen 48)"; NEW=1; }
[ -n "$(get_env MQTT_NODERED_PASSWORD)" ] || { set_env MQTT_NODERED_PASSWORD "$(gen 24)"; NEW=1; }
[ -n "$(get_env MQTT_GW1_PASSWORD)" ]     || { set_env MQTT_GW1_PASSWORD "$(gen 20)"; NEW=1; }
[ -n "$(get_env NR_EDITOR_PASSWORD)" ]    || { set_env NR_EDITOR_PASSWORD "$(gen 16)"; NEW=1; }
[ -n "$(get_env FARM_KEY)" ]              || { set_env FARM_KEY "$(hex 32)"; NEW=1; }
if [ -z "$(get_env ADMIN_PASSWORD)" ]; then set_env ADMIN_PASSWORD "$(gen 10)a7"; FIRST_ADMIN=1; NEW=1; fi
for k in TEMP_MIN:18 TEMP_MAX:30 HUM_MIN:50 HUM_MAX:70; do [ -n "$(get_env ${k%%:*})" ] || set_env "${k%%:*}" "${k##*:}"; done
[ $NEW = 1 ] && ok "สร้างกุญแจ/รหัสผ่านที่ยังไม่มีให้แล้ว (สุ่มใหม่ เก็บใน .env)" || ok "มีครบแล้ว"

# Node-RED's MQTT login (plain JSON: credentialSecret is off, the file stays on this machine)
printf '{\n    "scf_broker": {\n        "user": "nodered",\n        "password": "%s"\n    }\n}\n' "$(get_env MQTT_NODERED_PASSWORD)" > node-red/flows_cred.json
chmod 600 node-red/flows_cred.json 2>/dev/null

# ------------------------------------------------------------------ 3. firmware secrets.h (first farm, gw1)
step "3/7 ค่าสำหรับบอร์ด ESP32 (firmware/*/secrets.h)"
IP=""
for IF in en0 en1 en2 bridge100; do IP=$(ipconfig getifaddr "$IF" 2>/dev/null) && [ -n "$IP" ] && break; done
[ -n "$IP" ] || IP=$(hostname -I 2>/dev/null | awk '{print $1}')
GWS=firmware/gateway/secrets.h; NDS=firmware/node/secrets.h
# fresh clone from git: secrets.h is not in git (it holds passwords), start from the example
[ -f "$GWS" ] || cp firmware/gateway/secrets.example.h "$GWS"
[ -f "$NDS" ] || cp firmware/node/secrets.example.h "$NDS"
[ -n "$IP" ] && set_env SERVER_IP "$IP"     # the web shows http://<this IP>:1880 in the login it hands out
if [ -n "$IP" ]; then sedi "s|^#define MQTT_HOST \"[^\"]*\"|#define MQTT_HOST \"$IP\"|" "$GWS"; ok "IP เครื่องนี้ = $IP (ใส่ใน gateway แล้ว)"; else warn "หา IP ไม่เจอ: แก้ MQTT_HOST ใน $GWS เอง"; fi
if grep -q 'PUT_MQTT_PASSWORD_HERE' "$GWS" && grep -q '#define MQTT_USER "gw1"' "$GWS"; then
  sedi "s|PUT_MQTT_PASSWORD_HERE|$(get_env MQTT_GW1_PASSWORD)|" "$GWS"; ok "รหัส MQTT ของ gw1 ใส่ใน gateway แล้ว"
fi
for f in "$GWS" "$NDS"; do grep -q 'PUT_FARM_KEY_HERE' "$f" && sedi "s|PUT_FARM_KEY_HERE|$(get_env FARM_KEY)|" "$f"; done
GK=$(sed -n 's/^#define FARM_KEY *"\([^"]*\)".*/\1/p' "$GWS"); NK=$(sed -n 's/^#define FARM_KEY *"\([^"]*\)".*/\1/p' "$NDS")
[ "$GK" = "$NK" ] && ok "กุญแจฟาร์ม (FARM_KEY) ตรงกันทั้งตัวแม่และตัวลูก" || warn "FARM_KEY ใน gateway กับ node ไม่ตรงกัน: บอร์ดจะคุยกันไม่ได้"
if grep -q 'YOUR_WIFI_SSID' "$GWS"; then
  printf "ชื่อ Wi-Fi 2.4 GHz ที่บอร์ดจะใช้ (Enter = ข้าม): "; read -r WSSID
  if [ -n "$WSSID" ]; then ESC=$(printf %s "$WSSID" | sed 's/[\\"]/\\&/g' | sed 's/[\\|&]/\\&/g'); sedi "s|YOUR_WIFI_SSID|$ESC|" "$GWS" "$NDS"; fi
fi
if grep -q 'YOUR_WIFI_PASSWORD' "$GWS"; then
  SSID=$(sed -n 's/^#define WIFI_SSID *"\([^"]*\)".*/\1/p' "$GWS")
  printf "รหัส Wi-Fi \"%s\" สำหรับ gateway (Enter = ข้าม): " "$SSID"; read -r PASS
  if [ -n "$PASS" ]; then ESC=$(printf %s "$PASS" | sed 's/[\\"]/\\&/g' | sed 's/[\\|&]/\\&/g'); sedi "s|YOUR_WIFI_PASSWORD|$ESC|" "$GWS"; ok "ใส่รหัส Wi-Fi แล้ว"; fi
fi

# ------------------------------------------------------------------ 4. demo / real
step "4/7 โหมด"
SIM=true; [ "$MODE" = "demo" ] && SIM=false
perl -0pi -e 's/("id": "scf_tab_sim",\s*"type": "tab",\s*"label": "[^"]*",\s*"disabled": )(true|false)/${1}'"$SIM"'/' node-red/flows.json
[ "$MODE" = "demo" ] && warn "โหมดจำลอง: ไม่ต้องมีบอร์ด (อย่าเปิดบอร์ดจริงพร้อมกัน)" || ok "โหมดบอร์ดจริง"

# ------------------------------------------------------------------ 5. start
step "5/7 เปิด Mosquitto + Node-RED"
# A copy of this project in another folder (older version) owns containers with the same names and ports:
# `docker compose up` then stops with "container name is already in use" / "port is already allocated".
PROJECT=$(docker compose config 2>/dev/null | sed -n 's/^name: *//p' | head -1)
for C in scf-mosquitto scf-node-red; do
  OWNER=$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project"}}' "$C" 2>/dev/null) || continue
  if [ "$OWNER" != "$PROJECT" ]; then
    warn "พบ $C ของโฟลเดอร์อื่น (project \"$OWNER\") กำลังลบตัวเก่าออก (ข้อมูลใน Supabase ไม่หาย)"
    docker rm -f "$C" >/dev/null 2>&1
  fi
done
for PORT in 1880 1883; do
  for C in $(docker ps --filter "publish=$PORT" --format '{{.Names}}'); do
    case "$C" in scf-mosquitto|scf-node-red) continue;; esac
    warn "container \"$C\" ใช้พอร์ต $PORT อยู่ กำลังหยุดให้ (เปิดใหม่ได้ใน Docker Desktop)"
    docker stop "$C" >/dev/null 2>&1
  done
  if command -v lsof >/dev/null && lsof -nP -iTCP:$PORT -sTCP:LISTEN 2>/dev/null | awk 'NR>1 && $1 !~ /^com\.docke|^docker|^vpnkit/' | grep -q .; then
    lsof -nP -iTCP:$PORT -sTCP:LISTEN | awk 'NR>1 {print "    " $1 " (pid " $2 ")"}' | sort -u
    fail "พอร์ต $PORT ถูกโปรแกรมอื่นในเครื่องใช้อยู่ (เช่น Node-RED หรือ Mosquitto ที่ติดตั้งเอง) ปิดโปรแกรมนั้นก่อนแล้วรันใหม่"
  fi
done
docker compose up -d --force-recreate --remove-orphans || fail "docker compose up ไม่สำเร็จ ดูข้อความด้านบน หรือ: docker compose logs"
# a container that keeps restarting = configuration problem: show why right away
sleep 6
for C in scf-mosquitto scf-node-red; do
  ST=$(docker inspect -f '{{.State.Status}} {{.RestartCount}}' "$C" 2>/dev/null)
  case "$ST" in
    "running 0") ;;
    *) warn "$C ทำงานไม่ปกติ ($ST) · log ล่าสุด:"; docker logs --tail 25 "$C" 2>&1 | sed 's/^/    /';;
  esac
done
ok "container ทำงานแล้ว"

# ------------------------------------------------------------------ 6. checks
step "6/7 ตรวจระบบ"
CODE=000
for i in $(seq 1 45); do CODE=$(curl -s -o /dev/null -w '%{http_code}' http://localhost:1880/health); [ "$CODE" = 200 ] && break; sleep 2; done
if [ "$CODE" = 200 ]; then ok "Node-RED + Supabase พร้อม (โหลดข้อมูลฟาร์มได้)"
else
  warn "Node-RED ยังโหลดข้อมูลฟาร์มไม่ได้ (HTTP $CODE)"
  docker logs --tail 30 scf-node-red 2>&1 | sed 's/^/    /'
  warn "เช็ก: รัน supabase/setup.sql (ไฟล์ล่าสุด v3.3) ใน Supabase แล้วหรือยัง / SUPABASE_KEY ใน .env ถูกไหม"
fi
CODE=$(curl -s -o /dev/null -w '%{http_code}' http://localhost:1880/api/me)
[ "$CODE" = 401 ] && ok "API ปฏิเสธคำขอที่ไม่ได้ login (401)" || warn "API ตอบ $CODE กับคำขอที่ไม่ได้ login"
if docker exec scf-mosquitto mosquitto_pub -h localhost -t scf/selftest -m x >/dev/null 2>&1; then warn "broker ยอมให้ต่อโดยไม่มีรหัส!"
else ok "broker ปฏิเสธการเชื่อมต่อที่ไม่มีรหัส"; fi
if docker exec scf-mosquitto mosquitto_pub -h localhost -u nodered -P "$(get_env MQTT_NODERED_PASSWORD)" -t scf/selftest -m ok >/dev/null 2>&1; then ok "Node-RED เข้า broker ด้วยรหัสของตัวเองได้"
else warn "บัญชี MQTT ของ Node-RED ใช้ไม่ได้: docker compose logs mosquitto"; fi

# ------------------------------------------------------------------ 7. summary
step "7/7 พร้อมใช้งาน"
echo "  เว็บ              http://localhost:1880"
[ -n "$IP" ] && echo "  จากมือถือ         http://$IP:1880   (ต่อ Wi-Fi เดียวกัน)"
echo "  Node-RED editor   http://localhost:1880/admin   ผู้ใช้ admin / $(get_env NR_EDITOR_PASSWORD)"
if [ -n "$FIRST_ADMIN" ]; then
  printf "  ${B}บัญชีเว็บแรก      admin / %s${N}   (เข้าแล้วเปลี่ยนรหัสที่เมนูบัญชีของฉัน)\n" "$(get_env ADMIN_PASSWORD)"
else
  echo "  บัญชีเว็บ          ใช้บัญชีเดิม (admin แรกใช้รหัส ADMIN_PASSWORD ใน .env ถ้ายังไม่เคยเปลี่ยน)"
fi
[ "$MODE" = "demo" ] || echo "  แฟลชบอร์ด         firmware/gateway (library PubSubClient) + firmware/node (NODE_ID 1,2,3...) ทุกบอร์ดต้องแฟลชใหม่"
open http://localhost:1880 2>/dev/null || true
