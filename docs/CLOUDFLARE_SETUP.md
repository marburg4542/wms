# ติดตั้ง WMS บนเซิร์ฟเวอร์ + เปิดใช้งานผ่าน Cloudflare (Tunnel + Access)

คู่มือติดตั้ง WMS บนเซิร์ฟเวอร์ Windows ให้เข้าใช้งานได้จากทุกที่แบบ **private** ผ่าน Cloudflare
โดยไม่ต้องเปิดพอร์ตที่เราเตอร์หรือ firewall

> 📄 **ถ้ากำลังย้ายจากเซิร์ฟเวอร์เดิมไปเครื่องใหม่** ให้อ่าน [MIGRATION.md](MIGRATION.md) ก่อน
> เอกสารนี้เป็นคู่มือ "ติดตั้งใหม่" ส่วน MIGRATION.md ครอบคลุมการย้ายข้อมูลด้วย

ในเอกสารนี้จะใช้ตัวแทนค่าต่อไปนี้ — แทนด้วยค่าจริงของคุณ:

| ตัวแทน | ความหมาย | ตัวอย่าง |
|---|---|---|
| `<โดเมน>` | โดเมนขององค์กร | `company.com` |
| `<โฮสต์>` | ที่อยู่เต็มของ WMS | `wms.company.com` |
| `<ที่ติดตั้ง>` | โฟลเดอร์ที่วางโปรเจกต์ | `D:\apps\wms` |

---

## ภาพรวมสถาปัตยกรรม

```
พนักงาน (มือถือ/คอม จากที่ไหนก็ได้)
      │  เปิด https://<โฮสต์>
      ▼
Cloudflare  ──►  ด่านล็อกอิน Access (ยืนยันอีเมล + OTP)
      │  ส่งผ่าน "อุโมงค์" (Tunnel)
      ▼
cloudflared (โปรแกรมบนเครื่อง server — เป็น Windows Service)
      │
      ▼
WMS Backend ที่ http://localhost:5000 (รันด้วย pm2)
      └─ เสิร์ฟทั้งหน้าเว็บ (dist/) และ API จากพอร์ตเดียว
```

**หลักการ:** cloudflared เปิดการเชื่อมต่อ *ออกไปหา* Cloudflare (ไม่ต้องเปิดพอร์ตขาเข้า)
Cloudflare รับ request จากอินเทอร์เน็ตแล้วส่งย้อนกลับมาที่ WMS ผ่านอุโมงค์
ส่วน HTTPS นั้น Cloudflare จัดการให้ทั้งหมด — ตัว WMS เองพูดแค่ http ธรรมดาในเครื่อง

---

## ⚠️ ขั้นที่ 0 — ตรวจสอบก่อนเริ่ม

**Cloudflare Tunnel ใช้ได้เฉพาะโดเมนที่ย้าย nameserver มาอยู่กับ Cloudflare แล้วเท่านั้น**

```powershell
nslookup -type=NS <โดเมน>
```

| ผลลัพธ์ | ทำต่อได้ไหม |
|---|---|
| ขึ้นชื่อลงท้าย `ns.cloudflare.com` | ✅ ทำตามคู่มือนี้ได้เลย |
| ขึ้นชื่ออื่น | ⛔ ต้องย้าย nameserver มา Cloudflare ก่อน — **ต้องให้ฝ่าย IT ทำ** |

> 🔴 **การย้าย nameserver กระทบทั้งโดเมน ไม่ใช่แค่ WMS**
> ถ้าย้ายโดยไม่คัดลอก DNS record เดิมมาให้ครบก่อน **อีเมลองค์กรจะล่ม** (MX record หาย)
> และเว็บไซต์อื่นที่ใช้โดเมนนี้จะเข้าไม่ได้ — ต้องวางแผนกับฝ่าย IT เสมอ

