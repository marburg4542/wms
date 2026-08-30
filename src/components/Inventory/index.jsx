// src/components/Inventory/index.jsx
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { fetchApi, getAssetUrl } from '../../utils/api';
import { locationLabel, stockStatusLabel } from '../../utils/labels';
import { onServerEvent } from '../../utils/events';
import BarcodeScanner from '../BarcodeScanner';
import { isCameraScanDevice } from '../../utils/device';
import { ListSkeleton } from '../Skeleton';
import { useBodyScrollLock } from '../../utils/useBodyScrollLock';
import { parseScannedCode } from '../../utils/qr';
import { confirmDialog } from '../../utils/confirm';
import toast from 'react-hot-toast';

const PAGE_SIZE = 50; // จำนวนสินค้าต่อหน้า (แบ่งหน้าเพราะแคตตาล็อกจริงมีหลายพันตัว)

// ฟังก์ชันดึงรูปภาพ (ถ้าไม่มีรูปให้ใช้รูป SVG เปล่าๆ แทน เพื่อกันพัง)
const getImg = (url) => {
  if (!url) return "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxMDAiIGhlaWdodD0iMTAwIj48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSIjZjNmNGY2Ii8+PHRleHQgeD0iNTAlIiB5PSI1MCUiIGZvbnQtc2l6ZT0iMTIiIHRleHQtYW5jaG9yPSJtaWRkbGUiIGFsaWdubWVudC1iYXNlbGluZT0ibWlkZGxlIiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiIgZmlsbD0iIzliOWI5YiI+Tm8gSW1hZ2U8L3RleHQ+PC9zdmc+";
  return getAssetUrl(url);
};

