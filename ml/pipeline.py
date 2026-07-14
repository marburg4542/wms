"""
pipeline.py — งานพยากรณ์รายวัน (ETL → Prequential Loop → เขียนผลพยากรณ์)
================================================================================
รันด้วย cron / Windows Task Scheduler วันละครั้ง (เช่น ตี 1) หรือ trigger หลังปิดยอดวัน

ลูปหลัก (Prequential / test-then-train) ต่อ 1 จุดข้อมูล:
    1. predict_one(features)          → ทำนายล่วงหน้า
    2. observe actual (ค่าจริงวันนั้น) → เทียบ อัปเดต error (MAE)
    3. OutlierGuard.check()           → ผิดปกติ? ตัดยอด/ข้าม ไม่ให้โมเดลเรียนของเสีย
    4. learn_one(features, actual)    → อัปเดตโมเดลแบบ incremental
สถานะทั้งหมด (โมเดล + ประวัติ + watermark) ถูก pickle ไว้ → รอบถัดไปโหลดต่อ ไม่เริ่มใหม่
"""
from __future__ import annotations
import os, json, pickle, sqlite3
from collections import defaultdict
from datetime import date, datetime, timedelta

from features import SeriesState, build_features, update_state
from outliers import OutlierGuard
from forecaster import OnlineForecaster

# ---------------- ตั้งค่า (override ผ่าน environment variable ได้) ----------------
DB_PATH    = os.environ.get("WMS_DB", os.path.join("..", "server", "identifier.sqlite"))
STATE_DIR  = os.environ.get("ML_STATE", "state")
STATE_PATH = os.path.join(STATE_DIR, "ml_state.pkl")
OUT_PATH   = os.path.join(STATE_DIR, "forecasts.json")   # ← Node อ่านไฟล์นี้ไปเสิร์ฟหน้า Analysis

DEFAULT_LEAD_TIME_DAYS = 14   # ใช้เมื่อสินค้ายังไม่มีข้อมูล lead_time (แนะนำเพิ่มคอลัมน์นี้ทีหลัง)
FORECAST_HORIZON_DAYS  = 30   # ช่วงที่พยากรณ์ล่วงหน้า (รายเดือน)
REAL_MOVE = "COALESCE(clean_status,'') NOT IN ('imported','adjustment')"  # ตัดยอดยกมา/ปรับยอดออก


# ---------------- สถานะที่ต้องคงข้ามรอบการรัน ----------------
class MLState:
    def __init__(self):
        # แยกโมเดล "รับเข้า (in)" กับ "เบิกออก (out)" — คนละพฤติกรรม
        self.fc = {"in": OnlineForecaster(), "out": OnlineForecaster()}
        self.item_state = {"in": defaultdict(SeriesState), "out": defaultdict(SeriesState)}
        self.item_guard = {"in": defaultdict(OutlierGuard), "out": defaultdict(OutlierGuard)}
        self.total_state = {"in": SeriesState(), "out": SeriesState()}
        self.total_guard = {"in": OutlierGuard(), "out": OutlierGuard()}
        self.watermark: str | None = None   # วันสุดท้ายที่ประมวลผลแล้ว (กันเรียนซ้ำ = idempotent)


def load_state() -> MLState:
    if os.path.exists(STATE_PATH):
        with open(STATE_PATH, "rb") as f:
            return pickle.load(f)
    return MLState()


def save_state(s: MLState) -> None:
    os.makedirs(STATE_DIR, exist_ok=True)
    with open(STATE_PATH, "wb") as f:
        pickle.dump(s, f)


# ---------------- ดึงข้อมูลจาก WMS (ชั้น ERP ของโปรเจกต์นี้คือ SQLite) ----------------
def fetch_daily(conn, kind: str, since: str | None):
    """ยอดรวมรายวัน แยกตามสินค้า — เฉพาะการเคลื่อนไหวจริง (ตัด opening/adjustment)"""
    table, col = ("stock_in", "input_date") if kind == "in" else ("stock_out", "output_date")
    where = f"{REAL_MOVE} AND {col} IS NOT NULL"
    params = []
    if since:
        where += f" AND date({col},'localtime') > ?"
        params.append(since)
    return conn.execute(f"""
        SELECT date({col},'localtime') AS d, item_id, SUM(quantity) AS q
        FROM {table} WHERE {where}
        GROUP BY d, item_id ORDER BY d
    """, params).fetchall()