**สิ่งที่ต้องมี**
- บัญชี Cloudflare (แผน Free พอ)
- โดเมนที่อยู่บน Cloudflare แล้ว
- เครื่องเซิร์ฟเวอร์ที่เปิด 24 ชม. ออกอินเทอร์เน็ตได้
- **Node.js 22 LTS** (ดูหมายเหตุเรื่องเวอร์ชันท้ายเอกสาร)

---

## ขั้นที่ 1 — เตรียมโค้ดและ dependency

วางโปรเจกต์ไว้ที่ `<ที่ติดตั้ง>`

> 💡 **อย่าวางไว้ใน `C:\Users\<ชื่อคน>\`** — ถ้าคนนั้นลาออกหรือโปรไฟล์ถูกลบ ระบบจะพัง
> ใช้ path กลางเช่น `D:\apps\wms` แทน

```powershell
cd <ที่ติดตั้ง>
npm ci                 # ติดตั้ง dependency ของหน้าเว็บ
cd server
npm ci                 # ติดตั้ง dependency ของ backend
```

> ใช้ `npm ci` ไม่ใช่ `npm install` เพื่อให้ได้เวอร์ชันตรงตาม `package-lock.json` เป๊ะ

---

## ขั้นที่ 2 — ตั้งค่า `server/.env`

คัดลอก `server/.env.example` เป็น `server/.env` แล้วกรอกค่า
อ่านคำอธิบายแต่ละตัวในไฟล์ `.env.example` ได้เลย ค่าที่ต้องใส่แน่ๆ:

| ตัวแปร | ใส่อะไร |
|---|---|
| `JWT_SECRET` | สุ่มยาวอย่างน้อย 32 ตัว — `openssl rand -base64 48` |
| `FRONTEND_URL` | `https://<โฮสต์>` (ใส่โดเมนจริงไว้ตัวแรกเสมอ) |
| `VAPID_SUBJECT` | `https://<โฮสต์>` |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | `npx web-push generate-vapid-keys` |
| `BOOTSTRAP_ADMIN_*` | บัญชีแอดมินตัวแรก (ใช้อีเมลองค์กร) |
| `EMAIL_USER` / `EMAIL_PASS` | Gmail + App Password (ไว้ส่งลิงก์รีเซ็ตรหัสผ่าน) |

---

## ขั้นที่ 3 — build หน้าเว็บ แล้วทดสอบในเครื่อง

```powershell
cd <ที่ติดตั้ง>
npm run build          # สร้างหน้าเว็บลง dist/ (Express เสิร์ฟจากตรงนี้)
cd server
npm run create-admin   # สร้างบัญชีแอดมินตามค่าใน .env
npm start
```

ต้องเห็นครบ 3 บรรทัด:
```
📂 Using database: <ที่ติดตั้ง>\server\identifier.sqlite
🌐 Serving built frontend from dist/
🚀 Server running on port 5000
```

> ถ้าไม่เห็นบรรทัด **`Serving built frontend`** แปลว่ายังไม่ได้ `npm run build`
> เปิดเว็บจะขึ้นหน้าว่าง มีแต่ API ตอบ

ทดสอบ: เปิด `http://localhost:5000` บนเครื่องเซิร์ฟเวอร์ → ต้องเห็นหน้า login และล็อกอินได้
(ตอนนี้กล้องสแกนกับแจ้งเตือนยังใช้ไม่ได้ เพราะยังเป็น http — ปกติ)

กด `Ctrl+C` ปิดไปก่อน

---

## ขั้นที่ 4 — ติดตั้ง cloudflared

```powershell
winget install --id Cloudflare.cloudflared
```
ปิด-เปิด PowerShell ใหม่ แล้วเช็ค: `cloudflared --version` (ต้องขึ้นเลขเวอร์ชัน)

---

## ขั้นที่ 5 — สร้าง Tunnel

