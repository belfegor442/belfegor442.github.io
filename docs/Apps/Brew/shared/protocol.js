import {
  PROTOCOL_VERSION,
  SABOTAGE,
  EMOTES,
  ROOM,
  WORLD,
  MACHINE,
} from './constants.js';

export const C2S = {
  HELLO: 'HELLO',
  PING: 'PING',
  REQUEST_STATE_SYNC: 'REQUEST_STATE_SYNC',
  ROOM_LIST: 'ROOM_LIST',
  CREATE_ROOM: 'CREATE_ROOM',
  JOIN_ROOM: 'JOIN_ROOM',
  LEAVE_ROOM: 'LEAVE_ROOM',
  SET_READY: 'SET_READY',
  START_MATCH: 'START_MATCH',
  MOVE: 'MOVE',
  MOUNT_STATION: 'MOUNT_STATION',
  DISMOUNT: 'DISMOUNT',
  MACHINE_INPUT: 'MACHINE_INPUT',
  INTERACTION: 'INTERACTION',
  SABOTAGE: 'SABOTAGE',
  REACTION: 'REACTION',
  CHAT: 'CHAT',
};

export const S2C = {
  SESSION_ESTABLISHED: 'SESSION_ESTABLISHED',
  ACK: 'ACK',
  ERROR: 'ERROR',
  ROOM_LIST_RESULT: 'ROOM_LIST_RESULT',
  ROOM_SNAPSHOT: 'ROOM_SNAPSHOT',
  ROOM_STATE: 'ROOM_STATE',
  ROOM_EVENT: 'ROOM_EVENT',
  SERVER_EVENT: 'SERVER_EVENT',
  PONG: 'PONG',
};

export const ERROR_CODES = {
  AUTH_REQUIRED: 'AUTH_REQUIRED',
  AUTH_INVALID: 'AUTH_INVALID',
  AUTH_EXPIRED: 'AUTH_EXPIRED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_IN_ROOM: 'NOT_IN_ROOM',
  ALREADY_IN_ROOM: 'ALREADY_IN_ROOM',
  ROOM_NOT_FOUND: 'ROOM_NOT_FOUND',
  ROOM_FULL: 'ROOM_FULL',
  ROOM_LOCKED: 'ROOM_LOCKED',
  ROOM_UNAVAILABLE: 'ROOM_UNAVAILABLE',
  MAX_ROOMS: 'MAX_ROOMS',
  INVALID_ACTION: 'INVALID_ACTION',
  INVALID_PAYLOAD: 'INVALID_PAYLOAD',
  INVALID_PACKET: 'INVALID_PACKET',
  PACKET_TOO_LARGE: 'PACKET_TOO_LARGE',
  UNKNOWN_MESSAGE: 'UNKNOWN_MESSAGE',
  PROTOCOL_MISMATCH: 'PROTOCOL_MISMATCH',
  COOLDOWN: 'COOLDOWN',
  NOT_ENOUGH_MISCHIEF: 'NOT_ENOUGH_MISCHIEF',
  OUT_OF_RANGE: 'OUT_OF_RANGE',
  INVALID_TARGET: 'INVALID_TARGET',
  NOT_READY: 'NOT_READY',
  RATE_LIMITED: 'RATE_LIMITED',
  DUPLICATE_REQUEST: 'DUPLICATE_REQUEST',
  STATE_MISMATCH: 'STATE_MISMATCH',
  NOT_AUTHORIZED: 'NOT_AUTHORIZED',
  STATION_OCCUPIED: 'STATION_OCCUPIED',
  STATION_EMPTY: 'STATION_EMPTY',
  REQUEST_TIMEOUT: 'REQUEST_TIMEOUT',
  SERVER_BUSY: 'SERVER_BUSY',
  SERVER_UNAVAILABLE: 'SERVER_UNAVAILABLE',
  RECONNECT_FAILED: 'RECONNECT_FAILED',
  INTERNAL: 'INTERNAL',
};

export const INTERACTION_KINDS = [
  'SPECTATE',
  'STOP_SPECTATE',
  'TEACH_REQUEST',
  'PRACTICE_REQUEST',
  'CHALLENGE_REQUEST',
  'TAKEOVER_REQUEST',
  'RESPONSE',
];

