export const CANVAS_WIDTH = 1600;
export const CANVAS_HEIGHT = 900;
export const GRID_SIZE = 24;
export const RACK_WIDTH = 140;
export const RACK_HEIGHT = 84;

const KIND_ORDER = { marker: 0, room: 1, rack: 2 };

export const entityKey = (entityOrKind, id) => (
  typeof entityOrKind === 'string'
    ? `${entityOrKind}:${id}`
    : `${entityOrKind.kind}:${entityOrKind.id}`
);

export const snapValue = (value, enabled, size = GRID_SIZE) => (
  enabled ? Math.round(value / size) * size : Math.round(value)
);

export const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

export const normalizeLayerOrder = (entities = []) => (
  [...entities]
    .sort((a, b) => {
      const zDiff = Number(a.z || 0) - Number(b.z || 0);
      if (zDiff !== 0) return zDiff;
      const kindDiff = (KIND_ORDER[a.kind] ?? 99) - (KIND_ORDER[b.kind] ?? 99);
      if (kindDiff !== 0) return kindDiff;
      return Number(a.id) - Number(b.id);
    })
    .map((entity, index) => ({ ...entity, z: index + 1 }))
);

// ใช้เมื่อ array มีลำดับที่ผู้ใช้ต้องการอยู่แล้ว (เช่น Undo/Redo)
// จึงต้อง reindex โดยไม่ sort ซ้ำจากค่า z ปัจจุบัน
export const reindexLayerOrder = (entities = []) => (
  entities.map((entity, index) => ({ ...entity, z: index + 1 }))
);

export const moveLayer = (entities, key, action) => {
  const order = normalizeLayerOrder(entities);
  const index = order.findIndex((entity) => entityKey(entity) === key);
  if (index < 0) return order;

  let target = index;
  if (action === 'front') target = order.length - 1;
  if (action === 'forward') target = Math.min(order.length - 1, index + 1);
  if (action === 'backward') target = Math.max(0, index - 1);
  if (action === 'back') target = 0;
  if (target === index) return order;

  const [selected] = order.splice(index, 1);
  order.splice(target, 0, selected);
  return reindexLayerOrder(order);
};

export const screenToCanvas = ({ clientX, clientY }, rect, viewport) => ({
  x: (clientX - rect.left - viewport.panX) / viewport.zoom,
  y: (clientY - rect.top - viewport.panY) / viewport.zoom
});

export const clampPosition = (kind, position, dimensions = {}) => {
  const width = Number(dimensions.width || (kind === 'rack' ? RACK_WIDTH : 20));
  const height = Number(dimensions.height || (kind === 'rack' ? RACK_HEIGHT : 20));
  return {
    posX: clamp(position.posX, 0, Math.max(0, CANVAS_WIDTH - width)),
    posY: clamp(position.posY, 0, Math.max(0, CANVAS_HEIGHT - height))
  };
};

export const placementAtPoint = (kind, point, dimensions = {}, snapEnabled = false) => {
  const width = Number(dimensions.width || (kind === 'rack' ? RACK_WIDTH : 20));
  const height = Number(dimensions.height || (kind === 'rack' ? RACK_HEIGHT : 20));
  const centerX = snapValue(point.x, snapEnabled);
  const centerY = snapValue(point.y, snapEnabled);
  return clampPosition(kind, {
    posX: Math.round(centerX - width / 2),
    posY: Math.round(centerY - height / 2)
  }, { width, height });
};

export const segmentGeometry = (start, end, thickness = 4, snapEnabled = false) => {
  const startX = snapValue(start.x, snapEnabled);
  const startY = snapValue(start.y, snapEnabled);
  const endX = snapValue(end.x, snapEnabled);
  const endY = snapValue(end.y, snapEnabled);
  const dx = endX - startX;
  const dy = endY - startY;
  const length = Math.max(Math.hypot(dx, dy), thickness);
  const width = Math.min(CANVAS_WIDTH, Math.round(length));
  const height = Math.max(2, Math.round(thickness));
  const center = { x: (startX + endX) / 2, y: (startY + endY) / 2 };
  const position = clampPosition('marker', {
    posX: Math.round(center.x - width / 2),
    posY: Math.round(center.y - height / 2)
  }, { width, height });
  return {
    ...position,
    width,
    height,
    rotation: Math.atan2(dy, dx) * 180 / Math.PI,
    length
  };
};

