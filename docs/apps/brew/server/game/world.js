import { WORLD, PLAYER, STATION, EFFECTS } from '../../shared/constants.js';

export function buildWorld(maxPlayers) {
  const count = Math.max(1, Math.min(maxPlayers, 8));
  const spacing = Math.min(4.2, (WORLD.width - 4) / count);
  const center = WORLD.width / 2;
  const stations = [];
  const obstacles = [];
  const spawnPoints = [];

  for (let i = 0; i < count; i += 1) {
    const x = Math.round((center + (i - (count - 1) / 2) * spacing) * 100) / 100;
    const station = {
      id: i,
      x,
      machineZ: STATION.machineZ,
      standX: x,
      standZ: STATION.standZ,
      approachX: x,
      approachZ: STATION.approachZ,
      facing: -Math.PI / 2,
      assignedTo: null,
      occupiedBy: null,
      machine: null,
    };
    stations.push(station);
    obstacles.push({
      kind: 'machine',
      minX: x - STATION.machineWidth / 2,
      maxX: x + STATION.machineWidth / 2,
      minZ: STATION.machineZ - STATION.machineDepth / 2,
      maxZ: STATION.machineZ + STATION.machineDepth / 2,
      ref: station.id,
    });
  }

  obstacles.push({ kind: 'bar', minX: 17.8, maxX: 24.6, minZ: 9.6, maxZ: 11.2 });
  obstacles.push({ kind: 'table', minX: 3.2, maxX: 5.0, minZ: 10.4, maxZ: 12.2 });
  obstacles.push({ kind: 'table', minX: 8.6, maxX: 10.4, minZ: 13.0, maxZ: 14.8 });
  obstacles.push({ kind: 'table', minX: 14.2, maxX: 16.0, minZ: 10.4, maxZ: 12.2 });

  const spawnCols = Math.min(count + 2, 6);
  for (let i = 0; i < 8; i += 1) {
    const col = i % spawnCols;
    const row = Math.floor(i / spawnCols);
    spawnPoints.push({
      x: WORLD.width / 2 + (col - (spawnCols - 1) / 2) * 2.2,
      z: WORLD.spawnZ - row * 1.8,
    });
  }

  return { maxPlayers: count, stations, obstacles, spawnPoints };
}

export function clampToWorld(x, z) {
  return {
    x: Math.min(WORLD.maxX - PLAYER.radius, Math.max(WORLD.minX + PLAYER.radius, x)),
    z: Math.min(WORLD.maxZ - PLAYER.radius, Math.max(WORLD.minZ + PLAYER.radius, z)),
  };
}

export function resolveCollisions(x, z, radius, obstacles, iterations = 3) {
  let cx = x;
  let cz = z;
  for (let pass = 0; pass < iterations; pass += 1) {
    let moved = false;
    for (const box of obstacles) {
      const closestX = Math.min(Math.max(cx, box.minX), box.maxX);
      const closestZ = Math.min(Math.max(cz, box.minZ), box.maxZ);
      let dx = cx - closestX;
      let dz = cz - closestZ;
      const distSq = dx * dx + dz * dz;
      if (distSq >= radius * radius) continue;
      if (distSq === 0) {
        const pushLeft = cx - box.minX + radius;
        const pushRight = box.maxX - cx + radius;
        const pushUp = cz - box.minZ + radius;
        const pushDown = box.maxZ - cz + radius;
        const min = Math.min(pushLeft, pushRight, pushUp, pushDown);
        if (min === pushLeft) cx = box.minX - radius;
        else if (min === pushRight) cx = box.maxX + radius;
        else if (min === pushUp) cz = box.minZ - radius;
        else cz = box.maxZ + radius;
      } else {
        const dist = Math.sqrt(distSq);
        const overlap = radius - dist;
        dx /= dist;
        dz /= dist;
        cx += dx * overlap;
        cz += dz * overlap;
      }
      moved = true;
    }
    if (!moved) break;
  }
  const clamped = clampToWorld(cx, cz);
  return clamped;
}

export function effectSpeedMultiplier(effects, now) {
  let mult = 1;
  for (const effect of effects) {
    if (effect.until <= now) continue;
    const def = EFFECTS[effect.kind];
    if (def && def.speedMult) mult *= def.speedMult;
  }
  return mult;
}

export function applyMovement(player, intent, dtMs, world, now) {
  if (player.stationId !== null && player.stationId !== undefined) {
    return { moved: false, distance: 0 };
  }
  let dx = Number.isFinite(intent.dx) ? intent.dx : 0;
  let dz = Number.isFinite(intent.dz) ? intent.dz : 0;
  const mag = Math.hypot(dx, dz);
  if (mag > 1) {
    dx /= mag;
    dz /= mag;
  }
  if (mag < 0.0001) {
    if (player.anim === 'WALK') player.anim = 'IDLE';
    return { moved: false, distance: 0 };
  }
  const speed = PLAYER.speed * effectSpeedMultiplier(player.effects, now);
  const step = (speed * dtMs) / 1000;
  const nextX = player.x + dx * step;
  const nextZ = player.z + dz * step;
  const resolved = resolveCollisions(nextX, nextZ, PLAYER.radius, world.obstacles);
  const moved = Math.abs(resolved.x - player.x) > 1e-6 || Math.abs(resolved.z - player.z) > 1e-6;
  const distance = Math.hypot(resolved.x - player.x, resolved.z - player.z);
  player.x = resolved.x;
  player.z = resolved.z;
  player.facing = Math.atan2(dz, dx);
  player.anim = 'WALK';
  player.moving = true;
  player.lastMoveAt = now;
  return { moved, distance };
}

export function nearStation(player, station, range = STATION.interactionRange) {
  const dx = player.x - station.approachX;
  const dz = player.z - station.approachZ;
  return dx * dx + dz * dz <= range * range;
}

export function nearestStation(player, world, range = STATION.interactionRange) {
  let best = null;
  let bestDist = range * range;
  for (const station of world.stations) {
    const dx = player.x - station.approachX;
    const dz = player.z - station.approachZ;
    const d = dx * dx + dz * dz;
    if (d <= bestDist) {
      bestDist = d;
      best = station;
    }
  }
  return best;
}
