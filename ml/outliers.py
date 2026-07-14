"""
outliers.py — กันไม่ให้โมเดลเรียนรู้จากข้อมูลผิดปกติ (Outlier Handling)
================================================================================
ทำไมสำคัญ: online learning อัปเดตทุกจุด ถ้าปล่อยให้ "การเบิกฉุกเฉิน" (เช่น เครื่องตก
ต้องเปลี่ยนอะไหล่ล็อตใหญ่) เข้าไปเรียน โมเดลจะเข้าใจผิดว่านั่นคือ demand ปกติ แล้วพยากรณ์เว่อร์

กลยุทธ์ (robust + rule-based):
  1. ใช้ median + MAD แทน mean + std  → ทนต่อ outlier (ค่าสุดโต่งไม่ดึง baseline)
  2. เกินขอบเขต → "winsorize" (ตัดยอดให้อยู่ขอบ) แทนการทิ้งทั้งจุด — ยังเรียนทิศทางได้ ไม่เสียข้อมูล
  3. ธุรกรรมที่ระบบ flag ว่า "ฉุกเฉิน" → "skip" ไม่เอาเข้าเรียนเลย (แต่ยังพยากรณ์/แจ้งเตือนได้)
"""
from __future__ import annotations
from collections import deque
import statistics


class OutlierGuard:
    def __init__(self, window: int = 60, k: float = 5.0, min_history: int = 10):
        self.window: deque[float] = deque(maxlen=window)  # ค่าล่าสุดสำหรับคำนวณ baseline
        self.k = k                    # ยิ่งมาก ยิ่งอนุญาตให้เบี่ยงได้กว้าง (5 = ค่อนข้างผ่อนปรน)
        self.min_history = min_history

    @staticmethod
    def _mad(med: float, vals: list[float]) -> float:
        # Median Absolute Deviation — กระจายตัวแบบทน outlier; กัน 0 ด้วยค่าเล็กๆ
        return statistics.median([abs(v - med) for v in vals]) or 1e-9

    def check(self, value: float, *, is_emergency: bool = False):
        """
        คืน (decision, value_to_learn)
          decision ∈ {'accept', 'winsorize', 'skip'}
          value_to_learn = ค่าที่ควรป้อนให้ learn_one (อาจถูกตัดยอดแล้ว)

        หมายเหตุ: เก็บ 'ค่าจริง' เข้า baseline เสมอ เพื่อให้ขอบเขตสะท้อนความจริง
                  แต่ 'ค่าที่ให้โมเดลเรียน' อาจถูก winsorize/skip
        """
        vals = list(self.window)
        self.window.append(value)  # baseline ต้องเห็นค่าจริง

        # 1) กฎธุรกิจมาก่อน: เบิกฉุกเฉิน = ไม่ให้โมเดลเรียน
        if is_emergency:
            return "skip", value

        # 2) ข้อมูลยังน้อย ยังตั้งขอบเขตไม่ได้ เชื่อไปก่อน
        if len(vals) < self.min_history:
            return "accept", value

        med = statistics.median(vals)
        scale = 1.4826 * self._mad(med, vals)   # 1.4826 = ปรับ MAD ให้เทียบเท่า std ของ normal
        upper = med + self.k * scale
        lower = max(0.0, med - self.k * scale)

        # 3) เกินขอบเขต → ตัดยอด (winsorize) ไม่ทิ้งทั้งจุด
        if value > upper:
            return "winsorize", upper
        if value < lower:
            return "winsorize", lower
        return "accept", value
