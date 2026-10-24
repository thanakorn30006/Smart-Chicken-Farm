#!/bin/bash
# ปิด Mosquitto + Node-RED (ข้อมูลใน Supabase และสถานะไฟที่ retained ยังอยู่)
cd "$(dirname "$0")" && docker compose down && echo "ปิดระบบแล้ว"
