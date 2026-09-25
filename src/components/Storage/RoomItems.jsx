import React, { useCallback, useEffect, useState } from 'react';
import { FiHome, FiPackage, FiPlus, FiTrash2, FiX } from 'react-icons/fi';
import toast from 'react-hot-toast';
import { fetchApi, getAssetUrl } from '../../utils/api';
import { confirmDialog } from '../../utils/confirm';
import { useBodyScrollLock } from '../../utils/useBodyScrollLock';
import AdjustStockModal from '../AdjustStock';

const NO_IMAGE = "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxMDAiIGhlaWdodD0iMTAwIj48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSIjZjNmNGY2Ii8+PHRleHQgeD0iNTAlIiB5PSI1MCUiIGZvbnQtc2l6ZT0iMTIiIHRleHQtYW5jaG9yPSJtaWRkbGUiIGFsaWdubWVudC1iYXNlbGluZT0ibWlkZGxlIiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiIgZmlsbD0iIzliOWI5YiI+Tm8gSW1hZ2U8L3RleHQ+PC9zdmc+";
const getImg = (url) => (url ? getAssetUrl(url) : NO_IMAGE);

/**
 * ของที่วางไว้ในห้องโดยตรง — ห้องเล็กที่เก็บของชิ้นใหญ่ไม่ต้องสร้างชั้นวาง/พื้นที่วางพื้นขึ้นมาซ้อนอีกชั้น
 * หน้าตาและปุ่มเหมือนหน้าเลเวลของชั้นวาง (RackBlueprint) เพื่อให้คนใช้ไม่ต้องเรียนรู้ใหม่
 * ต่างกันแค่ห้องไม่มีเลเวล จึงเป็นตารางเดียว
 */