1. เข้า `https://one.dash.cloudflare.com` (ครั้งแรกตั้ง Team name + เลือกแผน Free)
2. **Networks → Tunnels → Create a tunnel** → เลือก **Cloudflared** → ตั้งชื่อ เช่น `wms`
3. เลือก **Windows (64-bit)** → คัดลอกคำสั่ง `cloudflared.exe service install <TOKEN>`
4. เปิด **PowerShell as Administrator** บนเครื่องเซิร์ฟเวอร์ → วางคำสั่งรัน
   → cloudflared จะติดตั้งเป็น **Windows Service** (รันเองตลอด)
5. รอสถานะ tunnel เป็น **Healthy / Connected** 🟢

> Token ของ tunnel เป็นความลับ — ถ้าหลุดให้กด **Rotate token** ในหน้า tunnel

---

## ขั้นที่ 6 — ผูกโดเมน (Public Hostname)

ในหน้า tunnel → แท็บ **Public Hostname** → **Add a public hostname**

| ช่อง | ค่า |
|---|---|
| Subdomain | `wms` |
| Domain | `<โดเมน>` |
| Type | **HTTP** |
| URL | `localhost:5000` |

> ⚠️ **สำคัญ:** Type ต้องเป็น **HTTP** ไม่ใช่ https — เพราะ WMS ในเครื่องเป็น http
> (ถ้าตั้งเป็น https จะขึ้น **502 Bad Gateway**) ส่วน https ที่ผู้ใช้เห็นภายนอก Cloudflare จัดการให้เอง

Cloudflare จะสร้าง DNS record ให้อัตโนมัติ ไม่ต้องไปเพิ่มเอง
รอ 1-2 นาที → เปิด `https://<โฮสต์>` ควรเห็นหน้า WMS

---

## ขั้นที่ 7 — ตั้งด่านล็อกอิน Access (ทำให้ private)

1. Zero Trust → **Access → Applications → Add an application → Self-hosted**
2. Application domain = `<โฮสต์>`
3. **Policy:**
   - Name: `พนักงาน` · Action: **Allow**
   - Include → **Emails ending in** → `@<โดเมน>` (พนักงานทุกคนเข้าได้)
4. Save

**ผลลัพธ์:** เปิดโดเมน → เจอหน้าล็อกอิน Cloudflare (ส่ง OTP ไปอีเมล) → ผ่านแล้วถึงเห็นหน้า WMS
→ มีล็อกอิน 2 ชั้น: (1) Cloudflare ยืนยันว่าเป็นพนักงาน (2) WMS ยืนยันตัวตนในระบบ

---

## ขั้นที่ 8 — ให้ WMS รันถาวรด้วย pm2

```powershell
npm install -g pm2 pm2-windows-startup

cd <ที่ติดตั้ง>
pm2 start ecosystem.config.cjs     # ใช้ค่าจากไฟล์ ecosystem.config.cjs ในโปรเจกต์
pm2 save
```
แล้วเปิด PowerShell **as Administrator**:
```powershell
pm2-startup install
```

> ✅ **ทดสอบให้แน่ใจ: สั่ง restart เครื่องเซิร์ฟเวอร์ 1 ครั้ง** แล้วรอดูว่าเว็บกลับมาเองไหม
> ถ้าไม่กลับมา แปลว่า startup ยังไม่ทำงาน — อย่าข้ามขั้นนี้

---

## ขั้นที่ 9 — สำรองข้อมูลอัตโนมัติ

```powershell
# ตั้ง Task รายวัน (PowerShell as Administrator)
schtasks /create /tn "WMS Backup" /sc daily /st 02:00 /tr "node \"<ที่ติดตั้ง>\server\tools\backup.mjs\""
```
สำรอง **ฐานข้อมูล + โฟลเดอร์ uploads** ลง `server/backups/` เก็บย้อนหลัง 14 ชุด
สำรองด้วยตนเอง: `npm run backup` (ในโฟลเดอร์ server)

### ตรวจสุขภาพข้อมูล

```powershell
cd <ที่ติดตั้ง>\server
npm run audit
```

