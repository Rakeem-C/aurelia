import test from 'node:test';
import assert from 'node:assert/strict';
import { Simulation } from '../Web/simulation.js';
import { UNITS, BUILDINGS, TECHNOLOGIES, AGE_COSTS } from '../Web/catalog.js';

// Fixtures isolate a failure mode; production actions are always issued through command().
const fresh = (config = {}) => {
  const { isolate = true, ...gameConfig } = config;
  const sim = new Simulation({ seed: 142857, size: 2048, population: 1000, startingResources: 5000, difficulty: 'easy', ...gameConfig });
  // A test-only fixture suppresses opponent decisions; no production bypass is introduced.
  if (isolate) sim.aiTick = () => {};
  return sim;
};
const entities = (sim, kind, owner = 0) => sim.state.entities.filter(e => e.alive && e.kind === kind && e.owner === owner);
const civic = (sim, owner = 0) => entities(sim, 'building', owner).find(e => e.type === 'civic');
const workers = sim => entities(sim, 'unit').filter(e => e.type === 'worker');
const resources = sim => ({ ...sim.state.players[0].resources });
const run = (sim, seconds) => { for (let i = 0; i < Math.ceil(seconds / .05); i++) sim.tick(.05); };
const accepted = (sim, command) => { const result = sim.command(command); assert.equal(result.ok, true, JSON.stringify({ command, result })); return result; };
function rejectedUnchanged(sim, command) {
  const before = resources(sim), population = sim.state.players[0].population;
  const result = sim.command(command);
  assert.equal(result.ok, false, JSON.stringify(command));
  assert.ok(result.message, 'rejected command should explain why');
  assert.deepEqual(resources(sim), before, 'invalid command must not spend resources');
  assert.equal(sim.state.players[0].population, population, 'invalid command must not reserve population');
}
function stable(value) {
  const copy = JSON.parse(JSON.stringify(value));
  const visit = v => { if (!v || typeof v !== 'object') return; delete v.stats; for (const child of Object.values(v)) visit(child); };
  visit(copy); return copy;
}
function construct(sim, type, owner = 0) {
  const center = civic(sim, owner), builder = entities(sim, 'unit', owner).find(e => e.type === 'worker');
  assert.ok(center && builder, 'fixture requires civic heart and builder');
  for (let radius = 120; radius < 700; radius += 65) {
    for (let i = 0; i < 24; i++) {
      const angle = i * Math.PI / 12, x = center.x + Math.cos(angle) * radius, y = center.y + Math.sin(angle) * radius;
      const before = new Set(sim.state.entities.map(e => e.id));
      const result = sim.command({ type: 'build', player: owner, ids: [builder.id], building: type, x, y });
      if (!result.ok) continue;
      const building = entities(sim, 'building', owner).find(e => !before.has(e.id));
      assert.ok(building, 'accepted construction creates a spatial foundation');
      run(sim, BUILDINGS[type].buildTime + 35);
      assert.equal(building.progress, 1, `${type} construction should finish; ${JSON.stringify({ builder: { x: builder.x, y: builder.y, order: builder.order }, building: { id: building.id, x: building.x, y: building.y }, winner: sim.state.winner, path: sim.paths?.get(builder.id) })}`);
      return building;
    }
  }
  assert.fail(`could not place ${type}`);
}
function train(sim, building, type, owner = 0) {
  const before = new Set(sim.state.entities.map(e => e.id));
  accepted(sim, { type: 'train', player: owner, buildingId: building.id, unit: type });
  run(sim, building.queue.at(-1).duration + 1);
  const unit = entities(sim, 'unit', owner).find(e => !before.has(e.id));
  assert.ok(unit, `${type} training creates a unit`); return unit;
}

