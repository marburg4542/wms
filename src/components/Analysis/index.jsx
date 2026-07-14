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

// กราฟแท่งเทียบ นำเข้า (เขียว) vs เบิกออก (ฟ้า) ต่อช่วงเวลา — ใช้ CSS ล้วน ไม่พึ่ง lib
function TrendChart({ trends }) {
  if (!trends.length) {
    return <div className="text-center py-16 opacity-50 text-sm">ยังไม่มีการเคลื่อนไหวจริงในช่วงนี้<br />(ยอดยกมาและการปรับยอดไม่ถูกนับเป็น trend)</div>;
  }
  const max = Math.max(1, ...trends.map(t => Math.max(t.inbound, t.outbound)));
  return (
    <div>
      <div className="flex gap-4 text-xs mb-3">
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-success inline-block" /> นำเข้า</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-info inline-block" /> เบิกออก</span>
      </div>
      <div className="overflow-x-auto">
        <div className="flex items-end gap-4 h-52 min-w-max px-2 border-b border-base-300 pb-0">
          {trends.map(t => (
            <div key={t.period} className="flex flex-col items-center gap-1 justify-end">
              <div className="flex items-end gap-1 h-44">
                <div className="w-5 bg-success rounded-t transition-all tooltip" data-tip={`นำเข้า ${nf(t.inbound)}`}
                  style={{ height: `${(t.inbound / max) * 100}%`, minHeight: t.inbound > 0 ? '3px' : '0' }} />
                <div className="w-5 bg-info rounded-t transition-all tooltip" data-tip={`เบิกออก ${nf(t.outbound)}`}
                  style={{ height: `${(t.outbound / max) * 100}%`, minHeight: t.outbound > 0 ? '3px' : '0' }} />
              </div>
              <span className="text-[10px] opacity-70 whitespace-nowrap">{t.period}</span>
            </div>
          ))}
        </div>
      </div>
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

// แยกตามหมวดหมู่ — แท่งแนวนอน
function CategoryBreakdown({ byCategory }) {
  if (!byCategory.length) return <div className="text-center py-8 opacity-50 text-sm">ยังไม่มีการเคลื่อนไหวแยกหมวดหมู่</div>;
  const max = Math.max(1, ...byCategory.map(c => Math.max(c.inbound, c.outbound)));
  return (
    <div className="space-y-3">
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

// พื้นที่ AI — เตรียมโครงไว้ ยังไม่เปิดใช้ (รอข้อมูลย้อนหลังพอสำหรับ train)
function AiForecastSection() {
  const cards = [
    { icon: '📅', title: 'คาดการณ์วันของหมด', desc: 'ประเมินว่าสินค้าแต่ละตัวจะหมดสต็อกวันไหน จากอัตราการเบิกที่ผ่านมา' },
    { icon: '📦', title: 'จำนวนที่ควรสั่งเพิ่ม', desc: 'แนะนำปริมาณสั่งซื้อที่เหมาะสม (reorder point / EOQ)' },
    { icon: '💰', title: 'งบประมาณสั่งซื้อ', desc: 'ประเมินงบที่ต้องใช้จากราคาล่าสุด × จำนวนที่ควรสั่ง' },
    { icon: '🚚', title: 'ระยะเวลาจัดส่ง', desc: 'คาดการณ์ lead time ต่อผู้ขาย เพื่อวางแผนสั่งล่วงหน้า' }
  ];
  return (
    <div className="card glass-panel p-6 relative overflow-hidden">
      <div className="absolute top-4 right-4">
        <span className="badge badge-primary badge-outline gap-1">🔒 เร็วๆ นี้</span>
      </div>
      <h2 className="font-bold text-xl text-gradient w-fit mb-1">🤖 ผู้ช่วย AI พยากรณ์คลังสินค้า</h2>
      <p className="text-sm text-base-content/60 mb-5 max-w-2xl">
        ส่วนนี้เตรียมพื้นที่ไว้สำหรับการวิเคราะห์ด้วย AI — ต้องสะสมข้อมูลการนำเข้า/เบิกออกจริงระยะหนึ่งก่อนจึงจะพยากรณ์ได้แม่นยำ
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {cards.map(c => (
          <div key={c.title} className="rounded-xl border border-base-300 bg-base-200/40 p-4 opacity-70">
            <div className="text-3xl mb-2">{c.icon}</div>
            <div className="font-semibold text-sm mb-1">{c.title}</div>
            <div className="text-xs text-base-content/60 leading-relaxed">{c.desc}</div>
            <div className="mt-3 text-[10px] font-semibold uppercase tracking-wide text-primary/70">รอข้อมูลฝึกโมเดล</div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function Analysis() {
  const [period, setPeriod] = useState('month');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    try {
      const json = await fetchApi(`/api/analysis?period=${period}`);
      if (json.success) setData(json);
    } catch (err) {
      console.error('Analysis fetch error:', err);
    } finally {
      if (!silent) setLoading(false);
    }
  }, [period]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const refresh = () => load({ silent: true });
    const off = onServerEvent('transactions', refresh);
    return off;
  }, [load]);

  if (loading || !data) return <div className="p-4"><DashboardSkeleton /></div>;

  const { trends, topByQty, topByFrequency, byCategory, totals } = data;

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

      {/* Trend */}
      <div className="card glass-panel p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-bold text-lg">แนวโน้มนำเข้า / เบิกออก</h2>
          <div className="join">
            <button className={`btn btn-sm join-item ${period === 'month' ? 'btn-primary text-white' : 'btn-ghost'}`} onClick={() => setPeriod('month')}>รายเดือน</button>
            <button className={`btn btn-sm join-item ${period === 'year' ? 'btn-primary text-white' : 'btn-ghost'}`} onClick={() => setPeriod('year')}>รายปี</button>
          </div>
        </div>
        <TrendChart trends={trends} />
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
