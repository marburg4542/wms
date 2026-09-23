// ตัวเลือกตำแหน่งจัดเก็บ — สินค้าที่วางไว้หลายที่ ต้องเลือกได้ว่าจะให้พาไปจุดไหนบนผังคลัง
//
// เดิมทุกจุดลิงก์ไป /storage?highlight=<sku> ซึ่งวิ่งไปที่ "ตำแหน่งหลัก" (จุดที่มีของมากสุด) เท่านั้น
// ของที่กระจายอยู่หลายชั้นวางจึงเปิดดูจุดอื่นจากหน้ารายการไม่ได้เลย
//
// วางอยู่จุดเดียว → กดแล้วไปทันที ไม่ต้องเสียคลิกเปิดเมนูที่มีตัวเลือกเดียว
import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { fetchApi } from '../../utils/api';

// จำผลไว้ระหว่างเปิดหน้า กดปิด-เปิดซ้ำจะได้ไม่ยิงซ้ำ (หายเองตอนรีโหลดหน้า)
const locationCache = new Map();

export const locationRowLabel = (loc) => (
  [loc.areaName, loc.rackName, loc.storageLevel ? `เลเวล ${loc.storageLevel}` : null]
    .filter(Boolean).join(' · ') || 'ไม่ระบุตำแหน่ง'
);

export default function LocationPicker({ sku, locationCount = 0, label = '', variant = 'icon' }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [data, setData] = useState(() => locationCache.get(sku) || null);
  const [loading, setLoading] = useState(false);
  const boxRef = useRef(null);

  // คลิกที่อื่นหรือกด Esc แล้วปิดเมนู — เมนูนี้ลอยทับตาราง ถ้าไม่ปิดจะบังแถวอื่น
  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event) => { if (!boxRef.current?.contains(event.target)) setOpen(false); };
    const onKey = (event) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const goTo = (locationId = null) => {
    setOpen(false);
    navigate(`/storage?highlight=${encodeURIComponent(sku)}${locationId ? `&loc=${locationId}` : ''}`);
  };

  const handleClick = async () => {
    if (locationCount <= 1) return goTo();     // จุดเดียว (หรือไม่รู้จำนวน) → พฤติกรรมเดิม
    if (open) return setOpen(false);
    setOpen(true);
    if (data) return undefined;
    setLoading(true);
    try {
      const result = await fetchApi(`/api/storage-map/locations/${encodeURIComponent(sku)}`, { suppressErrorToast: true });
      if (result.success) {
        locationCache.set(sku, result);
        setData(result);
      }
    } catch {
      // เรียกไม่สำเร็จก็ยังพาไปตำแหน่งหลักได้ ไม่ต้องค้างอยู่กับเมนูเปล่า
      setOpen(false);
      toast.error('โหลดรายการตำแหน่งไม่สำเร็จ');
      goTo();
    } finally {
      setLoading(false);
    }
    return undefined;
  };

  const rows = (data?.locations || []).filter((loc) => Number(loc.quantity) > 0);

  return (
    <span className="relative inline-block" ref={boxRef}>
      <button
        type="button"
        onClick={handleClick}
        className={variant === 'icon' ? 'ml-1 align-middle' : 'text-[10px] text-primary'}
        title={label ? `ตำแหน่ง: ${label}${locationCount > 1 ? ` (วางอยู่ ${locationCount} จุด)` : ''}` : 'ดูตำแหน่งจัดเก็บ'}
        aria-label={`ตำแหน่งจัดเก็บของ ${sku}`}
      >
        📍{variant === 'text' && label ? ` ${label}` : ''}
        {locationCount > 1 && <span className="badge badge-ghost badge-xs ml-1 align-middle">{locationCount} จุด</span>}
      </button>

      {open && (
        <div className="absolute left-0 z-50 mt-1 w-64 rounded-xl border border-base-300 bg-base-100 p-2 text-left shadow-xl">
          <p className="px-1 pb-1 text-[11px] font-semibold opacity-60">เลือกตำแหน่งที่จะดูบนผังคลัง</p>
          {loading && <p className="px-1 py-2 text-xs opacity-60">กำลังโหลด…</p>}
          {!loading && rows.length === 0 && <p className="px-1 py-2 text-xs opacity-60">ยังไม่มีข้อมูลตำแหน่ง</p>}
          {rows.map((loc) => (
            <button
              key={loc.id}
              type="button"
              onClick={() => goTo(loc.id)}
              className="flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left text-xs hover:bg-base-200"
            >
              <span className="min-w-0 truncate">📍 {locationRowLabel(loc)}</span>
              <span className="shrink-0 font-semibold">{Number(loc.quantity).toLocaleString()}</span>
            </button>
          ))}
          {Number(data?.unplaced) > 0 && (
            <p className="px-2 pt-1 text-[11px] text-warning">ยังไม่ระบุตำแหน่ง {Number(data.unplaced).toLocaleString()} ชิ้น</p>
          )}
        </div>
      )}
    </span>
  );
}