test('seeded initialization and the same real command stream stay deterministic', () => {
  const a = fresh({ isolate: false }), b = fresh({ isolate: false });
  assert.deepEqual(stable(a.serialize()), stable(b.serialize()));
  for (const sim of [a, b]) {
    const worker = workers(sim)[0], source = sim.state.entities.find(e => e.kind === 'resource' && e.resource === 'wood');
    accepted(sim, { type: 'order', ids: [worker.id], order: { type: 'gather', targetId: source.id } });
    accepted(sim, { type: 'train', buildingId: civic(sim).id, unit: 'worker' });
    run(sim, 30);
  }
  assert.deepEqual(stable(a.serialize()), stable(b.serialize()));
  assert.notDeepEqual(stable(a.state.map), stable(fresh({ seed: 142858 }).state.map), 'different seeds change map generation');
});

test('resources move spatially through worker carry and a compatible drop-off', () => {
  const sim = fresh(), worker = workers(sim)[0], base = civic(sim);
  // Isolated economy fixture: one nearby source, no other player-owned gather orders.
  for (const unit of entities(sim, 'unit')) accepted(sim, { type: 'order', ids: [unit.id], order: { type: 'idle' } });
  const source = sim.state.entities.find(e => e.kind === 'resource' && e.resource === 'wood');
  source.x = base.x + 165; source.y = base.y; source.amount = 100;
  worker.x = source.x - 35; worker.y = source.y;
  const before = resources(sim), sourceBefore = source.amount;
  run(sim, 1); assert.deepEqual(resources(sim), before, 'idle units must not generate passive income');
  accepted(sim, { type: 'order', ids: [worker.id], order: { type: 'gather', targetId: source.id } });
  let carried = false, deposited = false;
  for (let i = 0; i < 1200; i++) {
    sim.tick(.05);
    if (worker.carry?.amount > 0) { carried = true; if (!deposited) assert.equal(sim.state.players[0].resources.wood, before.wood, 'harvest is not credited before delivery'); }
    if (sim.state.players[0].resources.wood > before.wood) { deposited = true; break; }
  }
  assert.ok(carried, 'citizen actually carries harvested wood');
  assert.ok(deposited, 'citizen returns wood to the civic heart');
  assert.ok(source.amount < sourceBefore, 'source is depleted by harvesting');
  assert.ok(Math.hypot(worker.x - base.x, worker.y - base.y) < 110, 'deposit occurs physically near a drop-off');
});

test('authority, malformed targets, wrong producers, age and disabled cheats reject without spending', () => {
  const sim = fresh(), enemy = civic(sim, 1), worker = workers(sim)[0];
  rejectedUnchanged(sim, { type: 'train', buildingId: enemy.id, unit: 'worker' });
  rejectedUnchanged(sim, { type: 'train', buildingId: civic(sim).id, unit: 'militia' });
  rejectedUnchanged(sim, { type: 'train', buildingId: 'absent', unit: 'worker' });
  rejectedUnchanged(sim, { type: 'order', ids: [entities(sim, 'unit', 1)[0].id], order: { type: 'move', x: 800, y: 800 } });
  rejectedUnchanged(sim, { type: 'order', ids: [worker.id], order: { type: 'gather', targetId: 'absent' } });
  rejectedUnchanged(sim, { type: 'build', ids: [worker.id], building: 'refinery', x: 700, y: 700 });
  rejectedUnchanged(sim, { type: 'build', ids: [worker.id], building: 'house', x: NaN, y: 700 });
  rejectedUnchanged(sim, { type: 'build', ids: [worker.id], building: 'house', x: civic(sim).x, y: civic(sim).y });
  rejectedUnchanged(sim, { type: 'research', buildingId: civic(sim).id, technology: 'forestry' });
  for (const code of ['SUN TREASURY', 'CLEAR SKIES', 'AGES OF SUN', 'SPAWN worker']) rejectedUnchanged(sim, { type: 'cheat', code });
});

