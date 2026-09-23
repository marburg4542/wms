// ฟอร์มปรับยอดสต็อกตามการนับจริง — ใช้ร่วมกันระหว่างหน้ารายการอะไหล่กับรูปใหญ่ในผังคลัง
// แยกออกมาเป็นตัวเดียว เพราะกติกาหักของออกจากชั้นต้องเหมือนกันทุกทางเข้า
// ถ้าเขียนสองชุด วันหนึ่งจะแก้ชุดเดียวแล้วสองหน้าปรับยอดได้ผลไม่เท่ากัน
//
// focus = { rackId, level } เมื่อเปิดจากจุดบนผังคลัง (คนยืนนับอยู่หน้าชั้นนั้น)
//   นับได้น้อยลง → เติมให้ก่อนว่าหายจากจุดนี้ (แก้ได้ถ้าหายจากที่อื่นด้วย)
//   นับได้มากขึ้น → เสนอวางของที่เกินไว้ที่จุดนี้เลย แทนการไปกองที่ "ยังไม่ระบุตำแหน่ง"
import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import toast from 'react-hot-toast';
import { fetchApi } from '../../utils/api';
import { locationRowLabel } from '../LocationPicker';

export default function AdjustStockModal({ product, focus = null, onClose, onDone }) {
  // เติมยอดปัจจุบันไว้ให้ ผู้ใช้แก้เป็นจำนวนที่นับได้จริง (ถ้าไม่เปลี่ยน = ไม่ปรับ)
  const currentStock = Number(product.stock || 0);
  const [countedQty, setCountedQty] = useState(String(currentStock));
  const [note, setNote] = useState('');
  const [locations, setLocations] = useState([]);   // ของตัวนี้วางอยู่ที่ไหนบ้าง
  const [cuts, setCuts] = useState({});             // locationId -> จำนวนที่หายไปจากที่นั้น
  const [cutsTouched, setCutsTouched] = useState(false);
  const [placeHere, setPlaceHere] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  // ถ้านับได้น้อยกว่าที่วางไว้ ต้องรู้ก่อนว่าของหายจากชั้นไหน จึงดึงตำแหน่งมาเตรียมไว้เลย
  useEffect(() => {
    let alive = true;
    fetchApi(`/api/storage-map/locations/${encodeURIComponent(product.sku)}`)
      .then((result) => { if (alive && result.success) setLocations(result.locations.filter((loc) => Number(loc.quantity) > 0)); })
      .catch(() => {});
    return () => { alive = false; };
  }, [product.sku]);

  // ข้อมูลชั้นวางไม่ได้ส่งเลขตำแหน่งมา จึงจับคู่จากชั้นวาง+เลเวลแทน
  const focusLoc = useMemo(() => (focus
    ? locations.find((loc) => Number(loc.rackId) === Number(focus.rackId) && Number(loc.storageLevel || 0) === Number(focus.level || 0)) || null
    : null), [focus, locations]);

  const counted = countedQty === '' ? null : Number(countedQty);
  const delta = counted == null ? 0 : counted - currentStock;
  const placed = locations.reduce((sum, loc) => sum + Number(loc.quantity), 0);
  const excess = counted == null ? 0 : placed - counted;

  // เปิดจากจุดบนผัง = คนยืนนับอยู่ตรงนั้น ของที่ขาดน่าจะหายจากจุดนี้ก่อน — เติมให้ แต่ถ้าแก้เองแล้วไม่ไปทับ
  const effectiveCuts = cutsTouched || !focusLoc || excess <= 0
    ? cuts
    : { [focusLoc.id]: String(Math.min(excess, Number(focusLoc.quantity))) };
  const setCut = (locationId, value) => {
    setCuts({ ...effectiveCuts, [locationId]: value });
    setCutsTouched(true);
  };

  const submit = async (event) => {
    event.preventDefault();
    if (!Number.isInteger(counted) || counted < 0) return toast.error('จำนวนที่นับได้ต้องเป็นจำนวนเต็มไม่ติดลบ');

    setSubmitting(true);
    try {
      const deductions = Object.entries(effectiveCuts)
        .map(([locationId, quantity]) => ({ locationId: Number(locationId), quantity: Number(quantity) || 0 }))
        .filter((entry) => entry.quantity > 0);
      const placeAt = delta > 0 && focusLoc && placeHere ? focusLoc.id : null;
      const json = await fetchApi('/api/transactions/adjust', {
        method: 'POST',
        body: JSON.stringify({
          sku: product.sku,
          countedQty: counted,
          note,
          ...(deductions.length ? { deductions } : {}),
          ...(placeAt ? { placeAt } : {})
        })
      });
      if (json.needsLocationChoice) {
        setLocations(json.locations.map((loc) => ({
          id: loc.locationId, rackName: loc.place, storageLevel: loc.storageLevel, quantity: loc.quantity
        })));
        toast.error(`ของวางอยู่หลายที่ — ระบุก่อนว่าหายไปจากที่ไหนรวม ${json.excess} ชิ้น`);
        return undefined;
      }
      if (json.success) {
        toast.success(json.adjusted
          ? `${json.message}${placeAt ? ` · วางเพิ่มที่ ${locationRowLabel(focusLoc)} ${delta} ชิ้น` : ''}`
          : 'ยอดตรงกับระบบอยู่แล้ว ไม่มีการเปลี่ยนแปลง');
        await onDone?.(json);
      }
    } catch (err) {
      console.error('Adjust failed:', err);
    } finally {
      setSubmitting(false);
    }
    return undefined;
  };

  // portal + z-[120]: เปิดได้จากในรูปใหญ่ของผังคลัง (z-[110]) ซึ่งซ้อนอยู่บนผังชั้นวางอีกที
  // stopPropagation: event ของ portal ยังไหลขึ้นไปหา component แม่ใน React
  // ถ้าไม่กัน คลิกในฟอร์มจะไปโดนพื้นหลังของผังชั้นวางแล้วปิดทุกอย่างทิ้ง
  return createPortal(
    <div className="fixed inset-0 z-[120] flex items-center justify-center backdrop-blur-md p-4" onClick={(event) => event.stopPropagation()}>
      <div className="glass-modal w-full max-w-md p-5 sm:p-6 rounded-2xl animate-fade-in max-h-[85vh] overflow-y-auto">
        <h3 className="font-bold text-lg text-warning border-b border-base-200 pb-3 mb-4">ปรับยอดสต็อก (นับจริง)</h3>
        <form onSubmit={submit} className="space-y-4">
          <div className="text-sm bg-base-200/50 rounded-lg p-3">
            <div className="font-mono font-semibold">{product.sku}</div>
            <div className="opacity-70">{product.name}</div>
            <div className="mt-1">ยอดในระบบตอนนี้: <span className="font-bold">{currentStock}</span></div>
            {focusLoc && (
              <div className="mt-1 text-xs opacity-80">
                เปิดจาก 📍 {locationRowLabel(focusLoc)} — ในระบบวางไว้ที่นี่ <b>{Number(focusLoc.quantity)}</b> ชิ้น
              </div>
            )}
          </div>
          <label className="form-control w-full">
            <span className="label-text text-sm font-medium mb-1">จำนวนที่นับได้จริง (รวมทุกจุด)</span>
            <input type="number" min="0" step="1" className="input input-bordered w-full" value={countedQty}
              onChange={(event) => setCountedQty(event.target.value)} required autoFocus />
          </label>
          {/* แสดงส่วนต่างให้เห็นก่อนกดยืนยัน */}
          {counted != null && delta !== 0 && (
            <div className="text-sm">ส่วนต่าง: <span className={`font-bold ${delta > 0 ? 'text-success' : 'text-error'}`}>
              {delta > 0 ? '+' : ''}{delta}
            </span></div>
          )}

          {/* นับเกิน + เปิดมาจากจุดบนผัง → ของที่เกินอยู่ตรงหน้าคนนับ วางที่นี่เลย (เอาติ๊กออกได้ถ้าเจอที่อื่น) */}
          {delta > 0 && focusLoc && (
            <label className="flex cursor-pointer items-start gap-2 rounded-xl border border-success/40 bg-success/10 p-3 text-sm">
              <input type="checkbox" className="checkbox checkbox-sm checkbox-success mt-0.5" checked={placeHere} onChange={(event) => setPlaceHere(event.target.checked)} />
              <span>
                วางของที่เพิ่ม <b>+{delta}</b> ไว้ที่ <b>{locationRowLabel(focusLoc)}</b> เลย
                <span className="block text-xs opacity-70">
                  {placeHere ? `จุดนี้จะมี ${Number(focusLoc.quantity) + delta} ชิ้น` : 'ของที่เพิ่มจะไปอยู่ที่ "ยังไม่ระบุตำแหน่ง" ต้องผูกตำแหน่งเองทีหลัง'}
                </span>
              </span>
            </label>
          )}

          {/* นับได้น้อยกว่าที่วางไว้บนชั้น = ของหายไปจากชั้นด้วย ต้องบอกระบบว่าหายจากที่ไหน
              ไม่งั้นผังคลังจะยังบอกว่ามีของอยู่ ทั้งที่บัญชีบอกว่าหมดแล้ว */}
          {(() => {
            if (excess <= 0 || locations.length === 0) return null;
            const single = locations.length === 1;
            const allocated = locations.reduce((sum, loc) => sum + (Number(effectiveCuts[loc.id]) || 0), 0);
            const left = excess - (single ? excess : allocated);
            return (
              <div className="rounded-xl border border-warning/50 bg-warning/10 p-3 space-y-2">
                <div className="text-sm font-bold">ของบนชั้นหายไป {excess} ชิ้น — หายจากที่ไหน?</div>
                {single ? (
                  <p className="text-xs">
                    วางอยู่ที่เดียวคือ <b>{locationRowLabel(locations[0])}</b> ({locations[0].quantity} ชิ้น)
                    — ระบบจะหักออกจากที่นี่ให้อัตโนมัติ
                  </p>
                ) : (
                  <>
                    {locations.map((loc) => (
                      <div key={loc.id} className="flex items-center gap-2">
                        <span className="flex-1 truncate text-xs">
                          📍 {locationRowLabel(loc)}
                          <span className="opacity-60"> (มี {loc.quantity})</span>
                          {focusLoc?.id === loc.id && <span className="badge badge-warning badge-xs ml-1">จุดนี้</span>}
                        </span>
                        <input
                          type="number" min="0" max={loc.quantity}
                          className="input input-bordered input-xs w-20"
                          value={effectiveCuts[loc.id] ?? ''}
                          placeholder="0"
                          onChange={(event) => setCut(loc.id, event.target.value)}
                        />
                      </div>
                    ))}
                    <div className={`text-xs font-semibold ${left === 0 ? 'text-success' : 'text-error'}`}>
                      {left === 0 ? '✓ ระบุครบแล้ว' : `ยังต้องระบุอีก ${left} ชิ้น`}
                    </div>
                  </>
                )}
              </div>
            );
          })()}
          <textarea className="textarea textarea-bordered h-20 w-full" value={note}
            onChange={(event) => setNote(event.target.value)} placeholder="เหตุผล เช่น นับสต็อกประจำเดือน / ของชำรุด / สูญหาย"></textarea>
          <div className="flex justify-end gap-3 pt-4 border-t border-base-200">
            <button type="button" className="btn btn-ghost" onClick={onClose} disabled={submitting}>ยกเลิก</button>
            <button type="submit" className="btn btn-warning text-white" disabled={submitting}>
              {submitting && <span className="loading loading-spinner loading-xs"></span>}
              ยืนยันปรับยอด
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
}