export const INTERACTION_RESPONSES = ['ACCEPT', 'DECLINE'];

export const MACHINE_ACTIONS = ['SPIN', 'STOP', 'HOLD', 'RELEASE'];

export function message(type, payload = {}, requestId = null, timestamp = null) {
  const out = { type, payload };
  if (requestId) out.requestId = requestId;
  if (timestamp != null) out.timestamp = timestamp;
  return out;
}

export function encode(msg) {
  return JSON.stringify(msg);
}

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isStr = (v) => typeof v === 'string';
const isBool = (v) => typeof v === 'boolean';
const isInt = (v) => isNum(v) && Number.isInteger(v);

function str(v, min, max) {
  return isStr(v) && v.length >= min && v.length <= max;
}

function boundedInt(v, min, max) {
  return isInt(v) && v >= min && v <= max;
}

function oneOf(v, list) {
  return isStr(v) && list.includes(v);
}

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const ROOM_CODE_RE = /^[A-Za-z0-9]{4,8}$/;

function checkId(v) {
  return v === undefined || v === null || (isStr(v) && ID_RE.test(v));
}

const validators = {
  [C2S.HELLO]: (p) =>
    str(p.sessionToken, 8, 1024) &&
    (p.reconnectToken === undefined || str(p.reconnectToken, 8, 1024)) &&
    (p.clientVersion === undefined || str(p.clientVersion, 1, 32)) &&
    (p.protocol === undefined || boundedInt(p.protocol, 0, 1e6)),

  [C2S.PING]: (p) => isNum(p.t),

  [C2S.REQUEST_STATE_SYNC]: () => true,

  [C2S.ROOM_LIST]: () => true,

  [C2S.CREATE_ROOM]: (p) => ROOM.sizes.includes(p.maxPlayers),

  [C2S.JOIN_ROOM]: (p) =>
    (p.roomId !== undefined && str(p.roomId, 1, 64)) ||
    (p.roomCode !== undefined && ROOM_CODE_RE.test(p.roomCode)),

  [C2S.LEAVE_ROOM]: () => true,

  [C2S.SET_READY]: (p) => isBool(p.ready),

  [C2S.START_MATCH]: () => true,

  [C2S.MOVE]: (p) =>
    isNum(p.dx) && isNum(p.dz) && Math.abs(p.dx) <= 1.5 && Math.abs(p.dz) <= 1.5 &&
    (p.seq === undefined || boundedInt(p.seq, 0, 1e9)),

  [C2S.MOUNT_STATION]: (p) => p.stationId === undefined || boundedInt(p.stationId, 0, 15),

  [C2S.DISMOUNT]: () => true,

  [C2S.MACHINE_INPUT]: (p) =>
    oneOf(p.action, MACHINE_ACTIONS) &&
    (p.reel === undefined || boundedInt(p.reel, 0, MACHINE.reelCount - 1)) &&
    (p.hold === undefined || isBool(p.hold)) &&
    (p.clientTime === undefined || isNum(p.clientTime)),

  [C2S.INTERACTION]: (p) =>
    oneOf(p.kind, INTERACTION_KINDS) &&
    checkId(p.targetPlayerId) &&
    (p.accept === undefined || isBool(p.accept)) &&
    (p.pendingId === undefined || checkId(p.pendingId)),

  [C2S.SABOTAGE]: (p) =>
    oneOf(p.action, Object.keys(SABOTAGE)) && checkId(p.targetPlayerId),

  [C2S.REACTION]: (p) => oneOf(p.emote, EMOTES),

  [C2S.CHAT]: (p) => str(p.text, 1, 160),
};

export function validateMessage(msg) {
  if (!msg || typeof msg !== 'object') return { ok: false, code: ERROR_CODES.INVALID_PACKET };
  if (!isStr(msg.type)) return { ok: false, code: ERROR_CODES.INVALID_PACKET };
  if (msg.requestId !== undefined && msg.requestId !== null && !str(msg.requestId, 1, 64)) {
    return { ok: false, code: ERROR_CODES.INVALID_PAYLOAD };
  }
  if (msg.timestamp !== undefined && msg.timestamp !== null && !isNum(msg.timestamp)) {
    return { ok: false, code: ERROR_CODES.INVALID_PAYLOAD };
  }
  const payload = msg.payload === undefined ? {} : msg.payload;
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    return { ok: false, code: ERROR_CODES.INVALID_PAYLOAD };
  }
  const validator = validators[msg.type];
  if (!validator) return { ok: false, code: ERROR_CODES.UNKNOWN_MESSAGE };
  if (!validator(payload)) return { ok: false, code: ERROR_CODES.INVALID_PAYLOAD };
  return { ok: true, msg: { ...msg, payload } };
}

