/* eslint-disable react-refresh/only-export-components */
// กล่องยืนยันสวยๆ แทน window.confirm ของเบราว์เซอร์
// ใช้งาน:  const ok = await confirmDialog({ title, message, confirmText, danger });
//         if (!ok) return;
// (function + component อยู่ไฟล์เดียวกันเพราะแชร์ state — จึงปิด rule fast-refresh เฉพาะไฟล์นี้)
import React, { useEffect, useState } from 'react';
import { useBodyScrollLock } from './useBodyScrollLock';

let resolver = null;
let openExternal = null;

export const confirmDialog = (opts = {}) =>
  new Promise((resolve) => {
    resolver = resolve;
    openExternal?.({
      title: opts.title || 'ยืนยันการทำรายการ',
      message: opts.message || '',
      confirmText: opts.confirmText || 'ยืนยัน',
      cancelText: opts.cancelText || 'ยกเลิก',
      danger: !!opts.danger,
      open: true
    });
  });

// วางไว้ครั้งเดียวใน App — คอยแสดงกล่องยืนยันเมื่อมีการเรียก confirmDialog()
export function ConfirmHost() {
  const [state, setState] = useState({ open: false });
  useBodyScrollLock(state.open); // freeze พื้นหลังตอนถามยืนยัน

  useEffect(() => {
    openExternal = setState;
    return () => { openExternal = null; };
  }, []);

  const close = (result) => {
    setState((s) => ({ ...s, open: false }));
    const r = resolver;
    resolver = null;
    r?.(result);
  };

  if (!state.open) return null;

  return (
    <div className="fixed inset-0 z-[140] flex items-center justify-center backdrop-blur-md p-4" onClick={() => close(false)}>
      <div className="glass-modal rounded-2xl w-full max-w-sm p-6 animate-fade-in" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start gap-3">
          <div className={`text-2xl ${state.danger ? 'text-error' : 'text-primary'}`}>{state.danger ? '⚠️' : '❓'}</div>
          <div className="flex-1">
            <h3 className="font-bold text-lg">{state.title}</h3>
            {state.message && <p className="text-sm text-base-content/70 mt-1 whitespace-pre-line">{state.message}</p>}
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-6">
          <button className="btn btn-ghost" onClick={() => close(false)}>{state.cancelText}</button>
          <button className={`btn text-white ${state.danger ? 'btn-error' : 'btn-primary'}`} onClick={() => close(true)}>{state.confirmText}</button>
        </div>
      </div>
    </div>
  );
}