test('construction spends its exact cost, completes through a builder, and adds housing', () => {
  const sim = fresh(), before = resources(sim), cap = sim.state.players[0].popCap;
  const house = construct(sim, 'house');
  assert.equal(sim.state.players[0].resources.wood, before.wood - BUILDINGS.house.cost.wood);
  assert.equal(house.owner, 0); assert.equal(house.progress, 1);
  assert.equal(sim.state.players[0].popCap, cap + BUILDINGS.house.population);
});

test('training costs, queue cancellation refund, population gate and rally apply to actual units', () => {
  const sim = fresh(), base = civic(sim), before = resources(sim), population = sim.state.players[0].population;
  accepted(sim, { type: 'train', buildingId: base.id, unit: 'worker' });
  assert.equal(sim.state.players[0].resources.food, before.food - UNITS.worker.cost.food);
  assert.equal(base.queue.length, 1);
  accepted(sim, { type: 'cancel', buildingId: base.id, index: 0 });
  assert.equal(base.queue.length, 0); assert.deepEqual(resources(sim), before, 'unstarted training refunds its full cost');
  assert.equal(sim.state.players[0].population, population);
  accepted(sim, { type: 'rally', buildingId: base.id, x: base.x + 130, y: base.y + 110 });
  const unit = train(sim, base, 'worker');
  assert.equal(sim.state.players[0].population, population + 1);
  assert.ok(Math.hypot(unit.x - base.x, unit.y - base.y) > base.size, 'unit spawns outside the producing building');
  assert.equal(unit.order.type, 'move');
  sim.state.players[0].popCap = sim.state.players[0].population;
  rejectedUnchanged(sim, { type: 'train', buildingId: base.id, unit: 'worker' });
});

test('all four ages enforce prerequisites and automatically upgrade units while retaining identity and queued orders', () => {
  const sim = fresh(), base = civic(sim);
  rejectedUnchanged(sim, { type: 'advance', buildingId: base.id });
  const hall = construct(sim, 'barracks'); construct(sim, 'house');
  const unit = train(sim, hall, 'militia'), id = unit.id;
  accepted(sim, { type: 'order', ids: [id], order: { type: 'patrol', x: unit.x + 70, y: unit.y + 60 } });
  accepted(sim, { type: 'order', ids: [id], order: { type: 'move', x: unit.x + 120, y: unit.y + 100 }, queue: true });
  for (let target = 1; target <= 3; target++) {
    if (target === 2) { rejectedUnchanged(sim, { type: 'advance', buildingId: base.id }); construct(sim, 'forge'); construct(sim, 'market'); }
    if (target === 3) { rejectedUnchanged(sim, { type: 'advance', buildingId: base.id }); construct(sim, 'workshop'); construct(sim, 'fort'); }
    const before = resources(sim), queued = structuredClone(unit.orderQueue);
    accepted(sim, { type: 'advance', buildingId: base.id });
    for (const [resource, cost] of Object.entries(AGE_COSTS[target].cost)) assert.equal(sim.state.players[0].resources[resource], before[resource] - cost);
    run(sim, AGE_COSTS[target].time + .1);
    assert.equal(sim.state.players[0].age, target);
    const upgraded = sim.state.entities.find(e => e.id === id);
    assert.ok(upgraded); assert.equal(upgraded.owner, 0);
    assert.equal(upgraded.type, ['militia', 'legionary', 'cohort', 'rifleman'][target]);
    assert.deepEqual(upgraded.orderQueue, queued, 'automatic upgrade preserves pending orders');
    assert.equal(upgraded.order.type, 'patrol', 'automatic upgrade preserves active patrol');
  }
  rejectedUnchanged(sim, { type: 'advance', buildingId: base.id });
});

