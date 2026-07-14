"""
features.py — Feature Engineering สำหรับ time-series ความต้องการอะไหล่ VTOL
================================================================================
แนวคิด: แปลง "อนุกรมจำนวนอะไหล่รายวัน" เป็นชุดฟีเจอร์ที่บอกบริบทให้โมเดลเดาวันถัดไป
สำคัญสำหรับ online learning: เก็บสถานะย้อนหลังแบบ "หน้าต่างจำกัด" (deque) → หน่วยความจำคงที่
ไม่โตตามข้อมูล ต่างจากการ retrain ทั้งก้อนที่ต้องถือข้อมูลทั้งหมด
"""
from __future__ import annotations
from collections import deque
from datetime import date
import math


class SeriesState:
    """สถานะย้อนหลังของอนุกรม 1 เส้น (ต่อสินค้า 1 ตัว หรือยอดรวมทั้งคลัง)"""

    def __init__(self, max_lag: int = 30):
        # เก็บค่าจริงย้อนหลังไม่เกิน max_lag+1 จุด (พอสำหรับ lag/rolling ที่ยาวสุด)
        self.history: deque[float] = deque(maxlen=max_lag + 1)
        self.last_nonzero_gap = 0   # กี่วันแล้วที่ยอด = 0 (อะไหล่หลายตัวเบิกนานๆ ครั้ง = intermittent demand)
        self.count = 0              # จำนวนจุดที่เห็นแล้ว (ใช้เช็คว่าโมเดล "อุ่นเครื่อง" พอหรือยัง)


def build_features(d: date, state: SeriesState, *,
                   maintenance_period_days: int = 90,
                   static: dict | None = None) -> dict:
    """
    สร้าง feature dict สำหรับพยากรณ์ "วัน d" จากประวัติที่มีอยู่ (ต้องไม่ใช้ค่าจริงของวัน d — กัน data leakage)

    กลุ่มฟีเจอร์:
      • Lag variables       : ค่าจริง t-1, t-7, t-30 — ความต่อเนื่องระยะสั้น/สัปดาห์/เดือน
      • Moving average/std   : ค่าเฉลี่ย+ความผันผวน 7 และ 30 วัน — ระดับฐานและความไม่แน่นอน
      • ปฏิทิน (seasonality)  : วันในสัปดาห์, เดือน, ใกล้สิ้นเดือน (รอบจัดซื้อ/ปิดงบ)
      • รอบซ่อมบำรุง VTOL     : เข้ารหัสเฟสของรอบ maintenance เป็น sin/cos (ต่อเนื่อง ไม่มีรอยต่อ)
      • Intermittent demand  : จำนวนวันตั้งแต่เบิกครั้งล่าสุด (อะไหล่ VTOL หลายชิ้นเบิกเป็นครั้งคราว)
      • Trend index          : ดัชนีเวลาเชิงเส้น — ให้โมเดลจับแนวโน้มขาขึ้น/ลงระยะยาว
    """
    hist = list(state.history)

    def lag(k: int) -> float:
        return hist[-k] if len(hist) >= k else 0.0

    def rmean(n: int) -> float:
        v = hist[-n:]
        return sum(v) / len(v) if v else 0.0

    def rstd(n: int) -> float:
        v = hist[-n:]
        if len(v) < 2:
            return 0.0
        m = sum(v) / len(v)
        return math.sqrt(sum((x - m) ** 2 for x in v) / (len(v) - 1))

    # เฟสของรอบซ่อมบำรุง (เช่น ตรวจใหญ่ทุก 90 วัน) — sin/cos ทำให้ปลายรอบต่อกับต้นรอบเนียน
    doy = d.timetuple().tm_yday
    phase = 2 * math.pi * (doy % maintenance_period_days) / maintenance_period_days

    x = {
        "lag_1": lag(1),
        "lag_7": lag(7),
        "lag_30": lag(30),
        "roll_mean_7": rmean(7),
        "roll_mean_30": rmean(30),
        "roll_std_7": rstd(7),
        "dow": float(d.weekday()),          # 0=จันทร์ .. 6=อาทิตย์
        "month": float(d.month),
        "is_month_end": 1.0 if d.day >= 28 else 0.0,
        "gap_since_last": float(state.last_nonzero_gap),
        "maint_sin": math.sin(phase),
        "maint_cos": math.cos(phase),
        "trend_idx": float(state.count),
    }

    # ฟีเจอร์คงที่ของสินค้า (หมวดหมู่, lead_time, ราคา, is_asset) — ช่วยตัวที่ข้อมูลน้อยยืมความรู้จากตัวคล้ายกัน
    if static:
        x.update(static)
    return x


def update_state(state: SeriesState, value: float) -> None:
    """อัปเดตสถานะหลัง 'รู้ค่าจริง' ของวันนั้นแล้ว (เรียกหลัง model.learn_one เสมอ)"""
    state.history.append(value)
    state.count += 1
    state.last_nonzero_gap = 0 if value > 0 else state.last_nonzero_gap + 1
