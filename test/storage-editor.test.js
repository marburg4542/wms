import test from 'node:test';
import assert from 'node:assert/strict';
import {
  alignSelection,
  clampPosition,
  entityKey,
  moveLayer,
  normalizeLayerOrder,
  placementAtPoint,
  reindexLayerOrder,
  screenToCanvas,
  segmentGeometry,
  smartGuidePosition,
  intersectsSelection,
  distributeSelection,
  snapValue
} from '../src/components/Storage/layout.js';

const fixtures = [
  { kind: 'room', id: 1, z: -1 },
  { kind: 'marker', id: 3, z: -2 },
  { kind: 'rack', id: 2, z: 0 }
];

test('normalizes negative and duplicate layers into a safe contiguous order', () => {
  const result = normalizeLayerOrder(fixtures);
  assert.deepEqual(result.map(entityKey), ['marker:3', 'room:1', 'rack:2']);
  assert.deepEqual(result.map((entity) => entity.z), [1, 2, 3]);
});

test('send to back never produces a negative z-index', () => {
  const result = moveLayer(fixtures, 'rack:2', 'back');
  assert.deepEqual(result.map(entityKey), ['rack:2', 'marker:3', 'room:1']);
  assert.deepEqual(result.map((entity) => entity.z), [1, 2, 3]);
});

test('supports one-step and absolute layer moves across entity kinds', () => {
  const forward = moveLayer(fixtures, 'marker:3', 'forward');
  assert.deepEqual(forward.map(entityKey), ['room:1', 'marker:3', 'rack:2']);
  const front = moveLayer(forward, 'room:1', 'front');
  assert.deepEqual(front.map(entityKey), ['marker:3', 'rack:2', 'room:1']);
});

test('reindexes an explicit history order without sorting it again', () => {
  const explicit = [fixtures[2], fixtures[0], fixtures[1]];
  const result = reindexLayerOrder(explicit);
  assert.deepEqual(result.map(entityKey), ['rack:2', 'room:1', 'marker:3']);
  assert.deepEqual(result.map((entity) => entity.z), [1, 2, 3]);
});

test('converts screen coordinates through pan and zoom', () => {
  const point = screenToCanvas(
    { clientX: 420, clientY: 270 },
    { left: 100, top: 50 },
    { zoom: 2, panX: 20, panY: 20 }
  );
  assert.deepEqual(point, { x: 150, y: 100 });
});

test('snaps and clamps objects inside the logical canvas', () => {
  assert.equal(snapValue(37, true, 24), 48);
  assert.equal(snapValue(37, false, 24), 37);
  assert.deepEqual(
    clampPosition('rack', { posX: 9999, posY: -20 }),
    { posX: 1460, posY: 0 }
  );
  assert.deepEqual(
    clampPosition('rack', { posX: 9999, posY: 9999 }, { width: 320, height: 160 }),
    { posX: 1280, posY: 740 }
  );
});

test('places the component center at the clicked canvas coordinate', () => {
  assert.deepEqual(
    placementAtPoint('room', { x: 500, y: 300 }, { width: 240, height: 160 }),
    { posX: 380, posY: 220 }
  );
  assert.deepEqual(
    placementAtPoint('rack', { x: 70, y: 42 }),
    { posX: 0, posY: 0 }
  );
});

test('builds a drawable segment from its actual start and end points', () => {
  const horizontal = segmentGeometry({ x: 100, y: 120 }, { x: 300, y: 120 }, 14);
  assert.deepEqual(horizontal, { posX: 100, posY: 113, width: 200, height: 14, rotation: 0, length: 200 });

  const vertical = segmentGeometry({ x: 200, y: 100 }, { x: 200, y: 300 }, 4);
  assert.equal(vertical.width, 200);
  assert.equal(vertical.rotation, 90);
});

test('selects intersecting components and aligns a multi-selection', () => {
  const entities = [
    { kind: 'room', id: 1, posX: 100, posY: 100, width: 200, height: 100 },
    { kind: 'marker', id: 2, posX: 340, posY: 120, width: 60, height: 40 }
  ];
  assert.equal(intersectsSelection(entities[0], { left: 250, top: 50, right: 350, bottom: 160 }), true);
  assert.deepEqual(alignSelection(entities, 'top').map((change) => change.patch.posY), [100, 100]);
});

test('distributes components and snaps to nearby smart guides', () => {
  const entities = [
    { kind: 'marker', id: 1, posX: 0, posY: 0, width: 20, height: 20 },
    { kind: 'marker', id: 2, posX: 70, posY: 0, width: 20, height: 20 },
    { kind: 'marker', id: 3, posX: 180, posY: 0, width: 20, height: 20 }
  ];
  const distributed = distributeSelection(entities, 'horizontal');
  assert.deepEqual(distributed.map((change) => change.patch.posX), [0, 90, 180]);
  const guided = smartGuidePosition(entities[0], { posX: 49, posY: 1 }, [entities[1]], 3);
  assert.equal(guided.posX, 50);
  assert.equal(guided.posY, 0);
});
