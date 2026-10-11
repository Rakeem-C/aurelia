import test from 'node:test';
import assert from 'node:assert/strict';
import { Navigation } from '../Web/pathfinding.js';

const map = () => ({ size: 1024, width: 32, height: 32, cellSize: 32, terrain: Array(1024).fill(0) });
test('terrain routes take the real opening and never cut blocked diagonal corners', () => {
  const grid = map();
  for (let y = 0; y < grid.height; y++) if (y !== 20 && y !== 21) grid.terrain[y * grid.width + 15] = 1;
  const nav = new Navigation(grid); nav.rebuild([]);
  const path = nav.path(240, 240, 800, 240, 7);
  assert.ok(path.length > 1, 'a wall blocks the direct segment');
  assert.ok(path.some(p => p.y >= 640), 'route visits the opening instead of tunneling through a wall');
  let start = { x: 240, y: 240 };
  for (const waypoint of path) {
    assert.equal(nav.line(start.x, start.y, waypoint.x, waypoint.y, 7), true, 'each returned movement segment is passable');
    start = waypoint;
  }
  assert.ok(Math.hypot(start.x - 800, start.y - 240) < 1);
});

test('construction invalidates cached paths and physical footprints obstruct movement', () => {
  const nav = new Navigation(map()); nav.rebuild([]);
  assert.equal(nav.path(250, 500, 800, 500, 7).length, 1);
  nav.rebuild([{ id: 'fixture-wall', alive: true, kind: 'building', type: 'wall', x: 500, y: 500, size: 40 }]);
  assert.equal(nav.free(500, 500, 7), false);
  const route = nav.path(250, 500, 800, 500, 7);
  assert.ok(route.length > 1, 'cached direct route cannot survive a newly constructed obstacle');
  let from = { x: 250, y: 500 };
  for (const to of route) { assert.equal(nav.line(from.x, from.y, to.x, to.y, 7), true); from = to; }
});

test('a fully sealed barrier returns no route and destinations are bounded', () => {
  const grid = map(); for (let y = 0; y < grid.height; y++) grid.terrain[y * grid.width + 15] = 2;
  const nav = new Navigation(grid); nav.rebuild([]);
  assert.deepEqual(nav.path(240, 240, 800, 240, 7), []);
  const goal = nav.nearest(-100, 2000, 7);
  assert.ok(goal.x >= 7 && goal.y <= 1017);
});

test('a gate opens a sealed crossing for its owner and blocks the opposing owner', () => {
  const grid = map();
  for (let row = 0; row < grid.height; row++) if (row !== 15) grid.terrain[row * grid.width + 15] = 1;
  const nav = new Navigation(grid);
  nav.rebuild([{ id: 'fixture-gate', alive: true, kind: 'building', type: 'gate', owner: 0, x: 496, y: 496, size: 23 }]);
  assert.equal(nav.free(496, 496, 7, 0), true, 'friendly gate footprint is passable');
  assert.equal(nav.free(496, 496, 7, 1), false, 'enemy gate remains a physical obstacle');
  assert.ok(nav.path(240, 496, 800, 496, 7, 0).length > 0, 'friendly route crosses the only opening');
  assert.deepEqual(nav.path(240, 496, 800, 496, 7, 1), [], 'enemy cannot route through the closed gate');
  assert.ok(nav.path(240, 496, 800, 496, 7, 0).length > 0, 'enemy navigation cache cannot contaminate friendly routes');
});