test('research spends exact technology costs, applies visible effects and rejects duplicate research', () => {
  const sim = fresh(), forge = construct(sim, 'forge'), range = construct(sim, 'range'), archer = train(sim, range, 'archer');
  const before = resources(sim);
  accepted(sim, { type: 'research', buildingId: forge.id, technology: 'fletching' });
  for (const [resource, cost] of Object.entries(TECHNOLOGIES.fletching.cost)) assert.equal(sim.state.players[0].resources[resource], before[resource] - cost);
  rejectedUnchanged(sim, { type: 'research', buildingId: forge.id, technology: 'fletching' });
  run(sim, TECHNOLOGIES.fletching.time + .1);
  assert.ok(sim.state.players[0].techs.includes('fletching'));
  // Actual projectile damage demonstrates the dynamic effect on a previously trained troop.
  const target = entities(sim, 'unit', 1).find(e => e.type === 'worker');
  sim.state.map.terrain.fill(0); target.x = 1000; target.y = 1000;
  archer.x = 850; archer.y = 1000; archer.cooldown = 0;
  sim.index(); sim.nav.rebuild(sim.state.entities); sim.fog();
  accepted(sim, { type: 'order', ids: [archer.id], order: { type: 'attack', targetId: target.id } });
  sim.tick(.05);
  const shot = sim.state.projectiles.find(p => p.targetId === target.id && p.owner === 0);
  assert.ok(shot, 'existing archer fires after research');
  assert.ok(shot.damage > UNITS.archer.damage, 'research improves actual projectile damage');
  rejectedUnchanged(sim, { type: 'research', buildingId: forge.id, technology: 'fletching' });
});

test('serialization preserves queued commands and deterministic AI continuation without sharing mutable data', () => {
  const sim = fresh({ isolate: false }), worker = workers(sim)[0], base = civic(sim);
  accepted(sim, { type: 'order', ids: [worker.id], order: { type: 'move', x: 1900, y: 100 } });
  accepted(sim, { type: 'order', ids: [worker.id], order: { type: 'move', x: 1750, y: 700 }, queue: true });
  accepted(sim, { type: 'train', buildingId: base.id, unit: 'worker' });
  run(sim, 20);
  const save = JSON.parse(JSON.stringify(sim.serialize())), restored = Simulation.restore(save);
  assert.deepEqual(stable(restored.serialize()), stable(sim.serialize()));
  assert.equal(restored.state.entities.find(e => e.id === worker.id).orderQueue.length, 1);
  save.state ? save.state.players[0].resources.food = -999 : save.players[0].resources.food = -999;
  assert.ok(restored.state.players[0].resources.food >= 0, 'restored state does not alias save data');
  run(sim, 25); run(restored, 25);
  assert.deepEqual(stable(restored.serialize()), stable(sim.serialize()), 'restored RNG and queues resume exactly');
});

test('queued population is reserved globally and cancellation makes the slot available', () => {
  const sim = fresh(), base = civic(sim);
  sim.state.players[0].popCap = sim.state.players[0].population + 1;
  accepted(sim, { type: 'train', buildingId: base.id, unit: 'worker' });
  rejectedUnchanged(sim, { type: 'train', buildingId: base.id, unit: 'worker' });
  accepted(sim, { type: 'cancel', buildingId: base.id, index: 0 });
  accepted(sim, { type: 'train', buildingId: base.id, unit: 'worker' });
  assert.equal(base.queue.length, 1);
});

test('placement on impassable terrain or beyond a sealed barrier rejects without paying', () => {
  const sim = fresh(), worker = workers(sim)[0], m = sim.state.map;
  m.terrain.fill(0);
  for (let y = 0; y < m.height; y++) m.terrain[y * m.width + 31] = 1;
  sim.nav.rebuild(sim.state.entities);
  rejectedUnchanged(sim, { type: 'build', ids: [worker.id], building: 'house', x: 1008, y: 500 });
  rejectedUnchanged(sim, { type: 'build', ids: [worker.id], building: 'house', x: 1250, y: 500 });
});

