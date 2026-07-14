# วิธีเชื่อม WMS เข้ากับ Cloudflare (Tunnel + Access)

บันทึกขั้นตอนการ deploy WMS ให้เข้าใช้งานได้จากทุกที่แบบ **private** ผ่าน Cloudflare
โดเมนที่ใช้: `wms-icreativesystems.com` · เครื่อง server: Windows (รัน WMS + cloudflared)

---

## ภาพรวมสถาปัตยกรรม

```
พนักงาน (มือถือ/คอม จากที่ไหนก็ได้)
      │  เปิด https://wms-icreativesystems.com
      ▼
Cloudflare  ──►  ด่านล็อกอิน Access (ยืนยันอีเมล + OTP)
      │  ส่งผ่าน "อุโมงค์" (Tunnel)
      ▼
cloudflared (โปรแกรมบนเครื่อง server — เป็น Windows Service)
      │
      ▼
WMS Backend ที่ http://localhost:5000 (รันด้วย pm2)
      └─ เสิร์ฟทั้งหน้าเว็บ (dist/) และ API
```

**หลักการ:** cloudflared เปิดการเชื่อมต่อ *ออกไปหา* Cloudflare (ไม่ต้องเปิดพอร์ตเราเตอร์)
Cloudflare รับ request จากอินเทอร์เน็ตแล้วส่งย้อนกลับมาที่ WMS ผ่านอุโมงค์

---

## สิ่งที่ต้องมีก่อน
- บัญชี Cloudflare (ฟรี)
- โดเมนที่ผูก nameserver มาที่ Cloudflare แล้ว (`wms-icreativesystems.com`)
- เครื่อง server ที่เปิด 24 ชม. + ติดตั้ง Node.js

---

## ขั้นที่ 1 — เตรียม WMS Backend

```powershell
cd C:\Users\Lenovo\Documents\Personal_Projects\WMS_ICS
npm run build          # สร้างหน้าเว็บลง dist/ (Express เสิร์ฟจากตรงนี้)
cd server
npm run create-admin   # ตั้งรหัส admin ตามค่าใน .env
npm run start          # ต้องเห็น "Serving built frontend from dist/" + "port 5000"
```
ทดสอบ: เปิด `http://localhost:5000` ในเครื่อง server ต้องเห็นหน้า login

---

## ขั้นที่ 2 — ติดตั้ง cloudflared

```powershell
winget install --id Cloudflare.cloudflared
```
ปิด-เปิด PowerShell ใหม่ แล้วเช็ค: `cloudflared --version` (ต้องขึ้นเลขเวอร์ชัน)

---

## ขั้นที่ 3 — สร้าง Tunnel (ผ่าน Zero Trust Dashboard)

1. เข้า `https://one.dash.cloudflare.com` (ครั้งแรกตั้ง Team name + เลือกแผน Free)
2. **Networks → Tunnels → Create a tunnel** → เลือก **Cloudflared** → ตั้งชื่อ `wms`
3. เลือก **Windows (64-bit)** → คัดลอกคำสั่ง `cloudflared.exe service install <TOKEN>`
4. เปิด **PowerShell as Administrator** ที่เครื่อง server → วางคำสั่งรัน
   → cloudflared ติดตั้งเป็น **Windows Service** (รันเองตลอด)
5. รอสถานะ tunnel เป็น **Healthy / Connected** 🟢

> Token ของ tunnel เป็นความลับ — ถ้าหลุดให้กด **Rotate token** ในหน้า tunnel

---

## ขั้นที่ 4 — ผูกโดเมน (Public Hostname / Route)

ในหน้า tunnel `wms` → แท็บ **Routes** → **+ Add route** → เลือก **Published application**

| ช่อง | ค่า |
|---|---|
| Subdomain | *(เว้นว่าง)* |
| Domain | `wms-icreativesystems.com` |
| Type | **HTTP** |
| URL | `localhost:5000` |

> ⚠️ **สำคัญ:** ต้องเป็น `http` ไม่ใช่ `https` — เพราะ WMS ภายในเครื่องเป็น http
> (ถ้าตั้งเป็น https จะขึ้น **502 Bad Gateway**) ส่วน https ที่ผู้ใช้เห็นภายนอก Cloudflare จัดการให้เอง

หลังบันทึก รอ 1-2 นาที → เปิด `https://wms-icreativesystems.com` ควรเห็นหน้า WMS

---

## ขั้นที่ 5 — ตั้ง FRONTEND_URL

