// ตัวเลือกตำแหน่งจัดเก็บ — สินค้าที่วางไว้หลายที่ ต้องเลือกได้ว่าจะให้พาไปจุดไหนบนผังคลัง
//
// เดิมทุกจุดลิงก์ไป /storage?highlight=<sku> ซึ่งวิ่งไปที่ "ตำแหน่งหลัก" (จุดที่มีของมากสุด) เท่านั้น
// ของที่กระจายอยู่หลายชั้นวางจึงเปิดดูจุดอื่นจากหน้ารายการไม่ได้เลย
//
// วางอยู่จุดเดียว → กดแล้วไปทันที ไม่ต้องเสียคลิกเปิดเมนูที่มีตัวเลือกเดียว
//
// เมนูวาดลงที่ document.body (portal) แล้ววางตำแหน่งเองแบบ fixed — ไม่ได้ซ้อนอยู่ในตาราง/การ์ด
// เพราะกรอบตารางหน้าสินค้าคงคลังเลื่อนซ้าย-ขวาได้ (overflow-x-auto) ซึ่งบังคับให้ตัดของที่ล้นลงล่างไปด้วย
// และการ์ดหน้ารายการอะไหล่ก็ตั้ง overflow-hidden — เดิมสินค้าแถวท้ายๆ กด 📍 แล้วเห็นเมนูแค่ขีดเดียว
// ค้นหาของตัวเดียว (ตารางเหลือแถวเดียว) จึงดูเหมือนกดแล้วไม่เกิดอะไรขึ้นเลย
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { fetchApi } from '../../utils/api';

// ผลครั้งก่อนของแต่ละ SKU — ไว้โชว์ทันทีตอนเปิดเมนูซ้ำ ระหว่างรอผลใหม่ (ไม่ใช่ตัวตัดสินว่าจะถามใหม่ไหม)
const locationCache = new Map();

export const locationRowLabel = (loc) => (
  [loc.areaName, loc.rackName, loc.storageLevel ? `เลเวล ${loc.storageLevel}` : null]
    .filter(Boolean).join(' · ') || 'ไม่ระบุตำแหน่ง'
);

const MENU_GAP = 4;      // ระยะห่างจากปุ่ม 📍
const SCREEN_MARGIN = 8; // ไม่ให้เมนูชิดขอบจอจนอ่านไม่ออก