test('training obsolete military IDs at a later age charges and creates the current upgrade', () => {
  const sim = fresh({ startingAge: 2 }), hall = construct(sim, 'barracks'), before = resources(sim);
  const unit = train(sim, hall, 'militia');
  assert.equal(unit.type, 'cohort');
  for (const [resource, cost] of Object.entries(UNITS.cohort.cost)) assert.equal(resources(sim)[resource], before[resource] - cost, 'upgraded unit is not produced for an obsolete cost');
});

test('anti-cavalry counters and siege damage are exercised by actual attack orders', () => {
  function duel(attackerType, targetType, kind = 'unit') {
    const sim = fresh({ fog: false });
    sim.state.entities = sim.state.entities.filter(e => e.kind === 'building');
    sim.state.map.terrain.fill(0);
    const attacker = sim.create('unit', attackerType, 0, 1000, 1000);
    const target = sim.create(kind, targetType, 1, 1040, 1000, kind === 'building' ? { progress: 1 } : {});
    sim.index(); sim.nav.rebuild(sim.state.entities);
    const hp = target.hp;
    accepted(sim, { type: 'order', ids: [attacker.id], order: { type: 'attack', targetId: target.id } });
    sim.tick(.05);
    return hp - target.hp;
  }
  const infantryDamage = duel('spear', 'militia'), cavalryDamage = duel('spear', 'scout');
  assert.ok(infantryDamage > 0);
  assert.ok(cavalryDamage > infantryDamage * 2, 'anti-cavalry unit deals meaningfully increased damage to cavalry');
  const normalDamage = duel('militia', 'house', 'building'), siegeDamage = duel('ram', 'house', 'building');
  assert.ok(normalDamage > 0); assert.ok(siegeDamage > normalDamage * 3, 'siege is effective against structures');
});

test('conquest requires both civic-heart destruction and removal of military resistance; completed matches freeze', () => {
  const sim = fresh({ fog: false, startingAge: 1 });
  sim.state.entities = sim.state.entities.filter(e => e.kind === 'building');
  sim.state.map.terrain.fill(0);
  const enemyBase = civic(sim, 1), attacker = sim.create('unit', 'ram', 0, enemyBase.x - 85, enemyBase.y);
  const resistance = sim.create('unit', 'scout', 1, 1050, 900);
  sim.create('unit', 'worker', 1, 1950, 1800); // Workers alone cannot prolong conquest.
  enemyBase.hp = 1; resistance.hp = 1;
  sim.index(); sim.nav.rebuild(sim.state.entities);
  accepted(sim, { type: 'order', ids: [attacker.id], order: { type: 'attack', targetId: enemyBase.id } });
  run(sim, 1);
  assert.equal(enemyBase.alive, false); assert.equal(sim.state.winner, null, 'an army can continue fighting after its civic heart falls');
  attacker.x = resistance.x - 35; attacker.y = resistance.y; attacker.cooldown = 0; sim.index();
  accepted(sim, { type: 'order', ids: [attacker.id], order: { type: 'attack', targetId: resistance.id } });
  run(sim, 1);
  assert.equal(sim.state.winner, 0);
  const won = stable(sim.serialize()); run(sim, 5); assert.deepEqual(stable(sim.serialize()), won, 'victory freezes simulation');
  assert.equal(sim.command({ type: 'train', buildingId: civic(sim).id, unit: 'worker' }).ok, false);
  const lost = fresh(); accepted(lost, { type: 'resign' }); assert.equal(lost.state.winner, 1);
  const time = lost.state.time; run(lost, 1); assert.equal(lost.state.time, time, 'defeat freezes simulation');
});

