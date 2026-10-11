import test from 'node:test';
import assert from 'node:assert/strict';
import { projectWorld, unprojectWorld } from '../Web/projection.js';

const near = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 1e-9, `${message}: ${actual} versus ${expected}`);
const pointNear = (actual, expected, message) => { near(actual.x, expected.x, `${message} x`); near(actual.y, expected.y, `${message} y`); };

test('world axes project into opposed 2:1 diagonals and world diagonal projects vertically', () => {
  assert.deepEqual(projectWorld(0, 0), { x: 0, y: 0 });
  assert.deepEqual(projectWorld(32, 0), { x: 32, y: 16 });
  assert.deepEqual(projectWorld(0, 32), { x: -32, y: 16 });
  assert.deepEqual(projectWorld(32, 32), { x: 0, y: 32 });
  assert.deepEqual(projectWorld(32, -32), { x: 64, y: 0 });
});

test('projection round-trips map corners, negative camera offsets and fractional entity positions', () => {
  for (const size of [1024, 1536, 2048, 4096]) {
    for (const [x, y] of [[0, 0], [size, 0], [0, size], [size, size], [size / 2, size / 2], [-48, 12], [315.73, 719.125]]) {
      const projected = projectWorld(x, y);
      pointNear(unprojectWorld(projected.x, projected.y), { x, y }, `size ${size} at ${x},${y}`);
    }
  }
});

test('projected map bounds form the four exact diamond corners', () => {
  const size = 2048;
  const corners = [[0, 0], [size, 0], [size, size], [0, size]].map(([x, y]) => projectWorld(x, y));
  assert.deepEqual(corners, [{ x: 0, y: 0 }, { x: size, y: size / 2 }, { x: 0, y: size }, { x: -size, y: size / 2 }]);
  for (const corner of corners) {
    const world = unprojectWorld(corner.x, corner.y);
    assert.ok(world.x >= 0 && world.x <= size && world.y >= 0 && world.y <= size);
  }
});

test('projection math composes with CSS camera, zoom and canvas offsets without coordinate drift', () => {
  // This verifies composition math; the browser journey separately tests the real Renderer/input.
  for (const zoom of [.3, .65, 1, 1.8, 2.3]) {
    for (const viewport of [{ width: 1600, height: 1000, left: 0, top: 0 }, { width: 780, height: 680, left: 37, top: 81 }]) {
      const camera = { x: 512.25, y: 701.875 }, entity = { x: 800.3, y: 902.2 };
      const projectedCamera = projectWorld(camera.x, camera.y), projectedEntity = projectWorld(entity.x, entity.y);
      const client = { x: (projectedEntity.x - projectedCamera.x) * zoom + viewport.width / 2 + viewport.left, y: (projectedEntity.y - projectedCamera.y) * zoom + viewport.height / 2 + viewport.top };
      const local = { x: (client.x - viewport.left - viewport.width / 2) / zoom + projectedCamera.x, y: (client.y - viewport.top - viewport.height / 2) / zoom + projectedCamera.y };
      pointNear(unprojectWorld(local.x, local.y), entity, `zoom ${zoom}`);
    }
  }
});

test('projected rectangular drag selection differs from a world bounding box at diamond corners', () => {
  // A screen rectangle surrounds the east/west arms, but does not enclose the north/south tips.
  const diamond = [[480, 480], [520, 480], [520, 520], [480, 520]].map(([x, y]) => projectWorld(x, y));
  const box = { left: -45, right: 45, top: 489, bottom: 511 };
  const inside = diamond.map(p => p.x >= box.left && p.x <= box.right && p.y >= box.top && p.y <= box.bottom);
  assert.deepEqual(inside, [false, true, false, true], 'selection must compare rendered screen points rather than a world-axis bounding box');
});
