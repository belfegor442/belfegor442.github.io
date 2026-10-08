export const PROTOCOL_VERSION = 1;
export const CLIENT_VERSION = '1.0.0';

export const TICK_RATE = 20;
export const TICK_MS = 1000 / TICK_RATE;
export const STATE_BROADCAST_EVERY = 2;
export const STATE_HZ = TICK_RATE / STATE_BROADCAST_EVERY;

export const WORLD = {
  width: 26,
  depth: 18,
  minX: 1,
  maxX: 25,
  minZ: 1.2,
  maxZ: 17,
  spawnZ: 14.5,
};

export const PLAYER = {
  radius: 0.42,
  speed: 4.2,
  animBlendMs: 120,
};

export const STATION = {
  machineWidth: 2.0,
  machineDepth: 1.6,
  machineZ: 2.6,
  standZ: 4.1,
  approachZ: 5.2,
  interactionRange: 2.6,
  useRange: 2.2,
};

export const MACHINE = {
  reelCount: 3,
  baseSpeeds: [214, 297, 168],
  perfectWindow: 9,
  goodWindow: 22,
  okWindow: 45,
  stopScores: { PERFECT: 100, GOOD: 60, OK: 25, MISS: 0 },
  comboPerPerfect: 1,
  comboStep: 0.25,
  comboMax: 4,
  comboWindowMs: 1600,
  heat: {
    PERFECT: 8,
    GOOD: 5,
    OK: 2,
    MISS: 0,
    decayPerSecIdle: 5,
    overbrewAt: 100,
    pressureAt: 50,
    riskAt: 75,
    criticalAt: 90,
    coolOnOverbrewSuccess: 25,
    coolFromCooler: 25,
    riskHeatOnMiss: 10,
  },
  speedByThreshold: [
    { at: 90, mult: 1.3 },
    { at: 75, mult: 1.2 },
    { at: 50, mult: 1.1 },
    { at: 0, mult: 1.0 },
  ],
  overbrewWindowMs: 2000,
  overbrewMultiplier: 2,
  overbrewFailPenalty: 0.25,
  maxHolds: 2,
  holdValue: 0.6,
  minStopIntervalMs: 120,
  maxInputLatencyMs: 400,
  minSpinGapMs: 350,
  wobblePerReel: 34,
};

export const MISCHIEF = {
  max: 100,
  start: 100,
  regenPerSec: 5,
  regenTickEveryMs: 250,
};

export const SABOTAGE = {
  THROW_BEER: { cost: 30, cooldownMs: 6000, range: 7, target: 'PLAYER', effect: 'SPLASH' },
  PEANUT: { cost: 10, cooldownMs: 3000, range: 6, target: 'PLAYER', effect: 'JOLT' },
  BELL: { cost: 20, cooldownMs: 8000, range: 8, target: 'PLAYER', effect: 'DING' },
  SMOKE: { cost: 25, cooldownMs: 12000, range: 5, target: 'PLAYER', effect: 'SMOKE' },
  COIN: { cost: 15, cooldownMs: 5000, range: 6, target: 'PLAYER', effect: 'COIN' },
  COOLER: { cost: 20, cooldownMs: 10000, range: 5, target: 'PLAYER', effect: 'COOL' },
  CLEAN: { cost: 5, cooldownMs: 4000, range: 0, target: 'SELF', effect: 'CLEAN' },
};

export const EFFECTS = {
  SPLASH: { durationMs: 3000, speedMult: 0.85, negative: true },
  JOLT: { durationMs: 2000, speedMult: 1.0, negative: true },
  DING: { durationMs: 900, speedMult: 1.0, negative: true },
  SMOKE: { durationMs: 5000, speedMult: 0.7, negative: true },
  SMOKE_AREA: { durationMs: 5000, radius: 3.2, negative: true },
  COIN: { durationMs: 0, speedMult: 1.0, negative: true },
  COOL: { durationMs: 0, speedMult: 1.0, negative: false },
  CLEAN: { durationMs: 0, speedMult: 1.0, negative: false },
  CELEBRATE: { durationMs: 2000, speedMult: 1.0, negative: false },
};

export const INTERACTIONS = {
  SPECTATE: { },
  STOP_SPECTATE: { },
  TEACH_REQUEST: { timeoutMs: 20000 },
  PRACTICE_REQUEST: { timeoutMs: 20000 },
  CHALLENGE_REQUEST: { timeoutMs: 20000 },
  TAKEOVER_REQUEST: { timeoutMs: 15000 },
  RESPONSE: { timeoutMs: 8000 },
};

export const CHALLENGE = {
  durationMs: 30000,
  startHeat: 30,
  cooldownMs: 45000,
  takeoverDurationMs: 10000,
  maxSpectators: 6,
};

export const ROOM = {
  sizes: [2, 4, 6, 8],
  minPlayersToStart: 1,
  emptyGraceMs: 60000,
  reconnectGraceMs: 30000,
  idleTimeoutMs: 90000,
  maxRooms: 50,
  codeLength: 6,
  eventMinGapMs: 75000,
  eventMaxGapMs: 135000,
  eventDurationMs: 30000,
};

export const ROOM_EVENTS = {
  HAPPY_HOUR: { scoreMult: 2, heatMult: 1 },
  PINT_RUSH: { scoreMult: 1, heatDecayMult: 2.5 },
  LAST_CALL: { scoreMult: 1.5, heatMult: 1 },
  TOAST: { scoreMult: 1, bonus: 50 },
};

export const ROOM_PHASES = ['LOBBY', 'ROOM_JOINED', 'READY', 'PLAYING', 'ACTIVE_SOCIAL_STATE', 'PLAYER_LEAVES', 'CLOSING'];

export const MOVEMENT = {
  maxIntentMagnitude: 1,
  maxPositionDeltaPerTick: PLAYER.speed / TICK_RATE + 0.06,
  inputHistoryMs: 600,
};

export const NET = {
  maxPacketBytes: 8192,
  heartbeatIntervalMs: 5000,
  heartbeatTimeoutMs: 15000,
  pingIntervalMs: 5000,
  ackTimeoutMs: 6000,
  requestCacheSize: 256,
  maxQueuedMessages: 128,
};

export const RATE_LIMITS = {
  default: { tokens: 40, refillPerSec: 25 },
  MOVE: { tokens: 45, refillPerSec: 35 },
  MACHINE_INPUT: { tokens: 25, refillPerSec: 14 },
  SABOTAGE: { tokens: 6, refillPerSec: 1.2 },
  CHAT: { tokens: 4, refillPerSec: 0.6 },
  REACTION: { tokens: 6, refillPerSec: 2 },
  INTERACTION: { tokens: 8, refillPerSec: 2 },
  CREATE_ROOM: { tokens: 4, refillPerSec: 0.1 },
  JOIN_ROOM: { tokens: 8, refillPerSec: 0.5 },
  REQUEST_STATE_SYNC: { tokens: 5, refillPerSec: 0.4 },
  AUTH: { tokens: 5, refillPerSec: 0.3 },
};

export const EMOTES = ['CHEER', 'CLAP', 'LAUGH', 'THINK', 'ANGRY', 'WAVE', 'FACEPALM', 'MONEY'];

export const AVATAR_COLORS = ['#e0533f', '#3f8de0', '#4fbf6a', '#e0b53f', '#a55fe0', '#e05fa8', '#3fd0c8', '#e07f3f'];