export default function LocationPicker({ sku, locationCount = 0, label = '', variant = 'icon', className = '' }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [data, setData] = useState(() => locationCache.get(sku) || null);
  const [loading, setLoading] = useState(false);
  const [menuPos, setMenuPos] = useState(null);
  const buttonRef = useRef(null);
  const menuRef = useRef(null);

  // วางเมนูใต้ปุ่ม — ถ้าข้างล่างเหลือที่ไม่พอแต่ข้างบนเหลือมากกว่า ให้เปิดขึ้นด้านบนแทน
  // วัดจากความสูงจริงของเมนู (เปลี่ยนตอนโหลดเสร็จ) ไม่ใช่เดาเลขตายตัว
  const placeMenu = useCallback(() => {
    const button = buttonRef.current;
    const menu = menuRef.current;
    if (!button || !menu) return;
    const rect = button.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom - SCREEN_MARGIN;
    const spaceAbove = rect.top - SCREEN_MARGIN;
    const openUp = menu.offsetHeight + MENU_GAP > spaceBelow && spaceAbove > spaceBelow;
    setMenuPos({
      top: openUp ? Math.max(SCREEN_MARGIN, rect.top - MENU_GAP - menu.offsetHeight) : rect.bottom + MENU_GAP,
      left: Math.min(Math.max(SCREEN_MARGIN, rect.left), window.innerWidth - menu.offsetWidth - SCREEN_MARGIN),
    });
  }, []);

  useLayoutEffect(() => {
    if (open) placeMenu();
    else setMenuPos(null);
  }, [open, loading, data, placeMenu]);

  // คลิกที่อื่นหรือกด Esc แล้วปิดเมนู — เมนูนี้ลอยทับตาราง ถ้าไม่ปิดจะบังแถวอื่น
  //
  // เลื่อนจอ/ย่อขยายหน้าต่าง → ขยับเมนูตามปุ่ม (fixed ไม่เลื่อนตามเอง) ปิดก็ต่อเมื่อปุ่มหลุดจอไปแล้ว
  // ไม่ปิดทันทีที่มีการเลื่อน เพราะบนมือถือปัดจอแล้วแตะต่อ จอยังไหลอยู่อีกนิด
  // เมนูจะเปิดแล้วหุบทันที กลายเป็น "กดแล้วไม่เกิดอะไร" แบบเดียวกับที่แก้มา
  useEffect(() => {
    if (!open) return undefined;
    const isInside = (target) => buttonRef.current?.contains(target) || menuRef.current?.contains(target);
    const onPointerDown = (event) => { if (!isInside(event.target)) setOpen(false); };
    const onKey = (event) => { if (event.key === 'Escape') setOpen(false); };
    const onReflow = (event) => {
      if (event?.target instanceof Node && menuRef.current?.contains(event.target)) return;   // เลื่อนในเมนูเอง
      const rect = buttonRef.current?.getBoundingClientRect();
      if (!rect || rect.bottom < 0 || rect.top > window.innerHeight) setOpen(false);
      else placeMenu();
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onReflow, true);   // capture = จับการเลื่อนในกรอบตารางด้วย ไม่ใช่แค่ทั้งหน้า
    window.addEventListener('resize', onReflow);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onReflow, true);
      window.removeEventListener('resize', onReflow);
    };
  }, [open, placeMenu]);

  const goTo = (locationId = null) => {
    setOpen(false);
    navigate(`/storage?highlight=${encodeURIComponent(sku)}${locationId ? `&loc=${locationId}` : ''}`);
  };

  const handleClick = async () => {
    if (locationCount <= 1) return goTo();     // จุดเดียว (หรือไม่รู้จำนวน) → พฤติกรรมเดิม
    if (open) return setOpen(false);
    setOpen(true);
    // ถามใหม่ทุกครั้งที่เปิด — แคชเดิมอยู่ตลอดการใช้งาน (สลับหน้าในแอปไม่ล้าง) ถ้าเชื่อแคช
    // ปรับยอด/ย้ายของในผังคลังแล้วกลับมา เมนูจะยังโชว์ยอดเก่า ป้ายบอก "3 จุด" แต่ในเมนูมี 2
    // มีผลเดิมอยู่แล้ว → โชว์ไปก่อน ไม่ขึ้น "กำลังโหลด…" ให้เมนูกะพริบ
    if (!data) setLoading(true);
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
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={handleClick}
        className={className || (variant === 'icon' ? 'ml-1 align-middle' : 'text-[10px] text-primary')}
        title={label ? `ตำแหน่ง: ${label}${locationCount > 1 ? ` (วางอยู่ ${locationCount} จุด)` : ''}` : 'ดูตำแหน่งจัดเก็บ'}
        aria-label={`ตำแหน่งจัดเก็บของ ${sku}`}
      >
        📍{variant === 'text' && label ? ` ${label}` : ''}
        {locationCount > 1 && <span className="badge badge-ghost badge-xs ml-1 align-middle">{locationCount} จุด</span>}
      </button>

      {open && createPortal(
        // z สูงกว่า popup รูปใหญ่หน้าสินค้าคงคลัง (z-[110]) ซึ่งมีปุ่ม 📍 อยู่ข้างในด้วย
        // ก่อนรู้ตำแหน่ง (รอบวัดความสูงแรก) ซ่อนไว้ก่อน ไม่งั้นจะเห็นเมนูกะพริบที่มุมจอ
        <div
          ref={menuRef}
          style={menuPos ? { top: menuPos.top, left: menuPos.left } : { top: 0, left: 0, visibility: 'hidden' }}
          className="fixed z-[200] max-h-[60vh] w-64 overflow-y-auto rounded-xl border border-base-300 bg-base-100 p-2 text-left text-base-content shadow-xl"
        >
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
        </div>,
        document.body
      )}
    </>
  );
}
