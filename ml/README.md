# ML Forecasting Service — พยากรณ์ demand/cost อะไหล่ VTOL (Online Learning)

บริการ ML แยกส่วน (Python microservice) สำหรับหน้า "วิเคราะห์คลัง" — ทำนายแนวโน้มการนำเข้า/เบิกออก
และภาระค่าใช้จ่าย โดยเรียนรู้แบบ **incremental/online** (ไม่เทรนใหม่ทั้งก้อน)

## 1. System Architecture / Data Pipeline

```
┌─────────────────────────────────────────────────────────────────────────┐
│  WMS (ชั้น ERP ของโปรเจกต์นี้)                                             │
│  SQLite: stock_in / stock_out (ledger) + items + warehouse_balance (view) │
└───────────────┬───────────────────────────────────────────────────────────┘
                │  (1) EXTRACT รายวัน — เฉพาะข้อมูล > watermark (ประมวลผลเฉพาะของใหม่)
                ▼
┌───────────────────────────────┐   pipeline.py
│  ETL + Aggregate               │   • ยอดรายวันต่อ sku + ยอดรวม (ตัด opening/adjustment ออก)
│  daily series (in / out)       │
└───────────────┬───────────────┘
                │  (2) FEATURE ENGINEERING (features.py)  lag / rolling / ปฏิทิน / รอบซ่อม
                ▼
┌───────────────────────────────┐
│  Prequential Loop              │   สำหรับแต่ละจุดข้อมูล (เรียงเวลา):
│  predict → compare → learn     │     predict_one → MAE.update → OutlierGuard → learn_one
│  (forecaster.py = River)       │   ← incremental: อัปเดตทีละจุด ไม่ retrain
└───────────────┬───────────────┘
                │  (3) เก็บสถานะ (pickle) → รอบหน้าโหลดต่อ  |  เขียนผลพยากรณ์
                ▼
        state/ml_state.pkl  +  state/forecasts.json
                                     │  (4) SERVE
                                     ▼
              Node: GET /api/analysis/forecast  →  อ่าน forecasts.json  →  หน้า Analysis (การ์ด AI)
```

**ความถี่:** เริ่มที่ **รายวัน** (cron/Task Scheduler ตอนกลางคืน) เพียงพอสำหรับคลังอะไหล่ที่ demand ไม่ถี่มาก
ถ้าต้องการ near-real-time: ให้ Node ส่ง event (มี SSE อยู่แล้ว) เข้า queue แล้ว worker เรียก `learn_one` ทีละธุรกรรม —
โครงโมเดลเดิมรองรับได้ทันที เพราะเป็น online อยู่แล้ว

## 2. เป้าหมายที่แมปกับโค้ด

| เป้าหมาย | ทำที่ไหน |
|---|---|
| 1. เทรนด์ นำเข้า/เบิกออก (รวม + รายชิ้น) | `forecaster.OnlineForecaster` (total + per-sku), แยกโมเดล `in`/`out` |
| 2. ภาระค่าใช้จ่าย (รวม + รายชิ้น) | `pipeline.forecast_next` → `reorder_qty × latest_cost` (cost = ปริมาณพยากรณ์ × ราคา) |
| 3. Online/incremental | `learn_one` + pickle สถานะข้ามรอบ — ไม่มี batch retrain |
| 4. Feature engineering | `features.build_features` |
| 5. Outlier handling | `outliers.OutlierGuard` |

> **หมายเหตุเรื่อง cost:** ต้นทุนเป็นฟังก์ชันของปริมาณ (ที่ต้องพยากรณ์) × ราคา (รู้อยู่แล้วใน `latest_cost`)
> จึงแยกเป็น "พยากรณ์ปริมาณด้วย ML" แล้ว "คูณราคา" — แม่นและตีความง่ายกว่าการ regress cost ตรงๆ
> ถ้าราคาผันผวน ให้เพิ่มโมเดล online เล็กๆ ติดตาม unit_cost ต่อผู้ขาย (ต่อยอดได้ทันที)

## 3. Feature Engineering (features.py)
- **Lag** `lag_1/7/30` — ความต่อเนื่องระยะสั้น/สัปดาห์/เดือน
- **Moving avg/std** `roll_mean_7/30`, `roll_std_7` — ระดับฐาน + ความผันผวน
- **ปฏิทิน** `dow`, `month`, `is_month_end` — รอบจัดซื้อ/ปิดงบ
- **รอบซ่อมบำรุง VTOL** `maint_sin/cos` — เข้ารหัสเฟสของรอบ (ปรับ `maintenance_period_days` ตามจริง)
- **Intermittent** `gap_since_last` — อะไหล่ที่เบิกนานๆ ครั้ง
- **Trend** `trend_idx` — แนวโน้มระยะยาว
- ฟีเจอร์คงที่ของสินค้า (หมวดหมู่/lead_time/ราคา) ส่งผ่าน `static=` ได้ ช่วยตัวที่ข้อมูลน้อย

## 4. Outlier Handling (outliers.py)
- **median + MAD** (robust) แทน mean+std → ค่าสุดโต่งไม่ดึง baseline
- เกินขอบ `median ± k·MAD` → **winsorize** (ตัดยอด) ไม่ทิ้งทั้งจุด
- ธุรกรรม flag "ฉุกเฉิน" → **skip** ไม่ให้โมเดลเรียน (ส่ง `is_emergency=True`)
- baseline เห็นค่าจริงเสมอ แต่ค่าที่ "เรียน" ถูกกรอง → กันโมเดลเพี้ยนจากเหตุการณ์ผิดปกติ

## 5. วิธีรัน
```bash
cd ml
python -m venv .venv && .venv\Scripts\activate      # (Windows)
pip install -r requirements.txt
python pipeline.py                                   # รันครั้งแรก = อ่านทั้งหมด, ครั้งต่อไป = เฉพาะของใหม่
```
ตั้งเวลา (Windows Task Scheduler) ให้รัน `python pipeline.py` ทุกวันตอนกลางคืน

## 6. เชื่อมกับ Node/หน้าเว็บ
เพิ่ม route ฝั่ง Node อ่านไฟล์ `ml/state/forecasts.json` แล้วเสิร์ฟให้หน้า Analysis:
```js
// server/controllers/analysisController.js
import fs from 'fs';
export const getForecast = (req, res) => {
  try { res.json(JSON.parse(fs.readFileSync(process.env.ML_FORECAST || '../ml/state/forecasts.json', 'utf8'))); }
  catch { res.json({ available: false }); }   // ยังไม่มีไฟล์ = โมเดลยังไม่ได้รัน
};
// routes: router.get('/analysis/forecast', verifyAuth, authorizeRoles('Admin','Manager'), getForecast);
```
แล้วหน้า `Analysis` เปลี่ยนการ์ด placeholder → อ่าน `/api/analysis/forecast` มาแสดง `reorder_suggestions`

## 7. สถานะข้อมูลปัจจุบัน (cold start)
ตอนนี้มีแต่ธุรกรรมทดสอบไม่กี่รายการ โมเดลจะใช้ **moving-average fallback** ไปก่อน (ดู `WARMUP` ใน forecaster.py)
พอสะสมข้อมูลใช้งานจริงหลายสัปดาห์ ค่า MAE (`model_health`) จะลดลงและพยากรณ์แม่นขึ้นเรื่อยๆ