test('gathering technology affects its resource and a capacity technology changes actual carried loads', () => {
  function gathering(techs, resource, seconds) {
    const sim = fresh({ startingAge: 1 }), worker = workers(sim)[0];
    sim.state.players[0].techs = techs; // Explicit effect fixture; research costs/queue tested separately.
    sim.state.map.terrain.fill(0);
    const source = sim.state.entities.find(e => e.kind === 'resource' && e.resource === resource);
    worker.x = 1000; worker.y = 1000; source.x = 1015; source.y = 1000;
    sim.index(); sim.nav.rebuild(sim.state.entities);
    accepted(sim, { type: 'order', ids: [worker.id], order: { type: 'gather', targetId: source.id } });
    run(sim, seconds); return worker.carry?.amount || 0;
  }
  const ordinaryWood = gathering([], 'wood', 1), improvedWood = gathering(['forestry'], 'wood', 1);
  assert.ok(improvedWood > ordinaryWood * 1.2, 'wood gathering tech accelerates harvesting');
  assert.equal(gathering(['forestry'], 'food', 1), gathering([], 'food', 1), 'wood effect does not leak into food');
  assert.ok(gathering(['husbandry'], 'wood', 10) > gathering([], 'wood', 10), 'capacity upgrade increases the actual load before delivery');
});

test('a citizen follows actual move commands through terrain gaps without entering blocked cells', () => {
  const sim = fresh(), worker = workers(sim)[0], m = sim.state.map;
  m.terrain.fill(0); worker.x = 500; worker.y = 450;
  for (let row = 0; row < m.height; row++) if (row < 26 || row > 29) m.terrain[row * m.width + 23] = 1;
  sim.index(); sim.nav.rebuild(sim.state.entities);
  accepted(sim, { type: 'order', ids: [worker.id], order: { type: 'move', x: 960, y: 450 } });
  let visitedGap = false;
  for (let i = 0; i < 1400 && worker.order.type !== 'idle'; i++) {
    sim.tick(.05);
    const cell = Math.floor(worker.y / 32) * m.width + Math.floor(worker.x / 32);
    assert.equal(m.terrain[cell], 0, 'physical movement must not tunnel through impassable terrain');
    if (worker.x >= 710 && worker.x <= 770 && worker.y >= 832) visitedGap = true;
  }
  assert.ok(visitedGap); assert.ok(Math.hypot(worker.x - 960, worker.y - 450) <= 10, 'worker arrives at destination');
});

test('fog remembers explored cells while current visibility follows a moving scout', () => {
  const sim = fresh({ fog: true }), scout = entities(sim, 'unit').find(e => e.type !== 'worker');
  const { width, cellSize } = sim.state.map;
  const old = Math.floor(scout.y / cellSize) * width + Math.floor(scout.x / cellSize);
  run(sim, .1); assert.equal(sim.state.fog.visible[old], 1); assert.equal(sim.state.fog.explored[old], 1);
  // Relocation fixture specifically tests visibility recomputation independently of navigation.
  for (const e of sim.state.entities.filter(e => e.owner === 0)) { e.x = 100; e.y = 100; }
  scout.x = 1650; scout.y = 350;
  run(sim, .2);
  assert.equal(sim.state.fog.explored[old], 1, 'exploration persists after departure');
  assert.equal(sim.state.fog.visible[old], 0, 'previous location is no longer currently visible');
  const current = Math.floor(scout.y / cellSize) * width + Math.floor(scout.x / cellSize);
  assert.equal(sim.state.fog.visible[current], 1);
});

test('retargeting a partial resource load deposits only the harvested amount', () => {
  const sim = fresh(), worker = workers(sim)[0], base = civic(sim);
  sim.state.map.terrain.fill(0);
  const wood = sim.state.entities.find(e => e.kind === 'resource' && e.resource === 'wood');
  const food = sim.state.entities.find(e => e.kind === 'resource' && e.resource === 'food');
  wood.x = base.x + 180; wood.y = base.y; food.x = base.x + 200; food.y = base.y + 60;
  worker.x = wood.x - 20; worker.y = wood.y;
  sim.index(); sim.nav.rebuild(sim.state.entities);
  const before = resources(sim);
  accepted(sim, { type: 'order', ids: [worker.id], order: { type: 'gather', targetId: wood.id } });
  run(sim, 1);
  const partial = worker.carry?.amount;
  assert.ok(partial > 0 && partial < UNITS.worker.carryCapacity, 'fixture starts with a genuine partial load');
  assert.equal(resources(sim).wood, before.wood);
  accepted(sim, { type: 'order', ids: [worker.id], order: { type: 'gather', targetId: food.id } });
  for (let i = 0; i < 1200 && resources(sim).wood === before.wood; i++) sim.tick(.05);
  assert.ok(Math.abs(resources(sim).wood - before.wood - partial) < 1e-8, 'retarget does not inflate a partial load to full carrying capacity');
  assert.equal(resources(sim).food, before.food, 'new resource is not credited before its own physical harvest and delivery');
});