ไล่ตรวจกติกาของข้อมูล 19 ข้อ (ของวางเกินยอดคงเหลือ, ตำแหน่งชี้ชั้นที่ถูกลบ, ใบเบิกอนุมัติเกินที่ขอ ฯลฯ)
**อ่านอย่างเดียว ไม่แก้อะไร** — ถ้าเจอปัญหาจะคืนค่าผิดพลาด เอาไปตั้งเวลาให้เตือนอัตโนมัติได้
ตรวจไฟล์สำรองก็ได้: `npm run audit -- backups\<วันเวลา>\identifier.sqlite`

> 💡 **ควรทำเพิ่ม:** ตั้งให้คัดลอกโฟลเดอร์ `backups/` ไปเก็บอีกที่ (NAS / ไดรฟ์อื่น / cloud)
> เพราะถ้าเซิร์ฟเวอร์เครื่องนี้พัง ข้อมูลสำรองที่อยู่ในเครื่องเดียวกันก็หายไปพร้อมกัน
> หรือตั้ง `BACKUP_DIR` ใน `.env` ให้ชี้ไปไดรฟ์อื่นตั้งแต่แรก

---

## ✅ ตรวจรับก่อนประกาศใช้จริง

ทดสอบบน `https://<โฮสต์>` (ทดสอบข้อ 4-5 ด้วยมือถือ ปิด WiFi ใช้เน็ตมือถือ)

| # | ทดสอบ | พิสูจน์อะไร |
|---|---|---|
| 1 | ล็อกอินได้ | ระบบพื้นฐานทำงาน |
| 2 | เปิดสินค้าคงคลัง เห็นข้อมูล **และรูปภาพขึ้น** | โฟลเดอร์ `uploads/` ครบ |
| 3 | เปิดผังคลัง เห็นห้อง/ชั้นวาง/ตำแหน่งสินค้า | ฐานข้อมูลครบ |
| 4 | กดสแกน QR ด้วยมือถือ | HTTPS ทำงาน (กล้องต้องการ secure context) |
| 5 | กดติดตั้งเป็นแอป (PWA) | HTTPS ทำงาน |
| 6 | ลืมรหัสผ่าน → เช็คลิงก์ในอีเมล | **ลิงก์ต้องเป็นโดเมนใหม่** ถ้าไม่ใช่ = `FRONTEND_URL` ผิด |
| 7 | เปิดแจ้งเตือน แล้วลองส่งใบเบิก | VAPID ตั้งถูก |
| 8 | ส่งใบเบิก → อนุมัติ → กดรับแล้ว | flow หลักครบวง สต็อกตัดถูกจุด |
| 9 | รัน `npm run backup` ด้วยมือ 1 ครั้ง | ระบบสำรองข้อมูลทำงาน |
| 10 | restart เครื่อง แล้วรอ | pm2 + cloudflared สตาร์ทเองได้ |

---

## การอัปเดตโค้ดหลัง deploy

| แก้อะไร | คำสั่ง |
|---|---|
| หน้าเว็บ (`src/`) | `npm run build` แล้ว `pm2 restart wms` |
| โค้ด backend (`server/`) หรือ `.env` | `pm2 restart wms` |
| เพิ่ม/อัปเดต package | `npm ci` ก่อน แล้ว build/restart |

หลังอัปเดตหน้าเว็บ ให้ hard refresh เบราว์เซอร์ (`Ctrl+Shift+R`)
เพราะ Service Worker เก็บ cache ของหน้าเดิมไว้

---

## คำสั่ง pm2 ที่ใช้บ่อย

| งาน | คำสั่ง |
|---|---|
| ดูสถานะ | `pm2 status` |
| ดู log / error | `pm2 logs wms` |
| รีสตาร์ท | `pm2 restart wms` |
| หยุด | `pm2 stop wms` |

---

## แก้ปัญหาที่พบบ่อย

