// เครื่องสแกน QR/บาร์โค้ดด้วยกล้องมือถือ — ใช้ซ้ำได้ทุกหน้า
// หมายเหตุ: กล้อง (getUserMedia) ใช้ได้เฉพาะบน https หรือ localhost (secure context)
import React, { useEffect, useRef, useState } from 'react';
import { useBodyScrollLock } from '../../utils/useBodyScrollLock';

export default function BarcodeScanner({ onDetected, onClose }) {
  const [error, setError] = useState('');
  const scannerRef = useRef(null);
  const handledRef = useRef(false);
  useBodyScrollLock(true); // freeze พื้นหลังขณะเปิดกล้อง

  // หยุดกล้อง + เคลียร์ DOM ที่ html5-qrcode สร้างไว้ ก่อน React ถอด component
  // (ไม่งั้น React จะ crash ตอน removeChild → หน้าเปล่าสีขาว)
  const stopScanner = () => {
    const s = scannerRef.current;
    scannerRef.current = null;
    if (!s) return Promise.resolve();
    return s.stop().then(() => { try { s.clear(); } catch { /* ignore */ } }).catch(() => {});
  };

  useEffect(() => {
    let active = true;

    // เบราว์เซอร์บล็อกกล้องถ้าไม่ใช่ https/localhost — เช็คก่อนเพื่อขึ้นข้อความที่เข้าใจง่าย
    const secure = window.isSecureContext || location.hostname === 'localhost';
    if (!secure) {
      setError('สแกนด้วยกล้องใช้ได้เฉพาะเมื่อเปิดผ่าน https หรือ localhost เท่านั้น\n(บน LAN http จะใช้ไม่ได้ ต้องเปิดผ่าน tunnel/โดเมนที่เป็น https)');
      return;
    }

    (async () => {
      try {
        const { Html5Qrcode } = await import('html5-qrcode');
        if (!active) return;
        const scanner = new Html5Qrcode('wms-barcode-reader', { verbose: false });
        scannerRef.current = scanner;
        await scanner.start(
          { facingMode: 'environment' },
          {
            fps: 10,
            aspectRatio: 1.0, // บังคับพื้นที่กล้องเป็นสี่เหลี่ยมจัตุรัส
            // กรอบสแกนเป็นจัตุรัส ขนาดตามสัดส่วนวิดีโอ (70% ของด้านที่สั้นกว่า)
            qrbox: (vw, vh) => {
              const size = Math.floor(Math.min(vw, vh) * 0.7);
              return { width: size, height: size };
            }
          },
          (decodedText) => {
            if (handledRef.current) return;
            handledRef.current = true;
            stopScanner().finally(() => { if (active) onDetected(decodedText); });
          },
          () => {} // ข้าม error รายเฟรม (ยังหาบาร์โค้ดไม่เจอ)
        );
      } catch {
        if (active) setError('ไม่สามารถเปิดกล้องได้ — กรุณาอนุญาตการใช้กล้อง แล้วลองใหม่');
      }
    })();

    return () => {
      active = false;
      stopScanner();
    };
  }, [onDetected]);

  return (
    <div className="fixed inset-0 z-130 flex items-center justify-center backdrop-blur-md p-4">
      <div className="glass-modal rounded-2xl w-full max-w-sm p-5 max-h-[85vh] overflow-y-auto">
        <h3 className="font-bold text-lg mb-3 flex items-center gap-2">📷 สแกน QR / บาร์โค้ด</h3>
        {error ? (
          <div className="text-sm text-error whitespace-pre-line bg-error/10 rounded-lg p-4">{error}</div>
        ) : (
          <>
            {/* กรอบกล้องเป็นสี่เหลี่ยมจัตุรัสเสมอ */}
            <div id="wms-barcode-reader" className="rounded-lg overflow-hidden bg-black aspect-square w-full [&_video]:w-full [&_video]:h-full [&_video]:object-cover" />
            <p className="text-xs text-center opacity-60 mt-3">เล็งกล้องไปที่บาร์โค้ด/QR ของสินค้า</p>
          </>
        )}
        <button className="btn btn-ghost w-full mt-4" onClick={() => stopScanner().finally(onClose)}>ปิด</button>
      </div>
    </div>
  );
}
