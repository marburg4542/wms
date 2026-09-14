// เครื่องสแกน QR/บาร์โค้ดด้วยกล้องมือถือ — ใช้ซ้ำได้ทุกหน้า
// หมายเหตุ: กล้อง (getUserMedia) ใช้ได้เฉพาะบน https หรือ localhost (secure context)
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useBodyScrollLock } from '../../utils/useBodyScrollLock';

// เรนเดอร์ภาพกล้องที่ความกว้าง "ตามผัง" เท่านี้เสมอ แล้วค่อยย่อด้วย CSS ให้พอดีจอ
//
// เหตุผล (จุดตายของการสแกนป้ายกระดาษ): html5-qrcode ตัดภาพจากกล้องแล้ว *ย่อลงเท่าขนาดกรอบตามผัง*
// ก่อนส่งให้ตัวอ่านเสมอ ไม่ได้อ่านจากภาพความละเอียดเต็มที่กล้องถ่ายมา
// เดิมกรอบกว้างเท่าที่เหลือในจอมือถือ (~318px) หัก qrbox 70% → ตัวอ่านเห็นภาพแค่ราว 220 จุด
// บนจอคอม ป้าย QR ใหญ่และคมจัด เหลือ 220 จุดก็ยังอ่านออก แต่ป้ายกระดาษเล็กๆ ลายจะเละจนอ่านไม่ได้
// CSS transform ไม่เปลี่ยนขนาดตามผัง → เรนเดอร์ใหญ่แล้วย่อลงให้พอดีจอ ผู้ใช้เห็นภาพขนาดเท่าเดิม
//
// ทำไมต้อง 1280 (วัดจากหน้างานจริง 14 ก.ย. 2026 บน iPhone กล้อง 1920×1440):
// ตัวชี้ขาดว่าอ่านออกไหมคือ "1 จุดของลาย QR เหลือกี่พิกเซล" ซึ่ง = ขนาด QR ในภาพ ÷ อัตราย่อ
// ตอนใช้ 640 อัตราย่อคือ 1920/640 = 3 เท่า → ป้ายจริงเหลือ 3.1-5.3 พิกเซลต่อจุด
// ซึ่งคร่อม "เส้นตาย ~4 พิกเซลต่อจุด" ของตัวอ่านพอดี = อาการสแกนได้บ้างไม่ได้บ้าง
// ใช้ 1280 อัตราย่อเหลือ 1.5 เท่า → เด้งเป็น 6-10 พิกเซลต่อจุด พ้นเส้นทุกระยะที่ทดสอบ
// โดยผู้ใช้ไม่ต้องเปลี่ยนวิธีถือกล้องเลย
const RENDER_WIDTH = 1280;