export default function RoomItems({ roomId, roomName = '', highlightSku = null, canEdit = false, onChanged, onClose }) {
  const [detail, setDetail] = useState(null);
  const [saving, setSaving] = useState(false);
  const [adding, setAdding] = useState(false);
  const [query, setQuery] = useState('');
  const [options, setOptions] = useState([]);
  const [allRacks, setAllRacks] = useState([]);
  const [allRooms, setAllRooms] = useState([]);
  // ป๊อปอัพย้าย: { items: [{ sku, name, max, quantity }], kind: 'rack'|'room', rackId, level, roomId }
  const [moving, setMoving] = useState(null);
  const [preview, setPreview] = useState(null);
  const [adjusting, setAdjusting] = useState(false);
  useBodyScrollLock(true);

  const load = useCallback(() => fetchApi(`/api/storage-map/room-items/${roomId}`)
    .then((result) => { if (result.success) setDetail(result); return result; })
    .catch(() => ({})), [roomId]);

  useEffect(() => { load(); }, [load]);

  // ปลายทางที่ย้ายไปได้: ชั้นวางทุกตัว + ห้อง/พื้นที่ทุกแห่ง
  useEffect(() => {
    if (!canEdit) return;
    fetchApi('/api/racks').then((result) => { if (result.success) setAllRacks(result.racks); }).catch(() => {});
    fetchApi('/api/rooms').then((result) => { if (result.success) setAllRooms(result.rooms); }).catch(() => {});
  }, [canEdit]);

  // ค้นหาสินค้าที่ยังไม่ระบุตำแหน่ง เพื่อวางเข้าห้องนี้ได้โดยตรง
  useEffect(() => {
    if (!adding) return undefined;
    let alive = true;
    const timer = setTimeout(async () => {
      const term = query.trim();
      const result = await fetchApi(`/api/storage-map/unassigned?limit=100${term ? `&search=${encodeURIComponent(term)}` : ''}`).catch(() => ({}));
      if (alive && result.success) setOptions(result.items);
    }, 300);
    return () => { alive = false; clearTimeout(timer); };
  }, [adding, query]);

  // Esc ปิดทีละชั้นจากบนสุด — ฟอร์มปรับยอดก่อน แล้วค่อยรูปใหญ่ ตารางห้องยังเปิดค้างไว้
  useEffect(() => {
    if (!preview) return undefined;
    const onKey = (event) => {
      if (event.key !== 'Escape') return;
      if (adjusting) setAdjusting(false);
      else setPreview(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [preview, adjusting]);

  const items = detail?.items || [];
  const room = detail?.room || { id: roomId, name: roomName };
  const totalQty = items.reduce((sum, row) => sum + Number(row.qtyHere || 0), 0);

  const setLocation = async (body, successMessage) => {
    setSaving(true);
    try {
      const result = await fetchApi('/api/storage-map/assign', { method: 'POST', body: JSON.stringify(body) });
      if (result.success) {
        toast.success(successMessage || result.message);
        await load();
        onChanged?.();
        setQuery('');
        setOptions((list) => list.filter((entry) => entry.sku !== body.sku));
      }
    } catch (error) {
      toast.error(error?.message || 'บันทึกตำแหน่งไม่สำเร็จ');
    } finally {
      setSaving(false);
    }
  };

  const setQtyHere = (item, value) => {
    const next = Number(value);
    if (!Number.isFinite(next) || next < 0 || next === Number(item.qtyHere)) return;
    setLocation({ sku: item.sku, roomId, quantity: next });
  };

  // ถามยืนยันก่อนเสมอ — ปุ่มนี้อยู่ติดกับปุ่มย้าย กดพลาดแล้วสินค้าหลุดจากตำแหน่งทันที
  const removeOne = async (item) => {
    const ok = await confirmDialog({
      title: `เอา ${item.sku} ออกจากห้อง ${room.name}`,
      message: 'ยอดคงเหลือของสินค้าไม่เปลี่ยน และตำแหน่งอื่นของสินค้านี้ไม่ถูกแตะ',
      confirmText: 'เอาออก',
      danger: true
    });
    if (!ok) return;
    setLocation({ sku: item.sku, roomId, quantity: 0 }, `เอา ${item.sku} ออกจากห้อง ${room.name} แล้ว`);
  };

  const openMove = (item) => setMoving({
    items: [{ sku: item.sku, name: item.name, max: Number(item.qtyHere), quantity: Number(item.qtyHere) }],
    kind: 'rack', rackId: '', level: '', roomId: ''
  });

  const missingMoveFields = (draft) => {
    if (!draft) return [];
    const target = allRacks.find((entry) => Number(entry.id) === Number(draft.rackId));
    const missing = [];
    if (draft.kind === 'rack') {
      if (!draft.rackId) missing.push('ชั้นวางปลายทาง');
      else if (!target?.isFloor && !draft.level) missing.push(`เลเวลของชั้นวาง ${target?.name || 'ปลายทาง'}`);
    } else if (!draft.roomId) {
      missing.push('ห้อง/พื้นที่ปลายทาง');
    }
    if (!(Number(draft.items?.[0]?.quantity) > 0)) missing.push('จำนวนที่จะย้ายอย่างน้อย 1 ชิ้น');
    return missing;
  };

  const warnMissing = (missing) => confirmDialog({
    title: 'ยังระบุข้อมูลไม่ครบ',
    message: `โปรดระบุ${missing.length > 1 ? ':' : ''}\n${missing.map((entry) => `• ${entry}`).join('\n')}`,
    confirmText: 'รับทราบ',
    cancelText: 'ปิด',
    danger: true
  });

  // ปิดหน้าต่างระหว่างกรอก = ไม่ย้ายอะไรเลย แต่ถามก่อน กันเผลอคลิกพื้นหลังแล้วที่กรอกไว้หาย
  const closeMove = async () => {
    if (saving) return;
    if (moving?.rackId || moving?.roomId || moving?.level) {
      const ok = await confirmDialog({
        title: 'ออกจากหน้าต่างย้ายสินค้า?',
        message: 'ข้อมูลที่กรอกไว้จะหายไป และสินค้าจะไม่ถูกย้าย',
        confirmText: 'ออกโดยไม่ย้าย',
        cancelText: 'กรอกต่อ',
        danger: true
      });
      if (!ok) return;
    }
    setMoving(null);
  };

  const moveItems = async () => {
    const missing = missingMoveFields(moving);
    if (missing.length > 0) return warnMissing(missing);
    const row = moving.items[0];
    const quantity = Number(row.quantity);
    if (quantity > Number(row.max)) return toast.error(`${row.sku} ในห้องนี้มีของแค่ ${row.max} ชิ้น`);

    const target = allRacks.find((entry) => Number(entry.id) === Number(moving.rackId));
    const to = moving.kind === 'rack'
      // พื้นที่วางพื้นมีที่วางเดียว ไม่ต้องให้ผู้ใช้เลือกเลเวล ระบบใส่ 1 ให้เอง
      ? { rackId: Number(moving.rackId), storageLevel: target?.isFloor ? 1 : Number(moving.level) }
      : { roomId: Number(moving.roomId) };
    if (moving.kind === 'room' && Number(moving.roomId) === Number(roomId)) return toast.error('ปลายทางเป็นห้องเดิม');

    setSaving(true);
    try {
      const result = await fetchApi('/api/storage-map/move-quantity', {
        method: 'POST',
        body: JSON.stringify({ sku: row.sku, from: { roomId: Number(roomId) }, to, quantity })
      });
      if (result.success) {
        toast.success(`ย้าย ${row.sku} จำนวน ${quantity} ชิ้นเรียบร้อย`);
        setMoving(null);
        await load();
        onChanged?.();
      } else toast.error(result.message || 'ย้ายไม่สำเร็จ');
    } catch (error) {
      toast.error(error?.message || 'ย้ายไม่สำเร็จ');
    } finally {
      setSaving(false);
    }
  };

  // ปรับยอดเสร็จ → โหลดห้องใหม่ แล้วอัปเดตตัวเลขใต้รูปให้ตรงของจริงทันที
  const finishAdjust = async () => {
    setAdjusting(false);
    const result = await load();
    onChanged?.();
    setPreview((current) => {
      if (!current) return current;
      return (result?.items || []).find((row) => row.sku === current.sku) || null;
    });
  };

  if (!detail) {
    return (
      <div className="fixed inset-0 z-100 flex items-center justify-center bg-base-300/35 p-4 backdrop-blur-md" onClick={onClose}>
        <span className="loading loading-spinner loading-lg text-primary" />
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-100 flex items-center justify-center bg-base-300/35 p-4 backdrop-blur-md" onClick={onClose}>
      <section className="glass-modal max-h-[88vh] w-full max-w-5xl overflow-y-auto rounded-2xl" onClick={(event) => event.stopPropagation()}>
        <header className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-base-300 bg-base-100/95 p-5 backdrop-blur">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-bold">
              <FiHome /> ของที่วางในห้อง {room.name}
              {Boolean(room.isStaging) && <span className="badge badge-warning badge-sm">📦 พื้นที่จัดเตรียม</span>}
            </h2>
            <p className="mt-1 text-sm text-base-content/60">
              วางกับพื้นห้องโดยตรง ไม่ได้อยู่บนชั้นวาง · {items.length} รายการ · รวม {totalQty} ชิ้น
            </p>
          </div>
          <button className="btn btn-sm btn-ghost btn-square" onClick={onClose} aria-label="ปิด"><FiX /></button>
        </header>

        <div className="p-5">
          {canEdit && (
            <div className="mb-3">
              {!adding ? (
                <button className="btn btn-sm btn-outline btn-primary" onClick={() => { setAdding(true); setQuery(''); }}>
                  <FiPlus /> เพิ่มสินค้าเข้าห้องนี้
                </button>
              ) : (
                <div className="rounded-xl border border-primary/30 bg-primary/5 p-3">
                  <div className="mb-2 flex items-center gap-2">
                    <input
                      autoFocus
                      className="input input-bordered input-sm flex-1"
                      placeholder="ค้นหารหัสสินค้าหรือชื่อสินค้าที่ยังไม่ระบุตำแหน่ง..."
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                    />
                    <button className="btn btn-sm btn-ghost btn-square" onClick={() => setAdding(false)} aria-label="ปิด"><FiX /></button>
                  </div>
                  <div className="max-h-48 overflow-y-auto">
                    {options.length === 0 ? (
                      <p className="py-3 text-center text-xs text-base-content/50">
                        {query ? 'ไม่พบสินค้าที่ยังไม่ระบุตำแหน่ง' : 'สินค้าทุกตัวมีตำแหน่งจัดเก็บครบแล้ว'}
                      </p>
                    ) : options.map((option) => (
                      <button
                        key={option.sku}
                        type="button"
                        disabled={saving}
                        className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-base-200 disabled:opacity-50"
                        onClick={() => setLocation({ sku: option.sku, roomId, mode: 'add' })}
                      >
                        <span className="font-mono text-xs font-semibold">{option.sku}</span>
                        <span className="min-w-0 flex-1 truncate text-xs">{option.name}</span>
                        <span className="shrink-0 text-xs text-base-content/50">
                          ยังไม่ระบุที่ {option.unplaced ?? option.stock} / คงเหลือ {option.stock}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="overflow-x-auto rounded-xl border border-base-300">
            <table className="table table-sm w-full">
              <thead className="bg-base-200/50">
                <tr>
                  <th>รูปภาพ</th><th>รหัสสินค้า</th><th className="min-w-64">ชื่อสินค้า</th><th>หมวดหมู่</th><th>จำนวนที่นี่</th><th>คงเหลือรวม</th>
                  {canEdit && <th className="sticky right-0 bg-base-200"></th>}
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.sku} className={highlightSku === item.sku ? 'bg-warning/10' : 'hover:bg-base-200/40'}>
                    <td>
                      <div className="avatar">
                        <div className="h-10 w-10 rounded bg-base-300">
                          <button type="button" onClick={() => setPreview(item)} disabled={!item.imageUrl}
                            title={item.imageUrl ? 'กดเพื่อดูรูปใหญ่' : 'ไม่มีรูป'}
                            className={`h-full w-full ${item.imageUrl ? 'cursor-zoom-in' : ''}`}>
                            <img src={getImg(item.imageUrl)} crossOrigin="anonymous" alt={item.sku} loading="lazy" decoding="async" width="40" height="40" />
                          </button>
                        </div>
                      </div>
                    </td>
                    <td className="font-mono text-xs font-semibold">{item.sku}</td>
                    <td className="text-sm font-medium">{item.name}</td>
                    <td className="text-xs opacity-70">{item.groupId} — {item.groupName || 'Default'}</td>
                    <td>
                      {canEdit ? (
                        <input
                          key={`${item.sku}:${item.qtyHere}`}
                          type="number" min="0" step="1"
                          className="input input-bordered input-xs w-20 font-bold"
                          defaultValue={Number(item.qtyHere ?? 0)}
                          disabled={saving}
                          title="จำนวนที่วางอยู่ในห้องนี้"
                          onBlur={(event) => setQtyHere(item, event.target.value)}
                        />
                      ) : <span className="font-bold">{Number(item.qtyHere ?? 0)}</span>}
                    </td>
                    <td className="opacity-60">{item.stock}</td>
                    {canEdit && (
                      <td className="sticky right-0 whitespace-nowrap bg-base-100">
                        {Number(item.qtyHere) > 0 && (
                          <button className="btn btn-ghost btn-xs text-warning" disabled={saving}
                            title="ย้ายไปชั้นวาง ห้องอื่น หรือพื้นที่จัดเตรียม" onClick={() => openMove(item)}>
                            <FiPackage />
                          </button>
                        )}
                        <button className="btn btn-ghost btn-xs text-error" disabled={saving}
                          title="เอาสินค้าออกจากห้องนี้ (ตำแหน่งอื่นของสินค้านี้ไม่ถูกแตะ)" onClick={() => removeOne(item)}>
                          <FiTrash2 />
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
            {items.length === 0 && (
              <div className="py-10 text-center text-sm text-base-content/40">
                — ยังไม่มีของวางในห้องนี้โดยตรง —
                {canEdit && <div className="mt-1 text-xs">ห้องเล็กที่เก็บของชิ้นใหญ่วางเข้าห้องได้เลย ไม่ต้องสร้างชั้นวาง</div>}
              </div>
            )}
          </div>
        </div>
      </section>

      {/* ป๊อปอัพย้ายสินค้า — หน้าตาเดียวกับของชั้นวาง ต่างแค่ต้นทางเป็นห้อง */}
      {moving && (() => {
        const targetRack = allRacks.find((entry) => Number(entry.id) === Number(moving.rackId));
        const targetRoom = allRooms.find((entry) => Number(entry.id) === Number(moving.roomId));
        const row = moving.items[0];
        const missing = missingMoveFields(moving);
        return (
          <div className="fixed inset-0 z-[110] flex items-center justify-center bg-base-300/40 p-4 backdrop-blur-md" onClick={(event) => { event.stopPropagation(); closeMove(); }}>
            <section className="glass-modal max-h-[88vh] w-full max-w-2xl overflow-y-auto rounded-2xl" onClick={(event) => event.stopPropagation()}>
              <header className="flex items-start gap-3 border-b border-base-300 p-5">
                <FiPackage className="mt-1 shrink-0 text-warning" />
                <div className="min-w-0 flex-1">
                  <h3 className="text-base font-bold">ย้าย {row.sku}</h3>
                  <p className="mt-0.5 text-xs text-base-content/60">จากห้อง {room.name} · ที่นี่มี {row.max} ชิ้น</p>
                </div>
                <button className="btn btn-sm btn-ghost btn-square" onClick={closeMove} disabled={saving} aria-label="ปิด"><FiX /></button>
              </header>

              <div className="space-y-3 p-4">
                <div className="flex items-center gap-2 rounded-lg bg-base-200/50 p-2">
                  <span className="min-w-0 flex-1 truncate text-sm">{row.name}</span>
                  <span className="whitespace-nowrap text-[11px] text-base-content/50">จำนวนที่จะย้าย</span>
                  <input
                    type="number" min="1" max={row.max}
                    className="input input-bordered input-sm w-20 font-bold"
                    value={row.quantity}
                    onChange={(event) => setMoving({ ...moving, items: [{ ...row, quantity: event.target.value }] })}
                  />
                </div>

                <div>
                  <div className="mb-1.5 text-xs font-semibold text-base-content/60">ย้ายไปที่ไหน</div>
                  <div className="join">
                    <button className={`btn btn-sm join-item ${moving.kind === 'rack' ? 'btn-warning' : 'btn-ghost border border-base-300'}`}
                      onClick={() => setMoving({ ...moving, kind: 'rack' })}>ชั้นวาง</button>
                    <button className={`btn btn-sm join-item ${moving.kind === 'room' ? 'btn-warning' : 'btn-ghost border border-base-300'}`}
                      onClick={() => setMoving({ ...moving, kind: 'room' })}>ห้องเก็บของ</button>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {moving.kind === 'rack' ? (
                    <>
                      <select className={`select select-bordered select-sm min-w-52 flex-1 ${moving.rackId ? '' : 'select-warning'}`}
                        value={moving.rackId}
                        onChange={(event) => {
                          // ชั้นที่มีเลเวลเดียวไม่มีอะไรให้เลือก เติมให้เลย
                          const picked = allRacks.find((entry) => Number(entry.id) === Number(event.target.value));
                          const autoLevel = picked && !picked.isFloor && Number(picked.levels) === 1 ? '1' : '';
                          setMoving({ ...moving, rackId: event.target.value, level: autoLevel });
                        }}>
                        <option value="">— เลือกชั้นวาง —</option>
                        {allRacks.map((entry) => (
                          <option key={entry.id} value={entry.id}>
                            {entry.projectId ? '📦 ' : entry.isFloor ? '▤ ' : ''}{entry.name}
                            {entry.projectId ? ` — จัดเตรียม ${entry.projectName || ''}` : entry.roomName ? ` · ${entry.roomName}` : ''}
                          </option>
                        ))}
                      </select>
                      {targetRack?.isFloor ? (
                        <span className="badge badge-ghost">วางกับพื้น</span>
                      ) : (
                        <select className={`select select-bordered select-sm w-36 ${targetRack && !moving.level ? 'select-warning' : ''}`}
                          value={moving.level}
                          disabled={!targetRack}
                          onChange={(event) => setMoving({ ...moving, level: event.target.value })}>
                          <option value="">— เลือกเลเวล —</option>
                          {Array.from({ length: targetRack?.levels || 0 }, (_, index) => index + 1).map((level) => (
                            <option key={level} value={level}>เลเวล {level}</option>
                          ))}
                        </select>
                      )}
                    </>
                  ) : (
                    <select className={`select select-bordered select-sm min-w-52 flex-1 ${moving.roomId ? '' : 'select-warning'}`}
                      value={moving.roomId}
                      onChange={(event) => setMoving({ ...moving, roomId: event.target.value })}>
                      <option value="">— เลือกห้อง/พื้นที่ —</option>
                      {allRooms.filter((entry) => entry.isStorage || entry.isStaging).map((entry) => (
                        <option key={entry.id} value={entry.id}>
                          {entry.isStaging ? '📦 ' : ''}{entry.name}
                          {entry.isStaging ? ` — ${entry.projectName || 'ไม่ผูกโครงการ'}` : ''}
                          {Number(entry.id) === Number(roomId) ? ' (ห้องนี้)' : ''}
                        </option>
                      ))}
                    </select>
                  )}
                </div>

                <p className="text-[11px] text-base-content/60">
                  {targetRack?.projectId || targetRoom?.isStaging
                    ? 'ย้ายเข้าพื้นที่จัดเตรียม — ของยังนับเป็นสต็อก แต่จะถูกกันไว้ให้โครงการนั้นเท่านั้น'
                    : 'ย้ายที่วางเท่านั้น ยอดคงเหลือรวมของสินค้าไม่เปลี่ยน'}
                </p>

                {missing.length > 0 && <p className="text-xs font-semibold text-warning">ยังระบุไม่ครบ: {missing.join(' · ')}</p>}

                <div className="flex justify-end gap-2 border-t border-base-300 pt-3">
                  <button className="btn btn-ghost" onClick={closeMove} disabled={saving}>ยกเลิก</button>
                  {/* ปุ่ม disabled ไม่ส่ง event ออกมา จึงครอบ span ไว้ให้ยังกดแล้วมีป๊อปอัพบอกว่าขาดอะไร */}
                  <span onClick={() => { if (missing.length > 0 && !saving) warnMissing(missing); }}>
                    <button className="btn btn-warning gap-1" onClick={moveItems} disabled={saving || missing.length > 0}>
                      {saving && <span className="loading loading-spinner loading-xs" />}
                      ย้ายสินค้า
                    </button>
                  </span>
                </div>
              </div>
            </section>
          </div>
        );
      })()}

      {/* รูปใหญ่ — แตะพื้นหลังปิดแค่รูป ต้อง stopPropagation ไม่ให้คลิกทะลุไปปิดตารางห้องด้วย */}
      {preview && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
          onClick={(event) => { event.stopPropagation(); setPreview(null); }}>
          <div className="relative w-full max-w-3xl" onClick={(event) => event.stopPropagation()}>
            <button type="button" onClick={() => setPreview(null)}
              className="btn btn-sm btn-circle absolute -right-3 -top-3 z-10" title="ปิด (Esc)">✕</button>
            <img src={getImg(preview.imageUrl)} crossOrigin="anonymous" alt={preview.sku} decoding="async"
              className="max-h-[75vh] w-full rounded-2xl bg-base-100 object-contain shadow-2xl" />
            <div className="mt-3 text-center text-white">
              <p className="font-mono text-sm font-semibold">{preview.sku}</p>
              <p className="text-sm opacity-90">{preview.name}</p>
              <p className="mt-1 flex items-center justify-center gap-3 text-xs">
                <span>วางในห้องนี้ <b className="text-sm">{Number(preview.qtyHere ?? 0)}</b></span>
                <span className="opacity-80">คงเหลือรวม <b className="text-sm">{preview.stock}</b></span>
              </p>
              {canEdit && (
                <button type="button" className="btn btn-sm btn-warning mt-3" onClick={() => setAdjusting(true)}>
                  ปรับยอดตามที่นับได้
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {preview && adjusting && (
        <AdjustStockModal
          product={{ sku: preview.sku, name: preview.name, stock: preview.stock }}
          focus={{ roomId: Number(roomId) }}
          onClose={() => setAdjusting(false)}
          onDone={finishAdjust}
        />
      )}
    </div>
  );
}