export const normalizeAngle = (degrees) => {
  const value = Number(degrees);
  if (!Number.isFinite(value)) return 0;
  return ((value % 360) + 360) % 360;
};

// องศาจากจุดหมุนไปยังตำแหน่งเมาส์ (0° = ชี้ไปทางขวา, เพิ่มตามเข็มนาฬิกาเหมือน CSS rotate)
export const angleBetween = (origin, point) => normalizeAngle(
  Math.atan2(point.y - origin.y, point.x - origin.x) * 180 / Math.PI
);

// กำแพง/เส้นแบ่ง เก็บเป็นกล่องที่ยึด "จุดกึ่งกลาง" + องศา
// ถ้าหมุนตรงๆ ปลายทั้งสองข้างจะเลื่อนพร้อมกัน ทำให้ต่อกำแพงยาก
// ฟังก์ชันนี้คำนวณตำแหน่งใหม่เพื่อ "ล็อกปลายด้านเริ่มต้น" ไว้กับที่ แล้วให้ปลายอีกด้านกวาดไปแทน
export const isLinearMarker = (entity) => entity?.kind === 'marker' && (entity.type === 'wall' || entity.type === 'line');

export const linearStartPoint = (entity) => {
  const width = Number(entity.width) || 0;
  const height = Number(entity.height) || 0;
  const radius = width / 2;
  const radians = normalizeAngle(entity.rotation) * Math.PI / 180;
  return {
    x: Number(entity.posX || 0) + width / 2 - radius * Math.cos(radians),
    y: Number(entity.posY || 0) + height / 2 - radius * Math.sin(radians)
  };
};

// หมายเหตุ: ถ้าหมุนแล้วกำแพงจะพ้นขอบผัง ตำแหน่งจะถูกดันกลับเข้าผัง (จุดเริ่มจึงขยับได้บ้าง)
// เพราะ server บังคับ posX/posY ให้อยู่ในผังอยู่แล้ว ถ้าไม่ clamp ที่นี่ ภาพบนจอกับข้อมูลจริงจะไม่ตรงกัน
export const rotateAroundStart = (entity, nextRotation) => {
  const rotation = normalizeAngle(nextRotation);
  if (!isLinearMarker(entity)) return { rotation };
  const width = Number(entity.width) || 0;
  const height = Number(entity.height) || 0;
  const start = linearStartPoint(entity);
  const radius = width / 2;
  const radians = rotation * Math.PI / 180;
  const centerX = start.x + radius * Math.cos(radians);
  const centerY = start.y + radius * Math.sin(radians);
  return {
    rotation,
    ...clampPosition('marker', {
      posX: Math.round(centerX - width / 2),
      posY: Math.round(centerY - height / 2)
    }, { width, height })
  };
};

// สี่เหลี่ยมจากการลากสร้าง (ห้อง/ชั้นวาง) — ลากจากมุมไหนก็ได้
export const rectFromDrag = (start, end, minWidth = 20, minHeight = 20, snapEnabled = false) => {
  const startX = snapValue(start.x, snapEnabled);
  const startY = snapValue(start.y, snapEnabled);
  const endX = snapValue(end.x, snapEnabled);
  const endY = snapValue(end.y, snapEnabled);
  const width = Math.max(minWidth, Math.abs(endX - startX));
  const height = Math.max(minHeight, Math.abs(endY - startY));
  return {
    width: Math.round(Math.min(width, CANVAS_WIDTH)),
    height: Math.round(Math.min(height, CANVAS_HEIGHT)),
    ...clampPosition('room', {
      posX: Math.round(Math.min(startX, endX)),
      posY: Math.round(Math.min(startY, endY))
    }, { width, height })
  };
};

export const layerPayload = (entities) => reindexLayerOrder(entities)
  .map(({ kind, id }) => ({ kind, id }));

export const entityDimensions = (entity) => ({
  width: Number(entity.width || (entity.kind === 'rack' ? RACK_WIDTH : 20)),
  height: Number(entity.height || (entity.kind === 'rack' ? RACK_HEIGHT : 20))
});

