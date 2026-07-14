"""
forecaster.py — โมเดล Online Learning (River) สำหรับพยากรณ์ demand / cost
================================================================================
• ใช้ predict_one / learn_one → อัปเดตทีละจุด ไม่เทรนใหม่ทั้งก้อน (incremental / no batch retrain)
• pipeline: StandardScaler (online) → LinearRegression (SGD)
    - Scaler ปรับ mean/var ระหว่างสตรีม (ฟีเจอร์คนละสเกล เช่น lag กับ dow)
    - LinearRegression + SGD เบา เร็ว ตีความง่าย เหมาะ streaming; อยากได้ non-linear
      เปลี่ยนเป็น forest.ARFRegressor (Adaptive Random Forest) ได้โดยไม่ต้องแก้ที่อื่น
• Cold start: ระหว่างที่โมเดลยังไม่เห็นข้อมูลพอ ใช้ค่าเฉลี่ยเคลื่อนที่ (RollingMean) เป็น fallback
• Concept drift: มี ADWIN คอยจับว่า error กระโดด (พฤติกรรม demand เปลี่ยน) เพื่อแจ้งเตือน/รีเซ็ตเฉพาะจุด
"""
from __future__ import annotations
from collections import deque
from river import linear_model, preprocessing, metrics, optim, drift

WARMUP = 10  # เห็นข้อมูลกี่จุดก่อนเชื่อโมเดล (ก่อนหน้านั้นใช้ moving-average fallback)


class _RollingMean:
    """ค่าเฉลี่ยเคลื่อนที่แบบ deque — เขียนเองกัน API ของ river.stats เปลี่ยนไปมาระหว่างเวอร์ชัน"""
    def __init__(self, window: int = 7):
        self.buf: deque[float] = deque(maxlen=window)
    def update(self, x: float):
        self.buf.append(x)
    def get(self) -> float:
        return sum(self.buf) / len(self.buf) if self.buf else 0.0


def _new_model():
    return preprocessing.StandardScaler() | linear_model.LinearRegression(optimizer=optim.SGD(0.01))


class _Unit:
    """โมเดล + ตัววัดผล + fallback ของอนุกรม 1 เส้น"""
    def __init__(self):
        self.model = _new_model()
        self.metric = metrics.MAE()        # prequential error (วัดก่อนเรียนเสมอ)
        self.baseline = _RollingMean(7)
        self.drift = drift.ADWIN()         # จับ concept drift จากสตรีมของ error
        self.warm = 0
        self.drift_alarm = False

    def predict(self, x: dict) -> float:
        if self.warm < WARMUP:
            return max(0.0, self.baseline.get() or 0.0)
        return max(0.0, self.model.predict_one(x))

    def learn(self, x: dict, y: float) -> None:
        # ---- Prequential Evaluation: ทำนายล่วงหน้า → เทียบของจริง → อัปเดต ----
        y_pred = self.model.predict_one(x)     # 1) ทำนายก่อน (ยังไม่เห็น y)
        self.metric.update(y, y_pred)          # 2) เทียบของจริง สะสม error
        self.model.learn_one(x, y)             # 3) อัปเดตโมเดลแบบ incremental
        self.baseline.update(y)
        self.warm += 1
        # จับ drift จากขนาด error — ถ้า ADWIN เตือน แปลว่ารูปแบบ demand เปลี่ยนไป (ควรรีวิว)
        self.drift.update(abs(y - y_pred))
        self.drift_alarm = self.drift.drift_detected


class OnlineForecaster:
    """รวมโมเดล 'ยอดรวมทั้งคลัง' + 'รายชิ้น (ต่อ sku)' ไว้ในตัวเดียว — pickle ได้ทั้งก้อน"""
    def __init__(self):
        self.total = _Unit()
        self.items: dict[str, _Unit] = {}

    def _item(self, sku: str) -> _Unit:
        if sku not in self.items:
            self.items[sku] = _Unit()
        return self.items[sku]

    # ----- ยอดรวม -----
    def predict_total(self, x): return self.total.predict(x)
    def learn_total(self, x, y): self.total.learn(x, y)

    # ----- รายชิ้น -----
    def predict_item(self, sku, x): return self._item(sku).predict(x)
    def learn_item(self, sku, x, y): self._item(sku).learn(x, y)

    # ----- สรุป error ปัจจุบัน (ไว้โชว์ความน่าเชื่อถือของโมเดล) -----
    def report(self):
        return {
            "total_mae": round(self.total.metric.get(), 3),
            "total_seen": self.total.warm,
            "items_tracked": len(self.items),
            "items_drifting": sum(1 for u in self.items.values() if u.drift_alarm),
        }