export default function BarcodeScanner({ onDetected, onClose }) {
  const [error, setError] = useState('');
  const [scale, setScale] = useState(0);
  const [stageHeight, setStageHeight] = useState(0);
  const [hasTorch, setHasTorch] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const [zoom, setZoom] = useState(null);     // { min, max, step, value } ถ้ากล้องรองรับ
  const [camInfo, setCamInfo] = useState(''); // ไว้ให้ผู้ใช้บอกกลับได้ว่าเครื่องนั้นได้ภาพเท่าไหร่

  const stageRef = useRef(null);
  const readerRef = useRef(null);
  const scannerRef = useRef(null);
  const handledRef = useRef(false);
  const torchRef = useRef(null);
  const zoomRef = useRef(null);

  // เก็บ callback ไว้ใน ref แทนการใส่ใน dependency ของ useEffect
  // ทั้งสองหน้าที่เรียกใช้ส่ง arrow function ตัวใหม่ทุกครั้งที่ re-render
  // ถ้าผูกกับ dependency ตรงๆ กล้องจะถูกปิดแล้วเปิดใหม่ทุกรอบ = กำลังจะติดอยู่แล้วหลุด
  const onDetectedRef = useRef(onDetected);
  onDetectedRef.current = onDetected;

  useBodyScrollLock(true); // freeze พื้นหลังขณะเปิดกล้อง

  // หยุดกล้อง + เคลียร์ DOM ที่ html5-qrcode สร้างไว้ ก่อน React ถอด component
  // (ไม่งั้น React จะ crash ตอน removeChild → หน้าเปล่าสีขาว)
  const stopScanner = () => {
    const s = scannerRef.current;
    scannerRef.current = null;
    torchRef.current = null;
    zoomRef.current = null;
    if (!s) return Promise.resolve();
    return s.stop().then(() => { try { s.clear(); } catch { /* ignore */ } }).catch(() => {});
  };

  // วัดความกว้างที่มีจริงในจอ เพื่อรู้ว่าต้องย่อภาพเท่าไหร่ถึงจะพอดีช่อง
  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    let lastWidth = 0;
    const measure = () => {
      const w = stage.clientWidth;
      if (w > 0 && w !== lastWidth) { lastWidth = w; setScale(w / RENDER_WIDTH); }
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(stage);
    return () => ro.disconnect();
  }, []);

  // ความสูงของช่องต้องตามความสูงจริงของวิดีโอ (ขึ้นกับสัดส่วนภาพที่กล้องให้มา) คูณอัตราย่อ
  useEffect(() => {
    const reader = readerRef.current;
    if (!reader || !scale) return;
    const sync = () => setStageHeight(reader.offsetHeight * scale);
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(reader);
    return () => ro.disconnect();
  }, [scale]);

  useEffect(() => {
    let active = true;

    // เบราว์เซอร์บล็อกกล้องถ้าไม่ใช่ https/localhost — เช็คก่อนเพื่อขึ้นข้อความที่เข้าใจง่าย
    const secure = window.isSecureContext || location.hostname === 'localhost';
    if (!secure) {
      setError('สแกนด้วยกล้องใช้ได้เฉพาะเมื่อเปิดผ่าน https หรือ localhost เท่านั้น\n(บน LAN http จะใช้ไม่ได้ ต้องเปิดผ่าน tunnel/โดเมนที่เป็น https)');
      return;
    }

    (async () => {
      let Html5Qrcode, Fmt;
      try {
        ({ Html5Qrcode, Html5QrcodeSupportedFormats: Fmt } = await import('html5-qrcode'));
      } catch {
        if (active) setError('โหลดตัวสแกนไม่สำเร็จ — ลองรีเฟรชหน้าอีกครั้ง');
        return;
      }
      if (!active) return;

      // กรอบสแกนเล็กลงเหลือครึ่งหนึ่งของภาพ — ไม่ใช่เพื่อความคม (ความคมมาจากอัตราย่อล้วนๆ)
      // แต่เพื่อคุมงานของเครื่องไม่ให้บานตาม RENDER_WIDTH ที่โตขึ้นเท่าตัว
      // เช็กแล้วว่าไม่ตัดป้าย: ระยะที่ใกล้ที่สุดเท่าที่ทดสอบ QR กินแค่ 24% ของภาพ ยังเหลือที่อีกเท่าตัว
      // ยังทำเป็นแนวนอนอยู่ เพื่อให้บาร์โค้ดแบบเส้นยาวอยู่ในกรอบได้ทั้งแถบ
      // เพดานความสูง 460 กัน iOS ที่บางทีส่งภาพแนวตั้งมา แล้วกรอบจะสูงจนเครื่องอ่านไม่ทัน
      const qrbox = (vw, vh) => {
        const width = Math.floor(vw * 0.5);
        return { width, height: Math.floor(Math.min(vh * 0.6, width, 460)) };
      };

      // ลองสองชุด: ชุดเต็มสูตรก่อน ถ้าเครื่องไหนเปิดไม่ได้ค่อยถอยไปชุดพื้นฐาน
      // เหตุผล: ชุดเต็มสูตรพึ่งความสามารถที่บางเครื่องไม่มี เช่น ตัวอ่านบาร์โค้ดของระบบ
      // ซึ่งถ้าเครื่องนั้นไม่รองรับชนิดป้ายที่ขอไปแม้แต่ชนิดเดียว มันจะโยน error ทิ้งตั้งแต่
      // ยังไม่เปิดกล้อง → สแกนไม่ได้เลยทั้งเครื่อง ซึ่งแย่กว่าสแกนติดยากมาก
      const setups = [
        {
          ctor: {
            verbose: false,
            // อ่านเฉพาะชนิดป้ายที่คลังนี้ใช้จริง (QR เป็นหลัก + บาร์โค้ดแบบเส้น)
            // ยิ่งเปิดรับหลายชนิด แต่ละเฟรมยิ่งต้องลองอ่านหลายรอบ จนจำนวนครั้งที่ได้อ่านจริง
            // ต่อวินาทีต่ำกว่าที่ตั้งไว้มาก — มือสั่นนิดเดียวก็หลุด
            formatsToSupport: [
              Fmt.QR_CODE,
              Fmt.CODE_128, Fmt.CODE_39, Fmt.ITF,
              Fmt.EAN_13, Fmt.EAN_8, Fmt.UPC_A
            ],
            // แอนดรอยด์มีตัวอ่านบาร์โค้ดของตัวระบบเอง ทนภาพเบลอ/หมึกจาง/ป้ายยับ ได้ดีกว่า
            // ตัวอ่านที่มากับไลบรารีมาก · iOS ยังไม่มี ไลบรารีจะถอยไปใช้ตัวเดิมให้เอง
            useBarCodeDetectorIfSupported: true
          },
          start: {
            fps: 10,
            // ไม่ตั้ง aspectRatio อีกแล้ว: ของเดิมสั่งกล้องให้ส่งภาพจัตุรัส กล้องบางรุ่นทำตาม
            // บางรุ่นเมิน · รุ่นที่เมินจะทำให้ "กรอบที่เห็น" กับ "พื้นที่ที่อ่านจริง" เหลื่อมกัน
            // = เล็งป้ายเข้ากลางกรอบแล้วแต่ไม่ติด และอาการต่างกันไปในแต่ละเครื่อง
            disableFlip: true, // ป้ายในคลังไม่มีแบบพิมพ์กลับด้าน ตัดการอ่านซ้ำรอบสองทิ้งได้เลย
            videoConstraints: {
              facingMode: 'environment',
              // ของเดิมไม่ได้ขอความละเอียด มือถือหลายรุ่นจึงให้ 640×480 มาเป็นค่าเริ่มต้น
              // ขอเป็น 4:3 เพราะภาพจะสูงกว่า 16:9 กรอบสแกนเลยได้พื้นที่มากกว่า
              width: { ideal: 1920 },
              height: { ideal: 1440 },
              // ป้ายเล็กต้องให้กล้องไล่โฟกัสเองตลอด ไม่งั้นล็อกโฟกัสค้างที่ระยะไกลแล้วเบลอ
              advanced: [{ focusMode: 'continuous' }]
            },
            qrbox
          }
        },
        // ชุดสำรอง = เท่าของเดิมที่พิสูจน์แล้วว่าเปิดได้ทุกเครื่อง
        // ยังได้ภาพอ่านคมขึ้นอยู่ดี เพราะความคมมาจากขนาดกรอบตามผัง ไม่ได้มาจากค่าพวกนี้
        { ctor: { verbose: false }, start: { fps: 10, qrbox } }
      ];

      const onScan = (decodedText) => {
        if (handledRef.current) return;
        handledRef.current = true;
        stopScanner().finally(() => { if (active) onDetectedRef.current(decodedText); });
      };

      let running = null;
      for (const setup of setups) {
        if (!active) return;
        try {
          const scanner = new Html5Qrcode('wms-barcode-reader', setup.ctor);
          scannerRef.current = scanner;
          await scanner.start(
            { facingMode: 'environment' },
            setup.start,
            onScan,
            () => {} // ข้าม error รายเฟรม (ยังหาบาร์โค้ดไม่เจอ)
          );
          running = scanner;
          break;
        } catch {
          // เก็บกวาดก่อนลองชุดถัดไป (start() จะล้าง DOM เดิมให้เองอยู่แล้ว)
          const failed = scannerRef.current;
          scannerRef.current = null;
          try { failed?.clear(); } catch { /* ยังไม่ทันเริ่ม ไม่มีอะไรต้องเก็บ */ }
        }
      }

      if (!active) return;
      if (!running) {
        setError('ไม่สามารถเปิดกล้องได้ — กรุณาอนุญาตการใช้กล้อง แล้วลองใหม่');
        return;
      }

      // ไฟฉายกับซูมต้องถามหลังกล้องเริ่มทำงานแล้วเท่านั้น
      // ไฟฉาย: ชั้นวางในคลังมืด และป้ายมักมีเทปใสทับจนสะท้อน
      // ซูม: กล้องหลังมือถือโฟกัสใกล้กว่าราว 10 ซม. ไม่ได้ ยิ่งชะโงกเข้าไปใกล้ยิ่งเบลอ
      //      ให้ยืนห่างแล้วซูมเข้าไปแทน ได้ภาพคมกว่ามาก
      try {
        const caps = running.getRunningTrackCameraCapabilities();
        const torch = caps.torchFeature();
        if (torch.isSupported()) { torchRef.current = torch; setHasTorch(true); }
        const zoomFeat = caps.zoomFeature();
        if (zoomFeat.isSupported()) {
          zoomRef.current = zoomFeat;
          // ห้ามให้ลากซูมต่ำกว่าจุดที่กล้องเปิดมา — บน iPhone ค่าต่ำสุดที่กล้องรายงานคือ
          // เลนส์อัลตร้าไวด์ ซึ่งโฟกัสระยะใกล้ไม่ได้เลย ลากไปถึงเมื่อไหร่ภาพเบลอแก้ไม่ได้
          // (ของเดิมตั้งเพดานจากค่าต่ำสุดคูณห้า พอค่าต่ำสุดเป็น 0.5 เพดานเลยเตี้ยจนแถบ
          //  เกือบสุดขวาตั้งแต่เปิด — ซูมเข้าต่อแทบไม่ได้ แต่ลากออกไปเลนส์ที่เบลอได้)
          const start = zoomFeat.value();
          const base = (typeof start === 'number' && start > 0) ? start : Math.max(zoomFeat.min(), 1);
          const top = Math.min(zoomFeat.max(), base * 4); // เกินนี้เป็นซูมดิจิทัลล้วน ภาพแตกจนอ่านแย่ลง
          if (top > base) {
            setZoom({ min: base, max: top, step: zoomFeat.step() || 0.1, value: base });
          }
        }
        const st = running.getRunningTrackSettings();
        if (st?.width) setCamInfo(`${st.width}×${st.height}`);
      } catch { /* กล้องบางรุ่นไม่บอกความสามารถพวกนี้ — ข้ามไป ไม่กระทบการสแกน */ }
    })();

    return () => {
      active = false;
      stopScanner();
    };
  }, []);

  const toggleTorch = async () => {
    const f = torchRef.current;
    if (!f) return;
    const next = !torchOn;
    try { await f.apply(next); setTorchOn(next); } catch { /* บางรุ่นสั่งไฟไม่ได้ขณะสแกน */ }
  };

  const applyZoom = async (value) => {
    setZoom(z => (z ? { ...z, value } : z));
    try { await zoomRef.current?.apply(value); } catch { /* ignore */ }
  };

  return (
    <div className="fixed inset-0 z-130 flex items-center justify-center backdrop-blur-md p-4">
      <div className="glass-modal rounded-2xl w-full max-w-md p-5 max-h-[90vh] overflow-y-auto">
        <h3 className="font-bold text-lg mb-3 flex items-center gap-2">📷 สแกน QR / บาร์โค้ด</h3>
        {error ? (
          <div className="text-sm text-error whitespace-pre-line bg-error/10 rounded-lg p-4">{error}</div>
        ) : (
          <>
            {/* ช่องที่ผู้ใช้เห็น — ย่อภาพที่เรนเดอร์ไว้ใหญ่ ลงมาให้พอดีความกว้างจริง */}
            <div
              ref={stageRef}
              className="relative w-full overflow-hidden rounded-lg bg-black"
              style={{ height: stageHeight || undefined, minHeight: stageHeight ? undefined : 200 }}
            >
              <div
                ref={readerRef}
                id="wms-barcode-reader"
                style={{ width: RENDER_WIDTH, transformOrigin: 'top left', transform: `scale(${scale || 1})` }}
              />
            </div>

            {(hasTorch || zoom) && (
              <div className="flex items-center gap-3 mt-3">
                {hasTorch && (
                  <button
                    type="button"
                    onClick={toggleTorch}
                    className={`btn btn-sm shrink-0 ${torchOn ? 'btn-warning' : 'btn-outline'}`}
                    aria-pressed={torchOn}
                  >
                    {torchOn ? '🔦 ปิดไฟ' : '🔦 เปิดไฟ'}
                  </button>
                )}
                {zoom && (
                  <label className="flex items-center gap-2 flex-1 min-w-0">
                    <span className="text-xs opacity-60 shrink-0">ซูม</span>
                    <input
                      type="range"
                      className="range range-xs range-primary"
                      min={zoom.min} max={zoom.max} step={zoom.step} value={zoom.value}
                      onChange={e => applyZoom(Number(e.target.value))}
                    />
                    {/* โชว์ตัวเลขกำกับ ไม่งั้นไม่มีทางรู้ว่าตอนนี้ซูมอยู่กี่เท่า */}
                    <span className="text-xs opacity-60 shrink-0 tabular-nums w-9 text-right">
                      {(zoom.value / zoom.min).toFixed(1)}x
                    </span>
                  </label>
                )}
              </div>
            )}

            <p className="text-xs text-center opacity-60 mt-3">
              เล็งกล้องไปที่บาร์โค้ด/QR ของสินค้า
              {zoom && <><br />ป้ายเล็ก: ถอยออกมาแล้วใช้ซูม จะคมกว่าชะโงกเข้าไปใกล้</>}
            </p>
            {camInfo && <p className="text-[10px] text-center opacity-30 mt-1">กล้อง {camInfo}</p>}
          </>
        )}
        <button className="btn btn-ghost w-full mt-4" onClick={() => stopScanner().finally(onClose)}>ปิด</button>
      </div>
    </div>
  );
}