แก้ไฟล์ `server/.env`:
```
FRONTEND_URL=https://wms-icreativesystems.com
```
แล้ว restart: `pm2 restart wms` (หรือ `npm run start` ใหม่)

> จำเป็นสำหรับ: ลิงก์ reset password ในอีเมล, กล้องสแกน, ปุ่มติดตั้ง PWA
> (รองรับหลาย URL คั่นด้วยจุลภาค เช่น LAN + tunnel พร้อมกัน)

---

## ขั้นที่ 6 — ตั้งด่านล็อกอิน Access (ทำให้ private)

1. Zero Trust → **Access → Applications → Add an application → Self-hosted**
2. เลือกชนิด **Public DNS** → กรอก Destination = `wms-icreativesystems.com`
3. **Policy:**
   - Name: `พนักงาน` · Action: **Allow**
   - Include → **Emails** → ใส่อีเมลที่อนุญาต
   - ใช้จริง: **Emails ending in** → `@yourcompany.com` (พนักงานทุกคนเข้าได้)
4. Save

**ผลลัพธ์:** เปิดโดเมน → เจอหน้าล็อกอิน Cloudflare (ส่ง OTP ไปอีเมล) → ผ่านแล้วถึงเห็นหน้า WMS
→ มีล็อกอิน 2 ชั้น: (1) Cloudflare ยืนยันเป็นพนักงาน (2) WMS ยืนยันตัวตนในระบบ

---

## ขั้นที่ 7 — ให้ WMS รันถาวรด้วย pm2

```powershell
npm install -g pm2 pm2-windows-startup
cd C:\Users\Lenovo\Documents\Personal_Projects\WMS_ICS\server
pm2 start index.js --name wms
pm2 save
pm2-startup install     # รัน as Administrator — ให้สตาร์ทเองตอนเปิดเครื่อง
```

---

## ขั้นที่ 8 — สำรองข้อมูลอัตโนมัติ

```powershell
# ตั้ง Task รายวัน (PowerShell as Administrator)
schtasks /create /tn "WMS Backup" /sc daily /st 02:00 /tr "node \"C:\Users\Lenovo\Documents\Personal_Projects\WMS_ICS\server\tools\backup.mjs\""
```
สำรอง DB + โฟลเดอร์ uploads ลง `server/backups/` (เก็บย้อนหลัง 14 ชุด)
สำรองด้วยตนเอง: `npm run backup` (ในโฟลเดอร์ server)

---

## การอัปเดตโค้ดหลัง deploy

ที่เครื่อง server:

| แก้อะไร | คำสั่ง |
|---|---|
| หน้าเว็บ (src/) | `npm run build` แล้ว `pm2 restart wms` |
| โค้ด server / .env | `pm2 restart wms` |
| เพิ่ม package | `npm install` ก่อน แล้ว build/restart |

หลังอัปเดต hard refresh เบราว์เซอร์ (`Ctrl+Shift+R`)

---

## คำสั่ง pm2 ที่ใช้บ่อย

| งาน | คำสั่ง |
|---|---|
| ดูสถานะ | `pm2 status` |
| ดู log/error | `pm2 logs wms` |
| รีสตาร์ท | `pm2 restart wms` |
| หยุด | `pm2 stop wms` |

---

## แก้ปัญหาที่พบบ่อย

| อาการ | สาเหตุ | แก้ |
|---|---|---|
| **502 Bad Gateway** (Host Error) | backend ไม่รันที่ :5000 **หรือ** route ตั้งเป็น https | เช็ค `pm2 status` / เปลี่ยน route เป็น **http** |
| **Error 1033** | tunnel ไม่ connected | เช็ค cloudflared service / รอ DNS |
| เข้า WMS ตรงๆ ไม่เจอด่าน Access | policy ไม่ผูก hostname | เช็ค Access → Applications |
| reset link เป็น localhost | ไม่ได้ตั้ง/restart FRONTEND_URL | ขั้นที่ 5 |
| กล้อง/PWA ไม่ทำงาน | เปิดผ่าน http | ต้องเข้าผ่านโดเมน https |

---

## หมายเหตุความปลอดภัย (ทำไปแล้ว)
- ✅ Rotate `JWT_SECRET` ใหม่ (ค่าเก่าหลุดใน git history — rotate แล้วใช้ไม่ได้)
- ✅ Rotate รหัส admin ใหม่
- ✅ Rate limiting ที่ login/forgot-password (กันเดารหัส)
- ✅ Cloudflare Access เป็นด่านหน้า (คนนอกเข้าไม่ถึง)
- 🔸 ควรทำ repo เป็น private ถ้าเคย push ขึ้น GitHub แบบ public
