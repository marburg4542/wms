import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { fetchApi, getAssetUrl } from '../../utils/api';
import { parseCsv, toCsv } from '../../utils/csv';
import { stockStatusLabel } from '../../utils/labels';
import { onServerEvent } from '../../utils/events';
import BarcodeScanner from '../BarcodeScanner';
import { isCameraScanDevice } from '../../utils/device';
import { confirmDialog } from '../../utils/confirm';
import { parseScannedCode } from '../../utils/qr';

const PAGE_SIZE = 50; // จำนวนสินค้าต่อหน้า (แคตตาล็อกจริงมีหลายพันตัว ต้องแบ่งหน้า)
import { ProductCardSkeleton } from '../Skeleton';
import { useBodyScrollLock } from '../../utils/useBodyScrollLock';

const emptyInboundForm = {
  sku: '',
  name: '',
  quantity: '',
  minStock: 10,
  note: ''
};

const emptyProductForm = {
  sku: '',
  name: '',
  unit: '',
  vendor: '',
  groupId: '00',
  groupName: 'Default',
  latestCost: '',
  minStock: 10,
  imageUrl: '',
  initialStock: ''
};

const imageFallback = "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxNjAiIGhlaWdodD0iMTIwIj48cmVjdCB3aWR0aD0iMTYwIiBoZWlnaHQ9IjEyMCIgZmlsbD0iI2YzZjRmNiIvPjx0ZXh0IHg9IjUwJSIgeT0iNTAlIiBmb250LXNpemU9IjE0IiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBhbGlnbm1lbnQtYmFzZWxpbmU9Im1pZGRsZSIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZpbGw9IiM5YjliOWIiPk5vIEltYWdlPC90ZXh0Pjwvc3ZnPg==";

const csvHeaders = ['sku', 'name', 'unit', 'vendor', 'stock', 'minStock', 'latestCost', 'imageUrl', 'status'];