def fetch_item_meta(conn):
    """ข้อมูลคงที่ของสินค้า: ราคาล่าสุด, หมวดหมู่, ยอดคงเหลือ, ขั้นต่ำ, lead_time (ถ้ามีคอลัมน์)"""
    has_lead = any(c[1] == "lead_time" for c in conn.execute("PRAGMA table_info(items)").fetchall())
    lead_sel = "i.lead_time" if has_lead else f"{DEFAULT_LEAD_TIME_DAYS}"
    rows = conn.execute(f"""
        SELECT i.item_id AS sku, i.item_name AS name, i.group_id AS grp,
               COALESCE(i.latest_cost, 0) AS cost,
               COALESCE(wb.stock_balance, 0) AS stock,
               COALESCE(ps.min_stock, 10) AS min_stock,
               {lead_sel} AS lead_time
        FROM items i
        LEFT JOIN warehouse_balance wb ON wb.item_id = i.item_id
        LEFT JOIN product_settings ps ON ps.item_id = i.item_id
    """).fetchall()
    return {r["sku"]: dict(r) for r in rows}


# ---------------- ประมวลผลอนุกรม 1 เส้นด้วยลูป prequential ----------------
def process_series(rows_by_day, state: SeriesState, guard: OutlierGuard,
                   predict_fn, learn_fn, static: dict | None):
    """
    rows_by_day: dict{ 'YYYY-MM-DD' -> qty }  (วันที่ไม่มี = 0)
    ไล่ทีละวันตามลำดับเวลา ทำ predict → guard → learn
    """
    if not rows_by_day:
        return
    days = sorted(rows_by_day)
    cur = datetime.strptime(days[0], "%Y-%m-%d").date()
    end = datetime.strptime(days[-1], "%Y-%m-%d").date()
    while cur <= end:                       # เดินทุกวัน (รวมวันยอด 0) ให้ปฏิทิน/gap ถูกต้อง
        y = float(rows_by_day.get(cur.isoformat(), 0.0))
        x = build_features(cur, state, static=static)
        predict_fn(x)                        # 1) ทำนายล่วงหน้า (ผลเก็บใน metric ตอน learn)
        decision, y_learn = guard.check(y)   # 2)+3) กัน outlier
        if decision != "skip":
            learn_fn(x, y_learn)             # 4) เรียนแบบ incremental (ใช้ค่าที่ winsorize แล้ว)
        update_state(state, y)               # อัปเดตประวัติด้วย "ค่าจริง" เสมอ
        cur += timedelta(days=1)


def group_rows(raw):
    """(d, item_id, q) → { item_id: {d: q} } และ { d: total }"""
    by_item = defaultdict(dict)
    by_total = defaultdict(float)
    for r in raw:
        by_item[r["item_id"]][r["d"]] = (by_item[r["item_id"]].get(r["d"], 0.0) + r["q"])
        by_total[r["d"]] += r["q"]
    return by_item, dict(by_total)