test('placing a foundation beneath the assigned builder evacuates it and construction completes', () => {
  const sim = fresh(), worker = workers(sim)[0];
  sim.state.map.terrain.fill(0); worker.x = 1000; worker.y = 1000;
  sim.index(); sim.nav.rebuild(sim.state.entities);
  const result = accepted(sim, { type: 'build', ids: [worker.id], building: 'house', x: worker.x, y: worker.y });
  const house = sim.state.entities.find(e => e.id === result.entityId);
  assert.ok(house);
  run(sim, BUILDINGS.house.buildTime + 25);
  assert.equal(house.progress, 1, 'foundation cannot permanently entomb its assigned builder');
  assert.equal(sim.nav.free(worker.x, worker.y, worker.size, worker.owner), true);
});

test('a move into an occupied building footprint arrives at its clear edge and finishes', () => {
  const sim = fresh(), worker = workers(sim)[0], base = civic(sim);
  worker.x = base.x + 200; worker.y = base.y;
  sim.index();
  accepted(sim, { type: 'order', ids: [worker.id], order: { type: 'move', x: base.x, y: base.y } });
  run(sim, 10);
  assert.equal(worker.order.type, 'idle', 'snapped move destination must resolve the command');
  assert.ok(Math.hypot(worker.x - base.x, worker.y - base.y) >= base.size + worker.size);
});

test('hunting kills an animal before harvesting its persistent carcass and delivering food', () => {
  const sim = fresh(), worker = workers(sim)[0];
  sim.state.map.terrain.fill(0); worker.x = 1000; worker.y = 1000;
  const animal = sim.resource('food', 1015, 1000, 5, 'animal');
  sim.index(); sim.nav.rebuild(sim.state.entities);
  const before = resources(sim).food;
  accepted(sim, { type: 'order', ids: [worker.id], order: { type: 'gather', targetId: animal.id } });
  let hit = false;
  for (let i = 0; i < 500 && !animal.hunted; i++) {
    sim.tick(.05);
    if (animal.animalHp < animal.maxAnimalHp) hit = true;
    assert.equal(resources(sim).food, before, 'a living animal does not generate income');
    assert.equal(animal.amount, 5, 'food is not harvested until the animal is killed');
    assert.equal(worker.carry, null, 'hunting damage does not become a carried food load');
    assert.equal(animal.alive, true, 'animal entity persists through hunting');
  }
  assert.ok(hit); assert.equal(animal.hunted, true, 'real gather order completes hunting');
  assert.equal(animal.alive, true, 'the killed animal remains as a spatial carcass');
  assert.ok(sim.state.entities.some(e => e.id === animal.id));
  sim.tick(.05);
  assert.ok(worker.carry?.amount > 0, 'citizen begins collecting from the carcass');
  assert.equal(animal.alive, true, 'partially harvested corpse is retained');
  for (let i = 0; i < 1200 && resources(sim).food === before; i++) sim.tick(.05);
  assert.ok(Math.abs(resources(sim).food - before - 5) < 1e-8, 'only the carcass food physically carried home is credited');
  assert.equal(animal.alive, false, 'carcass disappears after complete harvest');
  assert.equal(sim.state.entities.some(e => e.id === animal.id), false, 'depleted carcass is safely removed');
});
