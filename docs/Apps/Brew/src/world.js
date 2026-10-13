// Multi-scene world facade. The lobby keeps its hand-authored data (below);
// the 7 game rooms come from scenes.js. Everything that used to be a const
// here (MAP, OBJECTS, SEATS, the collision helpers) now reads the ACTIVE
// scene through live bindings, so the renderer and the client keep working
// unchanged after a scene swap. The host authority must never use this
// facade for other players' scenes: it calls getScene(p.scene) instead.

import { makeSceneWorld, buildRoomData, ROOM_KINDS, LOBBY_TERMINALS } from './scenes.js';

const lobbyData = (() => {
  const MAP = { w: 2472, h: 1300, wall: 36 };

  const OBJECTS = [
    { id: 'w-n', type: 'wall', x: 0, y: 0, w: MAP.w, h: MAP.wall, solid: true, hgt: 54 },
    { id: 'w-s', type: 'wall', x: 0, y: MAP.h - MAP.wall, w: MAP.w, h: MAP.wall, solid: true, hgt: 54 },
    { id: 'w-w', type: 'wall', x: 0, y: 0, w: MAP.wall, h: MAP.h, solid: true, hgt: 54 },
    { id: 'w-e', type: 'wall', x: MAP.w - MAP.wall, y: 0, w: MAP.wall, h: MAP.h, solid: true, hgt: 54 },

    // Central floor stays open. The previous invisible 470x1000 'monument' was a solid collider with no renderer geometry.
    { id: 'rug', type: 'rug', x: 360, y: 330, w: 1000, h: 520, solid: false, hgt: 0 },
    { id: 'neon', type: 'sign', x: 640, y: 6, w: 430, h: 34, solid: false, hgt: 64, label: 'BREW' },

    // Narrowed so the fallback bar never intersects felt t4 (x from 1908).
    { id: 'bar', type: 'bar', x: 1190, y: 74, w: 120, h: 80, solid: true, hgt: 48 },
    { id: 'shelf', type: 'shelf', x: 1210, y: 54, w: 240, h: 30, solid: false, hgt: 74 },

    // Gameplay tables sit at the original model-world felts (six poker tables
    // and a roulette counter). glb:true = coordinates already in map space,
    // exempt from the KX pass below.
    { id: 't1', type: 'table', kind: 'poker', x: 1564, y: 111, w: 121, h: 211, solid: true, hgt: 32, glb: true },
    { id: 't2', type: 'table', kind: 'poker', x: 1564, y: 484, w: 121, h: 211, solid: true, hgt: 32, glb: true },
    { id: 't3', type: 'table', kind: 'poker', x: 1564, y: 857, w: 121, h: 211, solid: true, hgt: 32, glb: true },
    { id: 't4', type: 'table', kind: 'poker', x: 1908, y: 111, w: 121, h: 211, solid: true, hgt: 32, glb: true },
    { id: 't5', type: 'table', kind: 'poker', x: 1908, y: 484, w: 121, h: 211, solid: true, hgt: 32, glb: true },
    { id: 't6', type: 'table', kind: 'poker', x: 1908, y: 857, w: 121, h: 211, solid: true, hgt: 32, glb: true },
    { id: 'rt', type: 'table', kind: 'roulette', x: 1182, y: 476, w: 109, h: 226, solid: true, hgt: 36, glb: true },

    { id: 'plant-1', type: 'plant', x: 74, y: 96, w: 74, h: 74, solid: true, hgt: 62 },
    { id: 'plant-2', type: 'plant', x: 1560, y: 1010, w: 74, h: 74, solid: true, hgt: 62 },
    { id: 'plant-3', type: 'plant', x: 78, y: 1016, w: 74, h: 74, solid: true, hgt: 62 },
    { id: 'column', type: 'column', x: 1450, y: 300, w: 54, h: 54, solid: true, hgt: 150 },
    { id: 'column-2', type: 'column', x: 1514, y: 920, w: 54, h: 54, solid: true, hgt: 150 },

    { id: 'lights', type: 'switch', x: 46, y: 548, w: 22, h: 56, solid: false, hgt: 44 },
    { id: 'coat', type: 'decor', x: 140, y: 40, w: 110, h: 26, solid: false, hgt: 60, label: 'WARDROBE' },

    // Slot machine banks against the west wall: five banks of three cabinets,
    // built by map.js slotBank(b, z0) with z0 in {210,400,590,780,970} and
    // machines spanning x[46,99]. These rects mirror that geometry 1:1 so
    // collision and the vote-point proximity check line up with the cabinets;
    // mapSpace = the rect is already in final map coordinates (no KX/KZ pass).
    { id: 'slot-1', type: 'slots', x: 46, y: 185, w: 53, h: 150, solid: true, hgt: 66, mapSpace: true },
    { id: 'slot-2', type: 'slots', x: 46, y: 375, w: 53, h: 150, solid: true, hgt: 66, mapSpace: true },
    { id: 'slot-3', type: 'slots', x: 46, y: 565, w: 53, h: 150, solid: true, hgt: 66, mapSpace: true },
    { id: 'slot-4', type: 'slots', x: 46, y: 755, w: 53, h: 150, solid: true, hgt: 66, mapSpace: true },
    { id: 'slot-5', type: 'slots', x: 46, y: 945, w: 53, h: 150, solid: true, hgt: 66, mapSpace: true },

    // Arcade vote terminals along the south wall (mapSpace, no KX/KZ pass).
    // Each cabinet starts the vote for its game; the west-wall slot banks
    // serve the same role for 'slots'.
    ...LOBBY_TERMINALS
  ];

  // The map frame is 2.1:1 (2472x1300); the old 1720-wide frame forced that
  // aspect into 1.46:1 and squashed every side-to-side aisle 30%. Scale the
  // hand-placed x-coordinates by MAP.w / 1720 so they keep the same layout.
  const KX = MAP.w / 1720;
  // The map got deeper on request (2472x1300, a gentle +10%); every
  // hand-placed z (and the model-copied felts/stools) scales with
  // MAP.h / 1180 the same way KX handles x. glb objects keep their x untouched.
  const KZ = MAP.h / 1180;
  for (const o of OBJECTS) {
    if (o.type === 'wall') continue; // walls span MAP.w / MAP.h via MAP constants
    if (o.mapSpace) continue; // slot-bank and terminal rects live in final map space
    if (!o.glb) { o.x *= KX; o.w *= KX; }
    o.y *= KZ;
    o.h *= KZ;
  }

  const TABLES = OBJECTS.filter(o => o.type === 'table');

  function facing(from, to) { return Math.atan2(to.y - from.y, to.x - from.x); }

  function seat(id, table, x, y, dir) {
    return { id, table, x, y, dir, occupiedBy: null };
  }

  // Seat anchors are the stools around each table: seven chairs ring each
  // poker felt, six spots ring the roulette counter, model-world coords,
  // facing the table centre.
  const STOOLS = {
    t1: [[1527, 216], [1543, 285], [1543, 147], [1590, 338], [1590, 94], [1657, 358], [1657, 74]],
    t2: [[1527, 589], [1543, 658], [1543, 521], [1590, 711], [1590, 467], [1657, 731], [1657, 447]],
    t3: [[1527, 962], [1543, 1031], [1543, 894], [1590, 1084], [1590, 841], [1657, 1105], [1657, 820]],
    t4: [[2065, 216], [2050, 285], [2050, 147], [2003, 338], [2003, 94], [1936, 358], [1936, 74]],
    t5: [[2065, 589], [2050, 658], [2050, 521], [2003, 711], [2003, 467], [1936, 731], [1936, 447]],
    t6: [[2065, 962], [2050, 1031], [2050, 894], [2003, 1084], [2003, 841], [1936, 1105], [1936, 820]],
    rt: [[1200, 446], [1272, 446], [1200, 732], [1272, 732], [1152, 589], [1321, 589]]
  };

  const SEATS = (() => {
    const list = [];
    for (const t of TABLES) {
      const spots = STOOLS[t.id] || [];
      const cx = t.x + t.w / 2, cy = t.y + t.h / 2;
      spots.forEach((sp, i) => {
        const sy = sp[1] * KZ;
        list.push(seat(t.id + '-' + i, t.id, sp[0], sy, facing({ x: sp[0], y: sy }, { x: cx, y: cy })));
      });
    }
    return list;
  })();

  const SPAWNS = [
    { x: 430, y: 560 }, { x: 430, y: 260 }, { x: 1600, y: 600 },
    { x: 1600, y: 300 }, { x: 512, y: 940 }, { x: 300, y: 940 },
    { x: 1300, y: 940 }, { x: 1580, y: 940 }, { x: 510, y: 1100 },
    { x: 300, y: 1100 }, { x: 1300, y: 1100 }, { x: 1560, y: 1110 }
  ];
  for (const s of SPAWNS) { s.x *= KX; s.y *= KZ; }

  return { id: 'lobby', MAP, OBJECTS, SEATS, SPAWNS, LIGHTS: [] };
})();

