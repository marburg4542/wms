import React, { useCallback, useEffect, useRef, useState } from 'react';
import { FiBox, FiX, FiChevronLeft, FiPlus, FiTrash2, FiPackage, FiLayers } from 'react-icons/fi';
import toast from 'react-hot-toast';
import { fetchApi, getAssetUrl } from '../../utils/api';
import { confirmDialog } from '../../utils/confirm';
import { useBodyScrollLock } from '../../utils/useBodyScrollLock';

const NO_IMAGE = "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxMDAiIGhlaWdodD0iMTAwIj48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSIjZjNmNGY2Ii8+PHRleHQgeD0iNTAlIiB5PSI1MCUiIGZvbnQtc2l6ZT0iMTIiIHRleHQtYW5jaG9yPSJtaWRkbGUiIGFsaWdubWVudC1iYXNlbGluZT0ibWlkZGxlIiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiIgZmlsbD0iIzliOWI5YiI+Tm8gSW1hZ2U8L3RleHQ+PC9zdmc+";
const getImg = (url) => (url ? getAssetUrl(url) : NO_IMAGE);


// หนึ่งแถวในตารางสินค้าของเลเวล — หุ้ม memo เพราะตารางมีได้เกือบร้อยแถว
// ถ้าไม่หุ้ม การติ๊กช่องเลือก 1 ครั้งจะวาดใหม่ทุกแถว (แถวละ ~16 element + ไอคอน SVG 2 ตัว)
// ทำให้เครื่องหมายถูกกว่าจะขึ้นต้องรอ React วาดจบทั้งตารางก่อน
const LevelRow = React.memo(function LevelRow({
  item, canEdit, saving, selected, highlighted, removeTitle, onToggle, onMove, onSetQty, onRemove
}) {
  return (
    <tr className={`${highlighted ? 'bg-warning/10' : 'hover:bg-base-200/40'} ${selected ? 'bg-primary/5' : ''}`}>
      {canEdit && (
        <td>
          <input
            type="checkbox"
            className="checkbox checkbox-sm"
            aria-label={`เลือก ${item.sku}`}
            checked={selected}
            onChange={(event) => onToggle(item.sku, event.target.checked)}
          />
        </td>
      )}
      <td>
        <div className="avatar">
          <div className="w-10 h-10 rounded bg-base-300">
            <img src={getImg(item.imageUrl)} crossOrigin="anonymous" alt={item.sku} loading="lazy" decoding="async" width="40" height="40" />
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
            title="จำนวนที่วางอยู่ตรงเลเวลนี้"
            onBlur={(event) => onSetQty(item, event.target.value)}
          />
        ) : <span className="font-bold">{Number(item.qtyHere ?? 0)}</span>}
      </td>
      <td className="opacity-60">{item.stock}</td>
      {canEdit && (
        <td className="sticky right-0 whitespace-nowrap bg-base-100">
          {Number(item.qtyHere) > 0 && (
            <button
              className="btn btn-ghost btn-xs text-warning"
              disabled={saving}
              title="ย้ายไปชั้นวางอื่น หรือพื้นที่จัดเตรียม"
              onClick={() => onMove([item.sku])}
            >
              <FiPackage />
            </button>
          )}
          <button
            className="btn btn-ghost btn-xs text-error"
            disabled={saving}
            title={removeTitle}
            onClick={() => onRemove(item.sku)}
          >
            <FiTrash2 />
          </button>
        </td>
      )}
    </tr>
  );
});

