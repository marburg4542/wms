import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  FiArrowLeft,
  FiArchive,
  FiBox,
  FiCheck,
  FiClock,
  FiCopy,
  FiChevronDown,
  FiChevronUp,
  FiChevronsDown,
  FiChevronsUp,
  FiCornerUpLeft,
  FiCornerUpRight,
  FiEdit3,
  FiEye,
  FiGrid,
  FiHome,
  FiLayers,
  FiLock,
  FiMap,
  FiMaximize,
  FiMenu,
  FiMinus,
  FiMousePointer,
  FiMove,
  FiNavigation,
  FiPackage,
  FiPlus,
  FiRotateCw,
  FiSearch,
  FiSettings,
  FiTrash2,
  FiUploadCloud,
  FiUnlock,
  FiX,
  FiZoomIn,
  FiZoomOut
} from 'react-icons/fi';
import toast from 'react-hot-toast';
import { fetchApi, getAssetUrl } from '../../utils/api';
import { onServerEvent } from '../../utils/events';
import { useBodyScrollLock } from '../../utils/useBodyScrollLock';
import { confirmDialog } from '../../utils/confirm';
import RackBlueprint from './RackBlueprint';
import {
  CANVAS_HEIGHT,
  CANVAS_WIDTH,
  GRID_SIZE,
  RACK_HEIGHT,
  RACK_WIDTH,
  alignSelection,
  angleBetween,
  clamp,
  clampPosition,
  distributeSelection,
  entityBounds,
  entityKey,
  intersectsSelection,
  isLinearMarker,
  layerPayload,
  linearStartPoint,
  moveLayer,
  normalizeAngle,
  normalizeLayerOrder,
  placementAtPoint,
  rectFromDrag,
  reindexLayerOrder,
  rotateAroundStart,
  screenToCanvas,
  selectionBounds,
  segmentGeometry,
  smartGuidePosition,
  snapValue
} from './layout';

// ขนาดขั้นต่ำตอนลากสร้าง (ต้องตรงกับที่ server บังคับใน roomController/rackController)
const RECT_MIN = {
  room: { width: 80, height: 60 },
  rack: { width: 60, height: 40 }
};

// ขอบเขตการซูมผัง — กว้างพอให้ซูมอ่านป้ายชื่อชั้นวางบนมือถือได้จริง
const ZOOM_MIN = 0.2;
const ZOOM_MAX = 4;
const ZOOM_STEP = 1.2; // ปุ่ม +/- ซูมแบบคูณ ระยะก้าวจึงรู้สึกเท่ากันทุกระดับ (ต่างจากบวก/ลบทีละ 0.1)

// รูปสินค้า — ถ้าไม่มีรูปให้ใช้ SVG เปล่าแทน (แบบเดียวกับหน้าสินค้าคงคลัง/ผังชั้นวาง)
const NO_IMAGE = "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxMDAiIGhlaWdodD0iMTAwIj48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSIjZjNmNGY2Ii8+PHRleHQgeD0iNTAlIiB5PSI1MCUiIGZvbnQtc2l6ZT0iMTIiIHRleHQtYW5jaG9yPSJtaWRkbGUiIGFsaWdubWVudC1iYXNlbGluZT0ibWlkZGxlIiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiIgZmlsbD0iIzliOWI5YiI+Tm8gSW1hZ2U8L3RleHQ+PC9zdmc+";
const itemImage = (url) => (url ? getAssetUrl(url) : NO_IMAGE);

const MARKERS = [
  { type: 'wall', label: 'กำแพง', icon: '▰' },
  { type: 'line', label: 'เส้นแบ่ง', icon: '━' }
];

const KIND_LABEL = { room: 'ห้อง', rack: 'ชั้นวาง', marker: 'สัญลักษณ์' };
const HISTORY_LIMIT = 50;
const MARKER_SIZE = {
  wall: { width: 160, height: 14 },
  line: { width: 160, height: 4 }
};

const endpointFor = (kind, id) => {
  if (kind === 'room') return `/api/rooms/${id}`;
  if (kind === 'rack') return `/api/racks/${id}`;
  return `/api/markers/${id}`;
};

const entityTitle = (entity) => {
  if (!entity) return '';
  if (entity.kind === 'room' || entity.kind === 'rack') return entity.name;
  return MARKERS.find((item) => item.type === entity.type)?.label || 'สัญลักษณ์';
};

function MarkerToolIcon({ type }) {
  if (type === 'wall') return <span className="block h-2 w-5 rounded-sm bg-current" />;
  if (type === 'line') return <span className="block h-0.5 w-5 bg-current" />;
  return null;
}

function MarkerShape({ entity }) {
  if (entity.type === 'wall') return <div className="h-full w-full rounded bg-neutral" />;
  if (entity.type === 'line') return <div className="h-full w-full rounded-full bg-base-content/65" />;
  return null;
}

// หุ้มด้วย memo เพราะผังมีชิ้นส่วนเกือบร้อยชิ้น และ state ของผัง (โดยเฉพาะ viewport ตอนซูม)
// เปลี่ยนถี่มาก ถ้าไม่หุ้มจะวาดใหม่ทุกชิ้นทุกครั้งที่หมุนล้อ
const CanvasEntity = React.memo(function CanvasEntity({ entity, displayZ, selected, editMode, pickStop, pickDone, movedDuringRotate, onPointerDown, onResizeDown, onRotate, onRotateStart, onSelect, onOpen, onContextMenu }) {
  const isRoom = entity.kind === 'room';
  const isRack = entity.kind === 'rack';
  const width = Number(entity.width || (isRack ? RACK_WIDTH : 20));
  const height = Number(entity.height || (isRack ? RACK_HEIGHT : 20));
  const rotation = Number(entity.rotation) || 0;
  const utilization = isRack ? Math.min(1, Number(entity.quantity || 0) / Math.max(1, Number(entity.capacity || 100))) : 0;
  const rackTone = utilization >= 0.9 ? 'border-error/70 bg-error/10' : utilization >= 0.7 ? 'border-warning/70 bg-warning/10' : 'border-sky-500/70 bg-sky-400/15';
  // พื้นที่วางพื้น = ของกองกับพื้น ใช้กรอบประ + สีเทาอมเขียว ให้แยกออกจากชั้นวางตั้งแต่มองผัง
  const isFloorZone = isRack && Boolean(entity.isFloor);
  // พื้นที่จัดเตรียม = พื้นที่วางพื้นที่ผูกกับโครงการ (ของถูกกันไว้ให้โครงการนั้น)
  const isStagingZone = isFloorZone && Boolean(entity.projectId);

  return (
    <div
      data-entity-key={entityKey(entity)}
      style={{
        left: entity.posX,
        top: entity.posY,
        width,
        height,
        zIndex: Math.max(1, displayZ),
        transform: rotation ? `rotate(${rotation}deg)` : undefined
      }}
      className={`group absolute select-none transition-[box-shadow,border-color,background-color] duration-150
        ${editMode ? (entity.locked ? 'cursor-not-allowed' : 'cursor-move touch-none') : 'cursor-pointer'}
        ${selected ? 'ring-4 ring-primary/35 ring-offset-2 ring-offset-base-100' : ''}
        ${pickStop && !selected ? (pickDone ? 'ring-4 ring-success/40' : 'ring-4 ring-warning/70') : ''}
        ${isRoom ? `rounded-xl border-2 ${entity.isStorage ? 'border-blue-600/80 bg-blue-600/10' : 'border-dashed border-base-content/30 bg-base-200/70'}` : ''}
        ${isRack && !isFloorZone ? `flex items-center justify-center rounded-xl border-2 shadow-lg ${rackTone}` : ''}
        ${isFloorZone && !isStagingZone ? 'flex items-center justify-center rounded-lg border-2 border-dashed border-teal-600/70 bg-teal-400/10' : ''}
        ${isStagingZone ? 'flex items-center justify-center rounded-lg border-2 border-dashed border-amber-500/80 bg-amber-400/15' : ''}`}
      onPointerDown={(event) => editMode && onPointerDown(event, entity)}
      onClick={(event) => { event.stopPropagation(); onSelect(entity, event); }}
      onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); onContextMenu?.(event, entity); }}
      onDoubleClick={(event) => { event.stopPropagation(); onOpen(entity); }}
      role="button"
      aria-label={`${KIND_LABEL[entity.kind]} ${entityTitle(entity)}`}
    >
      {isRoom && (
        <div className="flex h-full flex-col overflow-hidden rounded-[10px]">
          <div className="flex items-center gap-2 border-b border-current/10 px-3 py-2">
            <FiHome className="shrink-0" />
            <span className="truncate text-sm font-bold">{entity.name}</span>
          </div>
          <div className="flex flex-1 flex-col items-center justify-center text-xs text-base-content/45">
            {entity.isStorage ? `${entity.rackCount || 0} ชั้นวาง` : 'พื้นที่ทั่วไป'}
          </div>
        </div>
      )}
      {isRack && (
        <div className="min-w-0 px-3 text-center">
          <div className="truncate text-sm font-bold">{entity.name}</div>
          {isStagingZone
            ? <div className="text-[10px] font-medium text-amber-700">📦 จัดเตรียม · {entity.projectName || 'ไม่ผูกโครงการ'}</div>
            : isFloorZone && <div className="text-[10px] font-medium text-teal-700/80">▤ วางกับพื้น</div>}
        </div>
      )}
      {entity.kind === 'marker' && <MarkerShape entity={entity} />}

      {/* ลำดับจุดแวะของเส้นทางหยิบของ — ตัวเลขบอกว่าควรเดินไปชั้นนี้เป็นลำดับที่เท่าไร */}
      {pickStop && (
        <span
          className={`pointer-events-none absolute -left-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full border-2 border-base-100 text-xs font-bold shadow ${pickDone ? 'bg-success text-success-content' : 'bg-warning text-warning-content'}`}
          title={pickDone ? 'หยิบครบแล้ว' : `จุดแวะที่ ${pickStop}`}
        >
          {pickDone ? '✓' : pickStop}
        </span>
      )}

      {editMode && Boolean(entity.locked) && (
        <span className="pointer-events-none absolute -right-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full bg-base-content text-base-100 shadow" title="ล็อกแล้ว"><FiLock size={12} /></span>
      )}

      {editMode && selected && !entity.locked && (
        <>
          {/* ลากเพื่อหมุนอิสระ (กด Shift = ทีละ 15°) — คลิกเฉยๆ = หมุน 15° */}
          <button
            type="button"
            className="absolute -right-2 -top-2 flex h-6 w-6 cursor-grab items-center justify-center rounded-full border-2 border-base-100 bg-secondary text-secondary-content shadow active:cursor-grabbing"
            aria-label={`หมุน (ตอนนี้ ${Math.round(rotation)} องศา)`}
            title={`ลากเพื่อหมุนอิสระ · กด Shift ล็อกทีละ 15° · ตอนนี้ ${Math.round(rotation)}°`}
            onPointerDown={(event) => { event.stopPropagation(); onRotateStart(event, entity); }}
            onClick={(event) => { event.stopPropagation(); if (!movedDuringRotate) onRotate(entity); }}
          >
            <FiRotateCw size={12} />
          </button>
          {/* ป้ายบอกองศาปัจจุบัน — ไม่หมุนตามกล่อง จะได้อ่านออกทุกมุม */}
          <span
            className="pointer-events-none absolute -top-7 left-1/2 rounded-full bg-secondary px-2 py-0.5 text-[10px] font-bold text-secondary-content shadow"
            style={{ transform: `translateX(-50%) rotate(${-rotation}deg)` }}
          >
            {Math.round(rotation)}°
          </span>
        </>
      )}

      {editMode && selected && !entity.locked && (
        <button
          type="button"
          className="absolute -bottom-2 -right-2 h-5 w-5 cursor-nwse-resize rounded-full border-2 border-base-100 bg-primary shadow"
          aria-label="ปรับขนาด"
          onPointerDown={(event) => { event.stopPropagation(); onResizeDown(event, entity); }}
        />
      )}
    </div>
  );
});

function LayerButtons({ disabled, onMove }) {
  return (
    <div className="grid grid-cols-4 gap-1">
      <button className="btn btn-sm btn-ghost btn-square" disabled={disabled} onClick={() => onMove('front')} title="นำมาหน้าสุด" aria-label="นำมาหน้าสุด"><FiChevronsUp /></button>
      <button className="btn btn-sm btn-ghost btn-square" disabled={disabled} onClick={() => onMove('forward')} title="เลื่อนขึ้นหนึ่งชั้น" aria-label="เลื่อนขึ้นหนึ่งชั้น"><FiChevronUp /></button>
      <button className="btn btn-sm btn-ghost btn-square" disabled={disabled} onClick={() => onMove('backward')} title="เลื่อนลงหนึ่งชั้น" aria-label="เลื่อนลงหนึ่งชั้น"><FiChevronDown /></button>
      <button className="btn btn-sm btn-ghost btn-square" disabled={disabled} onClick={() => onMove('back')} title="ส่งไปหลังสุด" aria-label="ส่งไปหลังสุด"><FiChevronsDown /></button>
    </div>
  );
}