# ---------------- คำนวณผลพยากรณ์ล่วงหน้า → 4 การ์ด AI ----------------
def forecast_next(st: MLState, meta: dict):
    """ทำนายอัตราวันถัดไป แล้วแปลงเป็น: วันของหมด / ควรสั่งเท่าไหร่ / งบ / lead time"""
    today = date.today()
    items_out = []
    total_cost_burden = 0.0

    for sku, m in meta.items():
        s_out = st.item_state["out"].get(sku)
        s_in = st.item_state["in"].get(sku)
        if not s_out:
            continue
        # อัตราเบิกออก/วัน ที่พยากรณ์ (ป้อนฟีเจอร์ของ "พรุ่งนี้")
        x_out = build_features(today, s_out)
        daily_out = st.fc["out"].predict_item(sku, x_out)

        stock = m["stock"]; lead = m["lead_time"]; cost = m["cost"]
        # เป้าหมาย 1: เทรนด์รายชิ้น (daily_out) | เป้าหมาย 2: ภาระค่าใช้จ่าย (qty×ราคา)
        stockout_days = round(stock / daily_out, 1) if daily_out > 1e-6 else None
        demand_lead = daily_out * lead                     # ต้องใช้ระหว่างรอของมาส่ง
        reorder_qty = max(0.0, round(demand_lead + m["min_stock"] - stock))
        reorder_budget = round(reorder_qty * cost, 2)
        total_cost_burden += reorder_budget

        if reorder_qty > 0 or (stockout_days is not None and stockout_days <= lead * 1.5):
            items_out.append({
                "sku": sku, "name": m["name"], "group": m["grp"],
                "predicted_daily_out": round(daily_out, 3),
                "current_stock": stock,
                "stockout_in_days": stockout_days,          # การ์ด 1: คาดว่าจะหมดในกี่วัน
                "reorder_qty": reorder_qty,                 # การ์ด 2: ควรสั่งเพิ่มเท่าไหร่
                "reorder_budget": reorder_budget,           # การ์ด 3: งบที่ต้องใช้
                "lead_time_days": lead,                     # การ์ด 4: กี่วันกว่าจะได้ของ
            })

    # เรียงตามความเร่งด่วน (ใกล้หมดก่อน)
    items_out.sort(key=lambda r: (r["stockout_in_days"] is None, r["stockout_in_days"] or 9e9))

    # ยอดรวมทั้งคลัง (เป้าหมาย 1+2 ระดับภาพรวม)
    x_total_out = build_features(today, st.total_state["out"])
    x_total_in = build_features(today, st.total_state["in"])
    return {
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "horizon_days": FORECAST_HORIZON_DAYS,
        "total": {
            "predicted_daily_out": round(st.fc["out"].predict_total(x_total_out), 2),
            "predicted_daily_in": round(st.fc["in"].predict_total(x_total_in), 2),
            "predicted_monthly_cost_burden": round(total_cost_burden, 2),
        },
        "model_health": {"in": st.fc["in"].report(), "out": st.fc["out"].report()},
        "reorder_suggestions": items_out[:100],   # ส่งเฉพาะที่ต้องสั่ง/ใกล้หมด
    }


# ---------------- main ----------------
def main():
    st = load_state()
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row

    latest_day = None
    for kind in ("in", "out"):
        raw = fetch_daily(conn, kind, st.watermark)       # เอาเฉพาะข้อมูลใหม่กว่า watermark
        by_item, by_total = group_rows(raw)
        # อนุกรมยอดรวม
        process_series(by_total, st.total_state[kind], st.total_guard[kind],
                       (lambda x, k=kind: st.fc[k].predict_total(x)),
                       (lambda x, y, k=kind: st.fc[k].learn_total(x, y)), None)
        # อนุกรมรายชิ้น
        for sku, series in by_item.items():
            process_series(series, st.item_state[kind][sku], st.item_guard[kind][sku],
                           (lambda x, s=sku, k=kind: st.fc[k].predict_item(s, x)),
                           (lambda x, y, s=sku, k=kind: st.fc[k].learn_item(s, x, y)), None)
        for r in raw:
            if latest_day is None or r["d"] > latest_day:
                latest_day = r["d"]

    if latest_day:
        st.watermark = latest_day        # เลื่อน watermark → รอบหน้าเรียนต่อจากนี้

    meta = fetch_item_meta(conn)
    result = forecast_next(st, meta)
    conn.close()

    os.makedirs(STATE_DIR, exist_ok=True)
    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)
    save_state(st)

    print(f"[ml] watermark={st.watermark} "
          f"items_tracked={result['model_health']['out']['items_tracked']} "
          f"reorder={len(result['reorder_suggestions'])} -> {OUT_PATH}")


if __name__ == "__main__":
    main()