export default function RackBlueprint({ rackId, highlightLevel, highlightSku, canEdit = false, onChanged, onClose }) {
  const [detail, setDetail] = useState(null);
  const [selectedLevel, setSelectedLevel] = useState(null);
  const [adding, setAdding] = useState(false);
  const [query, setQuery] = useState('');
  const [options, setOptions] = useState([]);
  const [saving, setSaving] = useState(false);
  const [allRacks, setAllRacks] = useState([]);
  const [allRooms, setAllRooms] = useState([]);
  // ป๊อปอัพย้าย: { items: [{ sku, name, max, quantity }], kind: 'rack'|'room', rackId, level, roomId }
  const [moving, setMoving] = useState(null);
  const [selected, setSelected] = useState(() => new Set());   // sku ที่ติ๊กไว้ในเลเวลนี้
  // กระจกเงาของค่าปัจจุบัน — ให้ callback ที่ส่งเข้าแถวอ่านค่าล่าสุดได้โดยไม่ต้องสร้างใหม่ทุก render
  // (ถ้า callback เปลี่ยน identity ทุกครั้ง React.memo ของแถวจะไม่ช่วยอะไรเลย)
  const selectedLevelRef = useRef(null);
  const isFloorRef = useRef(false);
  const rackNameRef = useRef('');
  const levelItemsRef = useRef([]);
  useBodyScrollLock(true);

  const load = useCallback(() => fetchApi(`/api/racks/${rackId}`)
    .then((result) => { if (result.success) setDetail(result); return result; })
    .catch(() => ({})), [rackId]);

  useEffect(() => {
    let alive = true;
    fetchApi(`/api/racks/${rackId}`)
      .then((result) => {
        if (!alive || !result.success) return;
        setDetail(result);
        // พื้นที่วางพื้น = ของกองกับพื้น ไม่มีชั้นย่อยให้เลือก ข้ามหน้าเลือกเลเวลไปเลย
        if (result.rack?.isFloor) setSelectedLevel(1);
        setSelected(new Set());
      })
      .catch(() => {});
    return () => { alive = false; };
  }, [rackId]);

  // ปลายทางที่ย้ายไปได้: ชั้นวางอื่นทุกตัว + พื้นที่/โซนจัดเตรียมทุกแห่ง
  useEffect(() => {
    if (!canEdit) return;
    fetchApi('/api/racks').then((result) => { if (result.success) setAllRacks(result.racks); }).catch(() => {});
    fetchApi('/api/rooms').then((result) => { if (result.success) setAllRooms(result.rooms); }).catch(() => {});
  }, [canEdit]);

  // ข้อมูลที่ derive จากผลโหลด — ประกาศไว้ก่อน handler เพราะ handler อ้างถึง
  const items = detail?.items || [];
  const byLevel = (level) => items.filter((item) => Number(item.level) === level);
  const unassigned = items.filter((item) => !item.level);
  const isFloor = Boolean(detail?.rack?.isFloor);
  const stagingProject = detail?.rack?.projectId ? (detail.rack.projectName || 'ไม่ผูกโครงการ') : null;
  const levelItems = selectedLevel != null ? byLevel(selectedLevel) : [];
  const removeTitle = isFloor
    ? 'เอาสินค้าออกจากพื้นที่นี้ (ตำแหน่งอื่นของสินค้านี้ไม่ถูกแตะ)'
    : `เอาสินค้าออกจากเลเวล ${selectedLevel} (ตำแหน่งอื่นของสินค้านี้ไม่ถูกแตะ)`;
  selectedLevelRef.current = selectedLevel;
  isFloorRef.current = isFloor;
  rackNameRef.current = detail?.rack?.name || '';
  levelItemsRef.current = levelItems;

  // ย้ายของจากเลเวลนี้ไปที่อื่น — ชั้นวางอื่น (ระบุเลเวลได้) หรือพื้นที่/โซนจัดเตรียม
  // ย้ายได้ทีละหลายรายการ: ยิงทีละตัวแล้วรวมผล ตัวที่พลาดไม่ทำให้ตัวที่เหลือค้าง
  const moveItems = async () => {
    const rows = (moving?.items || []).map((row) => ({ ...row, quantity: Number(row.quantity) }));
    const usable = rows.filter((row) => Number.isFinite(row.quantity) && row.quantity > 0);
    if (usable.length === 0) return toast.error('ระบุจำนวนที่จะย้ายอย่างน้อย 1 รายการ');
    const tooMany = usable.find((row) => row.quantity > Number(row.max));
    if (tooMany) return toast.error(`${tooMany.sku} ตรงนี้มีของแค่ ${tooMany.max} ชิ้น`);

    const target = allRacks.find((entry) => Number(entry.id) === Number(moving.rackId));
    const to = moving.kind === 'rack'
      // พื้นที่วางพื้นมีที่วางเดียว ไม่ต้องให้ผู้ใช้เลือกเลเวล ระบบใส่ 1 ให้เอง
      ? { rackId: Number(moving.rackId), storageLevel: target?.isFloor ? 1 : (moving.level === '' ? null : Number(moving.level)) }
      : { roomId: Number(moving.roomId) };
    if (moving.kind === 'rack' && !to.rackId) return toast.error('เลือกชั้นวางปลายทางก่อน');
    if (moving.kind === 'room' && !to.roomId) return toast.error('เลือกพื้นที่ปลายทางก่อน');
    if (moving.kind === 'rack' && to.rackId === Number(rackId) && String(to.storageLevel ?? '') === String(selectedLevel)) {
      return toast.error('ปลายทางเป็นที่เดิม');
    }

    setSaving(true);
    const failed = [];
    let moved = 0;
    for (const row of usable) {
      try {
        const result = await fetchApi('/api/storage-map/move-quantity', {
          method: 'POST',
          body: JSON.stringify({ sku: row.sku, from: { rackId, storageLevel: selectedLevel }, to, quantity: row.quantity })
        });
        if (result.success) moved += 1;
        else failed.push(`${row.sku} (${result.message || 'ไม่สำเร็จ'})`);
      } catch (error) {
        failed.push(`${row.sku} (${error?.message || 'ไม่สำเร็จ'})`);
      }
    }
    setSaving(false);
    if (moved > 0) toast.success(`ย้ายสำเร็จ ${moved} รายการ`);
    if (failed.length > 0) toast.error(`ย้ายไม่สำเร็จ ${failed.length} รายการ — ${failed.join(' · ')}`, { duration: 8000 });
    setMoving(null);
    setSelected(new Set());
    await load();
    onChanged?.();
  };

  // เอาสินค้าออกจากเลเวลนี้ทีละหลายรายการ (ตำแหน่งอื่นของสินค้าไม่ถูกแตะ)
  const removeSelected = async () => {
    const rows = levelItems.filter((item) => selected.has(item.sku));
    if (rows.length === 0) return;
    const ok = await confirmDialog({
      title: `เอาสินค้าออกจาก${isFloor ? 'พื้นที่นี้' : `เลเวล ${selectedLevel}`}`,
      message: `จะเอา ${rows.length} รายการออกจากตำแหน่งนี้ — ยอดคงเหลือของสินค้าไม่เปลี่ยน และตำแหน่งอื่นไม่ถูกแตะ`,
      confirmText: 'เอาออก',
      danger: true
    });
    if (!ok) return;

    setSaving(true);
    const failed = [];
    let done = 0;
    for (const row of rows) {
      try {
        const result = await fetchApi('/api/storage-map/assign', {
          method: 'POST',
          body: JSON.stringify({ sku: row.sku, rackId, level: selectedLevel, quantity: 0 })
        });
        if (result.success) done += 1;
        else failed.push(`${row.sku} (${result.message || 'ไม่สำเร็จ'})`);
      } catch (error) {
        failed.push(`${row.sku} (${error?.message || 'ไม่สำเร็จ'})`);
      }
    }
    setSaving(false);
    if (done > 0) toast.success(`เอาออกแล้ว ${done} รายการ`);
    if (failed.length > 0) toast.error(`ไม่สำเร็จ ${failed.length} รายการ — ${failed.join(' · ')}`, { duration: 8000 });
    setSelected(new Set());
    await load();
    onChanged?.();
  };

  const setLocation = useCallback(async (sku, body, successMessage) => {
    setSaving(true);
    try {
      const result = await fetchApi('/api/storage-map/assign', { method: 'POST', body: JSON.stringify(body) });
      if (result.success) {
        toast.success(successMessage || result.message);
        await load();
        onChanged?.();
        setQuery('');
        setOptions((list) => list.filter((item) => item.sku !== sku));
      }
    } catch (error) {
      toast.error(error?.message || 'บันทึกตำแหน่งไม่สำเร็จ');
    } finally {
      setSaving(false);
    }
  }, [load, onChanged]);

  // callback ที่ส่งเข้าแถวต้องมี identity คงที่ ไม่งั้น React.memo ของแถวจะไร้ผล
  const toggleSelected = useCallback((sku, checked) => {
    setSelected((current) => {
      const next = new Set(current);
      if (checked) next.add(sku); else next.delete(sku);
      return next;
    });
  }, []);

  const setQtyHere = useCallback((item, value) => {
    const next = Number(value);
    if (!Number.isFinite(next) || next < 0 || next === Number(item.qtyHere)) return;
    setLocation(item.sku, { sku: item.sku, rackId, level: selectedLevelRef.current, quantity: next });
  }, [rackId, setLocation]);

  const removeOne = useCallback((sku) => {
    const level = selectedLevelRef.current;
    setLocation(
      sku,
      { sku, rackId, level, quantity: 0 },
      isFloorRef.current ? `เอา ${sku} ออกจาก ${rackNameRef.current} แล้ว` : `เอา ${sku} ออกจากเลเวล ${level} แล้ว`
    );
  }, [rackId, setLocation]);

  // เปิดป๊อปอัพย้าย พร้อมตั้งจำนวนตั้งต้น = ของที่มีอยู่ตรงนี้ (กดย้ายได้เลยโดยไม่ต้องแก้)
  const openMove = useCallback((skus) => {
    const items = levelItemsRef.current
      .filter((item) => skus.includes(item.sku) && Number(item.qtyHere) > 0)
      .map((item) => ({ sku: item.sku, name: item.name, max: Number(item.qtyHere), quantity: Number(item.qtyHere) }));
    if (items.length === 0) return toast.error('ไม่มีรายการที่มีของให้ย้าย');
    setMoving({ items, kind: 'rack', rackId: '', level: '', roomId: '' });
  }, []);

  // ค้นหาสินค้าที่ยังไม่ระบุตำแหน่ง เพื่อเพิ่มเข้าเลเวลนี้โดยตรง
  useEffect(() => {
    if (!adding) return;
    let alive = true;
    const timer = setTimeout(async () => {
      const term = query.trim();
      const result = await fetchApi(`/api/storage-map/unassigned?limit=100${term ? `&search=${encodeURIComponent(term)}` : ''}`).catch(() => ({}));
      if (alive && result.success) setOptions(result.items);
    }, 300);
    return () => { alive = false; clearTimeout(timer); };
  }, [adding, query]);


  if (!detail) {
    return (
      <div className="fixed inset-0 z-100 flex items-center justify-center bg-base-300/35 backdrop-blur-md p-4" onClick={onClose}>
        <span className="loading loading-spinner loading-lg text-primary" />
      </div>
    );
  }

  const { rack } = detail;

  return (
    <div className="fixed inset-0 z-100 flex items-center justify-center bg-base-300/35 backdrop-blur-md p-4" onClick={onClose}>
      <section className="glass-modal rounded-2xl w-full max-w-5xl max-h-[88vh] overflow-y-auto" onClick={(event) => event.stopPropagation()}>
        <header className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-base-300 bg-base-100/95 p-5 backdrop-blur">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-bold">
              {selectedLevel != null && !isFloor ? (
                <button className="btn btn-xs btn-ghost btn-square" onClick={() => setSelectedLevel(null)} aria-label="ย้อนกลับ"><FiChevronLeft /></button>
              ) : isFloor ? <FiLayers /> : <FiBox />}
              {isFloor
                ? `${stagingProject ? 'พื้นที่จัดเตรียม' : 'พื้นที่วางพื้น'} ${rack.name}`
                : selectedLevel != null ? `ชั้นวาง ${rack.name} · เลเวล ${selectedLevel}` : `ชั้นวาง ${rack.name}`}
              {stagingProject && <span className="badge badge-warning badge-sm">📦 {stagingProject}</span>}
            </h2>
            <p className="mt-1 text-sm text-base-content/60">
              {isFloor
                ? `${stagingProject ? 'ของถูกกันไว้ให้โครงการนี้ โครงการอื่นเบิกไม่ได้' : 'ของวางกับพื้น'} · ${levelItems.length} รายการ · รวม ${levelItems.reduce((sum, row) => sum + Number(row.qtyHere || 0), 0)} ชิ้น`
                : selectedLevel != null
                  ? `${levelItems.length} รายการ · รวม ${levelItems.reduce((sum, row) => sum + Number(row.qtyHere || 0), 0)} ชิ้น`
                  : `${rack.levels} เลเวล · ${items.length} รายการ`}
            </p>
          </div>
          <button className="btn btn-sm btn-ghost btn-square" onClick={onClose} aria-label="ปิด"><FiX /></button>
        </header>

        {selectedLevel != null ? (
          <div className="p-5">
            {canEdit && (
              <div className="mb-3">
                {!adding ? (
                  <button className="btn btn-sm btn-outline btn-primary" onClick={() => { setAdding(true); setQuery(''); }}>
                    <FiPlus /> {isFloor ? 'เพิ่มสินค้าเข้าพื้นที่นี้' : 'เพิ่มสินค้าเข้าเลเวลนี้'}
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
                          onClick={() => setLocation(option.sku, { sku: option.sku, rackId, level: selectedLevel, mode: 'add' })}
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
            {canEdit && selected.size > 0 && (
              <div className="mb-2 flex flex-wrap items-center gap-2 rounded-xl border border-primary/40 bg-primary/5 p-2">
                <span className="text-sm font-bold">เลือกไว้ {selected.size} รายการ</span>
                <button className="btn btn-sm btn-warning gap-1" disabled={saving} onClick={() => openMove([...selected])}>
                  <FiPackage /> ย้ายที่เลือก
                </button>
                <button className="btn btn-sm btn-outline btn-error gap-1" disabled={saving} onClick={removeSelected}>
                  <FiTrash2 /> เอาออกที่เลือก
                </button>
                <button className="btn btn-sm btn-ghost" onClick={() => setSelected(new Set())}>ล้างการเลือก</button>
              </div>
            )}
            <div className="overflow-x-auto rounded-xl border border-base-300">
              <table className="table table-sm w-full">
                <thead className="bg-base-200/50">
                  <tr>
                    {canEdit && (
                      <th className="w-10">
                        <input
                          type="checkbox"
                          className="checkbox checkbox-sm"
                          aria-label="เลือกทั้งหมด"
                          checked={levelItems.length > 0 && selected.size === levelItems.length}
                          ref={(node) => { if (node) node.indeterminate = selected.size > 0 && selected.size < levelItems.length; }}
                          onChange={(event) => setSelected(event.target.checked ? new Set(levelItems.map((item) => item.sku)) : new Set())}
                        />
                      </th>
                    )}
                    <th>รูปภาพ</th><th>รหัสสินค้า</th><th className="min-w-64">ชื่อสินค้า</th><th>หมวดหมู่</th><th>จำนวนที่นี่</th><th>คงเหลือรวม</th>{canEdit && <th className="sticky right-0 bg-base-200"></th>}
                  </tr>
                </thead>
                <tbody>
                  {levelItems.map((item) => (
                    <LevelRow
                      key={item.sku}
                      item={item}
                      canEdit={canEdit}
                      saving={saving}
                      selected={selected.has(item.sku)}
                      highlighted={highlightSku === item.sku}
                      removeTitle={removeTitle}
                      onToggle={toggleSelected}
                      onMove={openMove}
                      onSetQty={setQtyHere}
                      onRemove={removeOne}
                    />
                  ))}
                </tbody>
              </table>
              {levelItems.length === 0 && <div className="py-10 text-center text-sm text-base-content/40">— ว่าง —</div>}
            </div>
          </div>
        ) : (
          <div className="space-y-3 p-5">
            {Array.from({ length: rack.levels }, (_, index) => rack.levels - index).map((level) => {
              const list = byLevel(level);
              const highlighted = Number(highlightLevel) === level;
              return (
                <button
                  key={level}
                  type="button"
                  onClick={() => setSelectedLevel(level)}
                  className={`w-full rounded-xl border p-4 text-left transition-colors hover:bg-base-200/70 ${highlighted ? 'border-warning bg-warning/10 ring-2 ring-warning/40' : 'border-base-300 bg-base-200/40'}`}
                >
                  <div className="mb-2 flex items-center gap-2 text-sm font-bold">
                    เลเวล {level}
                    {highlighted && <span className="badge badge-warning badge-sm">ตำแหน่งที่ค้นหา</span>}
                    <span className="font-normal text-base-content/50">
                      ({list.length} รายการ · {list.reduce((sum, row) => sum + Number(row.qtyHere || 0), 0)} ชิ้น)
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {list.length === 0
                      ? <span className="text-sm text-base-content/35">— ว่าง —</span>
                      : list.map((item) => (
                        <span key={item.sku} className={`badge badge-sm ${highlightSku === item.sku ? 'badge-warning' : 'badge-ghost'}`} title={item.name}>
                          <span className="font-mono">{item.sku}</span>
                        </span>
                      ))}
                  </div>
                </button>
              );
            })}

            {unassigned.length > 0 && (
              <div className="rounded-xl border border-dashed border-base-300 p-4">
                <div className="mb-2 text-sm font-bold text-base-content/60">ยังไม่ระบุเลเวล ({unassigned.length})</div>
                <div className="flex flex-wrap gap-1.5">
                  {unassigned.map((item) => <span key={item.sku} className="badge badge-sm badge-ghost font-mono">{item.sku}</span>)}
                </div>
              </div>
            )}
          </div>
        )}
      </section>

      {/* ป๊อปอัพย้ายสินค้า — ลอยกลางจอเสมอ ไม่ว่าจะกดจากแถวไหนของตาราง
          (เดิมเป็นแผงติดหัวตาราง พอกดจากแถวล่างๆ แผงจะอยู่นอกจอ ต้องเลื่อนขึ้นไปหา) */}
      {moving && (() => {
        const targetRack = allRacks.find((entry) => Number(entry.id) === Number(moving.rackId));
        const targetRoom = allRooms.find((entry) => Number(entry.id) === Number(moving.roomId));
        const totalQty = moving.items.reduce((sum, row) => sum + (Number(row.quantity) || 0), 0);
        const setQty = (sku, value) => setMoving({
          ...moving,
          items: moving.items.map((row) => (row.sku === sku ? { ...row, quantity: value } : row))
        });
        return (
          <div className="fixed inset-0 z-[110] flex items-center justify-center bg-base-300/40 p-4 backdrop-blur-md" onClick={() => !saving && setMoving(null)}>
            <section className="glass-modal max-h-[88vh] w-full max-w-2xl overflow-hidden rounded-2xl" onClick={(event) => event.stopPropagation()}>
              <header className="flex items-start gap-3 border-b border-base-300 p-5">
                <FiPackage className="mt-1 shrink-0 text-warning" />
                <div className="min-w-0 flex-1">
                  <h3 className="text-base font-bold">ย้ายสินค้า {moving.items.length} รายการ</h3>
                  <p className="mt-0.5 text-xs text-base-content/60">
                    จาก {rack.name}{isFloor ? '' : ` · เลเวล ${selectedLevel}`} · รวม {totalQty} ชิ้น
                  </p>
                </div>
                <button className="btn btn-sm btn-ghost btn-square" onClick={() => setMoving(null)} disabled={saving} aria-label="ปิด"><FiX /></button>
              </header>

              <div className="max-h-[42vh] overflow-y-auto border-b border-base-300 p-4">
                <div className="mb-2 text-xs font-semibold text-base-content/60">จำนวนที่จะย้าย (ตั้งไว้เท่าที่มีอยู่ตรงนี้แล้ว)</div>
                {moving.items.map((row) => (
                  <div key={row.sku} className="mb-1.5 flex items-center gap-2 rounded-lg bg-base-200/50 p-2">
                    <span className="font-mono text-xs font-semibold">{row.sku}</span>
                    <span className="min-w-0 flex-1 truncate text-sm">{row.name}</span>
                    <span className="whitespace-nowrap text-[11px] text-base-content/50">มี {row.max}</span>
                    <input
                      type="number" min="0" max={row.max}
                      className="input input-bordered input-sm w-20 font-bold"
                      value={row.quantity}
                      onChange={(event) => setQty(row.sku, event.target.value)}
                    />
                  </div>
                ))}
              </div>

              <div className="space-y-3 p-4">
                <div>
                  <div className="mb-1.5 text-xs font-semibold text-base-content/60">ย้ายไปที่ไหน</div>
                  <div className="join">
                    <button
                      className={`btn btn-sm join-item ${moving.kind === 'rack' ? 'btn-warning' : 'btn-ghost border border-base-300'}`}
                      onClick={() => setMoving({ ...moving, kind: 'rack' })}
                    >ชั้นวาง</button>
                    <button
                      className={`btn btn-sm join-item ${moving.kind === 'room' ? 'btn-warning' : 'btn-ghost border border-base-300'}`}
                      onClick={() => setMoving({ ...moving, kind: 'room' })}
                    >ห้องเก็บของ</button>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {moving.kind === 'rack' ? (
                    <>
                      <select className="select select-bordered select-sm min-w-52 flex-1"
                        value={moving.rackId}
                        onChange={(event) => setMoving({ ...moving, rackId: event.target.value, level: '' })}>
                        <option value="">— เลือกชั้นวาง —</option>
                        {allRacks.map((entry) => (
                          <option key={entry.id} value={entry.id}>
                            {entry.projectId ? '📦 ' : entry.isFloor ? '▤ ' : ''}{entry.name}
                            {entry.projectId ? ` — จัดเตรียม ${entry.projectName || ''}` : entry.roomName ? ` · ${entry.roomName}` : ''}
                            {Number(entry.id) === Number(rackId) ? ' (ที่นี่)' : ''}
                          </option>
                        ))}
                      </select>
                      {targetRack?.isFloor ? (
                        <span className="badge badge-ghost">วางกับพื้น</span>
                      ) : (
                        <select className="select select-bordered select-sm w-36"
                          value={moving.level}
                          disabled={!targetRack}
                          onChange={(event) => setMoving({ ...moving, level: event.target.value })}>
                          <option value="">ไม่ระบุเลเวล</option>
                          {Array.from({ length: targetRack?.levels || 0 }, (_, index) => index + 1).map((level) => (
                            <option key={level} value={level}>เลเวล {level}</option>
                          ))}
                        </select>
                      )}
                    </>
                  ) : (
                    <select className="select select-bordered select-sm min-w-52 flex-1"
                      value={moving.roomId}
                      onChange={(event) => setMoving({ ...moving, roomId: event.target.value })}>
                      <option value="">— เลือกพื้นที่ —</option>
                      {allRooms.filter((room) => room.isStorage || room.isStaging).map((room) => (
                        <option key={room.id} value={room.id}>
                          {room.isStaging ? '📦 ' : ''}{room.name}
                          {room.isStaging ? ` — ${room.projectName || 'ไม่ผูกโครงการ'}` : ''}
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

                <div className="flex justify-end gap-2 border-t border-base-300 pt-3">
                  <button className="btn btn-ghost" onClick={() => setMoving(null)} disabled={saving}>ยกเลิก</button>
                  <button className="btn btn-warning gap-1" onClick={moveItems} disabled={saving}>
                    {saving && <span className="loading loading-spinner loading-xs" />}
                    ย้าย {moving.items.length} รายการ
                  </button>
                </div>
              </div>
            </section>
          </div>
        );
      })()}
    </div>
  );
}