function InspectorPanel({ entity, saving, storageRooms = [], projects = [], onPatch, onLayer, onDelete, onOpen, onMoveRack }) {
  if (!entity) {
    return (
      <div className="flex min-h-40 flex-col items-center justify-center px-4 text-center text-base-content/45">
        <FiMousePointer className="mb-2 text-2xl" />
        <p className="text-sm font-semibold">เลือกองค์ประกอบบนผัง</p>
        <p className="mt-1 text-xs">หรือเลือกจาก Layers หากถูกวัตถุอื่นบัง</p>
      </div>
    );
  }

  const commitText = (field) => (event) => {
    const value = event.target.value.trim();
    if (value !== String(entity[field] || '')) onPatch({ [field]: value });
  };
  const commitNumber = (field, min = 0) => (event) => {
    const value = Number(event.target.value);
    if (Number.isFinite(value) && value >= min && value !== Number(entity[field])) onPatch({ [field]: value });
  };
  const rotation = Number(entity.rotation) || 0;

  return (
    <div className="space-y-3 p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <span className="badge badge-primary badge-sm mb-1">{KIND_LABEL[entity.kind]}</span>
          <h3 className="truncate text-sm font-bold">{entityTitle(entity)}</h3>
        </div>
        <span className={`badge badge-sm shrink-0 gap-1 ${saving ? 'badge-warning' : 'badge-ghost'}`}>
          {saving ? <span className="loading loading-spinner loading-xs" /> : <FiCheck />}
        </span>
      </div>

      <button
        className={`btn btn-sm w-full ${entity.locked ? 'btn-warning' : 'btn-outline'}`}
        disabled={saving}
        onClick={() => onPatch({ locked: !entity.locked })}
      >
        {entity.locked ? <><FiUnlock /> ปลดล็อก Component</> : <><FiLock /> ล็อก Component</>}
      </button>

      <fieldset disabled={Boolean(entity.locked)} className="space-y-3 disabled:opacity-50">
        {(entity.kind === 'room' || entity.kind === 'rack') && (
          <label className="form-control w-full">
            <span className="label-text mb-1 text-xs font-semibold">ชื่อ</span>
            <input key={`${entityKey(entity)}:name:${entity.name}`} className="input input-bordered input-sm" defaultValue={entity.name} onBlur={commitText('name')} />
          </label>
        )}

        {entity.kind === 'room' && (
          <div className="space-y-2">
            {(
              <label className="label cursor-pointer justify-start gap-2 rounded-lg bg-base-200/60 px-2">
                <input type="checkbox" className="toggle toggle-primary toggle-sm" checked={Boolean(entity.isStorage)} onChange={(event) => onPatch({ isStorage: event.target.checked })} />
                <span className="label-text text-xs">เป็นห้องเก็บของ</span>
              </label>
            )}
          </div>
        )}

        {entity.kind === 'rack' && (
          <div className="grid grid-cols-2 gap-2">
            {/* สลับประเภทได้ตลอด — ถ้ายังมีของอยู่เลเวล 2 ขึ้นไป เซิร์ฟเวอร์จะปฏิเสธพร้อมบอกเหตุผล */}
            <div className="col-span-2">
              <span className="label-text mb-1 block text-xs font-semibold">ประเภท</span>
              <div className="join w-full">
                <button
                  type="button"
                  className={`btn btn-xs join-item flex-1 ${entity.isFloor ? 'btn-ghost border border-base-300' : 'btn-primary'}`}
                  onClick={() => onPatch({ isFloor: false })}
                >ชั้นวาง</button>
                <button
                  type="button"
                  className={`btn btn-xs join-item flex-1 ${entity.isFloor ? 'btn-primary' : 'btn-ghost border border-base-300'}`}
                  onClick={() => onPatch({ isFloor: true })}
                >พื้นที่วางพื้น</button>
              </div>
            </div>
            {entity.isFloor ? (
              <label className="form-control col-span-2 -mt-1">
                <span className="label-text mb-1 text-xs font-semibold">ผูกกับโครงการ (ทำให้เป็นพื้นที่จัดเตรียม)</span>
                <select
                  className="select select-bordered select-sm"
                  value={entity.projectId || ''}
                  onChange={(event) => onPatch({ projectId: event.target.value ? Number(event.target.value) : null })}
                >
                  <option value="">— ไม่ผูก (พื้นที่วางพื้นทั่วไป) —</option>
                  {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
                </select>
                <span className="mt-1 text-[11px] text-base-content/55">ผูกแล้วของในพื้นที่นี้จะถูกกันไว้ให้โครงการนั้น โครงการอื่นเบิกไม่ได้</span>
              </label>
            ) : (
              <label className="form-control w-full">
                <span className="label-text mb-1 text-xs font-semibold">จำนวนเลเวล</span>
                <input key={`${entityKey(entity)}:levels:${entity.levels}`} type="number" min="1" max="50" className="input input-bordered input-sm" defaultValue={entity.levels} onBlur={commitNumber('levels', 1)} />
              </label>
            )}
            <label className="form-control w-full">
              <span className="label-text mb-1 text-xs font-semibold">ความจุ</span>
              <input key={`${entityKey(entity)}:capacity:${entity.capacity}`} type="number" min="1" className="input input-bordered input-sm" defaultValue={entity.capacity || 100} onBlur={commitNumber('capacity', 1)} />
            </label>
            <div className="col-span-2 text-[11px] text-base-content/55">ใช้งาน {Number(entity.quantity || 0)} / {Number(entity.capacity || 100)} · {entity.skuCount || entity.itemCount || 0} SKU</div>
          </div>
        )}

        {entity.kind === 'rack' && onMoveRack && (
          <div className="rounded-xl border border-base-300 p-2">
            <div className="mb-1 text-xs font-semibold">ย้ายไปที่</div>
            <select
              className="select select-bordered select-sm w-full"
              value={entity.roomId ?? ''}
              disabled={saving}
              onChange={(event) => onMoveRack(entity, event.target.value ? Number(event.target.value) : null)}
            >
              <option value="">ผังคลัง (ชั้นลอย ไม่อยู่ในห้อง)</option>
              {storageRooms.map((room) => <option key={room.id} value={room.id}>{room.name}</option>)}
            </select>
            <p className="mt-1 text-[11px] text-base-content/55">สินค้าบนชั้นจะย้ายตามไปด้วยทั้งหมด</p>
          </div>
        )}

        {entity.kind === 'marker' && entity.type === 'label' && (
          <label className="form-control w-full">
            <span className="label-text mb-1 text-xs font-semibold">ข้อความป้าย</span>
            <input key={`${entityKey(entity)}:text:${entity.text}`} className="input input-bordered input-sm" defaultValue={entity.text || ''} onBlur={commitText('text')} />
          </label>
        )}

        <div className="grid grid-cols-2 gap-2">
          <label className="form-control">
            <span className="label-text mb-1 text-xs">X</span>
            <input key={`${entityKey(entity)}:x:${entity.posX}`} type="number" className="input input-bordered input-sm" defaultValue={Math.round(entity.posX)} onBlur={commitNumber('posX')} />
          </label>
          <label className="form-control">
            <span className="label-text mb-1 text-xs">Y</span>
            <input key={`${entityKey(entity)}:y:${entity.posY}`} type="number" className="input input-bordered input-sm" defaultValue={Math.round(entity.posY)} onBlur={commitNumber('posY')} />
          </label>
          <>
            <label className="form-control">
              <span className="label-text mb-1 text-xs">กว้าง</span>
              <input key={`${entityKey(entity)}:w:${entity.width}`} type="number" min={entity.kind === 'room' ? 80 : entity.kind === 'rack' ? 60 : 6} className="input input-bordered input-sm" defaultValue={Math.round(entity.width || RACK_WIDTH)} onBlur={commitNumber('width', entity.kind === 'room' ? 80 : entity.kind === 'rack' ? 60 : 6)} />
            </label>
            <label className="form-control">
              <span className="label-text mb-1 text-xs">สูง</span>
              <input key={`${entityKey(entity)}:h:${entity.height}`} type="number" min={entity.kind === 'room' ? 60 : entity.kind === 'rack' ? 40 : 4} className="input input-bordered input-sm" defaultValue={Math.round(entity.height || RACK_HEIGHT)} onBlur={commitNumber('height', entity.kind === 'room' ? 60 : entity.kind === 'rack' ? 40 : 4)} />
            </label>
          </>
        </div>

        <div className="rounded-xl border border-base-300 p-2">
          <div className="mb-2 flex items-end gap-2">
            <label className="form-control min-w-0 flex-1">
              <span className="label-text mb-1 text-xs font-semibold">หมุน (องศา)</span>
              <input key={`${entityKey(entity)}:rotation:${rotation}`} type="number" min="0" max="359" className="input input-bordered input-sm w-full" defaultValue={Math.round(rotation)} onBlur={commitNumber('rotation')} />
            </label>
            <button type="button" className="btn btn-sm btn-square btn-outline" onClick={() => onPatch({ rotation: (rotation + 90) % 360 })} title="หมุน 90°"><FiRotateCw /></button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" className="btn btn-xs btn-ghost" onClick={() => onPatch({ rotation: (rotation + 345) % 360 })}>−15°</button>
            <button type="button" className="btn btn-xs btn-ghost" onClick={() => onPatch({ rotation: (rotation + 15) % 360 })}>+15°</button>
          </div>
        </div>

        <div className="rounded-xl border border-base-300 p-2">
          <div className="mb-2 flex items-center justify-between text-xs font-semibold"><span>Layer</span><span className="badge badge-ghost badge-sm">{entity.z}</span></div>
          <LayerButtons disabled={saving || Boolean(entity.locked)} onMove={onLayer} />
        </div>
      </fieldset>

      {(entity.kind === 'room' && entity.isStorage) || entity.kind === 'rack' ? (
        <button className="btn btn-sm btn-primary w-full" onClick={onOpen}>
          {entity.kind === 'room' ? 'เปิดผังในห้อง' : 'เปิด Blueprint'}
        </button>
      ) : null}
      <button className="btn btn-sm btn-ghost w-full text-error" disabled={Boolean(entity.locked)} onClick={onDelete}><FiTrash2 /> ลบ{KIND_LABEL[entity.kind]}</button>
    </div>
  );
}

function MultiInspector({ entities, saving, onAlign, onGroup, onUngroup, onPatch, onCopy, onDuplicate, onZoom, onDelete }) {
  const anyGroup = entities.some((entity) => entity.groupId);
  const allLocked = entities.every((entity) => entity.locked);
  return (
    <div className="space-y-3 p-3">
      <div>
        <span className="badge badge-primary badge-sm">เลือก {entities.length} Components</span>
        <p className="mt-2 text-xs text-base-content/55">ลากชิ้นใดชิ้นหนึ่งเพื่อย้ายทั้งชุด หรือใช้คำสั่งจัดแนวด้านล่าง</p>
      </div>
      <div className="rounded-xl border border-base-300 p-2">
        <div className="mb-2 text-xs font-bold">จัดแนว</div>
        <div className="grid grid-cols-3 gap-1">
          {['left', 'center', 'right', 'top', 'middle', 'bottom'].map((mode) => <button key={mode} className="btn btn-xs btn-ghost" disabled={saving} onClick={() => onAlign(mode)}>{mode}</button>)}
        </div>
        <div className="mt-1 grid grid-cols-2 gap-1">
          <button className="btn btn-xs btn-ghost" disabled={entities.length < 3 || saving} onClick={() => onAlign('horizontal')}>กระจายแนวนอน</button>
          <button className="btn btn-xs btn-ghost" disabled={entities.length < 3 || saving} onClick={() => onAlign('vertical')}>กระจายแนวตั้ง</button>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <button className="btn btn-sm btn-outline" disabled={saving} onClick={onGroup}>Group</button>
        <button className="btn btn-sm btn-outline" disabled={!anyGroup || saving} onClick={onUngroup}>Ungroup</button>
        <button className={`btn btn-sm ${allLocked ? 'btn-warning' : 'btn-outline'}`} disabled={saving} onClick={() => onPatch({ locked: !allLocked })}>{allLocked ? <FiUnlock /> : <FiLock />} {allLocked ? 'ปลดล็อก' : 'ล็อก'}</button>
        <button className="btn btn-sm btn-outline" disabled={saving || allLocked} onClick={() => onPatch((entity) => ({ rotation: ((Number(entity.rotation) || 0) + 15) % 360 }))}><FiRotateCw /> หมุน 15°</button>
        <button className="btn btn-sm btn-ghost" onClick={onCopy}><FiCopy /> Copy</button>
        <button className="btn btn-sm btn-ghost" onClick={onDuplicate}><FiPlus /> Duplicate</button>
        <button className="btn btn-sm btn-ghost col-span-2" onClick={onZoom}><FiMaximize /> Zoom to selection</button>
      </div>
      <button className="btn btn-sm btn-ghost w-full text-error" disabled={entities.some((entity) => entity.locked)} onClick={onDelete}><FiTrash2 /> ย้ายไปถังขยะ</button>
    </div>
  );
}

function LayersPanel({ entities, selectedKey, onSelect }) {
  const ordered = [...normalizeLayerOrder(entities)].reverse();
  return (
    <div className="space-y-1 p-3">
      {ordered.length === 0 && <p className="py-8 text-center text-sm text-base-content/40">ยังไม่มีองค์ประกอบ</p>}
      {ordered.map((entity) => {
        const key = entityKey(entity);
        return (
          <button
            key={key}
            className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors ${selectedKey === key ? 'bg-primary text-primary-content' : 'hover:bg-base-200'}`}
            onClick={() => onSelect(entity)}
          >
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-base-100/80 text-base-content">
              {entity.kind === 'room' ? <FiHome /> : entity.kind === 'rack' ? <FiBox /> : <FiMap />}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold">{entityTitle(entity)}</span>
              <span className={`block text-[11px] ${selectedKey === key ? 'opacity-75' : 'text-base-content/45'}`}>{KIND_LABEL[entity.kind]}</span>
            </span>
            {Boolean(entity.locked) && <FiLock className={selectedKey === key ? 'opacity-80' : 'text-base-content/40'} size={12} />}
            <span className={`text-xs ${selectedKey === key ? 'opacity-80' : 'text-base-content/40'}`}>#{entity.z}</span>
          </button>
        );
      })}
    </div>
  );
}

// แผงเส้นทางหยิบของตามใบเบิก — ลอยอยู่มุมขวาของผัง ใช้ได้ทั้งโหมดดูและโหมดแก้ไข
function PickListPanel({ data, pickedKeys, open, onToggleOpen, onTogglePicked, onGoto, onClose }) {
  const items = data.items || [];
  const unlocated = data.unlocated || [];
  const keyOf = (item) => item.pickKey || item.sku;
  const doneCount = items.filter((item) => pickedKeys.includes(keyOf(item))).length;

  return (
    <div className="absolute right-2 top-2 z-60 w-[min(88vw,290px)] overflow-hidden rounded-xl border border-warning/40 bg-base-100/97 shadow-2xl backdrop-blur">
      <div className="flex items-center gap-2 border-b border-base-300 bg-warning/10 px-3 py-2">
        <FiNavigation className="shrink-0 text-warning" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs font-bold">เส้นทางหยิบของ</div>
          <div className="truncate text-[11px] text-base-content/60">
            {data.transaction?.transactionId} · {doneCount}/{items.length} รายการ · {data.stops} จุดแวะ
          </div>
        </div>
        <button className="btn btn-xs btn-ghost btn-square" onClick={onToggleOpen} aria-label={open ? 'ย่อ' : 'ขยาย'}>
          {open ? <FiChevronUp /> : <FiChevronDown />}
        </button>
        <button className="btn btn-xs btn-ghost btn-square" onClick={onClose} aria-label="ปิดเส้นทางหยิบของ"><FiX /></button>
      </div>

      {open && (
        <div className="max-h-[52vh] overflow-y-auto p-2">
          {items.length === 0 && unlocated.length === 0 && (
            <p className="px-2 py-4 text-center text-xs text-base-content/50">ไม่มีรายการในใบเบิกนี้</p>
          )}

          {items.map((item) => {
            const picked = pickedKeys.includes(keyOf(item));
            // สินค้าตัวเดียวกันที่ต้องแวะหลายจุด — บอกให้ชัดว่าจุดนี้มีของอยู่กี่ชิ้น
            const spread = items.filter((row) => row.sku === item.sku).length > 1;
            return (
              <div key={keyOf(item)} className={`mb-1 flex items-start gap-2 rounded-lg p-2 ${picked ? 'bg-success/10' : 'bg-base-200/50'}`}>
                <input
                  type="checkbox"
                  className="checkbox checkbox-xs checkbox-success mt-1 shrink-0"
                  checked={picked}
                  onChange={() => onTogglePicked(keyOf(item))}
                  aria-label={`หยิบ ${item.sku} แล้ว`}
                />
                <button type="button" className="min-w-0 flex-1 text-left" onClick={() => onGoto(item)}>
                  <div className={`truncate text-xs font-semibold ${picked ? 'text-base-content/45 line-through' : ''}`}>
                    <span className="mr-1 opacity-50">{item.stop}.</span>{item.name}
                  </div>
                  <div className="truncate text-[11px] text-base-content/60">
                    <span className="font-mono">{item.sku}</span> · {item.roomName ? `${item.roomName} · ` : ''}{item.rackName}
                    {item.storageLevel ? ` · เลเวล ${item.storageLevel}` : ''}
                  </div>
                  <div className="text-[11px] font-bold text-primary">
                    หยิบ {item.approvedQty || item.requestedQty} · คงเหลือ {item.stock}
                  </div>
                  {spread && (
                    <div className="text-[11px] font-semibold text-warning">
                      ⚠️ ของตัวนี้วางหลายที่ — ตรงนี้มี {item.qtyHere} ชิ้น
                    </div>
                  )}
                </button>
              </div>
            );
          })}

          {unlocated.length > 0 && (
            <div className="mt-2 rounded-lg border border-dashed border-base-300 p-2">
              <div className="mb-1 text-[11px] font-bold text-base-content/60">ยังไม่ระบุตำแหน่ง ({unlocated.length})</div>
              {unlocated.map((item) => (
                <div key={item.sku} className="truncate text-[11px] text-base-content/55">
                  <span className="font-mono">{item.sku}</span> · {item.name}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// สินค้าที่ยังไม่ได้กำหนดตำแหน่งจัดเก็บ — ค้นหาแล้วผูกเข้าชั้นวาง/เลเวลได้ทันที
function UnassignedModal({ onClose, onAssigned }) {
  const [search, setSearch] = useState('');
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [racks, setRacks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState({});   // sku → { rackId, level }
  const [saving, setSaving] = useState('');
  useBodyScrollLock(true);

  const load = useCallback(async (term) => {
    setLoading(true);
    const query = term ? `?search=${encodeURIComponent(term)}&limit=100` : '?limit=100';
    const result = await fetchApi(`/api/storage-map/unassigned${query}`).catch(() => ({}));
    if (result.success) { setItems(result.items); setTotal(result.total); }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchApi('/api/racks').then((result) => { if (result.success) setRacks(result.racks); }).catch(() => {});
  }, []);
  useEffect(() => {
    const timer = setTimeout(() => load(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search, load]);

  const assign = async (item) => {
    const choice = draft[item.sku] || {};
    if (!choice.rackId) return toast.error('เลือกชั้นวางก่อน');
    setSaving(item.sku);
    try {
      const result = await fetchApi('/api/storage-map/assign', {
        method: 'POST',
        body: JSON.stringify({
          sku: item.sku,
          rackId: Number(choice.rackId),
          level: choice.level || null,
          quantity: choice.quantity === '' || choice.quantity == null ? null : Number(choice.quantity),
          mode: 'add'
        })
      });
      if (result.success) {
        toast.success(result.message);
        // วางไม่ครบก็ยังอยู่ในรายการ จึงโหลดใหม่แทนการตัดออกทันที
        await load(search.trim());
        onAssigned?.();
      }
    } catch (error) {
      toast.error(error?.message || 'บันทึกตำแหน่งไม่สำเร็จ');
    } finally {
      setSaving('');
    }
  };

  const rackOf = (sku) => racks.find((rack) => rack.id === Number(draft[sku]?.rackId));

  return (
    <div className="fixed inset-0 z-100 flex items-center justify-center bg-base-300/45 p-4 backdrop-blur-sm" onClick={onClose}>
      <section className="glass-modal max-h-[86vh] w-full max-w-3xl overflow-hidden rounded-2xl" onClick={(event) => event.stopPropagation()}>
        <header className="flex items-center gap-3 border-b border-base-300 p-4">
          <FiPackage className="text-primary" />
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-bold">สินค้ายังไม่ระบุตำแหน่งจัดเก็บ</h2>
            <p className="text-xs text-base-content/60">เหลือ {total} รายการที่ยังวางไม่ครบ — เลือกที่เก็บและระบุจำนวน</p>
          </div>
          <button className="btn btn-sm btn-ghost btn-square" onClick={onClose} aria-label="ปิด"><FiX /></button>
        </header>

        <div className="border-b border-base-300 p-3">
          <input
            className="input input-bordered input-sm w-full"
            placeholder="ค้นหารหัสสินค้าหรือชื่อสินค้า..."
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>

        <div className="max-h-[56vh] overflow-y-auto p-3">
          {loading ? (
            <div className="py-10 text-center"><span className="loading loading-spinner text-primary" /></div>
          ) : items.length === 0 ? (
            <p className="py-10 text-center text-sm text-base-content/50">
              {search ? 'ไม่พบสินค้าที่ค้นหา' : '🎉 สินค้าทุกตัวมีตำแหน่งจัดเก็บครบแล้ว'}
            </p>
          ) : items.map((item) => {
            const rack = rackOf(item.sku);
            return (
              <div key={item.sku} className="mb-2 flex flex-wrap items-center gap-2 rounded-xl bg-base-200/50 p-2">
                <div className="avatar shrink-0">
                  <div className="h-10 w-10 rounded bg-base-300">
                    <img src={itemImage(item.imageUrl)} crossOrigin="anonymous" alt={item.sku} loading="lazy" decoding="async" width="40" height="40" />
                  </div>
                </div>
                <div className="min-w-40 flex-1">
                  <div className="truncate text-sm font-medium">{item.name}</div>
                  <div className="truncate text-xs text-base-content/60">
                    <span className="font-mono">{item.sku}</span> · {item.groupId} — {item.groupName || 'Default'}
                    {' · '}คงเหลือ {item.stock}
                    {Number(item.placed) > 0 && <span className="text-warning"> · วางแล้ว {item.placed}</span>}
                    {' · '}<span className="font-semibold">ยังไม่ระบุที่ {item.unplaced ?? item.stock}</span>
                  </div>
                </div>
                <select
                  className="select select-bordered select-sm w-36"
                  value={draft[item.sku]?.rackId || ''}
                  onChange={(event) => setDraft((current) => ({ ...current, [item.sku]: { rackId: event.target.value, level: '' } }))}
                >
                  <option value="">— เลือกชั้นวาง —</option>
                  {racks.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.roomName ? `${option.roomName} · ` : ''}{option.name}
                    </option>
                  ))}
                </select>
                <select
                  className="select select-bordered select-sm w-28"
                  value={draft[item.sku]?.level || ''}
                  disabled={!rack}
                  onChange={(event) => setDraft((current) => ({ ...current, [item.sku]: { ...current[item.sku], level: event.target.value } }))}
                >
                  <option value="">ไม่ระบุเลเวล</option>
                  {Array.from({ length: rack?.levels || 0 }, (_, index) => index + 1).map((level) => (
                    <option key={level} value={level}>เลเวล {level}</option>
                  ))}
                </select>
                <input
                  type="number" min="1" max={item.unplaced ?? item.stock}
                  className="input input-bordered input-sm w-24"
                  placeholder={`สูงสุด ${item.unplaced ?? item.stock}`}
                  value={draft[item.sku]?.quantity ?? ''}
                  onChange={(event) => setDraft((current) => ({ ...current, [item.sku]: { ...current[item.sku], quantity: event.target.value } }))}
                  title="ไม่กรอก = ใส่ของที่ยังไม่ระบุตำแหน่งทั้งหมด"
                />
                <button
                  className="btn btn-sm btn-primary"
                  disabled={!draft[item.sku]?.rackId || saving === item.sku}
                  onClick={() => assign(item)}
                >
                  {saving === item.sku ? <span className="loading loading-spinner loading-xs" /> : 'บันทึก'}
                </button>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}


export default function Storage() {
  const currentUser = JSON.parse(sessionStorage.getItem('currentUser') || '{}');
  const canEdit = ['Admin', 'Manager'].includes(currentUser.role);
  const [searchParams, setSearchParams] = useSearchParams();

  const [plans, setPlans] = useState([]);
  const [planId, setPlanId] = useState(null);
  const [view, setView] = useState('floor');
  const [currentRoom, setCurrentRoom] = useState(null);
  const [rooms, setRooms] = useState([]);
  const [racks, setRacks] = useState([]);
  const [markers, setMarkers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [openRackId, setOpenRackId] = useState(null);
  const [highlight, setHighlight] = useState({ rackId: null, level: null, sku: null });

  // เส้นทางหยิบของตามใบเบิก (เปิดผ่าน /storage?pick=<เลขที่ใบเบิก>)
  const [pickList, setPickList] = useState(null);
  const [pickedKeys, setPickedKeys] = useState([]);   // จุดหยิบที่ทำแล้ว (sku@ตำแหน่ง)
  const [pickPanelOpen, setPickPanelOpen] = useState(true);
  // สินค้าที่ยังไม่ระบุตำแหน่ง (Admin/Manager) — เติมตำแหน่งได้จากหน้านี้เลย
  const [unassignedOpen, setUnassignedOpen] = useState(false);
  const [storageRooms, setStorageRooms] = useState([]);
  const [projects, setProjects] = useState([]);            // ใช้เลือกโครงการให้พื้นที่จัดเตรียม

  const [editMode, setEditMode] = useState(false);
  const [tool, setTool] = useState('select');
  const [selectedKeys, setSelectedKeys] = useState([]);
  const selectedKey = selectedKeys.at(-1) || null;
  const setSelectedKey = useCallback((key) => setSelectedKeys(key ? [key] : []), []);
  const [panelTab, setPanelTab] = useState('inspector');
  const [smallPanelOpen, setSmallPanelOpen] = useState(false);
  const [savingCount, setSavingCount] = useState(0);
  const [snapEnabled, setSnapEnabled] = useState(false);
  const [smartGuidesEnabled, setSmartGuidesEnabled] = useState(true);
  const [activeGuides, setActiveGuides] = useState({ x: null, y: null });
  const [selectionBox, setSelectionBox] = useState(null);
  const [contextMenu, setContextMenu] = useState(null);
  const [workflowOpen, setWorkflowOpen] = useState(false);
  const [workflowTab, setWorkflowTab] = useState('versions');
  const [versions, setVersions] = useState([]);
  const [trashItems, setTrashItems] = useState([]);
  const [storageHistory, setStorageHistory] = useState([]);
  const [remoteChanged, setRemoteChanged] = useState(false);
  const [searchResults, setSearchResults] = useState([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [drawPreview, setDrawPreview] = useState(null);
  const [rotatePreview, setRotatePreview] = useState(null); // องศาที่กำลังลากหมุน (แสดงสดบนผัง)
  const [viewport, setViewport] = useState({ zoom: 0.8, panX: 20, panY: 20 });
  const [, setHistoryTick] = useState(0);

  const [planManage, setPlanManage] = useState(false);
  const [newPlan, setNewPlan] = useState('');
  const [locateSku, setLocateSku] = useState('');
  const [creation, setCreation] = useState({ name: '', isStorage: true, projectId: '', levels: 3, capacity: 100, text: '', isFloor: false });

  const viewportRef = useRef(null);
  const dragRef = useRef(null);
  const drawRef = useRef(null);
  const panRef = useRef(null);
  const selectionRef = useRef(null);
  const clipboardRef = useRef([]);
  const viewportHistoryRef = useRef([]);
  const lastLocalSaveRef = useRef(0);
  const movedRef = useRef(false);
  const spacePressedRef = useRef(false);
  const pinchRef = useRef(null);            // ระยะ/จุดกึ่งกลางระหว่าง 2 นิ้ว ตอนหุบ-กาง
  const touchPointsRef = useRef(new Map()); // นิ้วที่แตะอยู่ตอนนี้ (pointerId -> ตำแหน่ง)
  const userZoomedRef = useRef(false);      // ผู้ใช้ปรับซูมเองแล้วหรือยัง
  const pendingZoomRef = useRef(null);      // ตัวคูณซูมที่สะสมไว้รอวาดเฟรมถัดไป
  const zoomFrameRef = useRef(null);
  const endPointerActionRef = useRef(null); // เก็บตัวปิดงานลากไว้ในref ให้ listener ท่านิ้วผูกครั้งเดียวจบ
  const undoRef = useRef([]);
  const redoRef = useRef([]);
  useBodyScrollLock(planManage || smallPanelOpen || workflowOpen);

  const inRoom = view === 'room' && currentRoom;
  const scope = useMemo(() => (inRoom ? { roomId: currentRoom.id } : { planId }), [inRoom, currentRoom, planId]);
  const currentPlan = useMemo(() => plans.find((plan) => plan.id === planId) || null, [plans, planId]);
  const drawType = tool === 'add-marker-wall' ? 'wall' : tool === 'add-marker-line' ? 'line' : null;
  // เครื่องมือที่ลากกำหนดขนาดตอนสร้างได้ (ห้อง/ชั้นวาง)
  const rectTool = tool === 'add-room' ? 'room' : tool === 'add-rack' ? 'rack' : null;

  const loadPlans = useCallback(async () => {
    const result = await fetchApi('/api/floor-plans').catch(() => ({}));
    if (result.success) {
      setPlans(result.plans);
      setPlanId((current) => current || result.plans[0]?.id || null);
    }
  }, []);

  const loadFloor = useCallback(async (nextPlanId) => {
    if (!nextPlanId) return;
    setLoading(true);
    const [roomResult, rackResult, markerResult] = await Promise.all([
      fetchApi(`/api/rooms?plan=${nextPlanId}`).catch(() => ({})),
      fetchApi(`/api/racks?plan=${nextPlanId}&floor=1`).catch(() => ({})),
      fetchApi(`/api/markers?plan=${nextPlanId}`).catch(() => ({}))
    ]);
    if (roomResult.success) setRooms(roomResult.rooms);
    if (rackResult.success) setRacks(rackResult.racks);
    if (markerResult.success) setMarkers(markerResult.markers);
    setLoading(false);
  }, []);

  const loadRoom = useCallback(async (roomId) => {
    setLoading(true);
    setRooms([]);
    const [rackResult, markerResult] = await Promise.all([
      fetchApi(`/api/racks?room=${roomId}`).catch(() => ({})),
      fetchApi(`/api/markers?room=${roomId}`).catch(() => ({}))
    ]);
    if (rackResult.success) setRacks(rackResult.racks);
    if (markerResult.success) setMarkers(markerResult.markers);
    setLoading(false);
  }, []);

  const reloadContext = useCallback(() => {
    if (inRoom) return loadRoom(currentRoom.id);
    return loadFloor(planId);
  }, [inRoom, currentRoom, planId, loadFloor, loadRoom]);

  useEffect(() => { loadPlans(); }, [loadPlans]);
  useEffect(() => { if (view === 'floor' && planId) loadFloor(planId); }, [view, planId, loadFloor]);
  useEffect(() => {
    const off = onServerEvent('products', reloadContext);
    return off;
  }, [reloadContext]);

  const allEntities = useMemo(() => [
    ...(view === 'floor' ? rooms.map((entity) => ({ ...entity, kind: 'room' })) : []),
    ...racks.map((entity) => ({ ...entity, kind: 'rack' })),
    ...markers.map((entity) => ({ ...entity, kind: 'marker' }))
  ], [view, rooms, racks, markers]);
  const orderedEntities = useMemo(() => normalizeLayerOrder(allEntities), [allEntities]);
  const displayZ = useMemo(() => new Map(orderedEntities.map((entity) => [entityKey(entity), entity.z])), [orderedEntities]);
  const selectedEntity = useMemo(() => orderedEntities.find((entity) => entityKey(entity) === selectedKey) || null, [orderedEntities, selectedKey]);
  const selectedEntities = useMemo(() => orderedEntities.filter((entity) => selectedKeys.includes(entityKey(entity))), [orderedEntities, selectedKeys]);

  const setLocalPatch = useCallback((kind, id, patch) => {
    const apply = (list) => list.map((entity) => entity.id === id ? { ...entity, ...patch } : entity);
    if (kind === 'room') setRooms(apply);
    else if (kind === 'rack') setRacks(apply);
    else setMarkers(apply);
  }, []);

  const markLocalMutation = useCallback(() => {
    lastLocalSaveRef.current = Date.now();
    setPlans((list) => list.map((plan) => plan.id === planId
      ? { ...plan, status: 'draft', revision: Number(plan.revision || 0) + 1 }
      : plan));
  }, [planId]);

  const applyLayerState = useCallback((order) => {
    const zByKey = new Map(order.map((entry, index) => [entityKey(entry), index + 1]));
    setRooms((list) => list.map((entity) => ({ ...entity, z: zByKey.get(entityKey('room', entity.id)) || entity.z })));
    setRacks((list) => list.map((entity) => ({ ...entity, z: zByKey.get(entityKey('rack', entity.id)) || entity.z })));
    setMarkers((list) => list.map((entity) => ({ ...entity, z: zByKey.get(entityKey('marker', entity.id)) || entity.z })));
  }, []);

  const pushHistory = useCallback((entry) => {
    undoRef.current = [...undoRef.current.slice(-(HISTORY_LIMIT - 1)), entry];
    redoRef.current = [];
    setHistoryTick((value) => value + 1);
  }, []);

  const savePatch = useCallback(async (kind, id, rawPatch, options = {}) => {
    const entity = allEntities.find((item) => item.kind === kind && item.id === id);
    if (!entity) return false;
    if (entity.locked && !Object.prototype.hasOwnProperty.call(rawPatch, 'locked')) return false;
    // กำแพง/เส้นแบ่ง: หมุนโดยล็อกปลายด้านเริ่มต้นไว้ ไม่ให้ทั้งเส้นกวาดไปรอบจุดกึ่งกลาง
    // (ครอบคลุมทุกทาง — ช่องกรอกองศา, ปุ่ม ±15°/90° และการลากหมุนบนผัง)
    const patch = (rawPatch.rotation != null && rawPatch.posX == null && isLinearMarker(entity))
      ? { ...rawPatch, ...rotateAroundStart(entity, rawPatch.rotation) }
      : rawPatch;
    const before = options.before || Object.fromEntries(Object.keys(patch).map((key) => [key, entity[key]]));
    setLocalPatch(kind, id, patch);
    setSavingCount((count) => count + 1);
    try {
      const saved = await fetchApi(endpointFor(kind, id), { method: 'PUT', body: JSON.stringify(patch) });
      // server อาจคืนค่าที่ derive มา (เช่น projectName ของพื้นที่จัดเตรียม) — เอามาอัปเดตผังทันที
      if (saved?.room) setLocalPatch(kind, id, saved.room);
      markLocalMutation();
      if (options.record !== false) pushHistory({ type: 'entity', kind, id, before, after: patch });
      return true;
    } catch {
      setLocalPatch(kind, id, before);
      toast.error('บันทึกการเปลี่ยนแปลงไม่สำเร็จ ระบบคืนค่าเดิมแล้ว');
      return false;
    } finally {
      setSavingCount((count) => Math.max(0, count - 1));
    }
  }, [allEntities, markLocalMutation, pushHistory, setLocalPatch]);

  const saveBulkChanges = useCallback(async (changes, options = {}) => {
    if (!changes.length) return false;
    const before = options.before || changes.map((change) => {
      const entity = allEntities.find((item) => item.kind === change.kind && item.id === change.id);
      return { kind: change.kind, id: change.id, patch: Object.fromEntries(Object.keys(change.patch).map((key) => [key, entity?.[key]])) };
    });
    changes.forEach((change) => setLocalPatch(change.kind, change.id, change.patch));
    setSavingCount((count) => count + 1);
    try {
      await fetchApi('/api/storage-map/bulk', { method: 'PUT', body: JSON.stringify({ scope, changes }) });
      markLocalMutation();
      if (options.record !== false) pushHistory({ type: 'bulk', before, after: changes });
      return true;
    } catch (error) {
      before.forEach((change) => setLocalPatch(change.kind, change.id, change.patch));
      toast.error(error?.message || 'บันทึกการแก้ไขหลายรายการไม่สำเร็จ');
      return false;
    } finally {
      setSavingCount((count) => Math.max(0, count - 1));
    }
  }, [allEntities, markLocalMutation, pushHistory, scope, setLocalPatch]);

  const saveLayerOrder = useCallback(async (nextOrder, options = {}) => {
    const before = normalizeLayerOrder(allEntities);
    const normalized = reindexLayerOrder(nextOrder);
    applyLayerState(normalized);
    setSavingCount((count) => count + 1);
    try {
      await fetchApi('/api/storage-map/layers', {
        method: 'PUT',
        body: JSON.stringify({ scope, order: layerPayload(normalized) }),
        suppressErrorToast: true
      });
      markLocalMutation();
      if (options.record !== false) {
        pushHistory({
          type: 'layers',
          before: before.map(entityKey),
          after: normalized.map(entityKey)
        });
      }
      return true;
    } catch (error) {
      applyLayerState(before);
      if (error?.code === 'LAYER_CONFLICT') {
        await reloadContext();
        toast.error('ลำดับ Layer เปลี่ยนจากอุปกรณ์อื่น กรุณาลองใหม่');
      } else if (error?.status === 404) {
        toast.error('Backend ยังไม่รองรับ Layer API กรุณา restart Backend แล้วลองใหม่');
      } else {
        toast.error('บันทึกลำดับ Layer ไม่สำเร็จ ระบบคืนค่าเดิมแล้ว');
      }
      return false;
    } finally {
      setSavingCount((count) => Math.max(0, count - 1));
    }
  }, [allEntities, applyLayerState, markLocalMutation, pushHistory, reloadContext, scope]);

  const historyOrder = useCallback((keys) => {
    const byKey = new Map(allEntities.map((entity) => [entityKey(entity), entity]));
    return keys.map((key) => byKey.get(key)).filter(Boolean);
  }, [allEntities]);

  const applyHistory = useCallback(async (entry, direction) => {
    if (entry.type === 'layers') return saveLayerOrder(historyOrder(entry[direction]), { record: false });
    if (entry.type === 'bulk') return saveBulkChanges(entry[direction], { record: false, before: entry[direction === 'before' ? 'after' : 'before'] });
    if (entry.type === 'created' || entry.type === 'deleted') {
      const shouldTrash = (entry.type === 'created' && direction === 'before') || (entry.type === 'deleted' && direction === 'after');
      const endpoint = shouldTrash ? '/api/storage-map/trash' : '/api/storage-map/trash/restore';
      const body = shouldTrash ? { scope: entry.scope, members: entry.members } : { members: entry.members };
      try {
        await fetchApi(endpoint, { method: 'POST', body: JSON.stringify(body) });
        markLocalMutation();
        await reloadContext();
        return true;
      } catch (error) {
        toast.error(error?.message || 'ย้อนประวัติไม่สำเร็จ');
        return false;
      }
    }
    return savePatch(entry.kind, entry.id, entry[direction], { record: false });
  }, [historyOrder, markLocalMutation, reloadContext, saveBulkChanges, saveLayerOrder, savePatch]);

  const undo = useCallback(async () => {
    const entry = undoRef.current.pop();
    if (!entry) return;
    setHistoryTick((value) => value + 1);
    if (await applyHistory(entry, 'before')) redoRef.current.push(entry);
    else undoRef.current.push(entry);
    setHistoryTick((value) => value + 1);
  }, [applyHistory]);

  const redo = useCallback(async () => {
    const entry = redoRef.current.pop();
    if (!entry) return;
    setHistoryTick((value) => value + 1);
    if (await applyHistory(entry, 'after')) undoRef.current.push(entry);
    else redoRef.current.push(entry);
    setHistoryTick((value) => value + 1);
  }, [applyHistory]);

  const openEntity = useCallback((entity) => {
    if (entity.kind === 'room' && entity.isStorage) {
      setCurrentRoom(entity);
      setView('room');
      setSelectedKey(null);
      setTool('select');
      loadRoom(entity.id);
    } else if (entity.kind === 'rack') {
      setOpenRackId(entity.id);
    }
  }, [loadRoom, setSelectedKey]);

  const selectEntity = useCallback((entity, event) => {
    if (movedRef.current) { movedRef.current = false; return; }
    if (editMode) {
      const key = entityKey(entity);
      const groupKeys = entity.groupId
        ? orderedEntities.filter((item) => item.groupId === entity.groupId).map(entityKey)
        : [key];
      setSelectedKeys((current) => {
        if (!event?.shiftKey) return groupKeys;
        const removing = groupKeys.every((item) => current.includes(item));
        return removing ? current.filter((item) => !groupKeys.includes(item)) : [...new Set([...current, ...groupKeys])];
      });
      setPanelTab('inspector');
    } else {
      openEntity(entity);
    }
  }, [editMode, openEntity, orderedEntities]);

  const deleteEntity = useCallback(async (entity = selectedEntity) => {
    if (!entity) return;
    const targets = selectedEntities.some((item) => entityKey(item) === entityKey(entity)) ? selectedEntities : [entity];
    if (targets.some((item) => item.locked)) return toast.error('ปลดล็อก Component ทั้งหมดก่อนลบ');
    const blockedRoom = targets.find((item) => item.kind === 'room' && item.rackCount > 0);
    const blockedRack = targets.find((item) => item.kind === 'rack' && item.itemCount > 0);
    if (blockedRoom) return toast.error(`ลบไม่ได้ — ห้อง ${blockedRoom.name} มีชั้นวาง ${blockedRoom.rackCount} ชั้น`);
    if (blockedRack) return toast.error(`ลบไม่ได้ — ชั้น ${blockedRack.name} มีสินค้า ${blockedRack.itemCount} รายการ`);
    const confirmed = await confirmDialog({
      title: targets.length > 1 ? `ลบ ${targets.length} Components` : `ลบ${KIND_LABEL[entity.kind]}`,
      message: targets.length > 1 ? 'รายการจะถูกย้ายไปถังขยะและกู้คืนได้' : `ต้องการย้าย “${entityTitle(entity)}” ไปถังขยะหรือไม่?`,
      confirmText: 'ลบ',
      danger: true
    });
    if (!confirmed) return;
    try {
      const members = targets.map(({ kind, id }) => ({ kind, id }));
      await fetchApi('/api/storage-map/trash', { method: 'POST', body: JSON.stringify({ scope, members }) });
      const ids = (kind) => new Set(targets.filter((item) => item.kind === kind).map((item) => item.id));
      setRooms((list) => list.filter((item) => !ids('room').has(item.id)));
      setRacks((list) => list.filter((item) => !ids('rack').has(item.id)));
      setMarkers((list) => list.filter((item) => !ids('marker').has(item.id)));
      pushHistory({ type: 'deleted', members, scope });
      markLocalMutation();
      setSelectedKey(null);
      toast.success('ย้ายไปถังขยะแล้ว');
    } catch (error) {
      toast.error(error?.message || 'ลบไม่สำเร็จ');
    }
  }, [markLocalMutation, pushHistory, scope, selectedEntities, selectedEntity, setSelectedKey]);

  const fitCanvas = useCallback(() => {
    const rect = viewportRef.current?.getBoundingClientRect();
    if (!rect) return;
    const zoom = clamp(Math.min((rect.width - 40) / CANVAS_WIDTH, (rect.height - 40) / CANVAS_HEIGHT), ZOOM_MIN, ZOOM_MAX);
    userZoomedRef.current = false;
    setViewport({ zoom, panX: (rect.width - CANVAS_WIDTH * zoom) / 2, panY: (rect.height - CANVAS_HEIGHT * zoom) / 2 });
  }, []);

  useEffect(() => {
    const frame = requestAnimationFrame(fitCanvas);
    return () => cancelAnimationFrame(frame);
  }, [editMode, fitCanvas, planId, view]);

  useEffect(() => {
    const node = viewportRef.current;
    if (!node || typeof ResizeObserver === 'undefined') return undefined;
    let frame;
    const observer = new ResizeObserver(() => {
      // ผู้ใช้ซูมเองแล้วอย่าไปรีเซ็ตให้ — บนมือถือแถบที่อยู่ซ่อน/โผล่ทำให้ขนาดกล่องเปลี่ยนบ่อยมาก
      if (userZoomedRef.current) return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(fitCanvas);
    });
    observer.observe(node);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [fitCanvas]);

  // ซูมโดยยึด "จุดที่ชี้" ไว้กับที่ (เคอร์เซอร์เมาส์ / จุดกึ่งกลางระหว่าง 2 นิ้ว)
  // factor เป็นตัวคูณ ไม่ใช่ค่าซูมปลายทาง จึงต่อกันได้เรื่อยๆ ระหว่างหมุนล้อรัวๆ โดยไม่อ่านค่าเก่าค้าง
  const zoomBy = useCallback((factor, clientPoint) => {
    const rect = viewportRef.current?.getBoundingClientRect();
    if (!rect) return;
    userZoomedRef.current = true;

    // ล้อเมาส์ยิง event ถี่กว่าที่จอวาดทัน — สะสมไว้แล้วอัปเดตครั้งเดียวต่อเฟรม
    // (เดิม setViewport ทุก event ทำให้วาดผังใหม่ ~60 ครั้ง/วินาที ผังใหญ่ๆ จะหน่วงชัด)
    pendingZoomRef.current = {
      factor: (pendingZoomRef.current?.factor ?? 1) * factor,
      point: clientPoint ?? pendingZoomRef.current?.point ?? null
    };
    if (zoomFrameRef.current) return;
    zoomFrameRef.current = requestAnimationFrame(() => {
      zoomFrameRef.current = null;
      const pending = pendingZoomRef.current;
      pendingZoomRef.current = null;
      if (!pending) return;
      setViewport((current) => {
        const zoom = clamp(current.zoom * pending.factor, ZOOM_MIN, ZOOM_MAX);
        const sx = pending.point?.x ?? rect.width / 2;
        const sy = pending.point?.y ?? rect.height / 2;
        const canvasX = (sx - current.panX) / current.zoom;
        const canvasY = (sy - current.panY) / current.zoom;
        return { zoom, panX: sx - canvasX * zoom, panY: sy - canvasY * zoom };
      });
    });
  }, []);

  const pointFromEvent = useCallback((event) => {
    const rect = viewportRef.current.getBoundingClientRect();
    return screenToCanvas(event, rect, viewport);
  }, [viewport]);

  const beginCanvasDraw = useCallback((event) => {
    if (!editMode || event.button !== 0) return;
    if (!drawType && !rectTool && tool !== 'select') return;
    event.preventDefault();
    event.stopPropagation();
    const point = pointFromEvent(event);
    if (tool === 'select') {
      selectionRef.current = { start: point, current: point };
      setSelectionBox({ left: point.x, top: point.y, right: point.x, bottom: point.y, width: 0, height: 0 });
      movedRef.current = false;
      event.currentTarget.setPointerCapture?.(event.pointerId);
      return;
    }
    // ห้อง/ชั้นวาง: ลากกำหนดขนาดได้เลย (ปล่อยโดยไม่ลาก = ใช้ขนาดมาตรฐานเหมือนเดิม)
    if (rectTool) {
      drawRef.current = { shape: 'rect', kind: rectTool, start: point, current: point };
      setDrawPreview({ shape: 'rect', ...rectFromDrag(point, point, RECT_MIN[rectTool].width, RECT_MIN[rectTool].height, snapEnabled) });
      movedRef.current = false;
      event.currentTarget.setPointerCapture?.(event.pointerId);
      return;
    }
    const thickness = drawType === 'wall' ? 14 : 4;
    drawRef.current = { type: drawType, start: point, current: point, thickness };
    setDrawPreview({ type: drawType, ...segmentGeometry(point, point, thickness, snapEnabled) });
    movedRef.current = true;
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }, [drawType, editMode, pointFromEvent, rectTool, snapEnabled, tool]);

  const beginMove = useCallback((event, entity) => {
    if (!editMode || tool !== 'select' || entity.locked) return;
    event.stopPropagation();
    const key = entityKey(entity);
    const grouped = entity.groupId ? orderedEntities.filter((item) => item.groupId === entity.groupId) : [entity];
    const targets = selectedKeys.includes(key) ? selectedEntities : grouped;
    setSelectedKeys(targets.map(entityKey));
    setPanelTab('inspector');
    const point = pointFromEvent(event);
    movedRef.current = false;
    dragRef.current = {
      mode: 'move',
      primary: entity,
      offsetX: point.x - entity.posX,
      offsetY: point.y - entity.posY,
      dimensions: { width: entity.width || RACK_WIDTH, height: entity.height || RACK_HEIGHT },
      members: targets.filter((item) => !item.locked).map((item) => ({
        kind: item.kind, id: item.id, entity: item,
        before: { posX: item.posX, posY: item.posY },
        latest: { posX: item.posX, posY: item.posY }
      }))
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }, [editMode, orderedEntities, pointFromEvent, selectedEntities, selectedKeys, tool]);

  const beginResize = useCallback((event, entity) => {
    if (!editMode || entity.locked) return;
    event.stopPropagation();
    const point = pointFromEvent(event);
    movedRef.current = false;
    dragRef.current = {
      kind: entity.kind,
      id: entity.id,
      mode: 'resize',
      startX: entity.posX,
      startY: entity.posY,
      before: { width: entity.width, height: entity.height },
      latest: { width: entity.width, height: entity.height },
      pointerStart: point
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }, [editMode, pointFromEvent]);

  // ลากหมุนอิสระ — จุดหมุนของกำแพง/เส้นแบ่งคือปลายด้านเริ่มต้น ส่วนห้อง/ชั้นวางหมุนรอบจุดกึ่งกลาง
  const beginRotate = useCallback((event, entity) => {
    if (!editMode || entity.locked) return;
    event.stopPropagation();
    const pivot = isLinearMarker(entity)
      ? linearStartPoint(entity)
      : { x: Number(entity.posX) + Number(entity.width || 0) / 2, y: Number(entity.posY) + Number(entity.height || 0) / 2 };
    movedRef.current = false;
    dragRef.current = {
      kind: entity.kind,
      id: entity.id,
      mode: 'rotate',
      entity,
      pivot,
      before: { rotation: Number(entity.rotation) || 0, posX: entity.posX, posY: entity.posY },
      latest: { rotation: Number(entity.rotation) || 0 }
    };
    setRotatePreview(Math.round(normalizeAngle(entity.rotation)));
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }, [editMode]);

  const onViewportPointerDown = useCallback((event) => {
    // โหมดดูไม่มีการลากวัตถุ และไม่มีปุ่ม "เลื่อนมุมมอง" ให้กด → บนมือถือให้ลากนิ้วเดียวเลื่อนผังได้เลย
    const touchPan = event.pointerType === 'touch' && !editMode;
    const wantsPan = event.button === 1 || tool === 'pan' || spacePressedRef.current || touchPan;
    if (!wantsPan) return;
    // ไม่ preventDefault ตอนแตะนิ้ว เพราะบางเบราว์เซอร์จะกลืน click ที่ตามมา ทำให้แตะเลือกห้อง/ชั้นไม่ติด
    movedRef.current = false;
    panRef.current = { startX: event.clientX, startY: event.clientY, panX: viewport.panX, panY: viewport.panY };
    if (!touchPan) {
      event.preventDefault();
      event.currentTarget.setPointerCapture?.(event.pointerId);
    }
  }, [editMode, tool, viewport]);

  const onViewportPointerMove = useCallback((event) => {
    if (drawRef.current) {
      const draw = drawRef.current;
      const current = pointFromEvent(event);
      draw.current = current;
      if (draw.shape === 'rect') {
        if (Math.hypot(current.x - draw.start.x, current.y - draw.start.y) > 4) movedRef.current = true;
        setDrawPreview({ shape: 'rect', ...rectFromDrag(draw.start, current, RECT_MIN[draw.kind].width, RECT_MIN[draw.kind].height, snapEnabled) });
        return;
      }
      setDrawPreview({ type: draw.type, ...segmentGeometry(draw.start, current, draw.thickness, snapEnabled) });
      return;
    }
    if (selectionRef.current) {
      const selection = selectionRef.current;
      const current = pointFromEvent(event);
      selection.current = current;
      if (Math.hypot(current.x - selection.start.x, current.y - selection.start.y) > 3) movedRef.current = true;
      const left = Math.min(selection.start.x, current.x);
      const top = Math.min(selection.start.y, current.y);
      const right = Math.max(selection.start.x, current.x);
      const bottom = Math.max(selection.start.y, current.y);
      setSelectionBox({ left, top, right, bottom, width: right - left, height: bottom - top });
      return;
    }
    if (panRef.current) {
      const pan = panRef.current;
      const dx = event.clientX - pan.startX;
      const dy = event.clientY - pan.startY;
      if (Math.abs(dx) + Math.abs(dy) > 2) movedRef.current = true;
      setViewport((current) => ({ ...current, panX: pan.panX + dx, panY: pan.panY + dy }));
      return;
    }
    const drag = dragRef.current;
    if (!drag) return;
    const point = pointFromEvent(event);
    movedRef.current = true;
    if (drag.mode === 'move') {
      let raw = { posX: snapValue(point.x - drag.offsetX, snapEnabled), posY: snapValue(point.y - drag.offsetY, snapEnabled) };
      if (smartGuidesEnabled && !snapEnabled) {
        const memberKeys = new Set(drag.members.map((member) => `${member.kind}:${member.id}`));
        const guide = smartGuidePosition(drag.primary, raw, orderedEntities.filter((item) => !memberKeys.has(entityKey(item))), 6 / viewport.zoom);
        raw = { posX: guide.posX, posY: guide.posY };
        setActiveGuides(guide.guides);
      }
      const primaryNext = clampPosition(drag.primary.kind, raw, drag.dimensions);
      const dx = primaryNext.posX - drag.primary.posX;
      const dy = primaryNext.posY - drag.primary.posY;
      drag.members.forEach((member) => {
        member.latest = clampPosition(member.kind, { posX: member.before.posX + dx, posY: member.before.posY + dy }, entityBounds(member.entity));
        setLocalPatch(member.kind, member.id, member.latest);
      });
    } else if (drag.mode === 'rotate') {
      // กด Shift ระหว่างลาก = ล็อกทีละ 15° (ทำมุมฉาก/45° ได้ตรงเป๊ะ)
      const raw = angleBetween(drag.pivot, point);
      const angle = normalizeAngle(event.shiftKey ? Math.round(raw / 15) * 15 : Math.round(raw));
      drag.latest = isLinearMarker(drag.entity)
        ? rotateAroundStart(drag.entity, angle)
        : { rotation: angle };
      setRotatePreview(angle);
      setLocalPatch(drag.kind, drag.id, drag.latest);
    } else {
      const minWidth = drag.kind === 'room' ? 80 : drag.kind === 'rack' ? 60 : 6;
      const minHeight = drag.kind === 'room' ? 60 : drag.kind === 'rack' ? 40 : 4;
      const width = clamp(snapValue(point.x - drag.startX, snapEnabled), minWidth, CANVAS_WIDTH - drag.startX);
      const height = clamp(snapValue(point.y - drag.startY, snapEnabled), minHeight, CANVAS_HEIGHT - drag.startY);
      drag.latest = { width, height };
      setLocalPatch(drag.kind, drag.id, drag.latest);
    }
  }, [orderedEntities, pointFromEvent, setLocalPatch, smartGuidesEnabled, snapEnabled, viewport.zoom]);

  const createDrawnMarker = useCallback(async (draw) => {
    const geometry = segmentGeometry(draw.start, draw.current, draw.thickness, snapEnabled);
    if (geometry.length < 8) return toast.error('ลากเส้นให้ยาวอย่างน้อย 8px');
    const body = {
      type: draw.type,
      text: null,
      ...(inRoom ? { roomId: currentRoom.id } : { planId }),
      posX: geometry.posX,
      posY: geometry.posY,
      width: geometry.width,
      height: geometry.height,
      rotation: geometry.rotation
    };
    setSavingCount((count) => count + 1);
    try {
      const result = await fetchApi('/api/markers', { method: 'POST', body: JSON.stringify(body) });
      if (result.marker) {
        setMarkers((list) => [...list, result.marker]);
        setSelectedKey(entityKey('marker', result.marker.id));
        setPanelTab('inspector');
        pushHistory({ type: 'created', members: [{ kind: 'marker', id: result.marker.id }], scope });
        markLocalMutation();
      }
      toast.success(draw.type === 'wall' ? 'วาดกำแพงแล้ว' : 'วาดเส้นแบ่งแล้ว');
    } catch {
      toast.error('วาดเส้นไม่สำเร็จ');
    } finally {
      setSavingCount((count) => Math.max(0, count - 1));
    }
  }, [currentRoom, inRoom, markLocalMutation, planId, pushHistory, scope, setSelectedKey, snapEnabled]);

  const createAt = useCallback(async (point, rect = null) => {
    if (!tool.startsWith('add-') || drawType) return;
    let endpoint;
    let body;
    if (tool === 'add-room') {
      if (!creation.name.trim()) return toast.error('กรุณาระบุชื่อห้องก่อนวาง');
      endpoint = '/api/rooms';
      const dimensions = rect ? { width: rect.width, height: rect.height } : { width: 240, height: 160 };
      const placement = rect ? { posX: rect.posX, posY: rect.posY } : placementAtPoint('room', point, dimensions, snapEnabled);
      body = { name: creation.name.trim(), isStorage: creation.isStorage, planId, ...dimensions, ...placement };
    } else if (tool === 'add-rack') {
      if (!creation.name.trim()) return toast.error('กรุณาระบุชื่อชั้นวางก่อนวาง');
      endpoint = '/api/racks';
      const dimensions = rect ? { width: rect.width, height: rect.height } : { width: RACK_WIDTH, height: RACK_HEIGHT };
      const placement = rect ? { posX: rect.posX, posY: rect.posY } : placementAtPoint('rack', point, dimensions, snapEnabled);
      body = {
        name: creation.name.trim(),
        isFloor: creation.isFloor,
        projectId: creation.isFloor ? (creation.projectId || null) : null,
        levels: creation.isFloor ? 1 : (Number(creation.levels) || 1),
        capacity: Number(creation.capacity) || 100,
        ...dimensions, ...(inRoom ? { roomId: currentRoom.id } : { planId }), ...placement
      };
    } else {
      const type = tool.replace('add-marker-', '');
      const dimensions = MARKER_SIZE[type] || MARKER_SIZE.line;
      endpoint = '/api/markers';
      body = { type, text: type === 'label' ? creation.text.trim() : null, ...(inRoom ? { roomId: currentRoom.id } : { planId }), ...dimensions, ...placementAtPoint('marker', point, dimensions, snapEnabled) };
    }
    setSavingCount((count) => count + 1);
    try {
      const result = await fetchApi(endpoint, { method: 'POST', body: JSON.stringify(body) });
      if (result.room) {
        setRooms((list) => [...list, result.room]);
        setSelectedKey(entityKey('room', result.room.id));
        pushHistory({ type: 'created', members: [{ kind: 'room', id: result.room.id }], scope });
      } else if (result.rack) {
        setRacks((list) => [...list, result.rack]);
        setSelectedKey(entityKey('rack', result.rack.id));
        pushHistory({ type: 'created', members: [{ kind: 'rack', id: result.rack.id }], scope });
      } else if (result.marker) {
        setMarkers((list) => [...list, result.marker]);
        setSelectedKey(entityKey('marker', result.marker.id));
        pushHistory({ type: 'created', members: [{ kind: 'marker', id: result.marker.id }], scope });
      }
      markLocalMutation();
      setTool('select');
      setCreation((current) => ({ ...current, name: '', text: '' }));
      setPanelTab('inspector');
      toast.success('เพิ่มลงผังแล้ว');
    } catch {
      toast.error('เพิ่มองค์ประกอบไม่สำเร็จ');
    } finally {
      setSavingCount((count) => Math.max(0, count - 1));
    }
  }, [creation, currentRoom, drawType, inRoom, markLocalMutation, planId, pushHistory, scope, setSelectedKey, snapEnabled, tool]);

  const endPointerAction = useCallback(() => {
    panRef.current = null;
    const selection = selectionRef.current;
    selectionRef.current = null;
    setSelectionBox(null);
    if (selection) {
      if (movedRef.current) {
        const left = Math.min(selection.start.x, selection.current.x);
        const top = Math.min(selection.start.y, selection.current.y);
        const right = Math.max(selection.start.x, selection.current.x);
        const bottom = Math.max(selection.start.y, selection.current.y);
        setSelectedKeys(orderedEntities.filter((entity) => intersectsSelection(entity, { left, top, right, bottom })).map(entityKey));
      }
      return;
    }
    const draw = drawRef.current;
    drawRef.current = null;
    setDrawPreview(null);
    if (draw) {
      if (draw.shape === 'rect') {
        // ลากแล้ว = ใช้ขนาดที่ลาก, แค่คลิก = ขนาดมาตรฐานตามตำแหน่งที่คลิก
        const rect = movedRef.current
          ? rectFromDrag(draw.start, draw.current, RECT_MIN[draw.kind].width, RECT_MIN[draw.kind].height, snapEnabled)
          : null;
        createAt(draw.start, rect);
        return;
      }
      createDrawnMarker(draw);
      return;
    }
    const drag = dragRef.current;
    dragRef.current = null;
    setActiveGuides({ x: null, y: null });
    setRotatePreview(null);
    if (drag && movedRef.current) {
      if (drag.mode === 'move') {
        const changes = drag.members.map((member) => ({ kind: member.kind, id: member.id, patch: member.latest }));
        const before = drag.members.map((member) => ({ kind: member.kind, id: member.id, patch: member.before }));
        saveBulkChanges(changes, { before });
      } else savePatch(drag.kind, drag.id, drag.latest, { before: drag.before });
    }
  }, [createAt, createDrawnMarker, orderedEntities, saveBulkChanges, savePatch, snapEnabled]);

  // rect = กรอบที่ผู้ใช้ลากกำหนดเอง (ถ้าไม่ส่งมา ใช้ขนาดมาตรฐานโดยวางกึ่งกลางที่จุดคลิก)

  const onCanvasClick = useCallback((event) => {
    setContextMenu(null);
    if (movedRef.current) { movedRef.current = false; return; }
    if (!editMode) return;
    // ห้อง/ชั้นวางสร้างตอนปล่อยเมาส์ใน endPointerAction แล้ว (รองรับลากกำหนดขนาด) — กันสร้างซ้ำ
    if (tool.startsWith('add-') && !rectTool) createAt(pointFromEvent(event));
    else if (!tool.startsWith('add-')) setSelectedKey(null);
  }, [createAt, editMode, pointFromEvent, rectTool, setSelectedKey, tool]);

  // ซูม/เลื่อนผังด้วยล้อเมาส์และ 2 นิ้ว
  // ต้องผูกเป็น listener แบบ native เพราะ React ผูก wheel/touch ไว้เป็นแบบ passive ที่ root
  // เรียก preventDefault() ใน onWheel ของ React จึงไม่มีผล (หน้าเว็บจะเลื่อน/ซูมทั้งหน้าแทนที่จะซูมผัง)
  useEffect(() => {
    const node = viewportRef.current;
    if (!node) return undefined;
    const points = touchPointsRef.current;
    const localPoint = (event) => {
      const rect = node.getBoundingClientRect();
      return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    };

    // ล้อเมาส์/ปัดสองนิ้วบนแทร็คแพด = ซูมเข้า-ออกตรงตำแหน่งเคอร์เซอร์ (ไม่ต้องกด Ctrl)
    const onWheel = (event) => {
      event.preventDefault();
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 100 : 1; // 1 = บรรทัด, 2 = หน้า
      // ท่าหุบนิ้วบนแทร็คแพด Mac ส่งมาเป็น wheel + ctrlKey และค่า delta เล็กกว่ามาก จึงต้องไวกว่า
      const speed = event.ctrlKey ? 0.02 : 0.0015;
      zoomBy(Math.exp(-event.deltaY * unit * speed), localPoint(event));
    };

    const twoFingerState = () => {
      const [a, b] = [...points.values()];
      return {
        distance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
        center: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
      };
    };

    const onPointerDown = (event) => {
      if (event.pointerType !== 'touch') return;
      points.set(event.pointerId, localPoint(event));
      if (points.size !== 2) return;
      // นิ้วที่ 2 แตะลงมา = เปลี่ยนเป็นท่าหุบ/กาง — ปิดงานที่นิ้วแรกทำค้างไว้ให้เรียบร้อยก่อน
      // stopPropagation กันไม่ให้ handler ของ React (ที่ผูกไว้ที่ root) เริ่มลากวัตถุด้วยนิ้วที่ 2
      event.stopPropagation();
      endPointerActionRef.current?.();
      pinchRef.current = twoFingerState();
    };

    const onPointerMove = (event) => {
      if (event.pointerType !== 'touch' || !points.has(event.pointerId)) return;
      points.set(event.pointerId, localPoint(event));
      if (!pinchRef.current || points.size < 2) return;
      event.preventDefault();
      event.stopPropagation();
      const previous = pinchRef.current;
      const next = twoFingerState();
      pinchRef.current = next;
      movedRef.current = true; // ปล่อยนิ้วแล้วอย่านับเป็นการคลิกเลือกห้อง/ชั้น
      userZoomedRef.current = true;
      setViewport((current) => {
        const zoom = clamp(current.zoom * (next.distance / previous.distance), ZOOM_MIN, ZOOM_MAX);
        // ตรึงจุดบนผังที่อยู่ใต้กึ่งกลางนิ้วเดิม ให้มาอยู่ใต้กึ่งกลางนิ้วใหม่
        // สูตรเดียวจบทั้งซูมและเลื่อน — สองนิ้วจึงลากผังไปมาได้ด้วยในตัว
        const canvasX = (previous.center.x - current.panX) / current.zoom;
        const canvasY = (previous.center.y - current.panY) / current.zoom;
        return { zoom, panX: next.center.x - canvasX * zoom, panY: next.center.y - canvasY * zoom };
      });
    };

    const dropPointer = (event) => {
      if (event.pointerType !== 'touch') return;
      points.delete(event.pointerId);
      // เหลือ 2 นิ้วพอดี (เมื่อกี้ใช้ 3 นิ้ว) ต้องตั้งระยะอ้างอิงใหม่ ไม่งั้นผังจะกระโดด
      if (points.size >= 2) pinchRef.current = twoFingerState();
      else pinchRef.current = null;
      // ปกติ click ที่ตามมาจะล้างธง "เพิ่งลาก" ให้เอง แต่ถ้าไม่มี click ตามมาธงจะค้าง
      // แล้วไปกลืนการแตะครั้งถัดไป — ตั้ง timeout 0 ให้ล้างหลัง click รอบนี้ผ่านไปแล้ว
      if (points.size === 0) window.setTimeout(() => { movedRef.current = false; }, 0);
    };

    // Safari บน iOS มี gesture ซูมของตัวเองซ้อนมาอีกชั้น ต้องปิดไม่ให้ไปซูมทั้งหน้าเว็บ
    const blockGesture = (event) => event.preventDefault();

    node.addEventListener('wheel', onWheel, { passive: false });
    node.addEventListener('pointerdown', onPointerDown);
    node.addEventListener('pointermove', onPointerMove, { passive: false });
    node.addEventListener('pointerup', dropPointer);
    node.addEventListener('pointercancel', dropPointer);
    node.addEventListener('gesturestart', blockGesture);
    node.addEventListener('gesturechange', blockGesture);
    return () => {
      node.removeEventListener('wheel', onWheel);
      node.removeEventListener('pointerdown', onPointerDown);
      node.removeEventListener('pointermove', onPointerMove);
      node.removeEventListener('pointerup', dropPointer);
      node.removeEventListener('pointercancel', dropPointer);
      node.removeEventListener('gesturestart', blockGesture);
      node.removeEventListener('gesturechange', blockGesture);
      points.clear();
      pinchRef.current = null;
    };
  }, [zoomBy]);

  useEffect(() => { endPointerActionRef.current = endPointerAction; }, [endPointerAction]);

  // ส่งเป็น callback คงที่เข้า CanvasEntity — ถ้าสร้างใหม่ทุก render จะทำให้ memo ไร้ผล
  const rotateEntityStep = useCallback((entity) => {
    savePatch(entity.kind, entity.id, { rotation: ((Number(entity.rotation) || 0) + 15) % 360 });
  }, [savePatch]);

  const selectEntityFromCanvas = useCallback((item, event) => {
    // เพิ่งลากเลื่อน/ซูมผังอยู่ ไม่ใช่ตั้งใจแตะเลือก — กลืนคลิกนี้ทิ้งแล้วเริ่มนับใหม่
    if (movedRef.current) { movedRef.current = false; return; }
    selectEntity(item, event);
  }, [selectEntity]);

  const moveSelectedLayer = useCallback((action) => {
    if (!selectedKey || selectedEntity?.locked) return;
    saveLayerOrder(moveLayer(orderedEntities, selectedKey, action));
  }, [orderedEntities, saveLayerOrder, selectedEntity, selectedKey]);

  const runSelectionLayout = useCallback((mode) => {
    if (selectedEntities.length < 2) return;
    const changes = mode === 'horizontal' || mode === 'vertical'
      ? distributeSelection(selectedEntities, mode)
      : alignSelection(selectedEntities, mode);
    saveBulkChanges(changes);
  }, [saveBulkChanges, selectedEntities]);

  const groupSelection = useCallback(async () => {
    if (selectedEntities.length < 2) return;
    const members = selectedEntities.map(({ kind, id }) => ({ kind, id }));
    try {
      const result = await fetchApi('/api/storage-map/groups', { method: 'PUT', body: JSON.stringify({ scope, members }) });
      selectedEntities.forEach((entity) => setLocalPatch(entity.kind, entity.id, { groupId: result.groupId }));
      markLocalMutation();
      toast.success('Group Components แล้ว');
    } catch (error) { toast.error(error?.message || 'Group ไม่สำเร็จ'); }
  }, [markLocalMutation, scope, selectedEntities, setLocalPatch]);

  const ungroupSelection = useCallback(async () => {
    const targets = selectedEntities.filter((entity) => entity.groupId);
    if (!targets.length) return;
    const members = targets.map(({ kind, id }) => ({ kind, id }));
    try {
      await fetchApi('/api/storage-map/groups', { method: 'DELETE', body: JSON.stringify({ scope, members }) });
      targets.forEach((entity) => setLocalPatch(entity.kind, entity.id, { groupId: null }));
      markLocalMutation();
      toast.success('ยกเลิก Group แล้ว');
    } catch (error) { toast.error(error?.message || 'Ungroup ไม่สำเร็จ'); }
  }, [markLocalMutation, scope, selectedEntities, setLocalPatch]);

  const patchSelection = useCallback((patchFactory) => {
    const changes = selectedEntities.map((entity) => ({
      kind: entity.kind,
      id: entity.id,
      patch: typeof patchFactory === 'function' ? patchFactory(entity) : patchFactory
    }));
    saveBulkChanges(changes);
  }, [saveBulkChanges, selectedEntities]);

  const copySelection = useCallback(() => {
    if (!selectedEntities.length) return;
    clipboardRef.current = selectedEntities.map((entity) => ({ ...entity }));
    toast.success(`คัดลอก ${selectedEntities.length} Component`);
  }, [selectedEntities]);

  const duplicateSelection = useCallback(async (sources = selectedEntities) => {
    const allowed = sources.filter((source) => !(inRoom && source.kind === 'room'));
    if (!allowed.length) return;
    setSavingCount((count) => count + 1);
    const created = [];
    const suffix = Date.now().toString().slice(-4);
    try {
      for (const source of allowed) {
        let endpoint;
        let body;
        const position = clampPosition(source.kind, { posX: Number(source.posX) + 24, posY: Number(source.posY) + 24 }, entityBounds(source));
        if (source.kind === 'room') {
          endpoint = '/api/rooms';
          body = { name: `${source.name} copy ${suffix}`, isStorage: source.isStorage, planId, width: source.width, height: source.height, ...position };
        } else if (source.kind === 'rack') {
          endpoint = '/api/racks';
          body = { name: `${source.name} copy ${suffix}`, levels: source.levels, capacity: source.capacity || 100, width: source.width || RACK_WIDTH, height: source.height || RACK_HEIGHT, ...(inRoom ? { roomId: currentRoom.id } : { planId }), ...position };
        } else {
          endpoint = '/api/markers';
          body = { type: source.type, text: source.text, width: source.width, height: source.height, rotation: source.rotation, ...(inRoom ? { roomId: currentRoom.id } : { planId }), ...position };
        }
        const result = await fetchApi(endpoint, { method: 'POST', body: JSON.stringify(body) });
        const entity = result.room ? { ...result.room, kind: 'room' } : result.rack ? { ...result.rack, kind: 'rack' } : { ...result.marker, kind: 'marker' };
        created.push(entity);
      }
      const roomsCreated = created.filter((entity) => entity.kind === 'room');
      const racksCreated = created.filter((entity) => entity.kind === 'rack');
      const markersCreated = created.filter((entity) => entity.kind === 'marker');
      if (roomsCreated.length) setRooms((list) => [...list, ...roomsCreated]);
      if (racksCreated.length) setRacks((list) => [...list, ...racksCreated]);
      if (markersCreated.length) setMarkers((list) => [...list, ...markersCreated]);
      const members = created.map(({ kind, id }) => ({ kind, id }));
      setSelectedKeys(created.map(entityKey));
      if (created.length > 1) {
        const grouped = await fetchApi('/api/storage-map/groups', { method: 'PUT', body: JSON.stringify({ scope, members }) });
        created.forEach((entity) => setLocalPatch(entity.kind, entity.id, { groupId: grouped.groupId }));
      }
      pushHistory({ type: 'created', members, scope });
      markLocalMutation();
      toast.success(`สร้างสำเนา ${created.length} Component`);
    } catch (error) {
      await reloadContext();
      toast.error(error?.message || 'สร้างสำเนาไม่สำเร็จ');
    } finally { setSavingCount((count) => Math.max(0, count - 1)); }
  }, [currentRoom, inRoom, markLocalMutation, planId, pushHistory, reloadContext, scope, selectedEntities, setLocalPatch]);

  const zoomToSelection = useCallback(() => {
    const bounds = selectionBounds(selectedEntities);
    const rect = viewportRef.current?.getBoundingClientRect();
    if (!bounds || !rect) return;
    viewportHistoryRef.current.push(viewport);
    const zoom = clamp(Math.min((rect.width - 100) / Math.max(80, bounds.width), (rect.height - 100) / Math.max(60, bounds.height)), ZOOM_MIN, ZOOM_MAX);
    setViewport({ zoom, panX: rect.width / 2 - bounds.centerX * zoom, panY: rect.height / 2 - bounds.centerY * zoom });
  }, [selectedEntities, viewport]);

  const previousViewport = useCallback(() => {
    const previous = viewportHistoryRef.current.pop();
    if (previous) setViewport(previous);
  }, []);

  const nudgeSelected = useCallback((dx, dy) => {
    const changes = selectedEntities.filter((entity) => !entity.locked).map((entity) => ({
      kind: entity.kind,
      id: entity.id,
      patch: clampPosition(entity.kind, { posX: entity.posX + dx, posY: entity.posY + dy }, entityBounds(entity))
    }));
    saveBulkChanges(changes);
  }, [saveBulkChanges, selectedEntities]);

  useEffect(() => {
    const onKeyDown = (event) => {
      const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName);
      if (event.code === 'Space' && !typing) { spacePressedRef.current = true; event.preventDefault(); }
      if (!editMode || typing) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) redo(); else undo();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'c') { event.preventDefault(); copySelection(); return; }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'v') { event.preventDefault(); duplicateSelection(clipboardRef.current); return; }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'd') { event.preventDefault(); duplicateSelection(); return; }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'g') { event.preventDefault(); if (event.shiftKey) ungroupSelection(); else groupSelection(); return; }
      if (event.key === 'Escape') { setTool('select'); setSelectedKey(null); }
      if ((event.key === 'Delete' || event.key === 'Backspace') && selectedEntity) { event.preventDefault(); deleteEntity(selectedEntity); }
      if (event.key === '0') { event.preventDefault(); fitCanvas(); }
      const step = event.shiftKey ? GRID_SIZE : 1;
      if (event.key === 'ArrowLeft') { event.preventDefault(); nudgeSelected(-step, 0); }
      if (event.key === 'ArrowRight') { event.preventDefault(); nudgeSelected(step, 0); }
      if (event.key === 'ArrowUp') { event.preventDefault(); nudgeSelected(0, -step); }
      if (event.key === 'ArrowDown') { event.preventDefault(); nudgeSelected(0, step); }
    };
    const onKeyUp = (event) => { if (event.code === 'Space') spacePressedRef.current = false; };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [copySelection, deleteEntity, duplicateSelection, editMode, fitCanvas, groupSelection, nudgeSelected, redo, selectedEntity, setSelectedKey, undo, ungroupSelection]);

  // เลื่อนผังไปยังชั้นวางที่ระบุ (สลับคลัง/เข้าห้องให้อัตโนมัติ) — ใช้ร่วมกันทั้งค้นหา SKU และเส้นทางหยิบของ
  const gotoRack = useCallback(async (rackId, { open = true, level = null, sku = null } = {}) => {
    const rackResult = await fetchApi(`/api/racks/${rackId}`).catch(() => ({}));
    const rack = rackResult.success && rackResult.rack;
    if (!rack) return false;
    if (rack.planId) setPlanId(rack.planId);
    if (rack.roomId) {
      const roomResult = await fetchApi(`/api/rooms?plan=${rack.planId}`).catch(() => ({}));
      const room = roomResult.success && roomResult.rooms.find((item) => item.id === rack.roomId);
      if (room) { setCurrentRoom(room); setView('room'); await loadRoom(room.id); }
    } else {
      setCurrentRoom(null);
      setView('floor');
      await loadFloor(rack.planId);
    }
    setHighlight({ rackId, level, sku });
    if (open) setOpenRackId(rackId);
    return true;
  }, [loadFloor, loadRoom]);

  useEffect(() => {
    const sku = searchParams.get('highlight');
    if (!sku) return;
    let alive = true;
    (async () => {
      const productResult = await fetchApi(`/api/products?search=${encodeURIComponent(sku)}&limit=1`).catch(() => ({}));
      const product = productResult.success && productResult.products?.[0];
      if (!alive) return;
      if (!product?.rackId) { toast('สินค้านี้ยังไม่ได้ระบุตำแหน่งจัดเก็บ', { icon: '📍' }); return; }
      await gotoRack(product.rackId, { level: product.storageLevel || null, sku: product.sku });
    })();
    return () => { alive = false; };
  }, [searchParams, gotoRack]);

  // โหลดเส้นทางหยิบของเมื่อเปิดด้วย ?pick=<เลขที่ใบเบิก> แล้วพาไปจุดแวะแรกให้เลย
  useEffect(() => {
    const txId = searchParams.get('pick');
    if (!txId) { setPickList(null); return; }
    let alive = true;
    (async () => {
      const result = await fetchApi(`/api/storage-map/pick-list/${encodeURIComponent(txId)}`).catch(() => ({}));
      if (!alive || !result.success) return;
      setPickList(result);
      setPickedKeys([]);
      setPickPanelOpen(true);
      const first = result.items?.[0];
      if (first?.rackId) await gotoRack(first.rackId, { open: false, level: first.storageLevel, sku: first.sku });
      else if (result.unlocated?.length) toast('สินค้าในใบนี้ยังไม่ได้ระบุตำแหน่งจัดเก็บ', { icon: '📍' });
    })();
    return () => { alive = false; };
  }, [searchParams, gotoRack]);

  useEffect(() => {
    fetchApi('/api/projects').then((result) => { if (result.success) setProjects(result.projects || []); }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!planId) { setStorageRooms([]); return; }
    let alive = true;
    fetchApi(`/api/rooms?plan=${planId}`)
      .then((result) => { if (alive && result.success) setStorageRooms(result.rooms.filter((room) => room.isStorage)); })
      .catch(() => {});
    return () => { alive = false; };
  }, [planId, racks]);

  // ชั้นวางที่ต้องแวะ → ลำดับจุดแวะ (ใช้ติดป้ายตัวเลขบนผัง)
  const pickStops = useMemo(() => {
    const map = new Map();
    for (const item of pickList?.items || []) if (!map.has(item.rackId)) map.set(item.rackId, item.stop);
    return map;
  }, [pickList]);

  // ชั้นที่หยิบครบทุกรายการแล้ว → เปลี่ยนป้ายเป็นเครื่องหมายถูก
  const doneStops = useMemo(() => {
    const byRack = new Map();
    for (const item of pickList?.items || []) {
      const current = byRack.get(item.rackId) || { total: 0, done: 0 };
      current.total += 1;
      if (pickedKeys.includes(item.pickKey || item.sku)) current.done += 1;
      byRack.set(item.rackId, current);
    }
    return new Set([...byRack.entries()].filter(([, v]) => v.total > 0 && v.total === v.done).map(([k]) => k));
  }, [pickList, pickedKeys]);

  const closePickList = useCallback(() => {
    setPickList(null);
    setPickedKeys([]);
    const params = new URLSearchParams(searchParams);
    params.delete('pick');
    setSearchParams(params, { replace: true });
  }, [searchParams, setSearchParams]);

  useEffect(() => {
    const query = locateSku.trim().toLowerCase();
    if (query.length < 2) { setSearchResults([]); return undefined; }
    let alive = true;
    const timer = setTimeout(async () => {
      const entityResults = orderedEntities
        .filter((entity) => `${entityTitle(entity)} ${KIND_LABEL[entity.kind]}`.toLowerCase().includes(query))
        .slice(0, 6)
        .map((entity) => ({ type: 'entity', key: entityKey(entity), label: entityTitle(entity), detail: KIND_LABEL[entity.kind], entity }));
      const productResult = await fetchApi(`/api/products?search=${encodeURIComponent(query)}&limit=6`).catch(() => ({}));
      if (!alive) return;
      const products = (productResult.products || []).map((product) => ({
        type: 'sku', key: `sku:${product.sku || product.itemId}`,
        label: product.sku || product.itemId, detail: product.name || product.itemName || 'สินค้า', product
      }));
      setSearchResults([...entityResults, ...products].slice(0, 10));
      setSearchOpen(true);
    }, 180);
    return () => { alive = false; clearTimeout(timer); };
  }, [locateSku, orderedEntities]);

  const chooseSearchResult = useCallback((result) => {
    setSearchOpen(false);
    if (result.type === 'sku') {
      setSearchParams({ highlight: result.product.sku || result.product.itemId });
      return;
    }
    setSelectedKey(result.key);
    setPanelTab('inspector');
    const rect = viewportRef.current?.getBoundingClientRect();
    const bounds = entityBounds(result.entity);
    if (rect) {
      viewportHistoryRef.current.push(viewport);
      const zoom = Math.max(viewport.zoom, 1);
      setViewport({ zoom, panX: rect.width / 2 - bounds.centerX * zoom, panY: rect.height / 2 - bounds.centerY * zoom });
    }
  }, [setSearchParams, setSelectedKey, viewport]);

  const loadWorkflow = useCallback(async () => {
    if (!planId) return;
    const [versionResult, trashResult, historyResult] = await Promise.all([
      fetchApi(`/api/floor-plans/${planId}/versions`).catch(() => ({})),
      fetchApi(`/api/storage-map/trash?plan=${planId}`).catch(() => ({})),
      fetchApi(`/api/floor-plans/${planId}/history`).catch(() => ({}))
    ]);
    if (versionResult.success) setVersions(versionResult.versions);
    if (trashResult.success) setTrashItems(trashResult.items);
    if (historyResult.success) setStorageHistory(historyResult.history);
  }, [planId]);

  useEffect(() => { if (workflowOpen) loadWorkflow(); }, [loadWorkflow, workflowOpen]);

  useEffect(() => {
    if (!planId) return undefined;
    let knownRevision = currentPlan?.revision || null;
    let alive = true;
    const poll = async () => {
      const result = await fetchApi(`/api/floor-plans/${planId}/layout-meta`).catch(() => ({}));
      if (!alive || !result.success) return;
      if (knownRevision != null && result.meta.revision !== knownRevision) {
        if (Date.now() - lastLocalSaveRef.current > 20000) setRemoteChanged(true);
      }
      knownRevision = result.meta.revision;
    };
    const interval = setInterval(poll, 15000);
    return () => { alive = false; clearInterval(interval); };
  }, [currentPlan?.revision, planId]);

  const publishCurrentPlan = useCallback(async () => {
    try {
      await fetchApi(`/api/floor-plans/${planId}/publish`, { method: 'POST', body: JSON.stringify({}) });
      lastLocalSaveRef.current = Date.now();
      await Promise.all([loadPlans(), loadWorkflow()]);
      toast.success('Publish ผังและสร้าง Version แล้ว');
    } catch (error) { toast.error(error?.message || 'Publish ไม่สำเร็จ'); }
  }, [loadPlans, loadWorkflow, planId]);

  const restoreLayoutVersion = useCallback(async (version) => {
    const confirmed = await confirmDialog({ title: `กู้คืน ${version.name}`, message: 'ผังปัจจุบันจะถูกแทนที่และกลับเป็น Draft', confirmText: 'กู้คืน', danger: true });
    if (!confirmed) return;
    try {
      await fetchApi(`/api/floor-plans/${planId}/versions/${version.id}/restore`, { method: 'POST', body: JSON.stringify({}) });
      markLocalMutation();
      await Promise.all([reloadContext(), loadPlans(), loadWorkflow()]);
      toast.success('กู้คืน Version แล้ว');
    } catch (error) { toast.error(error?.message || 'กู้คืน Version ไม่สำเร็จ'); }
  }, [loadPlans, loadWorkflow, markLocalMutation, planId, reloadContext]);

  const restoreTrashItem = useCallback(async (item) => {
    try {
      await fetchApi('/api/storage-map/trash/restore', { method: 'POST', body: JSON.stringify({ members: [{ kind: item.kind, id: item.id }] }) });
      markLocalMutation();
      await Promise.all([reloadContext(), loadWorkflow()]);
      toast.success('กู้คืน Component แล้ว');
    } catch (error) { toast.error(error?.message || 'กู้คืนไม่สำเร็จ'); }
  }, [loadWorkflow, markLocalMutation, reloadContext]);

  const switchPlan = (nextPlanId) => {
    setPlanId(nextPlanId);
    setView('floor');
    setCurrentRoom(null);
    setSelectedKey(null);
    setTool('select');
  };

  const backToFloor = () => {
    setView('floor');
    setCurrentRoom(null);
    setSelectedKey(null);
    setTool('select');
    loadFloor(planId);
  };

  const toggleEdit = () => {
    setEditMode((current) => {
      const next = !current;
      if (!next) { setSelectedKey(null); setTool('select'); }
      return next;
    });
  };

  const addPlan = async () => {
    const name = newPlan.trim();
    if (!name) return;
    const result = await fetchApi('/api/floor-plans', { method: 'POST', body: JSON.stringify({ name }) }).catch(() => ({}));
    if (result.success) {
      setNewPlan('');
      await loadPlans();
      switchPlan(result.plan.id);
      toast.success(`เพิ่มคลัง ${name}`);
    }
  };

  const renamePlan = async (plan, nextName) => {
    const name = String(nextName || '').trim();
    if (!name || name === plan.name) return;
    try {
      const result = await fetchApi(`/api/floor-plans/${plan.id}`, { method: 'PUT', body: JSON.stringify({ name }) });
      if (result.success) {
        setPlans((list) => list.map((item) => item.id === plan.id ? { ...item, name } : item));
        toast.success('เปลี่ยนชื่อคลังแล้ว');
      }
    } catch {
      await loadPlans();
      toast.error('เปลี่ยนชื่อคลังไม่สำเร็จ');
    }
  };

  const deletePlan = async (plan) => {
    const confirmed = await confirmDialog({ title: 'ลบคลัง', message: `ลบคลัง “${plan.name}” หรือไม่?`, confirmText: 'ลบ', danger: true });
    if (!confirmed) return;
    try {
      await fetchApi(`/api/floor-plans/${plan.id}`, { method: 'DELETE' });
      const rest = plans.filter((item) => item.id !== plan.id);
      setPlans(rest);
      if (planId === plan.id) switchPlan(rest[0]?.id || null);
      toast.success('ลบคลังแล้ว');
    } catch (error) {
      toast.error(error?.message || 'ลบคลังไม่สำเร็จ');
    }
  };

  // ย้ายชั้นวางไปห้องอื่น/ออกมาเป็นชั้นลอย — สินค้าบนชั้นย้ายตามไปเอง
  const moveRackTo = useCallback(async (entity, roomId) => {
    if (entity.locked) return toast.error('ปลดล็อก Component ก่อนย้าย');
    setSavingCount((count) => count + 1);
    try {
      const result = await fetchApi(`/api/racks/${entity.id}/move`, {
        method: 'PUT',
        body: JSON.stringify({ roomId, planId })
      });
      if (result.success) {
        toast.success(result.message);
        if (result.moved) {
          setSelectedKeys([]);
          markLocalMutation();
          await reloadContext();
        }
      }
    } catch (error) {
      toast.error(error?.message || 'ย้ายชั้นวางไม่สำเร็จ');
    } finally {
      setSavingCount((count) => Math.max(0, count - 1));
    }
  }, [markLocalMutation, planId, reloadContext]);

  const renderPanel = (
    <div className="flex h-full min-h-0 flex-col">
      <div className="tabs tabs-boxed m-2 mb-0 grid grid-cols-2">
        <button className={`tab gap-1 ${panelTab === 'inspector' ? 'tab-active' : ''}`} onClick={() => setPanelTab('inspector')}><FiEdit3 /> Inspector</button>
        <button className={`tab gap-1 ${panelTab === 'layers' ? 'tab-active' : ''}`} onClick={() => setPanelTab('layers')}><FiLayers /> Layers</button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {panelTab === 'inspector'
          ? (selectedEntities.length > 1
            ? <MultiInspector
              entities={selectedEntities}
              saving={savingCount > 0}
              onAlign={runSelectionLayout}
              onGroup={groupSelection}
              onUngroup={ungroupSelection}
              onPatch={patchSelection}
              onCopy={copySelection}
              onDuplicate={() => duplicateSelection()}
              onZoom={zoomToSelection}
              onDelete={() => deleteEntity(selectedEntity)}
            />
            : <InspectorPanel
              entity={selectedEntity}
              saving={savingCount > 0}
              storageRooms={storageRooms.filter((room) => room.id !== currentRoom?.id)}
              projects={projects}
              onMoveRack={canEdit ? moveRackTo : undefined}
              onPatch={(patch) => selectedEntity && savePatch(selectedEntity.kind, selectedEntity.id, patch)}
              onLayer={moveSelectedLayer}
              onDelete={() => deleteEntity(selectedEntity)}
              onOpen={() => selectedEntity && openEntity(selectedEntity)}
            />)
          : <LayersPanel entities={orderedEntities} selectedKey={selectedKey} onSelect={(entity) => { setSelectedKey(entityKey(entity)); setPanelTab('inspector'); }} />}
      </div>
    </div>
  );

  return (
    <div className="flex h-full min-h-0 flex-col gap-2 animate-fade-in">
      <header className="glass-panel shrink-0 rounded-xl px-3 py-2">
        <div className="flex flex-col gap-2 xl:flex-row xl:items-center xl:justify-between">
          <div className="min-w-0">
            <div className="mb-1 flex items-center gap-2 text-xs text-base-content/50">
              <FiMap /> ผังคลัง
              {inRoom && <><span>/</span><span className="truncate">{currentRoom.name}</span></>}
            </div>
            <div className="flex items-center gap-2">
              <h1 className="truncate text-xl font-bold text-gradient">{inRoom ? currentRoom.name : 'ผังคลังสินค้า'}</h1>
              {!inRoom && <span className={`badge badge-sm ${currentPlan?.status === 'published' ? 'badge-success' : 'badge-warning'}`}>{currentPlan?.status === 'published' ? 'Published' : 'Draft'}</span>}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {inRoom ? (
              <button className="btn btn-sm btn-ghost" onClick={backToFloor}><FiArrowLeft /> กลับผังคลัง</button>
            ) : (
              <div className="join">
                <select className="select select-bordered select-sm join-item" value={planId || ''} onChange={(event) => switchPlan(Number(event.target.value))}>
                  {plans.map((plan) => <option key={plan.id} value={plan.id}>{plan.name}</option>)}
                </select>
                {canEdit && <button className="btn btn-sm btn-ghost join-item" onClick={() => setPlanManage(true)} title="จัดการคลัง"><FiSettings /></button>}
              </div>
            )}

            <form
              className="join relative"
              onSubmit={(event) => { event.preventDefault(); if (locateSku.trim()) setSearchParams({ highlight: locateSku.trim() }); }}
            >
              <label className="input input-bordered input-sm join-item flex items-center gap-2">
                <FiSearch className="opacity-50" />
                <input className="w-28 sm:w-44" placeholder="ค้นหาห้อง ชั้น Component หรือ SKU" value={locateSku} onFocus={() => setSearchOpen(true)} onChange={(event) => setLocateSku(event.target.value)} />
              </label>
              <button className="btn btn-sm btn-primary join-item" type="submit">ค้นหา</button>
              {searchOpen && searchResults.length > 0 && (
                <div className="absolute left-0 top-full z-100 mt-1 w-80 overflow-hidden rounded-xl border border-base-300 bg-base-100 p-1 shadow-2xl">
                  {searchResults.map((result) => (
                    <button key={result.key} type="button" className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left hover:bg-base-200" onClick={() => chooseSearchResult(result)}>
                      <span className="truncate text-sm font-semibold">{result.label}</span><span className="ml-3 shrink-0 text-xs text-base-content/45">{result.detail}</span>
                    </button>
                  ))}
                </div>
              )}
            </form>

            {canEdit && (
              <button className="btn btn-sm btn-outline" onClick={() => setUnassignedOpen(true)} title="สินค้าที่ยังไม่ได้กำหนดตำแหน่งจัดเก็บ"><FiPackage /> ยังไม่ระบุตำแหน่ง</button>
            )}

            {canEdit && !inRoom && (
              <button className="btn btn-sm btn-outline" onClick={() => setWorkflowOpen(true)}><FiClock /> Version / Trash</button>
            )}

            {canEdit && (
              <button className={`btn btn-sm ${editMode ? 'btn-primary' : 'btn-outline'}`} onClick={toggleEdit}>
                {editMode ? <><FiEdit3 /> โหมดแก้ไข</> : <><FiEye /> โหมดดู</>}
              </button>
            )}
          </div>
        </div>
      </header>

      {remoteChanged && (
        <div className="alert alert-warning shrink-0 py-2 text-sm">
          <FiClock /><span>ผังนี้มีการแก้ไขจากอีกอุปกรณ์</span>
          <button className="btn btn-xs" onClick={async () => { await reloadContext(); await loadPlans(); setRemoteChanged(false); }}>โหลดข้อมูลล่าสุด</button>
        </div>
      )}

      <div className={`grid min-h-0 flex-1 gap-2 ${editMode ? 'lg:grid-cols-[184px_minmax(0,1fr)_240px]' : 'grid-cols-1'}`}>
        {editMode && (
          <aside className="glass-panel order-2 min-h-0 overflow-y-auto rounded-xl p-2 lg:order-1">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-bold">เครื่องมือ</h2>
              <span className="badge badge-ghost badge-sm">วางบนผัง</span>
            </div>
            <div className="grid grid-cols-2 gap-2 lg:grid-cols-1">
              <button className={`btn btn-sm justify-start ${tool === 'select' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setTool('select')}><FiMousePointer /> เลือก/ย้าย</button>
              <button className={`btn btn-sm justify-start ${tool === 'pan' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setTool('pan')}><FiMove /> เลื่อนมุมมอง</button>
            </div>

            <div className="divider my-3 text-xs">เพิ่มองค์ประกอบ</div>
            <div className="grid grid-cols-2 gap-2 lg:grid-cols-1">
              {!inRoom && <button className={`btn btn-sm justify-start ${tool === 'add-room' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setTool('add-room')}><FiHome /> ห้อง</button>}
              <button className={`btn btn-sm justify-start ${tool === 'add-rack' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setTool('add-rack')}><FiBox /> ชั้นวาง</button>
              {MARKERS.map((marker) => (
                <button key={marker.type} className={`btn btn-sm justify-start ${tool === `add-marker-${marker.type}` ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setTool(`add-marker-${marker.type}`)}>
                  <span className="flex w-5 items-center justify-center"><MarkerToolIcon type={marker.type} /></span> {marker.label}
                </button>
              ))}
            </div>

            {tool.startsWith('add-') && (
              <div className="mt-4 space-y-3 rounded-xl border border-primary/30 bg-primary/5 p-3">
                <div className="flex items-center justify-between text-xs font-bold text-primary"><span>ตั้งค่าก่อนวาง</span><button className="btn btn-xs btn-ghost btn-square" onClick={() => setTool('select')}><FiX /></button></div>
                {(tool === 'add-room' || tool === 'add-rack') && (
                  <input className="input input-bordered input-sm w-full" placeholder={tool === 'add-room' ? 'ชื่อห้อง' : 'ชื่อชั้นวาง'} value={creation.name} onChange={(event) => setCreation({ ...creation, name: event.target.value })} />
                )}
                {tool === 'add-room' && (
                  <div className="space-y-2">
                    <label className="label cursor-pointer justify-start gap-2 p-0"><input type="checkbox" className="toggle toggle-primary toggle-sm" checked={creation.isStorage} onChange={(event) => setCreation({ ...creation, isStorage: event.target.checked })} /><span className="text-xs">ห้องเก็บของ</span></label>
                    <p className="text-[11px] text-base-content/60">อยากได้พื้นที่จัดเตรียมของโครงการ ให้วาด &quot;พื้นที่วางพื้น&quot; ในห้องแล้วผูกโครงการแทน</p>
                  </div>
                )}
                {tool === 'add-rack' && (
                  <div className="space-y-2">
                    {/* ของกองกับพื้นไม่ใช่ชั้นวาง — แยกประเภทให้ชัดตั้งแต่ตอนสร้าง จะได้ไม่ต้องมาสมมติว่า "เลเวล 1" คือพื้น */}
                    <div className="join w-full">
                      <button
                        type="button"
                        className={`btn btn-sm join-item flex-1 ${creation.isFloor ? 'btn-ghost border border-base-300' : 'btn-primary'}`}
                        onClick={() => setCreation({ ...creation, isFloor: false })}
                      >ชั้นวาง</button>
                      <button
                        type="button"
                        className={`btn btn-sm join-item flex-1 ${creation.isFloor ? 'btn-primary' : 'btn-ghost border border-base-300'}`}
                        onClick={() => setCreation({ ...creation, isFloor: true })}
                      >พื้นที่วางพื้น</button>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      {creation.isFloor ? (
                        <label className="form-control col-span-2">
                          <span className="mb-1 text-xs">ผูกกับโครงการ (ทำให้เป็นพื้นที่จัดเตรียม)</span>
                          <select className="select select-bordered select-sm" value={creation.projectId || ''} onChange={(event) => setCreation({ ...creation, projectId: event.target.value ? Number(event.target.value) : '' })}>
                            <option value="">— ไม่ผูก (พื้นที่วางพื้นทั่วไป) —</option>
                            {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
                          </select>
                          <span className="mt-1 text-[11px] text-base-content/60">ของวางกับพื้น ไม่มีชั้นย่อย — ถ้าผูกโครงการ ของจะถูกกันไว้ให้โครงการนั้น</span>
                        </label>
                      ) : (
                        <label className="form-control"><span className="mb-1 text-xs">จำนวนเลเวล</span><input type="number" min="1" max="50" className="input input-bordered input-sm" value={creation.levels} onChange={(event) => setCreation({ ...creation, levels: event.target.value })} /></label>
                      )}
                      <label className="form-control"><span className="mb-1 text-xs">ความจุ</span><input type="number" min="1" className="input input-bordered input-sm" value={creation.capacity} onChange={(event) => setCreation({ ...creation, capacity: event.target.value })} /></label>
                    </div>
                  </div>
                )}
                <p className="flex items-center gap-2 text-xs text-base-content/60">
                  {drawType
                    ? <><FiEdit3 /> กดค้างแล้วลากจากจุดเริ่มถึงจุดสิ้นสุด</>
                    : rectTool
                      ? <><FiEdit3 /> ลากเพื่อกำหนดขนาดเอง หรือคลิกเฉยๆ เพื่อใช้ขนาดมาตรฐาน</>
                      : <><FiMousePointer /> คลิกจุดกึ่งกลางที่ต้องการวาง</>}
                </p>
              </div>
            )}
          </aside>
        )}

        <main className="glass-panel relative order-1 min-h-0 min-w-0 overflow-hidden rounded-xl lg:order-2">
          <div
            ref={viewportRef}
            className={`relative h-full min-h-[360px] w-full touch-none overflow-hidden bg-base-200/35 ${tool === 'pan' || spacePressedRef.current ? 'cursor-grab' : tool.startsWith('add-') ? 'cursor-crosshair' : ''}`}
            onPointerDown={onViewportPointerDown}
            onPointerMove={onViewportPointerMove}
            onPointerUp={endPointerAction}
            onPointerCancel={endPointerAction}
          >
            <div
              role="application"
              aria-label="พื้นที่ผังคลัง"
              className="absolute left-0 top-0 overflow-hidden border border-base-300 bg-base-100 shadow-2xl"
              style={{
                width: CANVAS_WIDTH,
                height: CANVAS_HEIGHT,
                transformOrigin: '0 0',
                transform: `translate(${viewport.panX}px, ${viewport.panY}px) scale(${viewport.zoom})`,
                backgroundImage: 'radial-gradient(circle, color-mix(in oklab, currentColor 15%, transparent) 1px, transparent 1px)',
                backgroundSize: `${GRID_SIZE}px ${GRID_SIZE}px`
              }}
              onPointerDown={beginCanvasDraw}
              onClick={onCanvasClick}
            >
              {orderedEntities.map((entity) => (
                <CanvasEntity
                  key={entityKey(entity)}
                  entity={entity}
                  displayZ={displayZ.get(entityKey(entity))}
                  selected={selectedKeys.includes(entityKey(entity))}
                  editMode={editMode}
                  pickStop={entity.kind === 'rack' ? pickStops.get(entity.id) : undefined}
                  pickDone={entity.kind === 'rack' && doneStops.has(entity.id)}
                  movedDuringRotate={movedRef.current}
                  onPointerDown={beginMove}
                  onResizeDown={beginResize}
                  onRotateStart={beginRotate}
                  onRotate={rotateEntityStep}
                  onSelect={selectEntityFromCanvas}
                  onOpen={openEntity}
                  onContextMenu={(event, item) => {
                    if (!selectedKeys.includes(entityKey(item))) setSelectedKey(entityKey(item));
                    setContextMenu({ x: event.clientX, y: event.clientY, entity: item });
                  }}
                />
              ))}

              {selectionBox && (
                <div className="pointer-events-none absolute border-2 border-primary bg-primary/10" style={{ left: selectionBox.left, top: selectionBox.top, width: selectionBox.width, height: selectionBox.height, zIndex: orderedEntities.length + 30 }} />
              )}
              {activeGuides.x != null && <div className="pointer-events-none absolute bottom-0 top-0 w-px bg-secondary" style={{ left: activeGuides.x, zIndex: orderedEntities.length + 31 }} />}
              {activeGuides.y != null && <div className="pointer-events-none absolute left-0 right-0 h-px bg-secondary" style={{ top: activeGuides.y, zIndex: orderedEntities.length + 31 }} />}

              {drawPreview?.shape === 'rect' && (
                <div
                  className="pointer-events-none absolute rounded-xl border-2 border-dashed border-primary bg-primary/10"
                  style={{
                    left: drawPreview.posX,
                    top: drawPreview.posY,
                    width: drawPreview.width,
                    height: drawPreview.height,
                    zIndex: orderedEntities.length + 10
                  }}
                >
                  <span className="absolute -top-6 left-0 rounded bg-primary px-1.5 py-0.5 text-[10px] font-bold text-primary-content">
                    {drawPreview.width} × {drawPreview.height}
                  </span>
                </div>
              )}

              {drawPreview && !drawPreview.shape && (
                <div
                  className={`pointer-events-none absolute rounded-full opacity-75 ${drawPreview.type === 'wall' ? 'bg-neutral' : 'bg-primary'}`}
                  style={{
                    left: drawPreview.posX,
                    top: drawPreview.posY,
                    width: drawPreview.width,
                    height: drawPreview.height,
                    zIndex: orderedEntities.length + 10,
                    transform: `rotate(${drawPreview.rotation}deg)`,
                    transformOrigin: 'center'
                  }}
                />
              )}

              {!loading && orderedEntities.length === 0 && (
                <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-base-content/35">
                  <FiMap className="mb-3 text-5xl" />
                  <p className="font-semibold">ผังนี้ยังว่าง</p>
                  {canEdit && <p className="mt-1 text-sm">เข้าโหมดแก้ไขแล้วเลือกองค์ประกอบเพื่อเริ่มวาง</p>}
                </div>
              )}
              {loading && <div className="absolute inset-0 z-100 flex items-center justify-center bg-base-100/60"><span className="loading loading-spinner loading-lg text-primary" /></div>}
            </div>

            {/* แผงเส้นทางหยิบของ — ต้องอยู่นอก div ที่ถูก transform ไม่งั้นจะถูกซูม/เลื่อนตามผัง */}
            {pickList && (
              <PickListPanel
                data={pickList}
                pickedKeys={pickedKeys}
                open={pickPanelOpen}
                onToggleOpen={() => setPickPanelOpen((value) => !value)}
                onTogglePicked={(key) => setPickedKeys((list) => (list.includes(key) ? list.filter((item) => item !== key) : [...list, key]))}
                onGoto={(item) => gotoRack(item.rackId, { level: item.storageLevel, sku: item.sku })}
                onClose={closePickList}
              />
            )}

            {/* องศาที่กำลังหมุน — โผล่เฉพาะตอนลากหมุน และบอกทางลัด Shift ตอนที่ผู้ใช้ต้องใช้พอดี */}
            {rotatePreview != null && (
              <div className="pointer-events-none absolute left-1/2 top-3 z-50 flex -translate-x-1/2 items-baseline gap-2 rounded-xl border border-base-300 bg-base-100/95 px-3 py-1.5 shadow-lg backdrop-blur">
                <span className="font-mono text-lg font-bold tabular-nums">{rotatePreview}°</span>
                <span className="text-[11px] text-base-content/60">กด Shift ค้าง = ล็อกทีละ 15°</span>
              </div>
            )}

            <div className="absolute bottom-3 left-1/2 z-50 flex -translate-x-1/2 items-center gap-1 rounded-xl border border-base-300 bg-base-100/95 p-1.5 shadow-lg backdrop-blur">
              {editMode && <>
                <button className="btn btn-sm btn-ghost btn-square" disabled={undoRef.current.length === 0 || savingCount > 0} onClick={undo} title="Undo"><FiCornerUpLeft /></button>
                <button className="btn btn-sm btn-ghost btn-square" disabled={redoRef.current.length === 0 || savingCount > 0} onClick={redo} title="Redo"><FiCornerUpRight /></button>
                <div className="divider divider-horizontal mx-0" />
              </>}
              <button className="btn btn-sm btn-ghost btn-square" onClick={() => zoomBy(1 / ZOOM_STEP)} title="ซูมออก"><FiZoomOut /></button>
              <span className="w-14 text-center text-xs font-semibold">{Math.round(viewport.zoom * 100)}%</span>
              <button className="btn btn-sm btn-ghost btn-square" onClick={() => zoomBy(ZOOM_STEP)} title="ซูมเข้า"><FiZoomIn /></button>
              <button className="btn btn-sm btn-ghost btn-square" onClick={fitCanvas} title="พอดีหน้าจอ"><FiMaximize /></button>
              <button className="btn btn-sm btn-ghost btn-square" disabled={!selectedEntities.length} onClick={zoomToSelection} title="Zoom to selection"><FiSearch /></button>
              <button className="btn btn-sm btn-ghost btn-square" disabled={!viewportHistoryRef.current.length} onClick={previousViewport} title="มุมมองก่อนหน้า"><FiArrowLeft /></button>
              {editMode && <>
                <button className={`btn btn-sm gap-1 ${snapEnabled ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setSnapEnabled((value) => !value)} title="Snap grid"><FiGrid /><span className="hidden sm:inline">{GRID_SIZE}px</span></button>
                <button className={`btn btn-sm ${smartGuidesEnabled ? 'btn-secondary' : 'btn-ghost'}`} onClick={() => setSmartGuidesEnabled((value) => !value)} title="Smart guides">Guide</button>
              </>}
            </div>

            {editMode && (
              <button className="btn btn-sm btn-primary btn-square absolute right-3 top-3 z-50 lg:hidden" onClick={() => setSmallPanelOpen(true)} aria-label="เปิด Inspector"><FiMenu /></button>
            )}
          </div>
        </main>

        {editMode && <aside className="glass-panel order-3 hidden min-h-0 overflow-hidden rounded-xl lg:block">{renderPanel}</aside>}
      </div>

      {editMode && (
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 px-1 text-[11px] text-base-content/50">
          <span>ดับเบิลคลิกเพื่อเปิดห้อง/Blueprint · กด Space ค้างแล้วลากเพื่อเลื่อนมุมมอง · Ctrl+Wheel เพื่อซูม</span>
          <span>{CANVAS_WIDTH} × {CANVAS_HEIGHT}px</span>
        </div>
      )}

      {openRackId && (
        <RackBlueprint
          rackId={openRackId}
          highlightLevel={highlight.rackId === openRackId ? highlight.level : null}
          highlightSku={highlight.rackId === openRackId ? highlight.sku : null}
          canEdit={canEdit}
          onChanged={reloadContext}
          onClose={() => setOpenRackId(null)}
        />
      )}

      {unassignedOpen && (
        <UnassignedModal onClose={() => setUnassignedOpen(false)} onAssigned={reloadContext} />
      )}

      {contextMenu && (
        <div className="fixed inset-0 z-100" onPointerDown={() => setContextMenu(null)}>
          <div className="absolute w-52 rounded-xl border border-base-300 bg-base-100 p-1 shadow-2xl" style={{ left: contextMenu.x, top: contextMenu.y }} onPointerDown={(event) => event.stopPropagation()}>
            <button className="btn btn-sm btn-ghost w-full justify-start" onClick={() => { copySelection(); setContextMenu(null); }}><FiCopy /> Copy</button>
            <button className="btn btn-sm btn-ghost w-full justify-start" onClick={() => { duplicateSelection(); setContextMenu(null); }}><FiPlus /> Duplicate</button>
            <button className="btn btn-sm btn-ghost w-full justify-start" onClick={() => { patchSelection((entity) => ({ locked: !entity.locked })); setContextMenu(null); }}>{contextMenu.entity.locked ? <FiUnlock /> : <FiLock />} {contextMenu.entity.locked ? 'ปลดล็อก' : 'ล็อก'}</button>
            <button className="btn btn-sm btn-ghost w-full justify-start" disabled={contextMenu.entity.locked} onClick={() => { patchSelection((entity) => ({ rotation: ((Number(entity.rotation) || 0) + 15) % 360 })); setContextMenu(null); }}><FiRotateCw /> หมุน 15°</button>
            <button className="btn btn-sm btn-ghost w-full justify-start" disabled={selectedEntities.length !== 1 || contextMenu.entity.locked} onClick={() => { moveSelectedLayer('front'); setContextMenu(null); }}><FiChevronsUp /> Bring to front</button>
            <button className="btn btn-sm btn-ghost w-full justify-start" disabled={selectedEntities.length !== 1 || contextMenu.entity.locked} onClick={() => { moveSelectedLayer('back'); setContextMenu(null); }}><FiChevronsDown /> Send to back</button>
            {selectedEntities.length > 1 && <button className="btn btn-sm btn-ghost w-full justify-start" onClick={() => { groupSelection(); setContextMenu(null); }}><FiLayers /> Group selection</button>}
            {contextMenu.entity.groupId && <button className="btn btn-sm btn-ghost w-full justify-start" onClick={() => { ungroupSelection(); setContextMenu(null); }}><FiLayers /> Ungroup</button>}
            <button className="btn btn-sm btn-ghost w-full justify-start" onClick={() => { zoomToSelection(); setContextMenu(null); }}><FiMaximize /> Zoom to selection</button>
            <div className="divider my-0" />
            <button className="btn btn-sm btn-ghost w-full justify-start text-error" disabled={contextMenu.entity.locked} onClick={() => { deleteEntity(contextMenu.entity); setContextMenu(null); }}><FiTrash2 /> ย้ายไปถังขยะ</button>
          </div>
        </div>
      )}

      {workflowOpen && (
        <div className="fixed inset-0 z-100 flex items-center justify-center bg-base-300/45 p-4 backdrop-blur-sm" onClick={() => setWorkflowOpen(false)}>
          <section className="glass-modal flex max-h-[82vh] w-full max-w-2xl flex-col rounded-2xl p-5" onClick={(event) => event.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between gap-3">
              <div><h2 className="text-lg font-bold">Version และประวัติผัง</h2><p className="text-xs text-base-content/50">{currentPlan?.name} · {currentPlan?.status === 'published' ? 'Published' : 'Draft'}</p></div>
              <div className="flex gap-2"><button className="btn btn-sm btn-outline" onClick={() => { setEditMode(false); setWorkflowOpen(false); }}><FiEye /> Preview</button><button className="btn btn-sm btn-primary" onClick={publishCurrentPlan}><FiUploadCloud /> Publish</button><button className="btn btn-sm btn-ghost btn-square" onClick={() => setWorkflowOpen(false)}><FiX /></button></div>
            </div>
            <div className="tabs tabs-boxed mb-3 grid grid-cols-3">
              <button className={`tab ${workflowTab === 'versions' ? 'tab-active' : ''}`} onClick={() => setWorkflowTab('versions')}>Versions ({versions.length})</button>
              <button className={`tab ${workflowTab === 'trash' ? 'tab-active' : ''}`} onClick={() => setWorkflowTab('trash')}>Trash ({trashItems.length})</button>
              <button className={`tab ${workflowTab === 'history' ? 'tab-active' : ''}`} onClick={() => setWorkflowTab('history')}>History</button>
            </div>
            <div className="min-h-0 flex-1 space-y-2 overflow-y-auto">
              {workflowTab === 'versions' && (versions.length ? versions.map((version) => <div key={version.id} className="flex items-center justify-between rounded-xl bg-base-200/60 p-3"><div><div className="font-semibold">v{version.versionNumber} · {version.name}</div><div className="text-xs text-base-content/50">{version.createdBy || 'ระบบ'} · {new Date(version.createdAt).toLocaleString('th-TH')}</div></div><button className="btn btn-sm btn-outline" onClick={() => restoreLayoutVersion(version)}>กู้คืน</button></div>) : <p className="py-10 text-center text-base-content/45">ยังไม่มี Version — กด Publish เพื่อสร้าง Version แรก</p>)}
              {workflowTab === 'trash' && (trashItems.length ? trashItems.map((item) => <div key={`${item.kind}:${item.id}`} className="flex items-center justify-between rounded-xl bg-base-200/60 p-3"><div><div className="font-semibold">{item.title}</div><div className="text-xs text-base-content/50">{KIND_LABEL[item.kind]} · {new Date(item.deletedAt).toLocaleString('th-TH')}</div></div><button className="btn btn-sm btn-outline" onClick={() => restoreTrashItem(item)}>กู้คืน</button></div>) : <p className="py-10 text-center text-base-content/45">ถังขยะว่าง</p>)}
              {workflowTab === 'history' && (storageHistory.length ? storageHistory.map((entry) => <div key={entry.id} className="rounded-xl bg-base-200/60 p-3"><div className="flex justify-between gap-3"><span className="font-semibold">{entry.action}</span><span className="text-xs text-base-content/45">{new Date(entry.createdAt).toLocaleString('th-TH')}</span></div><div className="text-xs text-base-content/55">{entry.actor || 'ระบบ'}</div></div>) : <p className="py-10 text-center text-base-content/45">ยังไม่มีประวัติ</p>)}
            </div>
          </section>
        </div>
      )}

      {smallPanelOpen && (
        <div className="fixed inset-0 z-100 bg-base-300/45 backdrop-blur-sm lg:hidden" onClick={() => setSmallPanelOpen(false)}>
          <aside className="absolute bottom-0 right-0 top-0 w-[min(86vw,300px)] overflow-hidden bg-base-100 shadow-2xl" onClick={(event) => event.stopPropagation()}>
            <button className="btn btn-sm btn-ghost btn-square absolute right-2 top-2 z-20" onClick={() => setSmallPanelOpen(false)} aria-label="ปิด"><FiX /></button>
            {renderPanel}
          </aside>
        </div>
      )}

      {planManage && (
        <div className="fixed inset-0 z-100 flex items-center justify-center bg-base-300/45 p-4 backdrop-blur-sm" onClick={() => setPlanManage(false)}>
          <section className="glass-modal w-full max-w-md rounded-2xl p-5" onClick={(event) => event.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between"><h2 className="text-lg font-bold">จัดการคลัง/สาขา</h2><button className="btn btn-sm btn-ghost btn-square" onClick={() => setPlanManage(false)}><FiX /></button></div>
            <div className="join mb-4 flex">
              <input className="input input-bordered input-sm join-item min-w-0 flex-1" placeholder="ชื่อคลังหรือสาขา" value={newPlan} onChange={(event) => setNewPlan(event.target.value)} />
              <button className="btn btn-sm btn-primary join-item" onClick={addPlan}><FiPlus /> เพิ่ม</button>
            </div>
            <div className="space-y-2">
              {plans.map((plan) => (
                <div key={plan.id} className="flex items-center gap-2 rounded-lg bg-base-200/60 px-2 py-2">
                  <FiMap className="shrink-0" />
                  <input
                    key={`${plan.id}:${plan.name}`}
                    className="input input-ghost input-sm min-w-0 flex-1 font-semibold"
                    defaultValue={plan.name}
                    aria-label={`ชื่อคลัง ${plan.name}`}
                    onBlur={(event) => renamePlan(plan, event.target.value)}
                    onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); }}
                  />
                  <button className="btn btn-xs btn-ghost text-error" disabled={plans.length <= 1} onClick={() => deletePlan(plan)}><FiTrash2 /> ลบ</button>
                </div>
              ))}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