export function decode(raw) {
  if (typeof raw !== 'string') return { ok: false, code: ERROR_CODES.INVALID_PACKET };
  if (raw.length > 8192) return { ok: false, code: ERROR_CODES.PACKET_TOO_LARGE };
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, code: ERROR_CODES.INVALID_PACKET };
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, code: ERROR_CODES.INVALID_PACKET };
  }
  const check = validateMessage(parsed);
  if (!check.ok) return check;
  return check;
}

export function makeError(code, message, requestId = null, extra = {}) {
  const out = { type: S2C.ERROR, code, message, payload: extra };
  if (requestId) out.requestId = requestId;
  return out;
}

export const ERROR_TEXT = {
  [ERROR_CODES.AUTH_REQUIRED]: 'Authentication required.',
  [ERROR_CODES.AUTH_INVALID]: 'Session could not be verified.',
  [ERROR_CODES.AUTH_EXPIRED]: 'Session expired. Please sign in again.',
  [ERROR_CODES.FORBIDDEN]: 'You are not allowed to do that.',
  [ERROR_CODES.NOT_IN_ROOM]: 'You are not in a room.',
  [ERROR_CODES.ALREADY_IN_ROOM]: 'You are already in a room.',
  [ERROR_CODES.ROOM_NOT_FOUND]: 'That room no longer exists.',
  [ERROR_CODES.ROOM_FULL]: 'That room is full.',
  [ERROR_CODES.ROOM_LOCKED]: 'That room is locked.',
  [ERROR_CODES.ROOM_UNAVAILABLE]: 'That room is unavailable.',
  [ERROR_CODES.MAX_ROOMS]: 'The server has too many rooms open.',
  [ERROR_CODES.INVALID_ACTION]: 'That action is not available right now.',
  [ERROR_CODES.INVALID_PAYLOAD]: 'The server rejected the request format.',
  [ERROR_CODES.INVALID_PACKET]: 'Malformed packet.',
  [ERROR_CODES.PACKET_TOO_LARGE]: 'Packet too large.',
  [ERROR_CODES.UNKNOWN_MESSAGE]: 'Unknown message type.',
  [ERROR_CODES.PROTOCOL_MISMATCH]: 'Client protocol version is not supported.',
  [ERROR_CODES.COOLDOWN]: 'That is on cooldown.',
  [ERROR_CODES.NOT_ENOUGH_MISCHIEF]: 'Not enough Mischief.',
  [ERROR_CODES.OUT_OF_RANGE]: 'Too far away.',
  [ERROR_CODES.INVALID_TARGET]: 'Invalid target.',
  [ERROR_CODES.NOT_READY]: 'You are not ready.',
  [ERROR_CODES.RATE_LIMITED]: 'Slow down.',
  [ERROR_CODES.DUPLICATE_REQUEST]: 'Duplicate request ignored.',
  [ERROR_CODES.STATE_MISMATCH]: 'State out of sync. Resynchronising.',
  [ERROR_CODES.NOT_AUTHORIZED]: 'Not authorised.',
  [ERROR_CODES.STATION_OCCUPIED]: 'That station is occupied.',
  [ERROR_CODES.STATION_EMPTY]: 'That station has no machine in use.',
  [ERROR_CODES.REQUEST_TIMEOUT]: 'The request timed out.',
  [ERROR_CODES.SERVER_BUSY]: 'The server is busy.',
  [ERROR_CODES.SERVER_UNAVAILABLE]: 'The server is unavailable.',
  [ERROR_CODES.RECONNECT_FAILED]: 'Could not restore your session.',
  [ERROR_CODES.INTERNAL]: 'Internal server error.',
};

export function worldBounds() {
  return WORLD;
}

export function protocolVersion() {
  return PROTOCOL_VERSION;
}
