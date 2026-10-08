import crypto from 'node:crypto';

const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';

export function randomId(prefix = '') {
  const raw = crypto.randomBytes(12).toString('base64url').replace(/[-_]/g, '');
  const id = raw.slice(0, 16).toLowerCase();
  return prefix ? `${prefix}_${id}` : id;
}

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function roomCode(length = 6) {
  const bytes = crypto.randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i += 1) out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return out;
}

export function shuffle(list) {
  const arr = list.slice();
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = crypto.randomInt(i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export function nowMs() {
  return Date.now();
}

export function monotonicMs() {
  return Number(process.hrtime.bigint() / 1000000n);
}

export function clamp(value, min, max) {
  return value < min ? min : value > max ? max : value;
}

export function dist2(ax, az, bx, bz) {
  const dx = ax - bx;
  const dz = az - bz;
  return dx * dx + dz * dz;
}

export function normalizeAngle(deg) {
  let a = deg % 360;
  if (a < 0) a += 360;
  return a;
}

export function angleDelta(a, b) {
  let d = Math.abs(normalizeAngle(a) - normalizeAngle(b));
  if (d > 180) d = 360 - d;
  return d;
}
