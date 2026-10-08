import { MISCHIEF, AVATAR_COLORS } from '../../shared/constants.js';
import { randomId } from '../util/ids.js';

export function createSessionStats() {
  return {
    score: 0,
    rounds: 0,
    stops: 0,
    perfects: 0,
    good: 0,
    ok: 0,
    misses: 0,
    maxCombo: 0,
    heatPeak: 0,
    overbrewSuccess: 0,
    overbrewFail: 0,
    sabotageThrown: 0,
    sabotageHit: 0,
    challengesPlayed: 0,
    challengesWon: 0,
    spectated: 0,
    distanceWalked: 0,
    roomEvents: 0,
    gamesPlayed: 1,
    practiceRounds: 0,
  };
}

export function createRoomPlayer({ profile, connection, stationIndex = -1, spawn }) {
  const colorIndex = Math.abs(hashCode(profile.id)) % AVATAR_COLORS.length;
  return {
    id: profile.id,
    username: profile.username,
    displayName: profile.displayName || profile.username,
    avatar: {
      color: profile.avatar?.color || AVATAR_COLORS[colorIndex],
      style: profile.avatar?.style || 'bartender',
      accessory: profile.avatar?.accessory || null,
    },
    connection,
    connectionId: connection ? connection.id : null,
    status: 'ONLINE',
    joinedAt: Date.now(),
    disconnectedAt: 0,
    lastSeenAt: Date.now(),
    ready: false,
    host: false,
    stationId: null,
    x: spawn.x,
    z: spawn.z,
    facing: Math.PI / 2,
    anim: 'IDLE',
    animUntil: 0,
    moving: false,
    intent: { dx: 0, dz: 0 },
    intentSeq: 0,
    lastMoveAt: 0,
    stateVersion: 0,
    emote: null,
    emoteUntil: 0,
    effects: [],
    mischief: MISCHIEF.start,
    lastMischiefSync: Math.floor(MISCHIEF.start),
    sabotageCooldowns: {},
    spectatorOf: null,
    stationIndex,
    stats: createSessionStats(),
    pendingFrom: new Set(),
    pendingTo: new Set(),
    challengeCooldownUntil: 0,
    chatBurst: [],
    sessionStartedAt: Date.now(),
    pingMs: 0,
    rejoined: false,
  };
}

export function touchPlayer(player, now) {
  player.lastSeenAt = now;
  player.stateVersion += 1;
}

export function markDirty(player) {
  player.stateVersion += 1;
}

export function isOnline(player) {
  return player.status === 'ONLINE' && player.connection && player.connection.state !== 'CLOSED';
}

export function playerPublic(player, now = Date.now()) {
  return {
    id: player.id,
    username: player.username,
    name: player.displayName,
    avatar: player.avatar,
    stationId: player.stationId,
    x: Math.round(player.x * 100) / 100,
    z: Math.round(player.z * 100) / 100,
    facing: Math.round(player.facing * 1000) / 1000,
    anim: player.anim,
    status: player.status,
    ready: player.ready,
    host: player.host,
    mischief: Math.floor(player.mischief),
    emote: player.emoteUntil > now ? player.emote : null,
    spectating: player.spectatorOf,
    score: player.stats.score,
    effects: player.effects.filter((effect) => effect.until > now).map((effect) => effect.kind),
  };
}

function hashCode(text) {
  let h = 0;
  for (let i = 0; i < text.length; i += 1) h = (Math.imul(31, h) + text.charCodeAt(i)) | 0;
  return h;
}

export function newPendingId() {
  return randomId('pend');
}
