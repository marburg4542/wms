import React, { useCallback, useEffect, useState } from 'react';
import { FiBox, FiX, FiChevronLeft, FiPlus, FiTrash2, FiPackage, FiLayers } from 'react-icons/fi';
import toast from 'react-hot-toast';
import { fetchApi, getAssetUrl } from '../../utils/api';
import { useBodyScrollLock } from '../../utils/useBodyScrollLock';

const NO_IMAGE = "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxMDAiIGhlaWdodD0iMTAwIj48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSIjZjNmNGY2Ii8+PHRleHQgeD0iNTAlIiB5PSI1MCUiIGZvbnQtc2l6ZT0iMTIiIHRleHQtYW5jaG9yPSJtaWRkbGUiIGFsaWdubWVudC1iYXNlbGluZT0ibWlkZGxlIiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiIgZmlsbD0iIzliOWI5YiI+Tm8gSW1hZ2U8L3RleHQ+PC9zdmc+";
const getImg = (url) => (url ? getAssetUrl(url) : NO_IMAGE);

export default function RackBlueprint({ rackId, highlightLevel, highlightSku, canEdit = false, onChanged, onClose }) {
  const [detail, setDetail] = useState(null);
  const [selectedLevel, setSelectedLevel] = useState(null);
  const [adding, setAdding] = useState(false);
  const [query, setQuery] = useState('');
  const [options, setOptions] = useState([]);
  const [saving, setSaving] = useState(false);
  const [allRacks, setAllRacks] = useState([]);
  const [allRooms, setAllRooms] = useState([]);
  // แถวที่กำลังย้าย: { sku, max, kind: 'rack'|'room', rackId, level, roomId, quantity }
  const [moving, setMoving] = useState(null);
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

  // ย้ายของจากเลเวลนี้ไปที่อื่น — ชั้นวางอื่น (ระบุเลเวลได้) หรือพื้นที่/โซนจัดเตรียม
  const moveItem = async () => {
    const qty = Number(moving?.quantity);
    if (!Number.isFinite(qty) || qty <= 0) return toast.error('ระบุจำนวนที่จะย้าย');
    if (qty > Number(moving.max)) return toast.error(`ตรงนี้มีของแค่ ${moving.max} ชิ้น`);
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
    try {
      const result = await fetchApi('/api/storage-map/move-quantity', {
        method: 'POST',
        body: JSON.stringify({
          sku: moving.sku,
          from: { rackId, storageLevel: selectedLevel },
          to,
          quantity: qty
        })
      });
      if (result.success) {
        toast.success(result.message);
        setMoving(null);
        await load();
        onChanged?.();
      }
    } catch (error) {
      toast.error(error?.message || 'ย้ายไม่สำเร็จ');
    } finally { setSaving(false); }
  };

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

  const setLocation = async (sku, body, successMessage) => {
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
  };

  if (!detail) {
    return (
      <div className="fixed inset-0 z-100 flex items-center justify-center bg-base-300/35 backdrop-blur-md p-4" onClick={onClose}>
        <span className="loading loading-spinner loading-lg text-primary" />
      </div>
    );
  }

  const { rack, items } = detail;
  const byLevel = (level) => items.filter((item) => Number(item.level) === level);
  const unassigned = items.filter((item) => !item.level);
  const isFloor = Boolean(rack.isFloor);
  const stagingProject = rack.projectId ? (rack.projectName || 'ไม่ผูกโครงการ') : null;
  const levelItems = selectedLevel != null ? byLevel(selectedLevel) : [];

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
            {moving && (() => {
              const targetRack = allRacks.find((entry) => Number(entry.id) === Number(moving.rackId));
              const targetRoom = allRooms.find((entry) => Number(entry.id) === Number(moving.roomId));
              return (
                <div className="mb-3 rounded-xl border border-warning/50 bg-warning/10 p-3">
                  <div className="mb-2 text-xs font-bold">
                    📦 ย้าย {moving.sku} จาก {rack.name}{isFloor ? '' : ` เลเวล ${selectedLevel}`} (ตรงนี้มี {moving.max} ชิ้น)
                  </div>

                  <div className="join mb-2">
                    <button
                      className={`btn btn-xs join-item ${moving.kind === 'rack' ? 'btn-warning' : 'btn-ghost border border-base-300'}`}
                      onClick={() => setMoving({ ...moving, kind: 'rack' })}
                    >ชั้นวาง</button>
                    <button
                      className={`btn btn-xs join-item ${moving.kind === 'room' ? 'btn-warning' : 'btn-ghost border border-base-300'}`}
                      onClick={() => setMoving({ ...moving, kind: 'room' })}
                    >ห้องเก็บของ</button>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    {moving.kind === 'rack' ? (
                      <>
                        <select className="select select-bordered select-sm min-w-44 flex-1"
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
                          <span className="badge badge-ghost badge-sm">วางกับพื้น</span>
                        ) : (
                          <select className="select select-bordered select-sm w-32"
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
                      <select className="select select-bordered select-sm min-w-44 flex-1"
                        value={moving.roomId}
                        onChange={(event) => setMoving({ ...moving, roomId: event.target.value })}>
                        <option value="">— เลือกพื้นที่ —</option>
                        {/* เฉพาะห้องเก็บของ — ห้องน้ำ/ออฟฟิศ/ห้องประชุม ไม่ใช่ที่วางสต็อก */}
                        {allRooms.filter((room) => room.isStorage || room.isStaging).map((room) => (
                          <option key={room.id} value={room.id}>
                            {room.isStaging ? '📦 ' : ''}{room.name}
                            {room.isStaging ? ` — ${room.projectName || 'ไม่ผูกโครงการ'}` : ''}
                          </option>
                        ))}
                      </select>
                    )}
                    <input type="number" min="1" max={moving.max} className="input input-bordered input-sm w-24"
                      value={moving.quantity}
                      onChange={(event) => setMoving({ ...moving, quantity: event.target.value })} />
                    <button className="btn btn-sm btn-warning" disabled={saving} onClick={moveItem}>ย้าย</button>
                    <button className="btn btn-sm btn-ghost" onClick={() => setMoving(null)}>ยกเลิก</button>
                  </div>

                  <p className="mt-1 text-[11px] text-base-content/60">
                    {targetRack?.projectId || targetRoom?.isStaging
                      ? 'ย้ายเข้าพื้นที่จัดเตรียม — ของยังนับเป็นสต็อก แต่จะถูกกันไว้ให้โครงการนั้นเท่านั้น'
                      : 'ย้ายที่วางเท่านั้น ยอดคงเหลือรวมของสินค้าไม่เปลี่ยน'}
                  </p>
                </div>
              );
            })()}
            <div className="overflow-x-auto rounded-xl border border-base-300">
              <table className="table table-sm w-full">
                <thead className="bg-base-200/50">
                  <tr><th>รูปภาพ</th><th>รหัสสินค้า</th><th className="min-w-64">ชื่อสินค้า</th><th>หมวดหมู่</th><th>จำนวนที่นี่</th><th>คงเหลือรวม</th>{canEdit && <th className="sticky right-0 bg-base-200"></th>}</tr>
                </thead>
                <tbody>
                  {levelItems.map((item) => (
                    <tr key={item.sku} className={highlightSku === item.sku ? 'bg-warning/10' : 'hover:bg-base-200/40'}>
                      <td>
                        <div className="avatar">
                          <div className="w-10 h-10 rounded bg-base-300">
                            <img src={getImg(item.imageUrl)} crossOrigin="anonymous" alt={item.sku} />
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
                            onBlur={(event) => {
                              const next = Number(event.target.value);
                              if (!Number.isFinite(next) || next < 0 || next === Number(item.qtyHere)) return;
                              setLocation(item.sku, { sku: item.sku, rackId, level: selectedLevel, quantity: next });
                            }}
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
                              onClick={() => setMoving({
                                sku: item.sku, kind: 'rack', rackId: '', level: '', roomId: '',
                                quantity: Number(item.qtyHere), max: Number(item.qtyHere)
                              })}
                            >
                              <FiPackage />
                            </button>
                          )}
                          <button
                            className="btn btn-ghost btn-xs text-error"
                            disabled={saving}
                            title={isFloor
                              ? 'เอาสินค้าออกจากพื้นที่นี้ (ตำแหน่งอื่นของสินค้านี้ไม่ถูกแตะ)'
                              : `เอาสินค้าออกจากเลเวล ${selectedLevel} (ตำแหน่งอื่นของสินค้านี้ไม่ถูกแตะ)`}
                            onClick={() => setLocation(
                              item.sku,
                              { sku: item.sku, rackId, level: selectedLevel, quantity: 0 },
                              isFloor ? `เอา ${item.sku} ออกจาก ${rack.name} แล้ว` : `เอา ${item.sku} ออกจากเลเวล ${selectedLevel} แล้ว`
                            )}
                          >
                            <FiTrash2 />
                          </button>
                        </td>
                      )}
                    </tr>
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
    </div>
  );
}

