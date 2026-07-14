// หน้าวิเคราะห์ — trend นำเข้า/เบิกออก (รายเดือน/ปี), สินค้าที่เบิกเยอะ/บ่อย, แยกหมวดหมู่ + พื้นที่ AI (เตรียมไว้)
import React, { useCallback, useEffect, useState } from 'react';
import { fetchApi } from '../../utils/api';
import { onServerEvent } from '../../utils/events';
import { DashboardSkeleton } from '../Skeleton';

const nf = (n) => Number(n || 0).toLocaleString();
const baht = (n) => '฿' + Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// การ์ดตัวเลขสรุป
function StatCard({ label, value, sub, accent = 'text-primary' }) {
  return (
    <div className="stats glass-panel">
      <div className="stat">
        <div className="stat-title text-xs font-semibold">{label}</div>
        <div className={`stat-value text-2xl ${accent}`}>{value}</div>
        {sub && <div className="stat-desc text-xs mt-1">{sub}</div>}
      </div>
    </div>
  );
}

// กราฟเส้น: แกน X = วันที่ (หรือเดือน), แกน Y = จำนวนอะไหล่ — นำเข้า (เขียว) vs เบิกออก (ฟ้า)
function LineChart({ points, xLabel }) {
  if (!points || points.length === 0) {
    return <div className="text-center py-16 opacity-50 text-sm">ไม่มีข้อมูลในช่วงที่เลือก</div>;
  }
  const H = 300, PAD_L = 58, PAD_R = 16, PAD_T = 12, PAD_B = 46;  // เผื่อที่สำหรับชื่อแกน X/Y
  const n = points.length;
  const W = Math.max(640, n * 28);          // กว้างตามจำนวนจุด (เลื่อนแนวนอนได้ถ้าเยอะ)
  const plotW = W - PAD_L - PAD_R;
  const plotH = H - PAD_T - PAD_B;
  const yMax = Math.max(1, ...points.map(p => Math.max(p.inbound, p.outbound)));
  const x = (i) => PAD_L + (n === 1 ? plotW / 2 : (i / (n - 1)) * plotW);
  const y = (v) => PAD_T + plotH - (v / yMax) * plotH;
  const pathOf = (key) => points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p[key]).toFixed(1)}`).join(' ');
  const yTicks = 4;
  const xEvery = Math.ceil(n / 12);         // โชว์ label แกน x ห่างๆ กันรก
  const yMid = PAD_T + plotH / 2;

  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} className="max-w-none">
        {/* เส้นตาราง + ป้ายค่าแกน Y */}
        {Array.from({ length: yTicks + 1 }, (_, i) => {
          const v = (yMax / yTicks) * i;
          const yy = y(v);
          return (
            <g key={i}>
              <line x1={PAD_L} y1={yy} x2={W - PAD_R} y2={yy} className="stroke-base-300" strokeWidth="1" />
              <text x={PAD_L - 8} y={yy + 3} textAnchor="end" className="fill-base-content/50" fontSize="9">{nf(Math.round(v))}</text>
            </g>
          );
        })}
        {/* ป้ายค่าแกน X (วันที่/เดือน) */}
        {points.map((p, i) => (i % xEvery === 0 || i === n - 1) ? (
          <text key={`x${i}`} x={x(i)} y={PAD_T + plotH + 16} textAnchor="middle" className="fill-base-content/50" fontSize="9">{p.label}</text>
        ) : null)}
        {/* เส้นข้อมูล */}
        <g className="text-success"><path d={pathOf('inbound')} fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" /></g>
        <g className="text-info"><path d={pathOf('outbound')} fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" /></g>
        {/* จุดบนเส้น (เฉพาะวันที่มียอด) */}
        {points.map((p, i) => (
          <g key={`d${i}`}>
            {p.inbound > 0 && <circle cx={x(i)} cy={y(p.inbound)} r="2.5" className="fill-success" />}
            {p.outbound > 0 && <circle cx={x(i)} cy={y(p.outbound)} r="2.5" className="fill-info" />}
          </g>
        ))}
        {/* ชื่อแกน */}
        <text x={16} y={yMid} transform={`rotate(-90 16 ${yMid})`} textAnchor="middle" className="fill-base-content/70 font-medium" fontSize="11">จำนวนอะไหล่</text>
        <text x={PAD_L + plotW / 2} y={H - 6} textAnchor="middle" className="fill-base-content/70 font-medium" fontSize="11">{xLabel}</text>
      </svg>
    </div>
  );
}

// ตารางอันดับสินค้า
function TopTable({ title, rows, valueKey, valueLabel, unit }) {
  return (
    <div className="card glass-panel p-5">
      <h3 className="font-bold mb-3">{title}</h3>
      {rows.length === 0 ? (
        <div className="text-center py-8 opacity-50 text-sm">ยังไม่มีข้อมูลการเบิก</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="table table-sm">
            <thead><tr><th>#</th><th>รหัส</th><th>ชื่อสินค้า</th><th className="text-right">{valueLabel}</th></tr></thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.sku} className="hover:bg-base-200/40">
                  <td className="opacity-50">{i + 1}</td>
                  <td className="font-mono text-xs font-semibold">{r.sku}</td>
                  <td className="text-sm max-w-[220px] truncate" title={r.name}>{r.name}</td>
                  <td className="text-right font-bold">{nf(r[valueKey])} <span className="text-xs opacity-60 font-normal">{unit}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// แยกตามหมวดหมู่ — แท่งแนวนอน แสดงครบทุกหมวด (01-23) เลื่อนดูภายในกรอบได้
function CategoryBreakdown({ byCategory }) {
  if (!byCategory.length) return <div className="text-center py-8 opacity-50 text-sm">ยังไม่มีการเคลื่อนไหวแยกหมวดหมู่</div>;
  const max = Math.max(1, ...byCategory.map(c => Math.max(c.inbound, c.outbound)));
  return (
    <div className="max-h-[420px] overflow-y-auto pr-1 space-y-3">
      {byCategory.map(c => (
        <div key={c.groupId}>
          <div className="flex justify-between text-xs mb-1">
            <span className="font-medium">{c.groupId} — {c.groupName}</span>
            <span className="opacity-60">เข้า {nf(c.inbound)} · ออก {nf(c.outbound)}</span>
          </div>
          <div className="space-y-1">
            <div className="h-2.5 rounded-full bg-success/80" style={{ width: `${(c.inbound / max) * 100}%`, minWidth: c.inbound > 0 ? '4px' : '0' }} />
            <div className="h-2.5 rounded-full bg-info/80" style={{ width: `${(c.outbound / max) * 100}%`, minWidth: c.outbound > 0 ? '4px' : '0' }} />
          </div>
        </div>
      ))}
    </div>
  );
}

// การ์ด placeholder ตอนที่ ML ยังไม่ได้รัน (ไม่มี forecasts.json)
function ForecastPlaceholder({ note }) {
  const cards = [
    { icon: '📅', title: 'คาดการณ์วันของหมด', desc: 'ประเมินว่าสินค้าแต่ละตัวจะหมดสต็อกวันไหน จากอัตราการเบิกที่ผ่านมา' },
    { icon: '📦', title: 'จำนวนที่ควรสั่งเพิ่ม', desc: 'แนะนำปริมาณสั่งซื้อที่เหมาะสม (reorder point)' },
    { icon: '💰', title: 'งบประมาณสั่งซื้อ', desc: 'ประเมินงบที่ต้องใช้จากราคาล่าสุด × จำนวนที่ควรสั่ง' },
    { icon: '🚚', title: 'ระยะเวลาจัดส่ง', desc: 'คาดการณ์ lead time ต่อผู้ขาย เพื่อวางแผนสั่งล่วงหน้า' }
  ];
  return (
    <div className="card glass-panel p-6 relative overflow-hidden">
      <div className="absolute top-4 right-4"><span className="badge badge-primary badge-outline gap-1">🔒 รอข้อมูล</span></div>
      <h2 className="font-bold text-xl text-gradient w-fit mb-1">🤖 ผู้ช่วย AI พยากรณ์คลังสินค้า</h2>
      <p className="text-sm text-base-content/60 mb-5 max-w-2xl">{note}</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {cards.map(c => (
          <div key={c.title} className="rounded-xl border border-base-300 bg-base-200/40 p-4 opacity-70">
            <div className="text-3xl mb-2">{c.icon}</div>
            <div className="font-semibold text-sm mb-1">{c.title}</div>
            <div className="text-xs text-base-content/60 leading-relaxed">{c.desc}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// พื้นที่ AI — ดึงผลพยากรณ์จริงจาก ML service (/api/analysis/forecast) มาแสดง
function AiForecastSection() {
  const [fc, setFc] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    fetchApi('/api/analysis/forecast')
      .then(j => { if (alive) setFc(j); })
      .catch(() => { if (alive) setFc({ available: false }); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  if (loading) {
    return <div className="card glass-panel p-6 flex items-center gap-3"><span className="loading loading-spinner text-primary" /> กำลังโหลดผลพยากรณ์ AI...</div>;
  }
  if (!fc?.available) {
    return <ForecastPlaceholder note="ยังไม่มีผลพยากรณ์ — ให้รัน ML pipeline (ml/pipeline.py) เพื่อสร้างผลจากข้อมูลจริง แล้วผลจะขึ้นตรงนี้อัตโนมัติ" />;
  }

  const { total = {}, model_health = {}, reorder_suggestions = [], stale, ageHours } = fc;
  const seen = model_health?.out?.total_seen ?? 0;
  const mae = model_health?.out?.total_mae;
  const preliminary = seen < 30; // ข้อมูลยังน้อย = ผลเบื้องต้น

  return (
    <div className="card glass-panel p-6 space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="font-bold text-xl text-gradient w-fit mb-1">🤖 ผู้ช่วย AI พยากรณ์คลังสินค้า</h2>
          <p className="text-sm text-base-content/60">พยากรณ์ demand + แนะนำการสั่งซื้อ จากโมเดล online learning</p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <span className={`badge gap-1 ${stale ? 'badge-warning' : 'badge-success'} text-white`}>
            {stale ? `⚠️ ข้อมูล ${ageHours} ชม.` : '🟢 อัปเดตล่าสุด'}
          </span>
          {preliminary && <span className="text-[10px] text-warning">ผลเบื้องต้น (โมเดลเพิ่งเรียนรู้ {seen} จุด)</span>}
        </div>
      </div>

      {/* สรุปภาพรวมที่พยากรณ์ */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="rounded-xl bg-base-200/50 p-3">
          <div className="text-xs opacity-60">เบิกออก/วัน (คาด)</div>
          <div className="text-xl font-bold text-info">{nf(total.predicted_daily_out)}</div>
        </div>
        <div className="rounded-xl bg-base-200/50 p-3">
          <div className="text-xs opacity-60">รับเข้า/วัน (คาด)</div>
          <div className="text-xl font-bold text-success">{nf(total.predicted_daily_in)}</div>
        </div>
        <div className="rounded-xl bg-base-200/50 p-3">
          <div className="text-xs opacity-60">งบสั่งซื้อ/เดือน (คาด)</div>
          <div className="text-xl font-bold text-primary">{baht(total.predicted_monthly_cost_burden)}</div>
        </div>
        <div className="rounded-xl bg-base-200/50 p-3">
          <div className="text-xs opacity-60">ความคลาดเคลื่อนโมเดล (MAE)</div>
          <div className="text-xl font-bold">{mae != null ? nf(mae) : '—'}</div>
        </div>
      </div>

      {/* ตารางแนะนำการสั่งซื้อ — แมป 4 ความสามารถ AI เป็นคอลัมน์ */}
      <div>
        <h3 className="font-bold mb-1">📋 รายการที่ควรสั่งเพิ่ม (เรียงตามความเร่งด่วน)</h3>
        <p className="text-xs text-base-content/50 mb-3">คำนวณจาก: อัตราเบิกที่พยากรณ์ × lead time เทียบกับยอดคงเหลือ</p>
        {reorder_suggestions.length === 0 ? (
          <div className="text-center py-8 opacity-50 text-sm">ยังไม่มีรายการที่ต้องสั่งเพิ่มในตอนนี้ 👍</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="table table-sm">
              <thead>
                <tr>
                  <th>รหัส</th><th>ชื่อสินค้า</th>
                  <th className="text-right">คงเหลือ</th>
                  <th className="text-right">📅 หมดใน (วัน)</th>
                  <th className="text-right">📦 ควรสั่ง</th>
                  <th className="text-right">💰 งบ</th>
                  <th className="text-right">🚚 Lead (วัน)</th>
                </tr>
              </thead>
              <tbody>
                {reorder_suggestions.map(r => {
                  const urgent = r.stockout_in_days != null && r.stockout_in_days <= r.lead_time_days;
                  return (
                    <tr key={r.sku} className="hover:bg-base-200/40">
                      <td className="font-mono text-xs font-semibold">{r.sku}</td>
                      <td className="text-sm max-w-[200px] truncate" title={r.name}>{r.name}</td>
                      <td className="text-right">{nf(r.current_stock)}</td>
                      <td className={`text-right font-bold ${urgent ? 'text-error' : ''}`}>
                        {r.stockout_in_days == null ? '—' : r.stockout_in_days}
                        {urgent && ' ⚠️'}
                      </td>
                      <td className="text-right font-bold text-primary">{nf(r.reorder_qty)}</td>
                      <td className="text-right">{r.reorder_budget > 0 ? baht(r.reorder_budget) : '—'}</td>
                      <td className="text-right opacity-70">{r.lead_time_days}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

export default function Analysis() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [trendMode, setTrendMode] = useState('month');   // 'month' = รายวันในเดือน | 'year' = รายเดือนในปี
  const [trendValue, setTrendValue] = useState('');       // เดือน '2026-07' หรือปี '2026' ที่เลือก
  const [trendPoints, setTrendPoints] = useState([]);

  const load = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    try {
      const json = await fetchApi('/api/analysis');
      if (json.success) {
        setData(json);
        // ครั้งแรกตั้ง dropdown เป็นเดือนล่าสุดที่มีข้อมูล
        setTrendValue(prev => prev || json.availableMonths?.[0] || '');
      }
    } catch (err) {
      console.error('Analysis fetch error:', err);
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const off = onServerEvent('transactions', () => load({ silent: true }));
    return off;
  }, [load]);

  // ดึงข้อมูลกราฟเส้นเมื่อเปลี่ยนโหมด/ช่วงที่เลือก
  useEffect(() => {
    if (!trendValue) { setTrendPoints([]); return; }
    let alive = true;
    fetchApi(`/api/analysis/trend?mode=${trendMode}&value=${encodeURIComponent(trendValue)}`)
      .then(j => { if (alive && j.success) setTrendPoints(j.points || []); })
      .catch(() => { if (alive) setTrendPoints([]); });
    return () => { alive = false; };
  }, [trendMode, trendValue]);

  if (loading || !data) return <div className="p-4"><DashboardSkeleton /></div>;

  const { topByQty, topByFrequency, byCategory, totals, availableMonths = [], availableYears = [] } = data;
  const trendOptions = trendMode === 'year' ? availableYears : availableMonths;
  // สลับโหมด → เลือกค่าล่าสุดของโหมดนั้นให้อัตโนมัติ (กัน value ไม่ตรงชนิด)
  const switchMode = (m) => { setTrendMode(m); setTrendValue((m === 'year' ? availableYears : availableMonths)[0] || ''); };

  return (
    <div className="p-4 space-y-6 animate-fade-in">
      <div className="glass-panel p-5 rounded-2xl">
        <h1 className="text-2xl font-bold text-gradient w-fit">วิเคราะห์คลังสินค้า</h1>
        <p className="text-sm text-base-content/60 mt-1">แนวโน้มการนำเข้า/เบิกออก และสินค้าที่เคลื่อนไหวมากที่สุด</p>
      </div>

      {/* การ์ดสรุป */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <StatCard label="นำเข้ารวม (ชิ้น)" value={nf(totals.totalInbound)} accent="text-success" />
        <StatCard label="เบิกออกรวม (ชิ้น)" value={nf(totals.totalOutbound)} accent="text-info" />
        <StatCard label="สินค้าที่ใช้งาน" value={nf(totals.activeItems)} />
        <StatCard label="มูลค่าสต็อก" value={baht(totals.stockValue)} accent="text-primary" sub="เฉพาะรายการที่มีราคา" />
        <StatCard label="ยอดคลาดเคลื่อน" value={nf(totals.discrepancyItems)} accent="text-warning" sub="สินค้ายอดติดลบ" />
      </div>

      {/* Trend (กราฟเส้น เลือกเดือน/ปีได้) */}
      <div className="card glass-panel p-5">
        <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
          {/* ซ้าย: หัวข้อ + ปุ่มรายเดือน/รายปี + dropdown เลือกช่วง */}
          <div className="flex items-center gap-3 flex-wrap">
            <h2 className="font-bold text-lg">แนวโน้มนำเข้า / เบิกออก</h2>
            <div className="join shrink-0">
              <button className={`btn btn-sm join-item ${trendMode === 'month' ? 'btn-primary text-white' : 'btn-ghost'}`} onClick={() => switchMode('month')}>รายเดือน</button>
              <button className={`btn btn-sm join-item ${trendMode === 'year' ? 'btn-primary text-white' : 'btn-ghost'}`} onClick={() => switchMode('year')}>รายปี</button>
            </div>
            <select className="select select-bordered select-sm shrink-0" value={trendValue} onChange={(e) => setTrendValue(e.target.value)}>
              {trendOptions.length === 0 && <option value="">— ไม่มีข้อมูล —</option>}
              {trendOptions.map(o => <option key={o} value={o}>{o}</option>)}
            </select>
          </div>
          {/* ขวาสุด: legend */}
          <div className="flex items-center gap-4 text-xs shrink-0">
            <span className="flex items-center gap-1"><span className="w-4 h-0.5 bg-success inline-block" /> นำเข้า</span>
            <span className="flex items-center gap-1"><span className="w-4 h-0.5 bg-info inline-block" /> เบิกออก</span>
          </div>
        </div>
        <LineChart points={trendPoints} xLabel={trendMode === 'month' ? 'วันที่ในเดือน' : 'เดือนในปี'} />
        <p className="text-[10px] opacity-40 text-right mt-1">นับเฉพาะการเคลื่อนไหวจริง (ไม่รวมยอดยกมา/ปรับยอด)</p>
      </div>

      {/* สินค้าที่เบิกเยอะ/บ่อย */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <TopTable title="🔝 เบิกออกมากที่สุด (จำนวนชิ้น)" rows={topByQty} valueKey="qty" valueLabel="จำนวนเบิก" unit="ชิ้น" />
        <TopTable title="🔁 เบิกออกบ่อยที่สุด (จำนวนครั้ง)" rows={topByFrequency} valueKey="times" valueLabel="จำนวนครั้ง" unit="ครั้ง" />
      </div>

      {/* หมวดหมู่ */}
      <div className="card glass-panel p-5">
        <h2 className="font-bold text-lg mb-4">การเคลื่อนไหวแยกตามหมวดหมู่</h2>
        <CategoryBreakdown byCategory={byCategory} />
      </div>

      {/* AI */}
      <AiForecastSection />
    </div>
  );
}
