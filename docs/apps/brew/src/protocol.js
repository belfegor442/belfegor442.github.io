export const NS = 'na-brew/v3/';
export const MAX_PLAYERS = 20;
export const LIMITS = { name: 12, pid: 6, chat: 140 };
export const SPEED = 190;
export const RADIUS = 14;
export const PROX = { chat: 320, emote: 460, interact: 58 };
export const TICK = { move: 83, snap: 100, full: 3000, beat: 5000, retry: 700, retries: 4 };
export const MOVE_TOLERANCE = 1.9;

const ALPHA = 'abcdefghijklmnopqrstuvwxyz0123456789';
const CODE = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function token(len = 8) {
  const b = new Uint8Array(len);
  crypto.getRandomValues(b);
  let s = '';
  for (const n of b) s += ALPHA[n % ALPHA.length];
  return s;
}
export function roomCode() {
  const b = new Uint8Array(6);
  crypto.getRandomValues(b);
  let s = '';
  for (const n of b) s += CODE[n % CODE.length];
  return s;
}
export function topics(room) {
  const base = NS + room + '/';
  return {
    host: base + 'host',
    c: base + 'c',
    s: base + 's',
    p: uid => base + 'p/' + uid,
    pAll: base + 'p/+'
  };
}
export const TYPES = ['hello', 'welcome', 'join', 'leave', 'mv', 'snap', 'sit', 'stand',
  'emote', 'chat', 'interact', 'obj', 'activity.start', 'activity.input',
  'activity.update', 'activity.end', 'ack', 'err', 'ping', 'pong', 'bye', 'presence'];