export default function Products() {
  const currentUser = JSON.parse(sessionStorage.getItem('currentUser') || '{}');
  // Manager จัดการสินค้าได้เท่า Admin (ปิดใช้งาน/คืนสถานะ/ลบถาวร)
  const canArchive = ['Admin', 'Manager'].includes(currentUser.role);
  const importInputRef = useRef(null);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [groups, setGroups] = useState([]);
  const [groupFilter, setGroupFilter] = useState('');
  // มุมมอง "ที่ปิดใช้งาน" — แสดงเฉพาะสินค้าที่ถูก archive ไว้ สำหรับคืนสถานะหรือลบถาวร
  const [showInactive, setShowInactive] = useState(false);
  const [discrepancyOnly, setDiscrepancyOnly] = useState(false); // แสดงเฉพาะสินค้ายอดคลาดเคลื่อน (ติดลบ)
  const [scanOpen, setScanOpen] = useState(false);
  const searchInputRef = useRef(null);

  // มือถือ → เปิดกล้อง / คอม → โฟกัสช่องค้นหาให้เครื่องสแกนบาร์โค้ดยิงลงไป (ทำงานเหมือนคีย์บอร์ด)
  const handleScanClick = () => {
    if (isCameraScanDevice()) {
      setScanOpen(true);
    } else {
      searchInputRef.current?.focus();
      toast('พร้อมสแกน — ยิงบาร์โค้ดด้วยเครื่องสแกนได้เลย', { icon: '🔎' });
    }
  };
  // filter=low ใน URL = โหมดแสดงเฉพาะสต็อกต่ำ (การ์ด Low Stock บน Dashboard ลิงก์มาที่นี่)
  const [searchParams, setSearchParams] = useSearchParams();
  const lowStockOnly = searchParams.get('filter') === 'low';
  const [inboundModal, setInboundModal] = useState(false);
  const [inboundForm, setInboundForm] = useState(emptyInboundForm);
  const [adjustModal, setAdjustModal] = useState(false);
  const [adjustForm, setAdjustForm] = useState({ sku: '', name: '', currentStock: 0, countedQty: '', note: '' });
  const [productModal, setProductModal] = useState(false);
  const [editingSku, setEditingSku] = useState(null);
  const [productForm, setProductForm] = useState(emptyProductForm);
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalItems, setTotalItems] = useState(0);
  const reqIdRef = useRef(0); // ตัวนับลำดับคำขอ — กัน response เก่ามาทับใหม่ (แก้จอกระพริบตอนสลับตัวกรอง)
  useBodyScrollLock(productModal || inboundModal || adjustModal || scanOpen); // freeze พื้นหลังตอนเปิด modal

  // silent = รีเฟรชเบื้องหลังโดยไม่โชว์ spinner (ใช้ตอน poll อัตโนมัติ)
  const fetchProducts = useCallback(async ({ silent = false } = {}) => {
    const reqId = ++reqIdRef.current; // จองหมายเลขคำขอนี้
    if (!silent) setLoading(true);
    try {
      const query = new URLSearchParams({ limit: String(PAGE_SIZE), page: String(page) });
      if (searchTerm.trim()) query.set('search', searchTerm.trim());
      if (groupFilter) query.set('group', groupFilter);
      if (showInactive) query.set('onlyInactive', 'true'); // มุมมองที่ปิดใช้งาน = แสดงเฉพาะสินค้าที่ archive ไว้
      if (lowStockOnly) query.set('lowStock', 'true');
      if (discrepancyOnly) query.set('discrepancy', 'true');
      const json = await fetchApi(`/api/products?${query.toString()}`);
      // ถ้ามีคำขอใหม่กว่ายิงตามมาแล้ว ให้ทิ้ง response เก่านี้ ไม่เอามาอัปเดตจอ
      if (reqId !== reqIdRef.current) return;
      if (json.success) {
        setProducts(json.products);
        setTotalPages(json.totalPages || 1);
        setTotalItems(json.totalItems || 0);
      }
    } catch (err) {
      console.error('Fetch products error:', err);
    } finally {
      if (reqId === reqIdRef.current && !silent) setLoading(false);
    }
  }, [searchTerm, groupFilter, showInactive, lowStockOnly, discrepancyOnly, page]);

  // เปลี่ยนตัวกรอง → กลับไปหน้า 1 เสมอ
  useEffect(() => { setPage(1); }, [searchTerm, groupFilter, showInactive, lowStockOnly, discrepancyOnly]);

  useEffect(() => {
    fetchApi('/api/product-groups')
      .then(json => { if (json.success) setGroups(json.groups); })
      .catch(err => console.error('Fetch groups error:', err));
  }, []);

  // debounce กันยิง request ทุกตัวอักษรที่พิมพ์ค้นหา
  useEffect(() => {
    const timer = setTimeout(fetchProducts, 300);
    return () => clearTimeout(timer);
  }, [fetchProducts]);

  // อัปเดตยอดสต็อกอัตโนมัติ: SSE ทันทีที่ข้อมูลเปลี่ยน + polling 30 วิเป็น fallback
  useEffect(() => {
    const refresh = () => fetchProducts({ silent: true });
    const interval = setInterval(refresh, 30000);
    window.addEventListener('focus', refresh);
    const offProducts = onServerEvent('products', refresh);
    return () => {
      clearInterval(interval);
      window.removeEventListener('focus', refresh);
      offProducts();
    };
  }, [fetchProducts]);

  const openInboundModal = (product = null) => {
    setInboundForm(product ? {
      sku: product.sku,
      name: product.name,
      quantity: '',
      minStock: product.minStock || 10,
      note: ''
    } : emptyInboundForm);
    setInboundModal(true);
  };

  const openAdjustModal = (product) => {
    // เติมยอดปัจจุบันไว้ให้ ผู้ใช้แก้เป็นจำนวนที่นับได้จริง (ถ้าไม่เปลี่ยน = ไม่ปรับ)
    setAdjustForm({ sku: product.sku, name: product.name, currentStock: product.stock, countedQty: String(product.stock), note: '' });
    setAdjustModal(true);
  };

  const openProductModal = (product = null) => {
    const firstGroup = groups[0];
    if (product) {
      setEditingSku(product.sku);
      // สินค้าเก่าที่อยู่กลุ่ม '00' (ที่ถูกเลิกใช้) ให้ default ไปกลุ่มแรกที่เลือกได้
      const validGroup = groups.find(g => g.id === product.groupId) || firstGroup;
      setProductForm({
        sku: product.sku,
        name: product.name,
        unit: product.unit || '',
        vendor: product.vendor || '',
        groupId: validGroup?.id || '01',
        groupName: validGroup?.name || '',
        latestCost: product.latestCost ?? '',
        minStock: product.minStock ?? 10,
        imageUrl: product.imageUrl || '',
        initialStock: ''
      });
      setImagePreview(product.imageUrl ? getAssetUrl(product.imageUrl) : '');
    } else {
      setEditingSku(null);
      setProductForm({ ...emptyProductForm, groupId: firstGroup?.id || '01', groupName: firstGroup?.name || '' });
      setImagePreview('');
    }
    setImageFile(null);
    setProductModal(true);
  };

  const handleImageChange = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setImageFile(file);
    setImagePreview(URL.createObjectURL(file));
  };

  const submitInbound = async (event) => {
    event.preventDefault();
    if (!inboundForm.sku.trim() || !inboundForm.name.trim()) return toast.error('กรุณาระบุ รหัสสินค้า หรือ ชื่ออะไหล่');
    if (!inboundForm.quantity || Number(inboundForm.quantity) <= 0) return toast.error('จำนวนรับเข้าต้องมากกว่า 0');

    setSubmitting(true);
    try {
      const json = await fetchApi('/api/transactions/inbound', {
        method: 'POST',
        body: JSON.stringify({
          sku: inboundForm.sku,
          name: inboundForm.name,
          quantity: Number(inboundForm.quantity),
          minStock: Number(inboundForm.minStock) || 10,
          note: inboundForm.note
        })
      });

      if (json.success) {
        toast.success('บันทึกรับอะไหล่เข้าสำเร็จ');
        setInboundModal(false);
        setInboundForm(emptyInboundForm);
        await fetchProducts();
      }
    } catch (err) {
      console.error('Inbound failed:', err);
    } finally {
      setSubmitting(false);
    }
  };

  const submitAdjust = async (event) => {
    event.preventDefault();
    const counted = Number(adjustForm.countedQty);
    if (!Number.isInteger(counted) || counted < 0) return toast.error('จำนวนที่นับได้ต้องเป็นจำนวนเต็มไม่ติดลบ');

    setSubmitting(true);
    try {
      const json = await fetchApi('/api/transactions/adjust', {
        method: 'POST',
        body: JSON.stringify({ sku: adjustForm.sku, countedQty: counted, note: adjustForm.note })
      });
      if (json.success) {
        toast.success(json.adjusted ? json.message : 'ยอดตรงกับระบบอยู่แล้ว ไม่มีการเปลี่ยนแปลง');
        setAdjustModal(false);
        await fetchProducts();
      }
    } catch (err) {
      console.error('Adjust failed:', err);
    } finally {
      setSubmitting(false);
    }
  };

  const submitProduct = async (event) => {
    event.preventDefault();
    if (!productForm.name.trim()) return toast.error('กรุณาระบุชื่อสินค้า');

    // แก้ไข SKU ได้ แต่ SKU ใหม่ต้องตามกติกา prefix หมวดหมู่ (server ตรวจซ้ำอีกชั้น)
    if (editingSku) {
      const newSku = productForm.sku.trim().toUpperCase();
      if (!newSku) return toast.error('กรุณาระบุ รหัสสินค้า');
      if (newSku !== editingSku && !newSku.startsWith(`${productForm.groupId}-`)) {
        return toast.error(`รหัสสินค้าใหม่ต้องขึ้นต้นด้วย ${productForm.groupId}-`);
      }
    }

    setSubmitting(true);
    try {
      // อัปโหลดรูปใหม่ก่อน (ถ้ามีการเลือกไฟล์) แล้วค่อยบันทึกข้อมูลสินค้าพร้อม URL ที่ได้
      let imageUrl = productForm.imageUrl;
      if (imageFile) {
        const formData = new FormData();
        formData.append('image', imageFile);
        const uploadRes = await fetchApi('/api/upload-product-image', {
          method: 'POST',
          body: formData
        });
        if (uploadRes.success) imageUrl = uploadRes.fileUrl;
      }

      const endpoint = editingSku ? `/api/products/${encodeURIComponent(editingSku)}` : '/api/products';
      const method = editingSku ? 'PUT' : 'POST';
      const payload = {
        ...productForm,
        // ตอนสร้างใหม่ ช่อง sku เก็บเฉพาะส่วนท้าย — ประกอบร่างกับรหัสหมวดหมู่ก่อนส่ง
        sku: editingSku
          ? productForm.sku
          : (productForm.sku.trim() ? `${productForm.groupId}-${productForm.sku.trim()}` : ''),
        imageUrl,
        latestCost: productForm.latestCost === '' ? null : Number(productForm.latestCost),
        minStock: Number(productForm.minStock) || 0,
        initialStock: productForm.initialStock === '' ? null : Number(productForm.initialStock)
      };

      const json = await fetchApi(endpoint, {
        method,
        body: JSON.stringify(payload)
      });

      if (json.success) {
        toast.success(editingSku ? 'อัปเดตสินค้าเรียบร้อย' : 'สร้างสินค้าเรียบร้อย');
        setProductModal(false);
        await fetchProducts();
      }
    } catch (err) {
      console.error('Product save failed:', err);
    } finally {
      setSubmitting(false);
    }
  };

  const archiveProduct = async (product) => {
    const ok = await confirmDialog({
      title: 'ปิดใช้งานสินค้า',
      message: `ปิดใช้งานสินค้า ${product.sku} — ${product.name}?\n(ประวัติยังเก็บไว้ คืนสถานะได้ภายหลัง)`,
      confirmText: 'ปิดใช้งาน',
      danger: true
    });
    if (!ok) return;
    try {
      const json = await fetchApi(`/api/products/${encodeURIComponent(product.sku)}`, { method: 'DELETE' });
      if (json.success) {
        toast.success('ปิดใช้งานสินค้าเรียบร้อย');
        await fetchProducts();
      }
    } catch (err) {
      console.error('Archive product failed:', err);
    }
  };

  const restoreProduct = async (product) => {
    try {
      const json = await fetchApi(`/api/products/${encodeURIComponent(product.sku)}/restore`, { method: 'PUT' });
      if (json.success) {
        toast.success(`คืนสถานะ ${product.sku} เรียบร้อย`);
        await fetchProducts();
      }
    } catch (err) {
      console.error('Restore product failed:', err);
    }
  };

  const permanentDeleteProduct = async (product) => {
    const ok = await confirmDialog({
      title: 'ลบสินค้าถาวร',
      message: `ลบ "${product.sku} — ${product.name}" ออกจากระบบถาวร?\nประวัติรับเข้า/เบิกออกทั้งหมดจะถูกลบด้วย และกู้คืนไม่ได้`,
      confirmText: 'ลบถาวร',
      danger: true
    });
    if (!ok) return;
    try {
      const json = await fetchApi(`/api/products/${encodeURIComponent(product.sku)}/permanent`, { method: 'DELETE' });
      if (json.success) {
        toast.success('ลบสินค้าออกจากระบบถาวรแล้ว');
        await fetchProducts();
      }
    } catch (err) {
      console.error('Permanent delete failed:', err);
    }
  };

  const exportProducts = () => {
    const rows = products.map(item => ({
      sku: item.sku,
      name: item.name,
      unit: item.unit,
      vendor: item.vendor,
      stock: item.stock,
      minStock: item.minStock,
      latestCost: item.latestCost,
      imageUrl: item.imageUrl,
      status: item.status
    }));
    const csv = toCsv(rows, csvHeaders);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `WMS_Products_${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const importProducts = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    try {
      const rows = parseCsv(await file.text());

      const json = await fetchApi('/api/products/import', {
        method: 'POST',
        body: JSON.stringify({ rows })
      });

      if (json.success) {
        toast.success(`นำเข้าสำเร็จ: เพิ่ม ${json.created}, อัปเดต ${json.updated}, ข้าม ${json.skipped?.length || 0}`);
        await fetchProducts();
      }
    } catch (err) {
      console.error('Import failed:', err);
      toast.error('นำเข้าไฟล์ไม่สำเร็จ');
    }
  };

  // ตัวกรองมุมมอง 3 อัน (สต็อกต่ำ / คลาดเคลื่อน / ที่ปิดใช้งาน) เปิดได้ทีละ 1 อันเท่านั้น — เปิดอันใหม่ปิดที่เหลืออัตโนมัติ
  const clearLowStock = () => {
    if (!lowStockOnly) return;
    const params = new URLSearchParams(searchParams);
    params.delete('filter');
    setSearchParams(params, { replace: true });
  };

  const toggleLowStock = () => {
    const next = new URLSearchParams(searchParams);
    if (lowStockOnly) {
      next.delete('filter');
    } else {
      next.set('filter', 'low');
      setDiscrepancyOnly(false);
      setShowInactive(false);
    }
    setSearchParams(next, { replace: true });
  };

  const toggleDiscrepancy = () => {
    const next = !discrepancyOnly;
    setDiscrepancyOnly(next);
    if (next) { clearLowStock(); setShowInactive(false); }
  };

  const toggleShowInactive = () => {
    const next = !showInactive;
    setShowInactive(next);
    if (next) { clearLowStock(); setDiscrepancyOnly(false); }
  };

  // ค้นหา/กรองสถานะ/สต็อกต่ำ/แบ่งหน้า ทำที่ server แล้ว — แสดงตามที่ได้มาตรงๆ
  const filteredProducts = products;

  return (
    <div className="space-y-6 animate-fade-in relative">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 glass-panel p-5 rounded-2xl">
        <div>
          <h1 className="text-2xl font-bold text-gradient w-fit">รายการอะไหล่</h1>
          <p className="text-sm text-base-content/60 mt-1">จัดการ ข้อมูลหลัก, สต็อกขั้นต่ำ, การนำเข้า/ส่งออกไฟล์ CSV และบันทึกรับเข้า</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="btn btn-ghost btn-sm" onClick={exportProducts} disabled={products.length === 0}>นำออก CSV</button>
          <button className="btn btn-ghost btn-sm" onClick={() => importInputRef.current?.click()}>นำเข้า CSV</button>
          <button className="btn btn-primary btn-sm shadow-md" onClick={() => openProductModal()}>เพิ่มสินค้า</button>
          <input ref={importInputRef} type="file" accept=".csv,text/csv" className="hidden" onChange={importProducts} />
        </div>
      </div>

      <div className="glass-panel rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="flex gap-2 w-full sm:max-w-xs">
          <input
            ref={searchInputRef}
            className="input input-bordered input-sm w-full"
            placeholder="ค้นหา รหัสสินค้า, ชื่อ, ผู้ขาย..."
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
          />
          <button type="button" onClick={handleScanClick} className="btn btn-sm btn-square btn-primary shrink-0" title="สแกนบาร์โค้ด/QR" aria-label="สแกนบาร์โค้ด">📷</button>
        </div>
        <select
          className="select select-bordered select-sm w-full sm:max-w-57.5"
          value={groupFilter}
          onChange={(event) => setGroupFilter(event.target.value)}
        >
          <option value="">ทุกหมวดหมู่</option>
          {groups.map(g => <option key={g.id} value={g.id}>{g.id} — {g.name}</option>)}
        </select>
        <label className="label cursor-pointer gap-2 py-0">
          <input type="checkbox" className="toggle toggle-sm toggle-error" checked={lowStockOnly} onChange={toggleLowStock} />
          <span className="label-text text-sm font-medium">สต็อกต่ำ</span>
        </label>
        <label className="label cursor-pointer gap-2 py-0">
          <input type="checkbox" className="toggle toggle-sm toggle-warning" checked={discrepancyOnly} onChange={toggleDiscrepancy} />
          <span className="label-text text-sm font-medium">สต็อกคลาดเคลื่อน</span>
        </label>
        <label className="label cursor-pointer gap-2 py-0">
          <input type="checkbox" className="toggle toggle-sm" checked={showInactive} onChange={toggleShowInactive} />
          <span className="label-text text-sm font-medium">ที่ปิดใช้งาน</span>
        </label>
        {lowStockOnly && (
          <span className="badge badge-error badge-outline gap-1">สต็อกต่ำ ({totalItems.toLocaleString()} รายการ)</span>
        )}
        {discrepancyOnly && (
          <span className="badge badge-warning badge-outline gap-1">ติดลบ {totalItems.toLocaleString()} รายการ</span>
        )}
      </div>

      {loading ? (
        <ProductCardSkeleton count={8} />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {filteredProducts.map((item) => (
            <div key={item.id} className="card glass-panel overflow-hidden hover:-translate-y-1 hover:shadow-2xl transition-all group">
              <figure className="h-44 bg-white border-b border-base-200 relative overflow-hidden">
                <img src={getAssetUrl(item.imageUrl) || imageFallback} alt={item.name} className="object-cover w-full h-full group-hover:scale-105 transition-transform duration-500" />
                <div className="absolute top-2 right-2">
                  {item.isActive
                    ? <span className={`badge font-semibold text-white shadow-sm ${item.stock > item.minStock ? 'badge-success' : item.stock > 0 ? 'badge-warning' : 'badge-error'}`}>{stockStatusLabel(item.status)}</span>
                    : <span className="badge badge-neutral font-semibold shadow-sm">ปิดใช้งาน</span>}
                </div>
              </figure>
              <div className="card-body p-5">
                <h2 className="card-title text-base leading-tight">{item.name}</h2>
                <div className="flex justify-between items-center mt-2">
                  <span className="font-mono text-sm text-base-content/60 bg-base-200 px-2 py-1 rounded">{item.sku}</span>
                  <span className="text-sm font-bold opacity-80">จำนวนสต็อก: {item.stock}</span>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs text-base-content/60">
                  <span>ขั้นต่ำ: {item.minStock}</span>
                  <span>หน่วย: {item.unit || '-'}</span>
                  <span className="col-span-2 truncate">หมวด: {item.groupId} — {item.groupName || 'ทั่วไป'}</span>
                  <span className="col-span-2 truncate">ผู้ขาย: {item.vendor || '-'}</span>
                </div>
                <div className="card-actions justify-end mt-4 pt-4 border-t border-base-200">
                  {item.isActive ? (
                    <>
                      <button className="btn btn-ghost btn-sm text-primary" onClick={() => openProductModal(item)}>แก้ไข</button>
                      <button className="btn btn-ghost btn-sm text-success" onClick={() => openInboundModal(item)}>รับเข้า</button>
                      <button className="btn btn-ghost btn-sm text-warning" onClick={() => openAdjustModal(item)}>ปรับยอด</button>
                      {canArchive && <button className="btn btn-ghost btn-sm text-error" onClick={() => archiveProduct(item)}>ปิดใช้งาน</button>}
                    </>
                  ) : (
                    <>
                      {canArchive && <button className="btn btn-ghost btn-sm text-success" onClick={() => restoreProduct(item)}>♻️ คืนสถานะ</button>}
                      {canArchive && <button className="btn btn-ghost btn-sm text-error" onClick={() => permanentDeleteProduct(item)}>🗑 ลบถาวร</button>}
                    </>
                  )}
                </div>
              </div>
            </div>
          ))}
          {filteredProducts.length === 0 && (
            <div className="col-span-full text-center py-20 opacity-60">ไม่พบสินค้า</div>
          )}
        </div>
      )}

      {/* แบ่งหน้า */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between gap-2 mt-6 pt-4 border-t border-base-200">
          <span className="text-xs opacity-60">ทั้งหมด {totalItems.toLocaleString()} รายการ · หน้า {page}/{totalPages}</span>
          <div className="flex gap-1">
            <button className="btn btn-sm btn-ghost" disabled={page <= 1}
              onClick={() => setPage(p => Math.max(p - 1, 1))}>‹ ก่อนหน้า</button>
            <button className="btn btn-sm btn-ghost" disabled={page >= totalPages}
              onClick={() => setPage(p => Math.min(p + 1, totalPages))}>ถัดไป ›</button>
          </div>
        </div>
      )}

      {productModal && (
        <div className="fixed inset-0 z-100 flex items-center justify-center backdrop-blur-md p-4">
          <div className="glass-modal w-full max-w-2xl p-5 sm:p-6 rounded-2xl animate-fade-in max-h-[85vh] overflow-y-auto">
            <h3 className="font-bold text-lg text-primary border-b border-base-200 pb-3 mb-4">{editingSku ? 'แก้ไขสินค้า' : 'เพิ่มสินค้าใหม่'}</h3>
            <form onSubmit={submitProduct} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className="form-control">
                  <span className="label-text text-xs font-bold">หมวดหมู่</span>
                  <select
                    className="select select-bordered"
                    value={productForm.groupId}
                    onChange={(e) => {
                      const selected = groups.find(g => g.id === e.target.value);
                      setProductForm({ ...productForm, groupId: e.target.value, groupName: selected?.name || 'Default' });
                    }}
                  >
                    {groups.map(g => <option key={g.id} value={g.id}>{g.id} — {g.name}</option>)}
                  </select>
                </label>
                <label className="form-control">
                  <span className="label-text text-xs font-bold">
                    SKU{' '}
                    {editingSku
                      ? <span className="font-normal opacity-60">(แก้ไขได้ — ต้องขึ้นต้นด้วย {productForm.groupId}-)</span>
                      : <span className="font-normal opacity-60">(เว้นว่าง = เลขอัตโนมัติ)</span>}
                  </span>
                  {editingSku ? (
                    <input
                      className="input input-bordered font-mono"
                      value={productForm.sku}
                      onChange={(e) => setProductForm({ ...productForm, sku: e.target.value })}
                      required
                    />
                  ) : (
                    // 2 หลักแรกล็อกตามหมวดหมู่ที่เลือก แก้ได้เฉพาะเลขหลังขีด
                    <div className="join w-full">
                      <span className="join-item flex items-center px-4 bg-base-200 border border-base-300 font-mono font-bold text-sm">{productForm.groupId}-</span>
                      <input
                        className="input input-bordered join-item w-full font-mono"
                        inputMode="numeric"
                        value={productForm.sku}
                        onChange={(e) => setProductForm({ ...productForm, sku: e.target.value.replace(/[^0-9a-zA-Z]/g, '') })}
                        placeholder="เช่น 001"
                      />
                    </div>
                  )}
                </label>
                <label className="form-control sm:col-span-2">
                  <span className="label-text text-xs font-bold">ชื่อสินค้า</span>
                  <input className="input input-bordered" value={productForm.name} onChange={(e) => setProductForm({ ...productForm, name: e.target.value })} required />
                </label>
                <label className="form-control">
                  <span className="label-text text-xs font-bold">หน่วย</span>
                  <input className="input input-bordered" value={productForm.unit} onChange={(e) => setProductForm({ ...productForm, unit: e.target.value })} />
                </label>
                <label className="form-control">
                  <span className="label-text text-xs font-bold">ผู้ขาย</span>
                  <input className="input input-bordered" value={productForm.vendor} onChange={(e) => setProductForm({ ...productForm, vendor: e.target.value })} />
                </label>
                <label className="form-control">
                  <span className="label-text text-xs font-bold">สต็อกขั้นต่ำ</span>
                  <input type="number" min="0" className="input input-bordered" value={productForm.minStock} onChange={(e) => setProductForm({ ...productForm, minStock: e.target.value })} />
                </label>
                <label className="form-control">
                  <span className="label-text text-xs font-bold">ราคาล่าสุด</span>
                  <input type="number" min="0" step="0.01" className="input input-bordered" value={productForm.latestCost} onChange={(e) => setProductForm({ ...productForm, latestCost: e.target.value })} />
                </label>
                {!editingSku && (
                  <label className="form-control">
                    <span className="label-text text-xs font-bold">สต็อกเริ่มต้น</span>
                    <input type="number" min="0" className="input input-bordered" value={productForm.initialStock} onChange={(e) => setProductForm({ ...productForm, initialStock: e.target.value })} />
                  </label>
                )}
                <label className="form-control sm:col-span-2">
                  <span className="label-text text-xs font-bold">รูปภาพสินค้า</span>
                  <div className="flex items-center gap-3">
                    <img
                      src={imagePreview || imageFallback}
                      alt="preview"
                      className="w-16 h-16 rounded-lg object-cover border border-base-300 bg-white shrink-0"
                    />
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      className="file-input file-input-bordered w-full"
                      onChange={handleImageChange}
                    />
                  </div>
                  <span className="label-text-alt opacity-60 mt-1">รองรับ JPG, PNG, WEBP ขนาดไม่เกิน 5MB</span>
                </label>
              </div>
              <div className="flex justify-end gap-3 pt-4 border-t border-base-200">
                <button type="button" className="btn btn-ghost" onClick={() => setProductModal(false)} disabled={submitting}>ยกเลิก</button>
                <button type="submit" className="btn btn-primary text-white" disabled={submitting}>
                  {submitting && <span className="loading loading-spinner loading-xs"></span>}
                  บันทึก
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {inboundModal && (
        <div className="fixed inset-0 z-100 flex items-center justify-center backdrop-blur-md p-4">
          <div className="glass-modal w-full max-w-md p-5 sm:p-6 rounded-2xl animate-fade-in max-h-[85vh] overflow-y-auto">
            <h3 className="font-bold text-lg text-primary border-b border-base-200 pb-3 mb-4">รับอะไหล่เข้า</h3>
            <form onSubmit={submitInbound} className="space-y-4">
              {/* เปิดจากการ์ดสินค้าเสมอ SKU/ชื่อถูกเติมมาให้แล้ว ล็อกไว้กันพิมพ์ผิดตัว */}
              <input type="text" placeholder="รหัสสินค้า (SKU)" required disabled className="input input-bordered w-full" value={inboundForm.sku} />
              <input type="text" placeholder="ชื่ออะไหล่" className="input input-bordered w-full" value={inboundForm.name} onChange={e => setInboundForm({ ...inboundForm, name: e.target.value })} required />
              <div className="grid grid-cols-2 gap-3">
                <input type="number" min="1" placeholder="จำนวนรับเข้า" className="input input-bordered w-full" value={inboundForm.quantity} onChange={e => setInboundForm({ ...inboundForm, quantity: e.target.value })} required />
                <input type="number" min="0" placeholder="ขั้นต่ำ" className="input input-bordered w-full" value={inboundForm.minStock} onChange={e => setInboundForm({ ...inboundForm, minStock: e.target.value })} />
              </div>
              <textarea className="textarea textarea-bordered h-20 w-full" value={inboundForm.note} onChange={(e) => setInboundForm({ ...inboundForm, note: e.target.value })} placeholder="เลขใบส่งของ / ผู้ส่งมอบ / หมายเหตุ"></textarea>
              <div className="flex justify-end gap-3 pt-4 border-t border-base-200">
                <button type="button" className="btn btn-ghost" onClick={() => setInboundModal(false)} disabled={submitting}>ยกเลิก</button>
                <button type="submit" className="btn btn-success text-white" disabled={submitting}>
                  {submitting && <span className="loading loading-spinner loading-xs"></span>}
                  บันทึกรับเข้า
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {adjustModal && (
        <div className="fixed inset-0 z-100 flex items-center justify-center backdrop-blur-md p-4">
          <div className="glass-modal w-full max-w-md p-5 sm:p-6 rounded-2xl animate-fade-in max-h-[85vh] overflow-y-auto">
            <h3 className="font-bold text-lg text-warning border-b border-base-200 pb-3 mb-4">ปรับยอดสต็อก (นับจริง)</h3>
            <form onSubmit={submitAdjust} className="space-y-4">
              <div className="text-sm bg-base-200/50 rounded-lg p-3">
                <div className="font-mono font-semibold">{adjustForm.sku}</div>
                <div className="opacity-70">{adjustForm.name}</div>
                <div className="mt-1">ยอดในระบบตอนนี้: <span className="font-bold">{adjustForm.currentStock}</span></div>
              </div>
              <label className="form-control w-full">
                <span className="label-text text-sm font-medium mb-1">จำนวนที่นับได้จริง</span>
                <input type="number" min="0" step="1" className="input input-bordered w-full" value={adjustForm.countedQty}
                  onChange={e => setAdjustForm({ ...adjustForm, countedQty: e.target.value })} required autoFocus />
              </label>
              {/* แสดงส่วนต่างให้เห็นก่อนกดยืนยัน */}
              {adjustForm.countedQty !== '' && Number(adjustForm.countedQty) !== adjustForm.currentStock && (
                <div className="text-sm">ส่วนต่าง: <span className={`font-bold ${Number(adjustForm.countedQty) > adjustForm.currentStock ? 'text-success' : 'text-error'}`}>
                  {Number(adjustForm.countedQty) > adjustForm.currentStock ? '+' : ''}{Number(adjustForm.countedQty) - adjustForm.currentStock}
                </span></div>
              )}
              <textarea className="textarea textarea-bordered h-20 w-full" value={adjustForm.note}
                onChange={e => setAdjustForm({ ...adjustForm, note: e.target.value })} placeholder="เหตุผล เช่น นับสต็อกประจำเดือน / ของชำรุด / สูญหาย"></textarea>
              <div className="flex justify-end gap-3 pt-4 border-t border-base-200">
                <button type="button" className="btn btn-ghost" onClick={() => setAdjustModal(false)} disabled={submitting}>ยกเลิก</button>
                <button type="submit" className="btn btn-warning text-white" disabled={submitting}>
                  {submitting && <span className="loading loading-spinner loading-xs"></span>}
                  ยืนยันปรับยอด
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {scanOpen && (
        <BarcodeScanner
          onClose={() => setScanOpen(false)}
          onDetected={(code) => {
            const { searchValue, fromLabel } = parseScannedCode(code);
            setSearchTerm(searchValue);
            setScanOpen(false);
            toast.success(fromLabel ? `สแกนป้าย: รหัสสินค้า ${searchValue}` : `สแกนได้: ${searchValue}`);
          }}
        />
      )}
    </div>
  );
}
