#!/bin/sh
# Mosquitto with accounts that Node-RED can manage at runtime.
#   - Node-RED never touches the password file: it appends "add <user> <password>" / "del <user>"
#     to the queue file; this script applies it with the official mosquitto_passwd and reloads Mosquitto.
#   - Only gateway accounts (gw...) can be changed through the queue, never "nodered".
A=/mosquitto/auth
mkdir -p "$A" /mosquitto/data
touch "$A/passwd" "$A/queue"
chmod 0666 "$A/queue"      # Node-RED (other container) may append
chmod 0700 "$A/passwd"

setpw() { mosquitto_passwd -b "$A/passwd" "$1" "$2"; }

# Node-RED's own account: always the password from .env
[ -n "$MQTT_NODERED_PASSWORD" ] && setpw nodered "$MQTT_NODERED_PASSWORD"
# The first gateway (gw1): password from .env only if it has none yet (later resets come from the web)
if [ -n "$MQTT_GW1_PASSWORD" ] && ! grep -q '^gw1:' "$A/passwd"; then setpw gw1 "$MQTT_GW1_PASSWORD"; fi

process_queue() {
  [ -s "$A/queue" ] || return 1
  cp "$A/queue" "$A/queue.work" && : > "$A/queue"
  while read -r op user pass; do
    case "$user" in gw[a-z0-9]*) ;; *) echo "mqtt-auth: ignored request for '$user'"; continue ;; esac
    case "$op" in
      add) setpw "$user" "$pass" && echo "mqtt-auth: password set for $user" ;;
      del) mosquitto_passwd -D "$A/passwd" "$user" 2>/dev/null; echo "mqtt-auth: removed $user" ;;
    esac
  done < "$A/queue.work"
  rm -f "$A/queue.work"
  return 0
}
process_queue
chown -R mosquitto:mosquitto /mosquitto/data "$A/passwd" 2>/dev/null

/usr/sbin/mosquitto -c /mosquitto/config/mosquitto.conf &
PID=$!
trap 'kill -TERM $PID 2>/dev/null; wait $PID; exit 0' TERM INT
while kill -0 "$PID" 2>/dev/null; do
  sleep 2
  if process_queue; then
    chown mosquitto:mosquitto "$A/passwd" 2>/dev/null
    kill -HUP "$PID"          # reload password file without dropping connections
  fi
done
wait "$PID"