| อาการ | สาเหตุ | แก้ |
|---|---|---|
| **502 Bad Gateway** | backend ไม่รันที่ :5000 **หรือ** Public Hostname ตั้ง Type เป็น https | เช็ค `pm2 status` / เปลี่ยน Type เป็น **HTTP** |
| **Error 1033** | tunnel ไม่ connected | เช็ค cloudflared service / รอ DNS |
| เปิดเว็บขึ้นหน้าว่าง | ยังไม่ได้ `npm run build` | build แล้ว `pm2 restart wms` |
| เข้า WMS ตรงๆ ไม่เจอด่าน Access | policy ไม่ผูก hostname | เช็ค Access → Applications |
| ลิงก์รีเซ็ตรหัสผ่านเป็น localhost หรือโดเมนเก่า | `FRONTEND_URL` ผิด/ยังไม่ restart | แก้ `.env` แล้ว `pm2 restart wms` |
| กล้องสแกน / PWA ไม่ทำงาน | เปิดผ่าน http | ต้องเข้าผ่านโดเมน https |
| แจ้งเตือนไม่เด้ง | VAPID ว่าง หรือผู้ใช้ยังไม่กดเปิดบนโดเมนนี้ | เช็ค `.env` / ให้ผู้ใช้กดเปิดแจ้งเตือนใหม่ |
| เซิร์ฟเวอร์สตาร์ทไม่ขึ้นเลย | `JWT_SECRET` ว่างหรือสั้นกว่า 32 ตัว | ตั้งค่าใน `server/.env` |

---

## หมายเหตุทางเทคนิค

**เวอร์ชัน Node** — ใช้ **Node 22 LTS** โปรเจกต์นี้ใช้ `better-sqlite3` ซึ่งเป็น native module
ที่คอมไพล์ผูกกับเวอร์ชัน Node ถ้าอัปเกรด Node major version ต้องรัน `npm rebuild better-sqlite3`
และ **ห้ามคัดลอกโฟลเดอร์ `node_modules` ข้ามเครื่อง** ให้ `npm ci` ใหม่เสมอ

**ฐานข้อมูลใช้โหมด WAL** — ห้ามคัดลอกไฟล์ `identifier.sqlite` ตรงๆ ขณะระบบรันอยู่
เพราะข้อมูลล่าสุดบางส่วนอยู่ในไฟล์ `-wal` ให้ใช้ `npm run backup` แทนเสมอ

**reverse proxy** — `server/index.js` ตั้ง `app.set('trust proxy', 'loopback')`
ค่านี้ถูกต้องเมื่อ cloudflared รันบนเครื่องเดียวกับ WMS (ตามคู่มือนี้)
ถ้าเปลี่ยนไปใช้ reverse proxy บนเครื่องอื่น ต้องแก้ค่านี้ ไม่งั้นระบบจำกัดจำนวนครั้งล็อกอิน
จะนับรวมผู้ใช้ทุกคนเป็น IP เดียวกัน

**อีเมล** — `server/utils/sendEmail.js` ตั้งค่าไว้ใช้ Gmail เท่านั้น
ถ้าจะใช้ SMTP ขององค์กร (Microsoft 365 / mail server ภายใน) ต้องแก้โค้ดไฟล์นั้น

---

## ความปลอดภัย

- ✅ `JWT_SECRET` ต้องสุ่มใหม่และไม่เคยอยู่ใน git — ถ้าเคยหลุดให้ rotate ทันที
- ✅ Rate limiting ที่ login / forgot-password (กันเดารหัสผ่าน)
- ✅ Cloudflare Access เป็นด่านหน้า คนนอกองค์กรเข้าไม่ถึงหน้า login ด้วยซ้ำ
- ✅ ไม่มีการเปิดพอร์ตขาเข้าที่ firewall เลย
- 🔸 `server/.env` ห้าม commit และ **ไม่ได้อยู่ในไฟล์สำรองข้อมูล** — เก็บสำเนาไว้ที่ปลอดภัยแยกต่างหาก
- 🔸 ถ้า repo เคย push ขึ้น GitHub แบบ public ควรเปลี่ยนเป็น private