export const entityBounds = (entity) => {
  const { width, height } = entityDimensions(entity);
  return {
    left: Number(entity.posX || 0),
    top: Number(entity.posY || 0),
    right: Number(entity.posX || 0) + width,
    bottom: Number(entity.posY || 0) + height,
    centerX: Number(entity.posX || 0) + width / 2,
    centerY: Number(entity.posY || 0) + height / 2,
    width,
    height
  };
};

export const selectionBounds = (entities = []) => {
  if (!entities.length) return null;
  const rects = entities.map(entityBounds);
  const left = Math.min(...rects.map((rect) => rect.left));
  const top = Math.min(...rects.map((rect) => rect.top));
  const right = Math.max(...rects.map((rect) => rect.right));
  const bottom = Math.max(...rects.map((rect) => rect.bottom));
  return { left, top, right, bottom, width: right - left, height: bottom - top, centerX: (left + right) / 2, centerY: (top + bottom) / 2 };
};

export const intersectsSelection = (entity, box) => {
  const rect = entityBounds(entity);
  return rect.left < box.right && rect.right > box.left && rect.top < box.bottom && rect.bottom > box.top;
};

export const alignSelection = (entities, mode) => {
  const bounds = selectionBounds(entities);
  if (!bounds) return [];
  return entities.map((entity) => {
    const rect = entityBounds(entity);
    let posX = entity.posX;
    let posY = entity.posY;
    if (mode === 'left') posX = bounds.left;
    if (mode === 'center') posX = bounds.centerX - rect.width / 2;
    if (mode === 'right') posX = bounds.right - rect.width;
    if (mode === 'top') posY = bounds.top;
    if (mode === 'middle') posY = bounds.centerY - rect.height / 2;
    if (mode === 'bottom') posY = bounds.bottom - rect.height;
    return { kind: entity.kind, id: entity.id, patch: clampPosition(entity.kind, { posX, posY }, rect) };
  });
};

export const distributeSelection = (entities, axis) => {
  if (entities.length < 3) return [];
  const horizontal = axis === 'horizontal';
  const sorted = [...entities].sort((a, b) => {
    const ar = entityBounds(a);
    const br = entityBounds(b);
    return horizontal ? ar.left - br.left : ar.top - br.top;
  });
  const bounds = selectionBounds(sorted);
  const totalSize = sorted.reduce((sum, entity) => {
    const rect = entityBounds(entity);
    return sum + (horizontal ? rect.width : rect.height);
  }, 0);
  const available = (horizontal ? bounds.width : bounds.height) - totalSize;
  const gap = Math.max(0, available / (sorted.length - 1));
  let cursor = horizontal ? bounds.left : bounds.top;
  return sorted.map((entity) => {
    const rect = entityBounds(entity);
    const patch = horizontal ? { posX: cursor, posY: entity.posY } : { posX: entity.posX, posY: cursor };
    cursor += (horizontal ? rect.width : rect.height) + gap;
    return { kind: entity.kind, id: entity.id, patch: clampPosition(entity.kind, patch, rect) };
  });
};

export const smartGuidePosition = (entity, rawPosition, others = [], threshold = 6) => {
  const moving = entityBounds({ ...entity, ...rawPosition });
  let bestX = null;
  let bestY = null;
  const xCandidates = ['left', 'centerX', 'right'];
  const yCandidates = ['top', 'centerY', 'bottom'];
  others.forEach((other) => {
    const target = entityBounds(other);
    xCandidates.forEach((movingKey) => xCandidates.forEach((targetKey) => {
      const delta = target[targetKey] - moving[movingKey];
      if (Math.abs(delta) <= threshold && (!bestX || Math.abs(delta) < Math.abs(bestX.delta))) bestX = { delta, value: target[targetKey] };
    }));
    yCandidates.forEach((movingKey) => yCandidates.forEach((targetKey) => {
      const delta = target[targetKey] - moving[movingKey];
      if (Math.abs(delta) <= threshold && (!bestY || Math.abs(delta) < Math.abs(bestY.delta))) bestY = { delta, value: target[targetKey] };
    }));
  });
  return {
    posX: rawPosition.posX + (bestX?.delta || 0),
    posY: rawPosition.posY + (bestY?.delta || 0),
    guides: { x: bestX?.value ?? null, y: bestY?.value ?? null }
  };
};