export default function Inventory() {
  const [searchParams] = useSearchParams();
  // Viewer ดูข้อมูลได้อย่างเดียว — ซ่อน UI การเบิกทั้งหมด (server ก็บล็อกอีกชั้น)
  const currentUser = JSON.parse(sessionStorage.getItem('currentUser') || '{}');
  const canWithdraw = currentUser.role !== 'Viewer';

  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [groups, setGroups] = useState([]);
  const [groupFilter, setGroupFilter] = useState('');
  const [scanOpen, setScanOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalItems, setTotalItems] = useState(0);
  const reqIdRef = useRef(0); // ตัวนับลำดับคำขอ — กัน response เก่ามาทับใหม่ (แก้จอกระพริบตอนค้นหา/เปลี่ยนหน้า)
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

  // ระบบตะกร้าสินค้า
  const [cart, setCart] = useState([]);
  const [cartModal, setCartModal] = useState(false);
  const [reqProject, setReqProject] = useState('');
  const [projectList, setProjectList] = useState([]);      // [{id, name}] รายชื่อโปรเจกต์
  const [selectedProject, setSelectedProject] = useState(''); // ตัวกรอง/โปรเจกต์ปัจจุบันของการเบิก (เติมให้ตะกร้าอัตโนมัติ)
  const [projectModal, setProjectModal] = useState(false); // modal จัดการโปรเจกต์ (เพิ่ม/ลบ)
  const [newProjectName, setNewProjectName] = useState('');
  const [categoryModal, setCategoryModal] = useState(false); // modal จัดการหมวดหมู่ (เพิ่ม/ลบ/ยุบ)
  const [newCategoryName, setNewCategoryName] = useState('');
  const [mergeFrom, setMergeFrom] = useState('');
  const [mergeTo, setMergeTo] = useState('');
  const isManager = ['Admin', 'Manager'].includes(currentUser.role);

  useBodyScrollLock(cartModal || scanOpen || projectModal || categoryModal); // freeze พื้นหลังตอนเปิด modal

  // ค้นหาผ่านฝั่ง server เพื่อให้เจอสินค้าทุกตัว ไม่ติดเพดานจำนวนรายการที่โหลดมาแสดง
  // silent = รีเฟรชเบื้องหลังโดยไม่โชว์ spinner (ใช้ตอน poll อัตโนมัติ)
  const fetchProducts = useCallback(async ({ silent = false } = {}) => {
    const reqId = ++reqIdRef.current; // จองหมายเลขคำขอนี้
    if (!silent) setLoading(true);
    try {
      const query = new URLSearchParams({ limit: String(PAGE_SIZE), page: String(page) });
      if (searchTerm.trim()) query.set('search', searchTerm.trim());
      if (groupFilter) query.set('group', groupFilter);
      // ส่งโครงการไปด้วย เพื่อให้ server คำนวณ "เบิกได้" ตามโควตาพื้นที่จัดเตรียมของโครงการนั้น
      if (selectedProject) query.set('project', selectedProject);
      const json = await fetchApi(`/api/products?${query.toString()}`);
      // ทิ้ง response เก่าถ้ามีคำขอใหม่กว่ายิงตามมาแล้ว (กันค่าเด้งกลับไปมา)
      if (reqId !== reqIdRef.current) return;
      if (json.success) {
        setData(json.products);
        setTotalPages(json.totalPages || 1);
        setTotalItems(json.totalItems || 0);
      }
    } catch (error) {
      console.warn('Failed to fetch products', error);
    } finally {
      if (reqId === reqIdRef.current && !silent) setLoading(false);
    }
  }, [searchTerm, groupFilter, page, selectedProject]);

  // เปลี่ยนคำค้น/หมวดหมู่ → กลับไปหน้า 1 เสมอ (ไม่งั้นอาจค้างหน้าที่ไม่มีผลลัพธ์)
  useEffect(() => { setPage(1); }, [searchTerm, groupFilter, selectedProject]);

  const loadGroups = useCallback(() => {
    fetchApi('/api/product-groups')
      .then(json => { if (json.success) setGroups(json.groups); })
      .catch(err => console.warn('Failed to fetch groups', err));
  }, []);
  useEffect(() => { loadGroups(); }, [loadGroups]);

  // รายชื่อโปรเจกต์ (ใช้ทั้งตัวกรอง, ตะกร้า, จัดการ) — โหลดตอน mount + รีโหลดหลังเพิ่ม/ลบ
  const loadProjects = useCallback(() => {
    fetchApi('/api/projects')
      .then(json => { if (json.success) setProjectList(json.projects || []); })
      .catch(() => {});
  }, []);
  useEffect(() => { loadProjects(); }, [loadProjects]);

  // เปิดตะกร้าแล้วยังไม่ได้กรอกโปรเจกต์ → เติมโปรเจกต์ที่เลือกไว้ในตัวกรองให้อัตโนมัติ
  useEffect(() => {
    if (cartModal && selectedProject && !reqProject) setReqProject(selectedProject);
  }, [cartModal]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const timer = setTimeout(fetchProducts, 300);
    return () => clearTimeout(timer);
  }, [fetchProducts]);

  // อัปเดตยอดสต็อกอัตโนมัติทุก 30 วินาที + ตอนสลับกลับมาที่แท็บ
  // เผื่อมีคน inbound/outbound จากเครื่องอื่นระหว่างที่เปิดหน้านี้ค้างไว้
  useEffect(() => {
    const refresh = () => fetchProducts({ silent: true });
    const interval = setInterval(refresh, 300000)  // 5 นาที — SSE ส่ง event ให้อยู่แล้ว อันนี้เป็นแค่ fallback เผื่อ stream หลุด;
    window.addEventListener('focus', refresh);
    const offProducts = onServerEvent('products', refresh);
    return () => {
      clearInterval(interval);
      window.removeEventListener('focus', refresh);
      offProducts();
    };
  }, [fetchProducts]);
  useEffect(() => {
    setSearchTerm(searchParams.get('search') || '');
  }, [searchParams]);

  // ค้นหา/กรอง/แบ่งหน้าทำที่ฝั่ง server แล้ว — แสดงผลตามที่ได้มาตรงๆ (ไม่กรองซ้ำ ไม่งั้นจะซ่อนผลที่ match ผู้ขาย)
  const filteredData = data;

  // ยอดที่เบิกได้จริง = คงเหลือ − ที่ถูกจองให้ใบเบิกที่อนุมัติแล้วรอรับของ
  const availableOf = (product) => Number(product.available ?? product.stock ?? 0);

  const addToCart = (product) => {
    const available = availableOf(product);
    if (available <= 0) {
      if (product.stock <= 0) return toast.error('สินค้านี้หมดสต็อก');
      return toast.error(product.availableSource === 'staging'
        ? `${product.sku} ใช้โควตาของโครงการ ${selectedProject} ครบแล้ว (จัดเตรียมไว้ ${product.stagingQuota}) — แจ้งผู้จัดการเติมของเข้าพื้นที่จัดเตรียม`
        : `${product.sku} ถูกกันไว้ให้โครงการอื่นหมดแล้ว (คงเหลือ ${product.stock} · ของกลาง ${product.freeStock})`);
    }
    const existing = cart.find(c => c.productId === product.id);
    if (existing) {
      const current = Number(existing.quantity) || 0;
      if (current >= available) return toast.error(`ขอเบิกเกินยอดที่เบิกได้ (${available})`);
      setCart(cart.map(c => c.productId === product.id ? { ...c, quantity: current + 1 } : c));
    } else {
      // 👇 บันทึก imageUrl ลงในตะกร้า
      setCart([...cart, { productId: product.id, sku: product.sku, productName: product.name, imageUrl: product.imageUrl, quantity: 1, stock: available }]);
    }
    toast.success(`เพิ่ม ${product.sku} ลงในใบเบิกแล้ว`);
  };

  const removeFromCart = (productId) => setCart(cart.filter(c => c.productId !== productId));

  // ระหว่างพิมพ์ยอมให้ค่าเป็นอะไรก็ได้ (รวมถึงช่องว่าง) แล้วค่อยตรวจ/ปัดค่าตอน blur กับตอนส่งใบเบิก
  const setCartQty = (productId, quantity) =>
    setCart(prev => prev.map(c => (c.productId === productId ? { ...c, quantity } : c)));

  const stepCartQty = (item, delta) => {
    const next = (Number(item.quantity) || 0) + delta;
    setCartQty(item.productId, Math.min(Math.max(next, 1), item.stock));
  };

  const submitCartRequest = async (e) => {
    e.preventDefault();
    if (cart.length === 0) return toast.error('ไม่มีสินค้าในใบเบิก');
    if (!reqProject.trim()) return toast.error('กรุณาระบุชื่อโปรเจกต์');

    for (const item of cart) {
      const qty = Number(item.quantity);
      if (!Number.isInteger(qty) || qty < 1) return toast.error(`จำนวนเบิกของ ${item.sku} ไม่ถูกต้อง`);
      if (qty > item.stock) return toast.error(`${item.sku} ขอเบิกเกินสต็อกคงเหลือ (${item.stock})`);
    }

    try {
      const res = await fetchApi('/api/transactions/request', {
        method: 'POST',
        body: JSON.stringify({
          items: cart.map(c => ({ ...c, quantity: Number(c.quantity) })),
          project: reqProject
        })
      });
      if (res.success) {
        toast.success('ส่งใบคำขอเบิกสินค้าสำเร็จ');
        setCart([]);
        setReqProject('');
        setCartModal(false);
        fetchProducts();
      }
    } catch { toast.error('เกิดข้อผิดพลาด'); }
  };

  const addProjectHandler = async () => {
    const name = newProjectName.trim();
    if (!name) return;
    try {
      const j = await fetchApi('/api/projects', { method: 'POST', body: JSON.stringify({ name }) });
      if (j.success) {
        setNewProjectName('');
        loadProjects();
        toast.success(j.existed ? `มีโปรเจกต์นี้อยู่แล้ว: ${j.project.name}` : `เพิ่มโปรเจกต์ "${j.project.name}"`);
      }
    } catch { toast.error('เพิ่มโปรเจกต์ไม่สำเร็จ'); }
  };

  const deleteProjectHandler = async (p) => {
    const ok = await confirmDialog({ title: 'ลบโปรเจกต์', message: `ลบโปรเจกต์ "${p.name}"?\n(ใบเบิกเดิมไม่กระทบ ชื่อยังอยู่ในประวัติ)`, confirmText: 'ลบ', danger: true });
    if (!ok) return;
    try {
      const j = await fetchApi(`/api/projects/${p.id}`, { method: 'DELETE' });
      if (j.success) { loadProjects(); if (selectedProject === p.name) setSelectedProject(''); toast.success('ลบโปรเจกต์แล้ว'); }
    } catch { toast.error('ลบไม่สำเร็จ'); }
  };

  const addCategoryHandler = async () => {
    const name = newCategoryName.trim();
    if (!name) return;
    try {
      const j = await fetchApi('/api/product-groups', { method: 'POST', body: JSON.stringify({ name }) });
      if (j.success) { setNewCategoryName(''); loadGroups(); toast.success(j.group?.existed ? 'มีหมวดนี้แล้ว' : `เพิ่มหมวด ${j.group.id} — ${j.group.name}`); }
    } catch (e) { toast.error(e?.message || 'เพิ่มหมวดไม่สำเร็จ'); }
  };

  const deleteCategoryHandler = async (g) => {
    if (g.itemCount > 0) return toast.error(`ลบไม่ได้ — มีสินค้า ${g.itemCount} รายการ (ต้องยุบก่อน)`);
    const ok = await confirmDialog({ title: 'ลบหมวดหมู่', message: `ลบหมวด "${g.id} — ${g.name}"?`, confirmText: 'ลบ', danger: true });
    if (!ok) return;
    try {
      const j = await fetchApi(`/api/product-groups/${g.id}`, { method: 'DELETE' });
      if (j.success) { loadGroups(); toast.success('ลบหมวดแล้ว'); }
    } catch (e) { toast.error(e?.message || 'ลบไม่สำเร็จ'); }
  };

  const resequenceCategoryHandler = async () => {
    const hasItems = groups.some(g => g.itemCount > 0);
    const ok = await confirmDialog({
      title: 'จัดเรียงเลขหมวดใหม่',
      message: `เรียงเลขหมวดให้ต่อเนื่อง (01, 02, 03, ...) ปิดช่องว่างจากการยุบ/ลบ` +
        (hasItems ? `\n⚠️ มีสินค้าอยู่ — SKU ของหมวดที่เปลี่ยนรหัสจะถูกรันใหม่ตาม ถ้ามีป้าย QR เดิมต้องพิมพ์ใหม่` : ''),
      confirmText: 'จัดเรียง'
    });
    if (!ok) return;
    try {
      const j = await fetchApi('/api/product-groups/resequence', { method: 'POST' });
      if (j.success) { loadGroups(); fetchProducts(); toast.success(j.message); }
    } catch (e) { toast.error(e?.message || 'จัดเรียงไม่สำเร็จ'); }
  };

  const mergeCategoryHandler = async () => {
    if (!mergeFrom || !mergeTo || mergeFrom === mergeTo) return toast.error('เลือกหมวดต้นทาง/ปลายทางให้ถูกต้อง');
    const from = groups.find(g => g.id === mergeFrom), to = groups.find(g => g.id === mergeTo);
    const ok = await confirmDialog({
      title: 'ยุบหมวดหมู่',
      message: `ยุบ "${from?.id} — ${from?.name}" (${from?.itemCount || 0} รายการ) เข้ากับ "${to?.id} — ${to?.name}"?\n⚠️ สินค้าจะถูกรัน SKU ใหม่ตามหมวดปลายทาง — ถ้ามีป้าย QR เดิมต้องพิมพ์ใหม่`,
      confirmText: 'ยุบ', danger: true
    });
    if (!ok) return;
    try {
      const j = await fetchApi('/api/product-groups/merge', { method: 'POST', body: JSON.stringify({ fromId: mergeFrom, toId: mergeTo }) });
      if (j.success) { setMergeFrom(''); setMergeTo(''); loadGroups(); fetchProducts(); toast.success(j.message); }
    } catch (e) { toast.error(e?.message || 'ยุบหมวดไม่สำเร็จ'); }
  };

  return (
    <div className="space-y-6 animate-fade-in relative pb-20">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 glass-panel p-5 rounded-2xl">
        <div>
          <h1 className="text-2xl font-bold text-gradient w-fit">จัดการสินค้าคงคลัง</h1>
          <p className="text-sm text-base-content/60 mt-1">
            {canWithdraw ? 'เลือกสินค้าที่ต้องการเบิกลงในใบเบิก แล้วส่งคำขอให้ผู้ดูแลอนุมัติ' : 'ดูข้อมูลสินค้าคงคลัง (สิทธิ์ดูอย่างเดียว)'}
          </p>
        </div>
      </div>

      {canWithdraw && !selectedProject && (
        <div className="alert alert-info py-2 text-sm">
          <span>
            💡 <b>เลือกโครงการก่อน</b> เพื่อดูจำนวนที่เบิกได้จริงของโครงการนั้น —
            ตอนนี้แสดงเฉพาะ <b>ของกลาง</b> ที่ยังไม่ได้กันไว้ให้โครงการใด
            (สินค้าที่ถูกจัดเตรียมไว้ให้โครงการอื่นจะไม่รวมอยู่ในยอดนี้)
          </span>
        </div>
      )}

      <div className="card glass-panel overflow-hidden flex flex-col">
        <div className="p-4 border-b border-base-200 flex flex-col sm:flex-row gap-3 sm:items-center bg-base-200/30">
          <div className="flex gap-2 w-full max-w-xs">
            <input
              ref={searchInputRef}
              type="text" placeholder="🔍 ค้นหา รหัสสินค้า หรือ ชื่อ..."
              className="input input-sm input-bordered w-full bg-base-100"
              value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)}
            />
            <button type="button" onClick={handleScanClick} className="btn btn-sm btn-square btn-primary shrink-0" title="สแกนบาร์โค้ด/QR" aria-label="สแกนบาร์โค้ด">📷</button>
          </div>
          <div className="flex gap-2 items-center w-full sm:w-auto">
            <select
              className="select select-bordered select-sm w-full sm:max-w-52 bg-base-100"
              value={groupFilter}
              onChange={(e) => setGroupFilter(e.target.value)}
            >
              <option value="">ทุกหมวดหมู่</option>
              {groups.map(g => <option key={g.id} value={g.id}>{g.id} — {g.name}</option>)}
            </select>
            {isManager && (
              <button type="button" onClick={() => setCategoryModal(true)} className="btn btn-sm btn-ghost btn-square shrink-0" title="จัดการหมวดหมู่">⚙️</button>
            )}
          </div>
          {/* ตัวกรอง/เลือกโปรเจกต์ปัจจุบัน (เติมให้ตะกร้าอัตโนมัติ) + ปุ่มจัดการ (Admin/Manager) */}
          {canWithdraw && (
            <div className="flex gap-2 items-center w-full sm:w-auto">
              <select
                className="select select-bordered select-sm w-full sm:w-48 bg-base-100"
                value={selectedProject}
                onChange={(e) => setSelectedProject(e.target.value)}
                title="เลือกโปรเจกต์สำหรับการเบิก"
              >
                <option value="">เลือกโปรเจกต์</option>
                {projectList.map(p => <option key={p.id} value={p.name}>{p.name}</option>)}
              </select>
              {isManager && (
                <button type="button" onClick={() => setProjectModal(true)} className="btn btn-sm btn-ghost btn-square shrink-0" title="จัดการโปรเจกต์">⚙️</button>
              )}
            </div>
          )}
        </div>
        
        {loading ? ( <ListSkeleton count={6} /> ) : (
          <>
            {/* ตาราง (จอ md ขึ้นไป) */}
            <div className="overflow-x-auto hidden md:block">
              <table className="table table-sm w-full">
                <thead className="bg-base-200/50">
                  <tr><th>รูปภาพ</th><th>รหัสสินค้า</th><th>ชื่อสินค้า</th><th>หมวดหมู่</th><th>คงเหลือ</th><th>จองแล้ว</th><th>เบิกได้</th><th>สถานะ</th>{canWithdraw && <th>เบิก</th>}</tr>
                </thead>
                <tbody>
                  {filteredData.map((item) => (
                    <tr key={item.id} className="hover:bg-base-200/40">
                      <td>
                        <div className="avatar">
                          <div className="w-10 h-10 rounded bg-base-300">
                            <img src={getImg(item.imageUrl)} crossOrigin="anonymous" alt={item.sku} loading="lazy" decoding="async" width="40" height="40" />
                          </div>
                        </div>
                      </td>
                      <td className="font-mono text-xs font-semibold">
                        {item.sku}
                        {locationLabel(item) && <Link to={`/storage?highlight=${item.sku}`} className="ml-1" title={`ตำแหน่ง: ${locationLabel(item)}`}>📍</Link>}
                      </td>
                      <td className="text-sm font-medium">{item.name}</td>
                      <td className="text-xs opacity-70">{item.groupId} — {item.groupName || 'Default'}</td>
                      <td className="font-bold">{item.stock}</td>
                      <td className={Number(item.reserved) > 0 ? 'font-semibold text-warning' : 'opacity-30'}>{Number(item.reserved) || 0}</td>
                      <td className="font-bold">
                        {availableOf(item)}
                        {item.availableSource === 'staging' && (
                          <span className="ml-1 badge badge-warning badge-xs" title={`จัดเตรียมไว้ให้โครงการ ${selectedProject} จำนวน ${item.stagingQuota}`}>
                            โควตา {item.stagingQuota}
                          </span>
                        )}
                      </td>
                      {/* ตาราง desktop ใช้ label สั้น 'หมด' (มือถือ/รายงานยังใช้คำเต็มจาก stockStatusLabel) */}
                      <td><span className={`badge badge-sm text-white ${item.stock > 20 ? 'badge-success' : item.stock > 0 ? 'badge-warning' : 'badge-error'}`}>{item.stock === 0 ? 'หมด' : stockStatusLabel(item.status)}</span></td>
                      {canWithdraw && (
                        <td>
                          <button onClick={() => addToCart(item)} disabled={availableOf(item) <= 0} className="btn btn-primary btn-xs">เพิ่ม</button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* การ์ด (จอมือถือ) */}
            <div className="md:hidden divide-y divide-base-200">
              {filteredData.map((item) => (
                <div key={item.id} className="flex items-center gap-3 p-3">
                  <div className="avatar shrink-0">
                    <div className="w-14 h-14 rounded-lg bg-base-300">
                      <img src={getImg(item.imageUrl)} crossOrigin="anonymous" alt={item.sku} loading="lazy" decoding="async" width="40" height="40" />
                    </div>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm truncate">{item.name}</p>
                    <p className="font-mono text-xs opacity-60">{item.sku} · {item.groupId}</p>
                    {locationLabel(item) && <Link to={`/storage?highlight=${item.sku}`} className="text-[10px] text-primary">📍 {locationLabel(item)}</Link>}
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-sm font-bold">คงเหลือ {item.stock}</span>
                      <span className="text-[11px] text-warning">
                        {item.availableSource === 'staging'
                          ? `เบิกได้ ${availableOf(item)} (โควตา ${selectedProject} = ${item.stagingQuota})`
                          : Number(item.reserved) > 0 ? `กันไว้ ${item.reserved} · เบิกได้ ${availableOf(item)}` : ''}
                      </span>
                      <span className={`badge badge-xs text-white ${item.stock > 20 ? 'badge-success' : item.stock > 0 ? 'badge-warning' : 'badge-error'}`}>{stockStatusLabel(item.status)}</span>
                    </div>
                  </div>
                  {canWithdraw && (
                    <button onClick={() => addToCart(item)} disabled={availableOf(item) <= 0} className="btn btn-primary btn-sm shrink-0">เบิก</button>
                  )}
                </div>
              ))}
              {filteredData.length === 0 && <div className="text-center py-10 opacity-50 text-sm">ไม่พบสินค้า</div>}
            </div>
          </>
        )}

        {/* แบ่งหน้า — แสดงเมื่อมีมากกว่า 1 หน้า (ใช้ได้ทั้ง desktop และมือถือ) */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between gap-2 px-3 py-3 border-t border-base-200">
            <span className="text-xs opacity-60">
              ทั้งหมด {totalItems.toLocaleString()} รายการ · หน้า {page}/{totalPages}
            </span>
            <div className="flex gap-1">
              <button className="btn btn-sm btn-ghost" disabled={page <= 1}
                onClick={() => setPage(p => Math.max(p - 1, 1))}>‹ ก่อนหน้า</button>
              <button className="btn btn-sm btn-ghost" disabled={page >= totalPages}
                onClick={() => setPage(p => Math.min(p + 1, totalPages))}>ถัดไป ›</button>
            </div>
          </div>
        )}
      </div>

      {canWithdraw && cart.length > 0 && (
        <div className="fixed bottom-6 right-6 z-50">
          <button onClick={() => setCartModal(true)} className="btn btn-primary shadow-2xl rounded-full px-6 h-14 animate-bounce">
            🛒 ตะกร้าใบเบิก <div className="badge badge-error badge-sm text-white ml-2">{cart.length}</div>
          </button>
        </div>
      )}

      {/* Modal ตะกร้าใบเบิก */}
      {cartModal && (
        <div className="fixed inset-0 z-100 flex items-center justify-center backdrop-blur-md p-4">
          <div className="glass-modal p-5 sm:p-6 rounded-2xl w-full max-w-lg max-h-[85vh] overflow-y-auto">
            <h3 className="font-bold text-lg border-b border-base-200 pb-3 mb-4">📝 สรุปใบรายการเบิกสินค้า</h3>
            <div className="space-y-3 mb-4 p-2 bg-base-200/50 rounded-lg">
              {cart.map((item, idx) => (
                <div key={idx} className="flex justify-between items-center gap-2 bg-base-100 p-2 rounded-lg border border-base-200">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="avatar shrink-0">
                      <div className="w-10 h-10 rounded">
                        <img src={getImg(item.imageUrl)} crossOrigin="anonymous" alt="product" loading="lazy" decoding="async" width="40" height="40" />
                      </div>
                    </div>
                    <div className="text-xs min-w-0">
                      <p className="font-bold">{item.sku}</p>
                      <p className="opacity-70 truncate max-w-28">{item.productName}</p>
                      <p className="opacity-50">คงเหลือ {item.stock}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <div className="join">
                      <button
                        type="button"
                        className="btn btn-sm join-item"
                        onClick={() => stepCartQty(item, -1)}
                        disabled={(Number(item.quantity) || 0) <= 1}
                      >−</button>
                      <input
                        type="number" min="1" max={item.stock}
                        className="input input-sm input-bordered join-item w-14 text-center px-1"
                        value={item.quantity}
                        onChange={(e) => setCartQty(item.productId, e.target.value)}
                        onBlur={() => setCartQty(item.productId, Math.min(Math.max(Number(item.quantity) || 1, 1), item.stock))}
                      />
                      <button
                        type="button"
                        className="btn btn-sm join-item"
                        onClick={() => stepCartQty(item, 1)}
                        disabled={(Number(item.quantity) || 0) >= item.stock}
                      >+</button>
                    </div>
                    <button onClick={() => removeFromCart(item.productId)} className="btn btn-sm btn-error btn-circle text-white">✕</button>
                  </div>
                </div>
              ))}
            </div>
            <form onSubmit={submitCartRequest}>
              <div className="form-control mb-4">
                <label className="label text-xs font-bold">โปรเจกต์</label>
                {/* เลือกจากรายชื่อเท่านั้น (กันสร้างชื่อซ้ำ) — เพิ่มโปรเจกต์ใหม่ได้เฉพาะผู้จัดการที่ปุ่ม ⚙️ */}
                <select required className="select select-bordered w-full" value={reqProject} onChange={e => setReqProject(e.target.value)}>
                  <option value="" disabled>— เลือกโปรเจกต์ —</option>
                  {projectList.map(p => <option key={p.id} value={p.name}>{p.name}</option>)}
                </select>
                {selectedProject && reqProject && reqProject !== selectedProject && (
                  <span className="text-[11px] text-warning mt-1">
                    ⚠️ ยอดที่เห็นในตารางคำนวณจากโครงการ “{selectedProject}” แต่กำลังส่งใบเบิกในนาม “{reqProject}” — จำนวนที่เบิกได้จริงอาจต่างกัน
                  </span>
                )}
                {projectList.length === 0 && (
                  <span className="text-[10px] text-warning mt-1">ยังไม่มีโปรเจกต์ — ให้ผู้จัดการเพิ่มก่อน (ปุ่ม ⚙️ ด้านบน)</span>
                )}
              </div>
              <div className="flex justify-end gap-2">
                <button type="button" className="btn btn-ghost" onClick={() => setCartModal(false)}>ปิด</button>
                <button type="submit" className="btn btn-primary text-white">ส่งใบเบิก</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {scanOpen && (
        <BarcodeScanner
          onClose={() => setScanOpen(false)}
          onDetected={(code) => {
            // ป้ายเดิม 9 หลักจะถูกแตกเหลือ item_id 5 ตัวท้ายให้ค้นหาเจอ (คงเลข 0 นำหน้า)
            const { searchValue, fromLabel } = parseScannedCode(code);
            setSearchTerm(searchValue);
            setScanOpen(false);
            toast.success(fromLabel ? `สแกนป้าย: รหัสสินค้า ${searchValue}` : `สแกนได้: ${searchValue}`);
          }}
        />
      )}

      {/* จัดการโปรเจกต์ (Admin/Manager) — เพิ่ม/ลบ */}
      {projectModal && (
        <div className="fixed inset-0 z-100 flex items-center justify-center backdrop-blur-md p-4" onClick={() => setProjectModal(false)}>
          <div className="glass-modal p-5 sm:p-6 rounded-2xl w-full max-w-md max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <h3 className="font-bold text-lg border-b border-base-200 pb-3 mb-4">⚙️ จัดการโปรเจกต์</h3>
            <div className="flex gap-2 mb-4">
              <input type="text" className="input input-bordered input-sm w-full" placeholder="ชื่อโปรเจกต์ใหม่"
                value={newProjectName} onChange={e => setNewProjectName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addProjectHandler(); } }} />
              <button className="btn btn-sm btn-primary text-white shrink-0" onClick={addProjectHandler}>เพิ่ม</button>
            </div>
            <div className="space-y-1 max-h-[50vh] overflow-y-auto">
              {projectList.length === 0 ? (
                <div className="text-center opacity-50 text-sm py-6">ยังไม่มีโปรเจกต์</div>
              ) : projectList.map(p => (
                <div key={p.id} className="flex items-center justify-between bg-base-200/50 rounded-lg px-3 py-2">
                  <span className="text-sm">{p.name}</span>
                  <button className="btn btn-ghost btn-xs text-error" onClick={() => deleteProjectHandler(p)}>ลบ</button>
                </div>
              ))}
            </div>
            <div className="flex justify-end mt-4"><button className="btn btn-ghost" onClick={() => setProjectModal(false)}>ปิด</button></div>
          </div>
        </div>
      )}

      {/* จัดการหมวดหมู่ (Admin/Manager) — เพิ่ม / ลบ / ยุบ */}
      {categoryModal && (
        <div className="fixed inset-0 z-100 flex items-center justify-center backdrop-blur-md p-4" onClick={() => setCategoryModal(false)}>
          <div className="glass-modal p-5 sm:p-6 rounded-2xl w-full max-w-lg max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-base-200 pb-3 mb-4">
              <h3 className="font-bold text-lg">⚙️ จัดการหมวดหมู่</h3>
              <button className="btn btn-xs btn-ghost text-primary gap-1" onClick={resequenceCategoryHandler} title="ปิดช่องว่างเลขหมวด ให้ต่อเนื่อง 01,02,03...">🔢 จัดเรียงเลขใหม่</button>
            </div>

            {/* เพิ่มหมวด — รหัส 2 หลักรันอัตโนมัติ */}
            <div className="flex gap-2 mb-4">
              <input type="text" className="input input-bordered input-sm w-full" placeholder="ชื่อหมวดหมู่ใหม่ (รหัสรันให้อัตโนมัติ)"
                value={newCategoryName} onChange={e => setNewCategoryName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addCategoryHandler(); } }} />
              <button className="btn btn-sm btn-primary text-white shrink-0" onClick={addCategoryHandler}>เพิ่ม</button>
            </div>

            {/* รายการหมวด */}
            <div className="space-y-1 max-h-[35vh] overflow-y-auto mb-4">
              {groups.map(g => (
                <div key={g.id} className="flex items-center justify-between bg-base-200/50 rounded-lg px-3 py-2">
                  <span className="text-sm"><span className="font-mono opacity-60">{g.id}</span> — {g.name} <span className="text-xs opacity-50">({g.itemCount} รายการ)</span></span>
                  <button className="btn btn-ghost btn-xs text-error" disabled={g.itemCount > 0}
                    title={g.itemCount > 0 ? 'มีสินค้าอยู่ ต้องยุบก่อน' : undefined}
                    onClick={() => deleteCategoryHandler(g)}>ลบ</button>
                </div>
              ))}
            </div>

            {/* ยุบหมวด */}
            <div className="border-t border-base-200 pt-4">
              <div className="text-sm font-bold mb-2">ยุบหมวดหมู่เข้าด้วยกัน</div>
              <div className="flex flex-wrap items-center gap-2">
                <select className="select select-bordered select-sm flex-1 min-w-32" value={mergeFrom} onChange={e => setMergeFrom(e.target.value)}>
                  <option value="">— ต้นทาง —</option>
                  {groups.map(g => <option key={g.id} value={g.id}>{g.id} — {g.name} ({g.itemCount})</option>)}
                </select>
                <span className="opacity-60 text-sm">เข้ากับ</span>
                <select className="select select-bordered select-sm flex-1 min-w-32" value={mergeTo} onChange={e => setMergeTo(e.target.value)}>
                  <option value="">— ปลายทาง —</option>
                  {groups.filter(g => g.id !== mergeFrom).map(g => <option key={g.id} value={g.id}>{g.id} — {g.name}</option>)}
                </select>
                <button className="btn btn-sm btn-warning text-white" onClick={mergeCategoryHandler}>ยุบ</button>
              </div>
              <p className="text-[10px] opacity-50 mt-1">สินค้าในหมวดต้นทางจะย้ายไปปลายทาง + รัน SKU ใหม่ตามรหัสหมวดปลายทาง</p>
            </div>

            <div className="flex justify-end mt-4"><button className="btn btn-ghost" onClick={() => setCategoryModal(false)}>ปิด</button></div>
          </div>
        </div>
      )}
    </div>
  );
}