const WORLDS = new Map();
WORLDS.set('lobby', makeSceneWorld(lobbyData));
for (const kind of ROOM_KINDS) {
  WORLDS.set(kind, makeSceneWorld(buildRoomData(kind)));
}

let active = WORLDS.get('lobby');

export let MAP = active.MAP;
export let OBJECTS = active.OBJECTS;
export let SEATS = active.SEATS;
export let SPAWNS = active.SPAWNS;
export let SEAT_BY_ID = active.SEAT_BY_ID;
export let OBJ_BY_ID = active.OBJ_BY_ID;

export function getScene(id) { return WORLDS.get(id) || null; }
export function listScenes() { return [...WORLDS.keys()]; }

// Swap the facade to another scene. Returns the new world (null when the id
// is unknown). The renderer calls this from useScene(); the client calls it
// only while applying a host-authoritative scene teleport.
export function setScene(id) {
  const w = WORLDS.get(id);
  if (!w) return null;
  active = w;
  MAP = w.MAP;
  OBJECTS = w.OBJECTS;
  SEATS = w.SEATS;
  SPAWNS = w.SPAWNS;
  SEAT_BY_ID = w.SEAT_BY_ID;
  OBJ_BY_ID = w.OBJ_BY_ID;
  return w;
}

export function activeSceneId() { return active.id; }

// Fill in one scene's collision nav grid (rasterised from its geometry).
export function setSceneNav(id, nav) {
  const w = WORLDS.get(id);
  if (w) w.nav = nav;
}

export function setNav(n) { active.nav = n; }
export function getNav() { return active.nav; }

export function seatFree(id) { return active.seatFree(id); }
export function tableOf(seatId) { return active.tableOf(seatId); }
export function seatsAt(tableId) { return active.seatsAt(tableId); }
export function move(x, y, nx, ny, r) { return active.move(x, y, nx, ny, r); }
export function eject(x, y, r) { return active.eject(x, y, r); }
export function blocked(x, y, r) { return active.blocked(x, y, r); }
export function nearestSeat(x, y, maxDist) { return active.nearestSeat(x, y, maxDist); }
export function insideInteract(x, y, range) { return active.insideInteract(x, y, range); }
export function nearestVotePoint(x, y, maxDist) { return active.nearestVotePoint(x, y, maxDist); }

// Distance to the nearest machine cabinet / slot bank of the active scene.
// Kept under the old name so existing call sites read unchanged.
export function nearestSlotBank(x, y, maxDist) { return active.nearestMachine(x, y, maxDist); }

export function dist(a, b) { return active.dist(a, b); }
