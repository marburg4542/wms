// src/components/Homepage/index.jsx
import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { fetchApi, getAssetUrl } from '../../utils/api';
import { txTypeLabel, txStatusLabel } from '../../utils/labels';
import { onServerEvent } from '../../utils/events';
import { confirmDialog } from '../../utils/confirm';
import { DashboardSkeleton } from '../Skeleton';
import { useBodyScrollLock } from '../../utils/useBodyScrollLock';
import toast from 'react-hot-toast';

// ฟังก์ชันดึงรูปภาพแบบเดียวกับหน้า Inventory
const getImg = (url) => {
  if (!url) return "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxMDAiIGhlaWdodD0iMTAwIj48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSIjZjNmNGY2Ii8+PHRleHQgeD0iNTAlIiB5PSI1MCUiIGZvbnQtc2l6ZT0iMTIiIHRleHQtYW5jaG9yPSJtaWRkbGUiIGFsaWdubWVudC1iYXNlbGluZT0ibWlkZGxlIiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiIgZmlsbD0iIzliOWI5YiI+Tm8gSW1hZ2U8L3RleHQ+PC9zdmc+";
  return getAssetUrl(url);
};

export default function Homepage() {
  const navigate = useNavigate();
  const currentUser = JSON.parse(sessionStorage.getItem('currentUser') || '{}');
  const isAdmin = ['Admin', 'Manager'].includes(currentUser.role);
  
  const [stats, setStats] = useState({ totalItems: 0, lowStockCount: 0, inboundToday: 0, outboundToday: 0 });
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);
  
  const [approveModal, setApproveModal] = useState(null);
  const [approvedQtys, setApprovedQtys] = useState({});
  const [approveMessage, setApproveMessage] = useState('');

  const [exportModalOpen, setExportModalOpen] = useState(false);
  const [exportType, setExportType] = useState('day');
  const [exportTypeFilter, setExportTypeFilter] = useState('all');   // ทั้งหมด/นำเข้า/เบิกออก
  const [exportProjectFilter, setExportProjectFilter] = useState('all');
  const [exporting, setExporting] = useState(false);
  const [itemsModal, setItemsModal] = useState(null); // ใบเบิกที่กำลังดูรายการอะไหล่ (recheck ตอนส่งมอบ)
  const [cancelResv, setCancelResv] = useState(null);   // ใบที่กำลังยกเลิกการจอง
  const [cancelReason, setCancelReason] = useState('');
  useBodyScrollLock(!!approveModal || exportModalOpen || !!itemsModal || !!cancelResv); // freeze พื้นหลังตอนเปิด modal

  const offset = new Date().getTimezoneOffset() * 60000;
  const todayStr = new Date(Date.now() - offset).toISOString().slice(0, 10);
  const [exportValue, setExportValue] = useState(todayStr);
  // ข้อมูลสำหรับ export ดึงแยกตามช่วงเวลาที่เลือก ไม่แบกประวัติทั้งหมดมากับ dashboard
  const [exportLogs, setExportLogs] = useState([]);
  const [exportLoading, setExportLoading] = useState(false);
  const [projectList, setProjectList] = useState([]); // อิงรายชื่อโปรเจกต์จากหน้าจัดการสินค้าคงคลัง

  // โหลดรายชื่อโปรเจกต์ (ใช้เป็นตัวเลือกกรองใน export) — ให้ตรงกับที่จัดการไว้ ไม่ใช่เดาจากข้อมูลในช่วง
  useEffect(() => {
    fetchApi('/api/projects').then(j => { if (j.success) setProjectList(j.projects || []); }).catch(() => {});
  }, []);

  const loadDashboardData = useCallback(async () => {
    try {
      // ขอเฉพาะใบที่ยังค้าง (รออนุมัติ/รอส่งมอบ) + รายการของวันนี้ — พอสำหรับ dashboard
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const txQuery = `/api/transactions?view=dashboard&since=${encodeURIComponent(todayStart.toISOString())}`;

      const [statsRes, txRes] = await Promise.all([
        fetchApi('/api/wms/dashboard-stats').catch(() => ({})),
        fetchApi(txQuery).catch(() => ({}))
      ]);

      if (statsRes.success) setStats(statsRes.stats || { totalItems: 0, lowStockCount: 0, inboundToday: 0, outboundToday: 0 });
      if (txRes.success) setTransactions(txRes.transactions || []);
    } catch {
      console.warn("ดึงข้อมูล Dashboard ล้มเหลว");
    } finally {
      setLoading(false);
    }
  }, []);

  // โหลดครั้งแรกแล้ว poll ซ้ำทุก 30 วินาที + refresh ตอนสลับกลับมาที่แท็บ
  // เพื่อให้คำขอเบิก/สถิติอัปเดตเองเมื่อมีคน inbound/outbound จากเครื่องอื่น
  useEffect(() => {
    loadDashboardData();
    const interval = setInterval(loadDashboardData, 300000)  // 5 นาที — SSE ส่ง event ให้อยู่แล้ว อันนี้เป็นแค่ fallback เผื่อ stream หลุด;
    const onFocus = () => loadDashboardData();
    window.addEventListener('focus', onFocus);
    // SSE: อัปเดตทันทีที่มีใบเบิก/สต็อกเปลี่ยนจากเครื่องไหนก็ตาม (polling 30 วิเป็น fallback)
    const offTx = onServerEvent('transactions', loadDashboardData);
    const offProducts = onServerEvent('products', loadDashboardData);
    return () => {
      clearInterval(interval);
      window.removeEventListener('focus', onFocus);
      offTx();
      offProducts();
    };
  }, [loadDashboardData]);

  // ใบเบิกที่อนุมัติแล้วแต่ยังไม่ได้ส่งมอบสินค้าให้ผู้ขอ = สถานะ "รอส่งมอบ" (Waiting for pickup)
  // จะยังอยู่ในตารางรอดำเนินการ และเข้าประวัติเมื่อ Admin กด Picked up แล้วเท่านั้น
  const isWaitingPickup = (t) => t.type === 'OUTBOUND' && ['Approved', 'Partial'].includes(t.status) && !t.pickedUpAt;
  const historyLogs = transactions
    .filter(t => (t.status !== 'Pending' || t.type === 'INBOUND') && !isWaitingPickup(t))
    .sort((a,b) => new Date(b.requestDate) - new Date(a.requestDate));
  const pendingRequests = transactions.filter(t => (t.status === 'Pending' && t.type === 'OUTBOUND') || isWaitingPickup(t));

  const todayLogs = historyLogs.filter(tx => {
    const txDate = tx.resolvedDate || tx.requestDate;
    if (!txDate) return false;
    const localDate = new Date(new Date(txDate).getTime() - offset).toISOString().slice(0, 10);
    return localDate === todayStr;
  });

  // ดึงข้อมูล export จาก server ตามช่วงเวลาที่เลือก (เฉพาะตอน modal เปิดอยู่)
  useEffect(() => {
    if (!exportModalOpen || !exportValue) return;

    let start = null;
    let end = null;
    if (exportType === 'day') {
      start = new Date(`${exportValue}T00:00:00`);
      end = new Date(start); end.setDate(end.getDate() + 1);
    } else if (exportType === 'month') {
      const [y, m] = exportValue.split('-').map(Number);
      start = new Date(y, m - 1, 1); end = new Date(y, m, 1);
    } else {
      const y = Number(exportValue);
      start = new Date(y, 0, 1); end = new Date(y + 1, 0, 1);
    }
    if (!start || Number.isNaN(start.getTime())) return;

    let cancelled = false;
    setExportLoading(true);
    fetchApi(`/api/transactions?since=${encodeURIComponent(start.toISOString())}&until=${encodeURIComponent(end.toISOString())}`)
      .then(json => { if (!cancelled && json.success) setExportLogs(json.transactions || []); })
      .catch(err => console.warn('โหลดข้อมูล export ล้มเหลว', err))
      .finally(() => { if (!cancelled) setExportLoading(false); });
    return () => { cancelled = true; };
  }, [exportModalOpen, exportType, exportValue]);

  // ตัวเลือกโปรเจกต์สำหรับ dropdown กรอง — อิงรายชื่อในหน้าจัดการสินค้าคงคลัง (ตาราง projects)
  const exportProjectOptions = projectList.map(p => p.name);

  const exportFilteredLogs = exportLogs
    .filter(t => (t.status !== 'Pending' || t.type === 'INBOUND') && !isWaitingPickup(t))
    .filter(t => exportTypeFilter === 'all' || t.type === exportTypeFilter)              // กรอง นำเข้า/เบิกออก
    .filter(t => exportProjectFilter === 'all' || exportTypeFilter === 'INBOUND' || (t.project || '') === exportProjectFilter) // กรองโปรเจกต์ (นำเข้าไม่มีโปรเจกต์ จึงข้าม)
    .sort((a, b) => new Date(b.requestDate) - new Date(a.requestDate));

  // 👇 เพิ่ม imageUrl ในฟังก์ชัน GetItems
  const getItemsToRender = (tx) => {
    if (tx.items && Array.isArray(tx.items)) return tx.items;
    return [{ productId: tx.productId, sku: tx.sku, productName: tx.productName, imageUrl: tx.imageUrl, requestedQty: tx.quantity, approvedQty: tx.quantity, status: tx.status }];
  };

  const openApproveModal = (tx) => {
    const items = getItemsToRender(tx);
    const initialQtys = {};
    items.forEach(item => { initialQtys[item.productId] = item.requestedQty; });
    setApprovedQtys(initialQtys);
    setApproveMessage('');
    setApproveModal({ ...tx, parsedItems: items });
  };

  const handleApproveSubmit = async (action) => {
    if (!approveModal) return;

    // ปฏิเสธ หรืออนุมัติไม่ครบตามจำนวนที่ขอ ต้องบอกเหตุผลให้ผู้ขอเบิกเสมอ (server ตรวจซ้ำอีกชั้น)
    const message = approveMessage.trim();
    const isPartial = approveModal.parsedItems.some(item => (approvedQtys[item.productId] || 0) < item.requestedQty);
    if (action === 'REJECT' && !message) return toast.error('กรุณาระบุเหตุผลการปฏิเสธใบเบิก');
    if (action === 'APPROVE' && isPartial && !message) return toast.error('กรุณาระบุเหตุผลเมื่ออนุมัติไม่ครบตามจำนวนที่ขอ');

    try {
      const updatedItems = approveModal.parsedItems.map(item => ({
        productId: item.productId,
        approvedQty: approvedQtys[item.productId] || 0
      }));

      const res = await fetchApi(`/api/transactions/${approveModal.id}/resolve`, {
        method: 'PUT',
        body: JSON.stringify({ action, updatedItems, adminMessage: message })
      });

      if (res.success) {
        toast.success(`อัปเดตสถานะใบเบิกสำเร็จ`);
        setApproveModal(null);
        loadDashboardData();
      }
    } catch {
      toast.error('เกิดข้อผิดพลาดในการประมวลผล');
    }
  };

  // ยกเลิกการจองใบที่อนุมัติแล้วแต่ไม่มีคนมารับ — คืนของเข้าสต็อก ต้องระบุเหตุผล
  const submitCancelReservation = async () => {
    const reason = cancelReason.trim();
    if (!reason) return toast.error('กรุณาระบุเหตุผลการยกเลิกการจอง');
    try {
      const res = await fetchApi(`/api/transactions/${cancelResv.id}/cancel-reservation`, {
        method: 'PUT',
        body: JSON.stringify({ reason })
      });
      if (res.success) {
        toast.success(res.message);
        setCancelResv(null);
        setCancelReason('');
        loadDashboardData();
      }
    } catch (err) {
      toast.error(err?.message || 'ยกเลิกการจองไม่สำเร็จ');
    }
  };

  const handlePickup = async (tx) => {
    const ok = await confirmDialog({
      title: 'ยืนยันการส่งมอบสินค้า',
      message: `ส่งมอบสินค้าตามใบเบิก ${tx.transactionId || tx.id} ให้ผู้ขอเบิกแล้ว?
⚠️ ระบบจะตัดสต็อกจริงเมื่อกดยืนยัน`,
      confirmText: 'ส่งมอบแล้ว'
    });
    if (!ok) return;
    try {
      const res = await fetchApi(`/api/transactions/${tx.id}/pickup`, { method: 'PUT' });
      if (res.success) {
        toast.success('บันทึกการส่งมอบสินค้าแล้ว');
        loadDashboardData();
      }
    } catch (err) {
      console.error('Pickup failed:', err);
    }
  };

  const handleExportTypeChange = (e) => {
    const type = e.target.value;
    setExportType(type);
    if (type === 'day') setExportValue(todayStr);
    if (type === 'month') setExportValue(todayStr.slice(0, 7));
    if (type === 'year') setExportValue(todayStr.slice(0, 4));
  };

  // โหลดรูปสินค้าเป็น PNG dataURL (ผ่าน canvas เพื่อรองรับ jpg/png/webp และปรับขนาดให้เท่ากัน)
  // คืน null ถ้าโหลดไม่ได้ (รูปหาย/ติด CORS) เพื่อให้ข้ามไปโดยไม่ทำให้ทั้งรายงานพัง
  const loadImageAsPng = (url) => new Promise((resolve) => {
    if (!url) return resolve(null);
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => {
      try {
        const S = 90; // ความละเอียดรูปในไฟล์ (px) — คมพอสำหรับพิมพ์
        const canvas = document.createElement('canvas');
        canvas.width = S; canvas.height = S;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#f8fafc'; ctx.fillRect(0, 0, S, S);
        // จัดรูปให้อยู่กลาง แบบ contain (เห็นเต็มใบ ไม่โดนตัด)
        const scale = Math.min(S / image.width, S / image.height);
        const w = image.width * scale, h = image.height * scale;
        ctx.drawImage(image, (S - w) / 2, (S - h) / 2, w, h);
        resolve(canvas.toDataURL('image/png'));
      } catch { resolve(null); }
    };
    image.onerror = () => resolve(null);
    image.src = url;
  });

  // สร้าง PDF ด้วย jsPDF + autoTable — แบ่งหน้าอัตโนมัติจริง ไม่ตัดกลางแถว ขึ้นหัวตารางซ้ำทุกหน้า
  const executePDFExport = async () => {
    if (exportFilteredLogs.length === 0) return toast.error('ไม่มีข้อมูลในช่วงเวลาที่เลือก');

    setExporting(true);
    toast.loading('กำลังสร้างไฟล์ PDF...', { id: 'pdf-toast' });
    try {
      const [{ jsPDF }, { default: autoTable }, { sarabunRegular }] = await Promise.all([
        import('jspdf'),
        import('jspdf-autotable'),
        import('../../utils/thaiFont')
      ]);

      // แต่ละแถว = สินค้า 1 ชิ้น (ฟิลด์ระดับใบเบิกโชว์เฉพาะแถวแรกของใบ) + โหลดรูปทุกชิ้นล่วงหน้า
      const rows = [];
      const imageCache = new Map();
      for (const tx of exportFilteredLogs) {
        const items = getItemsToRender(tx);
        for (let idx = 0; idx < items.length; idx++) {
          const item = items[idx];
          const url = item.imageUrl ? getImg(item.imageUrl) : '';
          if (url && !imageCache.has(url)) imageCache.set(url, await loadImageAsPng(url));
          rows.push({
            img: url ? imageCache.get(url) : null,
            date: idx === 0 ? new Date(tx.requestDate).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' }) : '',
            txId: idx === 0 ? (tx.transactionId || String(tx.id)) : '',
            type: idx === 0 ? txTypeLabel(tx.type) : '',
            sku: item.sku || '-',
            group: item.groupId ? `${item.groupId} — ${item.groupName || ''}` : '-',
            name: item.productName || '-',
            qty: String(tx.type === 'INBOUND' ? item.requestedQty : item.approvedQty),
            requester: idx === 0 ? (tx.requesterUsername || '-') : '',
            project: idx === 0 ? (tx.project || '-') : '',
            status: idx === 0 ? txStatusLabel(tx.status) : '',
            note: idx === 0 ? (tx.adminMessage || '-') : ''
          });
        }
      }

      const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
      doc.addFileToVFS('Sarabun-Regular.ttf', sarabunRegular);
      doc.addFont('Sarabun-Regular.ttf', 'Sarabun', 'normal');
      // ผูก bold เข้ากับไฟล์เดียวกันด้วย เพราะหัวตาราง autoTable ใช้ตัวหนา — ไม่งั้นภาษาไทยในหัวตารางจะเพี้ยน
      doc.addFont('Sarabun-Regular.ttf', 'Sarabun', 'bold');
      doc.setFont('Sarabun');

      let periodLabel = exportType === 'day' ? `วันที่ ${exportValue}` : exportType === 'month' ? `เดือน ${exportValue}` : `ปี ${exportValue}`;
      if (exportTypeFilter !== 'all') periodLabel += ` · ${txTypeLabel(exportTypeFilter)}`;
      if (exportProjectFilter !== 'all') periodLabel += ` · โปรเจกต์: ${exportProjectFilter}`;
      const IMG_COL = 3; // index คอลัมน์รูปใน body

      autoTable(doc, {
        startY: 24,
        margin: { top: 22, bottom: 12, left: 8, right: 8 },
        head: [['วันที่-เวลา', 'รหัสใบรายการ', 'ประเภท', 'รูป', 'SKU', 'หมวดหมู่', 'ชื่อสินค้า', 'จำนวน', 'ผู้ทำรายการ', 'โปรเจกต์', 'สถานะ', 'หมายเหตุ']],
        body: rows.map(r => [r.date, r.txId, r.type, '', r.sku, r.group, r.name, r.qty, r.requester, r.project, r.status, r.note]),
        styles: { font: 'Sarabun', fontSize: 8, cellPadding: 1.5, valign: 'middle', minCellHeight: 16 },
        headStyles: { font: 'Sarabun', fillColor: [37, 99, 235], textColor: 255, minCellHeight: 8 },
        alternateRowStyles: { fillColor: [241, 247, 253] },
        columnStyles: { 3: { cellWidth: 18, halign: 'center' }, 7: { halign: 'center' } },
        // วาดรูปสินค้าในเซลล์ (autoTable รับผิดชอบการแบ่งหน้า)
        didDrawCell: (data) => {
          if (data.section === 'body' && data.column.index === IMG_COL) {
            const png = rows[data.row.index]?.img;
            if (png) {
              const s = 14;
              doc.addImage(png, 'PNG', data.cell.x + (data.cell.width - s) / 2, data.cell.y + (data.cell.height - s) / 2, s, s);
            }
          }
        },
        didDrawPage: () => {
          doc.setFont('Sarabun');
          doc.setFontSize(13);
          doc.setTextColor(20, 40, 70);
          doc.text('รายงานประวัติการทำรายการคลังสินค้า (WMS)', 148.5, 12, { align: 'center' });
          doc.setFontSize(9);
          doc.setTextColor(110);
          doc.text(`${periodLabel} · ออกรายงานเมื่อ ${new Date().toLocaleString('th-TH')} · ${exportFilteredLogs.length} ใบรายการ`, 148.5, 17, { align: 'center' });
          doc.text(`หน้า ${doc.internal.getNumberOfPages()}`, 289, 203, { align: 'right' });
        }
      });

      // ---- ตารางสรุปยอดรวมต่อสินค้า (ต่อท้ายรายงาน) ----
      const summaryMap = new Map(); // sku -> { name, inbound, outbound }
      for (const tx of exportFilteredLogs) {
        // นับเฉพาะนำเข้า/เบิกออกจริง — ข้ามการปรับยอด (ADJUSTMENT) และประเภทอื่น
        if (tx.type !== 'INBOUND' && tx.type !== 'OUTBOUND') continue;
        for (const item of getItemsToRender(tx)) {
          const sku = item.sku || '-';
          const e = summaryMap.get(sku) || { name: item.productName || '-', inbound: 0, outbound: 0 };
          if (tx.type === 'INBOUND') e.inbound += Number(item.requestedQty) || 0;
          else e.outbound += Number(item.approvedQty) || 0;
          summaryMap.set(sku, e);
        }
      }
      const summaryRows = [...summaryMap.entries()]
        .map(([sku, v]) => [sku, v.name, String(v.inbound), String(v.outbound)])
        .sort((a, b) => a[0].localeCompare(b[0]));

      if (summaryRows.length > 0) {
        doc.addPage();
        autoTable(doc, {
          startY: 22,
          margin: { top: 20, bottom: 12, left: 8, right: 8 },
          head: [['SKU', 'ชื่อสินค้า', 'รับเข้ารวม (ชิ้น)', 'เบิกออกรวม (ชิ้น)']],
          body: summaryRows,
          styles: { font: 'Sarabun', fontSize: 9, cellPadding: 2, valign: 'middle' },
          headStyles: { font: 'Sarabun', fillColor: [16, 122, 87], textColor: 255 },
          alternateRowStyles: { fillColor: [237, 247, 242] },
          columnStyles: { 0: { cellWidth: 34 }, 2: { halign: 'center' }, 3: { halign: 'center' } },
          didDrawPage: () => {
            doc.setFont('Sarabun'); doc.setFontSize(13); doc.setTextColor(16, 122, 87);
            doc.text('สรุปยอดรวมต่อสินค้า', 148.5, 12, { align: 'center' });
            doc.setFontSize(9); doc.setTextColor(110);
            doc.text(`${periodLabel} · รวม ${summaryRows.length} รายการสินค้า`, 148.5, 17, { align: 'center' });
            doc.text(`หน้า ${doc.internal.getNumberOfPages()}`, 289, 203, { align: 'right' });
          }
        });
      }

      doc.save(`WMS_Report_${exportType}_${exportValue}.pdf`);
      toast.success('บันทึกไฟล์ PDF เรียบร้อย', { id: 'pdf-toast' });
      setExportModalOpen(false);
    } catch (err) {
      console.error('PDF export failed:', err);
      toast.error('สร้างไฟล์ PDF ไม่สำเร็จ', { id: 'pdf-toast' });
    } finally {
      setExporting(false);
    }
  };

  if (loading) return <DashboardSkeleton />;

  return (
    <div className="p-4 space-y-6 min-h-[86vh] animate-fade-in relative">

      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gradient w-fit">แดชบอร์ดคลังสินค้า</h1>
          <p className="text-sm text-base-content/60">ภาพรวมระบบคลังสินค้า และรายการคำขอเบิก/รับเข้า</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setExportModalOpen(true)} className="btn btn-sm btn-primary shadow-sm text-white">
            📄 นำออก PDF
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="stats glass-panel"><div className="stat"><div className="stat-title text-xs font-semibold">จำนวนสินค้าทั้งหมด (ชิ้น)</div><div className="stat-value text-2xl text-primary">{stats.totalItems}</div></div></div>
        <div
          className={`stats glass-panel ${isAdmin ? 'cursor-pointer hover:border-error/60 hover:shadow-md transition-all' : ''}`}
          onClick={isAdmin ? () => navigate('/products?filter=low') : undefined}
          title={isAdmin ? 'คลิกเพื่อดูรายการสินค้าสต็อกต่ำ' : undefined}
        >
          <div className="stat">
            <div className="stat-title text-xs font-semibold">สต็อกต่ำ</div>
            <div className="stat-value text-2xl text-error">{stats.lowStockCount}</div>
            {isAdmin && <div className="stat-desc text-[10px] text-error/70">คลิกเพื่อดูรายการ →</div>}
          </div>
        </div>
        <div className="stats glass-panel"><div className="stat"><div className="stat-title text-xs font-semibold">รับเข้าวันนี้</div><div className="stat-value text-2xl text-success">+{stats.inboundToday}</div></div></div>
        <div className="stats glass-panel"><div className="stat"><div className="stat-title text-xs font-semibold">เบิกออกวันนี้</div><div className="stat-value text-2xl text-info">-{stats.outboundToday}</div></div></div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        
        {/* คำขอรอดำเนินการ */}
        <div className="card glass-panel p-5">
          <h2 className="text-lg font-bold mb-4 flex items-center gap-2"><span>📋</span> คำขอเบิกรอดำเนินการ / รอส่งมอบ</h2>
          <div className="overflow-x-auto max-h-100 overflow-y-auto">
            <table className="table table-sm w-full">
              <thead className="sticky top-0 bg-base-100/80 backdrop-blur-md z-10">
                <tr><th>รหัสใบเบิก</th><th>ผู้ขอ</th><th>โปรเจกต์</th><th>รายการ</th><th>สถานะ</th><th>จัดการ</th></tr>
              </thead>
              <tbody>
                {pendingRequests.length === 0 ? <tr><td colSpan="6" className="text-center opacity-50 py-4">ไม่มีคำขอใหม่</td></tr> : pendingRequests.map((tx) => (
                  <tr key={tx.id} className="hover:bg-base-200/40">
                    <td className="text-xs font-mono">{tx.transactionId || tx.id}</td>
                    <td className="text-xs">{tx.requesterUsername}</td>
                    <td className="text-xs max-w-25 truncate">{tx.project}</td>
                    <td>
                      <button onClick={() => setItemsModal(tx)} className="btn btn-ghost btn-xs text-primary gap-1" title="คลิกดูรายการอะไหล่ (recheck ก่อนส่งมอบ)">
                        {getItemsToRender(tx).length} รายการ
                      </button>
                    </td>
                    <td>
                      {tx.status === 'Pending'
                        ? <span className="badge badge-xs badge-warning">รออนุมัติ</span>
                        : <span className="badge badge-xs badge-info">รอส่ง</span>}
                    </td>
                    <td>
                      {tx.status === 'Pending' ? (
                        isAdmin
                          ? <button onClick={() => openApproveModal(tx)} className="btn btn-xs btn-primary shadow-sm">ตรวจสอบ</button>
                          : <span className="text-xs opacity-50">-</span>
                      ) : (
                        isAdmin
                          ? <div className="flex gap-1">
                              <button onClick={() => handlePickup(tx)} className="btn btn-xs btn-success text-white shadow-sm">รับแล้ว</button>
                              <button onClick={() => { setCancelResv(tx); setCancelReason(''); }} className="btn btn-xs btn-ghost text-error" title="ยกเลิกการจองและคืนของเข้าสต็อก">ยกเลิกจอง</button>
                            </div>
                          : <span className="badge badge-xs badge-success badge-outline">มารับสินค้าได้</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* ประวัติการทำรายการ */}
        <div className="card glass-panel p-5">
          <h2 className="text-lg font-bold mb-4 flex items-center gap-2"><span>🕒</span> ประวัติการทำรายการ (วันนี้)</h2>
          <div className="overflow-x-auto max-h-100 overflow-y-auto">
            <table className="table table-xs w-full">
              <thead className="sticky top-0 bg-base-100/80 backdrop-blur-md z-10">
                <tr><th>เวลา</th><th>รูปภาพ</th><th>ประเภท</th><th>จำนวนรวม</th><th>ผู้เบิก/ผู้อนุมัติ</th><th>สถานะ</th></tr>
              </thead>
              <tbody>
                {todayLogs.length === 0 ? <tr><td colSpan="6" className="text-center opacity-50 py-4">ไม่มีประวัติรายการในวันนี้</td></tr> : todayLogs.map((tx) => {
                  const items = getItemsToRender(tx);
                  const totalQty = items.reduce((sum, item) => sum + (tx.type === 'INBOUND' ? item.requestedQty : item.approvedQty), 0);
                  
                  return (
                  <tr key={tx.id} className="hover:bg-base-200/40">
                    <td className="opacity-70 whitespace-nowrap">{new Date(tx.requestDate).toLocaleTimeString('th-TH', {timeStyle:'short'})}</td>
                    {/* 👇 เพิ่มรูปภาพในตาราง History แบบซ้อนกันกรณีมีหลายรูป 👇 */}
                    <td>
                      <div className="avatar-group -space-x-3">
                        {items.slice(0, 3).map((i, idx) => (
                          <div key={idx} className="avatar border-none"><div className="w-6 h-6 rounded-full ring-1 ring-base-300"><img src={getImg(i.imageUrl)} crossOrigin="anonymous" alt="pic"/></div></div>
                        ))}
                        {items.length > 3 && (
                          <div className="avatar placeholder border-none"><div className="w-6 h-6 rounded-full bg-neutral text-neutral-content ring-1 ring-base-300"><span className="text-[8px]">+{items.length-3}</span></div></div>
                        )}
                      </div>
                    </td>
                    <td><span className={`badge badge-xs ${tx.type === 'INBOUND' ? 'badge-success' : 'badge-info'}`}>{tx.type === 'OUTBOUND' ? 'เบิก' : txTypeLabel(tx.type)}</span></td>
                    <td className="font-semibold">{totalQty} ชิ้น</td>
                    <td>
                      <div className="flex flex-col">
                        <span className="font-semibold text-primary">{tx.requesterUsername}</span>
                        {tx.type === 'OUTBOUND' && <span className="text-[10px] opacity-60">โดย: {tx.adminUsername || '-'}</span>}
                      </div>
                    </td>
                    <td>
                      <span className={`badge badge-xs ${tx.status === 'Approved' ? 'badge-success' : tx.status === 'Partial' ? 'badge-warning' : 'badge-error'}`}>{txStatusLabel(tx.status)}</span>
                    </td>
                  </tr>
                )})}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Modal พิจารณาใบเบิก */}
      {approveModal && isAdmin && (
        <div className="fixed inset-0 z-100 flex items-center justify-center backdrop-blur-md p-4">
          <div className="glass-modal p-5 sm:p-6 rounded-2xl max-w-2xl w-full max-h-[85vh] overflow-y-auto">
            <h3 className="font-bold text-lg border-b border-base-200 pb-3 mb-4">พิจารณาใบเบิก: {approveModal.transactionId || approveModal.id}</h3>
            <p className="text-sm mb-1"><strong>ผู้ขอเบิก:</strong> {approveModal.requesterUsername}</p>
            <p className="text-sm mb-4"><strong>โปรเจกต์:</strong> {approveModal.project}</p>

            <table className="table table-sm w-full mb-4">
              <thead>
                <tr className="bg-base-200">
                  <th className="w-12">รูปภาพ</th>
                  <th>SKU / ชื่อสินค้า</th>
                  <th className="text-right">จำนวนขอเบิก</th>
                  <th className="text-center w-32">จำนวนอนุมัติ</th>
                </tr>
              </thead>
              <tbody>
                {approveModal.parsedItems.map(item => (
                  <tr key={item.productId}>
                    {/* 👇 โชว์รูปภาพในหน้าจออนุมัติของ Admin 👇 */}
                    <td>
                      <div className="avatar">
                        <div className="w-8 h-8 rounded bg-base-300">
                          <img src={getImg(item.imageUrl)} crossOrigin="anonymous" alt="item" loading="lazy" decoding="async" width="40" height="40" />
                        </div>
                      </div>
                    </td>
                    <td className="text-xs">{item.sku}<br/><span className="opacity-70">{item.productName}</span></td>
                    <td className="text-right text-sm">{item.requestedQty}</td>
                    <td>
                      <input 
                        type="number" min="0" max={item.requestedQty} 
                        className="input input-sm input-bordered w-full text-center"
                        value={approvedQtys[item.productId] ?? 0}
                        onChange={(e) => setApprovedQtys({...approvedQtys, [item.productId]: parseInt(e.target.value) || 0})}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="form-control mb-4">
              <label className="label text-xs font-bold">ข้อความถึงผู้ขอเบิก / เหตุผล <span className="font-normal opacity-60">(จำเป็นเมื่อปฏิเสธ หรืออนุมัติไม่ครบตามจำนวน)</span></label>
              <textarea
                className="textarea textarea-bordered w-full"
                rows="2"
                placeholder="เช่น สต็อกไม่พอ จ่ายได้บางส่วน / ข้อมูลใบเบิกไม่ครบถ้วน"
                value={approveMessage}
                onChange={(e) => setApproveMessage(e.target.value)}
              ></textarea>
            </div>
            <div className="flex justify-end gap-3 pt-4 border-t border-base-200">
              <button className="btn btn-ghost" onClick={() => setApproveModal(null)}>ยกเลิก</button>
              <button className="btn btn-error text-white" onClick={() => handleApproveSubmit('REJECT')}>ปฏิเสธทั้งใบ</button>
              <button className="btn btn-success text-white" onClick={() => handleApproveSubmit('APPROVE')}>บันทึกการอนุมัติ</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal สำหรับการเลือก Export */}
      {itemsModal && (
        <div className="fixed inset-0 z-120 flex items-center justify-center backdrop-blur-md p-4" onClick={() => setItemsModal(null)}>
          <div className="glass-modal p-5 sm:p-6 rounded-2xl max-w-5xl w-full max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <h3 className="font-bold text-lg border-b border-base-200 pb-3 mb-1 flex items-center gap-2">📋 รายการอะไหล่ในใบเบิก</h3>
            <p className="text-xs text-base-content/60 mb-4">
              {itemsModal.transactionId || itemsModal.id} · โปรเจกต์: {itemsModal.project || '-'} · ผู้ขอ: {itemsModal.requesterUsername || '-'}
            </p>
            {/* ตำแหน่งจัดเก็บสำหรับ Admin/Manager ตรวจก่อนเตรียมสินค้า — พาไปหน้าผังคลังได้เลย */}
            <div className="overflow-x-auto">
              <table className="table table-sm">
                <thead><tr><th>รูป</th><th>SKU</th><th className="min-w-[22rem]">ชื่อสินค้า</th><th className="text-right">ขอ</th><th className="text-right">อนุมัติ/ส่งมอบ</th>{isAdmin && <th>ตำแหน่งจัดเก็บ</th>}</tr></thead>
                <tbody>
                  {getItemsToRender(itemsModal).map((it, i) => (
                    <tr key={i} className="hover:bg-base-200/40">
                      <td>
                        <div className="avatar"><div className="w-10 h-10 rounded bg-base-300"><img src={getImg(it.imageUrl)} crossOrigin="anonymous" alt={it.sku} loading="lazy" decoding="async" width="40" height="40" /></div></div>
                      </td>
                      <td className="font-mono text-xs">{it.sku}</td>
                      <td className="text-sm min-w-[22rem]">{it.productName}</td>
                      <td className="text-right">{it.requestedQty}</td>
                      <td className="text-right font-bold text-success">{it.approvedQty}</td>
                      {isAdmin && (
                        <td className="text-xs whitespace-nowrap">
                          {it.rackName ? (
                            <Link
                              to={`/storage?highlight=${it.sku}`}
                              onClick={() => setItemsModal(null)}
                              className="link link-primary flex items-center gap-1"
                              title="ไปที่ตำแหน่งจัดเก็บในผังคลัง"
                            >
                              📍 {it.rackName}{it.storageLevel ? ` · เลเวล ${it.storageLevel}` : ''}
                            </Link>
                          ) : <span className="text-base-content/30">ยังไม่ระบุ</span>}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap justify-end gap-2 mt-4">
              {/* เปิดทั้งใบบนผังคลังพร้อมเส้นทางเดินหยิบ — สำหรับเตรียมของก่อนผู้ขอมารับ */}
              {isAdmin && (
                <Link
                  to={`/storage?pick=${encodeURIComponent(itemsModal.transactionId || itemsModal.id)}`}
                  onClick={() => setItemsModal(null)}
                  className="btn btn-primary text-white"
                >
                  🗺️ ดูทั้งใบบนผังคลัง
                </Link>
              )}
              <button className="btn btn-ghost" onClick={() => setItemsModal(null)}>ปิด</button>
            </div>
          </div>
        </div>
      )}

      {cancelResv && (
        <div className="fixed inset-0 z-120 flex items-center justify-center backdrop-blur-md p-4" onClick={() => setCancelResv(null)}>
          <div className="glass-modal p-5 sm:p-6 rounded-2xl w-full max-w-md" onClick={e => e.stopPropagation()}>
            <h3 className="font-bold text-lg border-b border-base-200 pb-3 mb-2">↩️ ยกเลิกการจอง</h3>
            <p className="text-xs text-base-content/60 mb-1">
              {cancelResv.transactionId || cancelResv.id} · โปรเจกต์: {cancelResv.project || '-'} · ผู้ขอ: {cancelResv.requesterUsername || '-'}
            </p>
            <p className="text-xs text-base-content/60 mb-4">ของที่กันไว้จะถูกปล่อยคืนเข้าสต็อกให้คนอื่นเบิกได้ทันที (ใบนี้ยังไม่ได้ตัดสต็อก)</p>
            <label className="form-control mb-4">
              <span className="label-text text-xs font-bold mb-1">เหตุผลการยกเลิก (จำเป็น)</span>
              <textarea
                autoFocus
                className="textarea textarea-bordered w-full"
                rows={3}
                placeholder="เช่น ผู้ขอไม่มารับเกิน 30 วัน / โครงการถูกยกเลิก"
                value={cancelReason}
                onChange={e => setCancelReason(e.target.value)}
              />
            </label>
            <div className="flex justify-end gap-2">
              <button className="btn btn-ghost" onClick={() => setCancelResv(null)}>ปิด</button>
              <button className="btn btn-error text-white" disabled={!cancelReason.trim()} onClick={submitCancelReservation}>ยกเลิกการจอง</button>
            </div>
          </div>
        </div>
      )}

      {exportModalOpen && (
        <div className="fixed inset-0 z-120 flex items-center justify-center backdrop-blur-md p-4">
          <div className="glass-modal p-5 sm:p-6 rounded-2xl max-w-md w-full max-h-[85vh] overflow-y-auto">
            <h3 className="font-bold text-lg border-b border-base-200 pb-3 mb-4 flex items-center gap-2">📄 เลือกเงื่อนไขการสร้างรายงาน</h3>
            <div className="space-y-4 mb-6">
              <div className="form-control">
                <label className="label text-sm font-bold">ประเภทรายงาน</label>
                <select className="select select-bordered w-full" value={exportType} onChange={handleExportTypeChange}>
                  <option value="day">รายวัน</option>
                  <option value="month">รายเดือน</option>
                  <option value="year">รายปี</option>
                </select>
              </div>
              <div className="form-control">
                <label className="label text-sm font-bold">ระบุ {exportType === 'day' ? 'วันที่' : exportType === 'month' ? 'เดือน' : 'ปี'}</label>
                {exportType === 'day' && <input type="date" className="input input-bordered w-full" value={exportValue} onChange={e => setExportValue(e.target.value)} />}
                {exportType === 'month' && <input type="month" className="input input-bordered w-full" value={exportValue} onChange={e => setExportValue(e.target.value)} />}
                {exportType === 'year' && <input type="number" min="2020" max="2100" className="input input-bordered w-full" value={exportValue} onChange={e => setExportValue(e.target.value)} />}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="form-control">
                  <label className="label text-sm font-bold">ประเภทรายการ</label>
                  <select className="select select-bordered w-full" value={exportTypeFilter} onChange={e => setExportTypeFilter(e.target.value)}>
                    <option value="all">ทั้งหมด</option>
                    <option value="INBOUND">นำเข้า</option>
                    <option value="OUTBOUND">เบิกออก</option>
                  </select>
                </div>
                <div className="form-control">
                  <label className="label text-sm font-bold">โปรเจกต์</label>
                  <select className="select select-bordered w-full" value={exportProjectFilter} onChange={e => setExportProjectFilter(e.target.value)}
                    disabled={exportTypeFilter === 'INBOUND'} title={exportTypeFilter === 'INBOUND' ? 'การนำเข้าไม่มีโปรเจกต์' : undefined}>
                    <option value="all">ทุกโปรเจกต์</option>
                    {exportProjectOptions.map(p => <option key={p} value={p}>{p}</option>)}
                  </select>
                </div>
              </div>
              <div className="bg-base-200 p-3 rounded-lg text-sm text-center">
                {exportLoading
                  ? <span className="flex items-center justify-center gap-2"><span className="loading loading-spinner loading-xs"></span> กำลังค้นหาข้อมูล...</span>
                  : <>พบข้อมูลที่ตรงกับเงื่อนไข: <strong className="text-primary">{exportFilteredLogs.length}</strong> รายการ</>}
              </div>
            </div>
            <div className="flex justify-end gap-3 pt-4 border-t border-base-200">
              <button className="btn btn-ghost" onClick={() => setExportModalOpen(false)} disabled={exporting}>ยกเลิก</button>
              <button className="btn btn-primary text-white" onClick={executePDFExport} disabled={exporting || exportLoading || exportFilteredLogs.length === 0}>
                {exporting && <span className="loading loading-spinner loading-xs"></span>}
                ดาวน์โหลดไฟล์ PDF
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
