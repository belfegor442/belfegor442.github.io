import test from 'node:test';
import assert from 'node:assert/strict';
import {
  C2S,
  S2C,
  ERROR_CODES,
  ERROR_TEXT,
  message,
  encode,
  decode,
  validateMessage,
  makeError,
  protocolVersion,
} from '../../shared/protocol.js';
import { ROOM, EMOTES, SABOTAGE, PROTOCOL_VERSION } from '../../shared/constants.js';

test('message builds an envelope with optional request metadata', () => {
  assert.deepEqual(message(C2S.PING, { t: 5 }), { type: 'PING', payload: { t: 5 } });
  assert.deepEqual(message(C2S.PING, { t: 5 }, 'c1', 123), {
    type: 'PING',
    payload: { t: 5 },
    requestId: 'c1',
    timestamp: 123,
  });
});

test('encode and decode round-trip a valid MOVE', () => {
  const msg = message(C2S.MOVE, { dx: 1, dz: -0.5, seq: 7 }, 'c9', 1000);
  const decoded = decode(encode(msg));
  assert.equal(decoded.ok, true);
  assert.deepEqual(decoded.msg, msg);
});

test('decode rejects malformed input', () => {
  assert.equal(decode('{not json').ok, false);
  assert.equal(decode('{not json').code, ERROR_CODES.INVALID_PACKET);
  assert.equal(decode(12345).code, ERROR_CODES.INVALID_PACKET);
  assert.equal(decode('[1,2,3]').code, ERROR_CODES.INVALID_PACKET);
  assert.equal(decode('null').code, ERROR_CODES.INVALID_PACKET);
  assert.equal(decode('x'.repeat(9000)).code, ERROR_CODES.PACKET_TOO_LARGE);
});

test('decode rejects known-bad payloads', () => {
  assert.equal(decode(encode(message(C2S.CHAT, { text: '' }))).code, ERROR_CODES.INVALID_PAYLOAD);
  assert.equal(decode(encode(message('NOT_A_TYPE', {}))).code, ERROR_CODES.UNKNOWN_MESSAGE);
  assert.equal(decode(encode(message(C2S.SET_READY, { ready: 'yes' }))).code, ERROR_CODES.INVALID_PAYLOAD);
});

test('validateMessage enforces envelope shape', () => {
  assert.equal(validateMessage(null).code, ERROR_CODES.INVALID_PACKET);
  assert.equal(validateMessage({ payload: {} }).code, ERROR_CODES.INVALID_PACKET);
  assert.equal(validateMessage({ type: 42 }).code, ERROR_CODES.INVALID_PACKET);
  assert.equal(validateMessage({ type: C2S.PING, requestId: '' }).code, ERROR_CODES.INVALID_PAYLOAD);
  assert.equal(validateMessage({ type: C2S.PING, timestamp: 'now' }).code, ERROR_CODES.INVALID_PAYLOAD);
  assert.equal(validateMessage({ type: C2S.PING, payload: [] }).code, ERROR_CODES.INVALID_PAYLOAD);
  const ok = validateMessage({ type: C2S.PING, payload: { t: 1 } });
  assert.equal(ok.ok, true);
});

test('MOVE validator bounds movement intent', () => {
  assert.equal(validateMessage({ type: C2S.MOVE, payload: { dx: 1.5, dz: -1.5 } }).ok, true);
  assert.equal(validateMessage({ type: C2S.MOVE, payload: { dx: 5, dz: 0 } }).code, ERROR_CODES.INVALID_PAYLOAD);
  assert.equal(validateMessage({ type: C2S.MOVE, payload: { dx: 0, dz: NaN } }).code, ERROR_CODES.INVALID_PAYLOAD);
  assert.equal(
    validateMessage({ type: C2S.MOVE, payload: { dx: 0, dz: 0, seq: -1 } }).code,
    ERROR_CODES.INVALID_PAYLOAD,
  );
});

test('room validators enforce codes and sizes', () => {
  assert.equal(validateMessage({ type: C2S.CREATE_ROOM, payload: { maxPlayers: 4 } }).ok, true);
  assert.equal(validateMessage({ type: C2S.CREATE_ROOM, payload: { maxPlayers: 5 } }).code, ERROR_CODES.INVALID_PAYLOAD);
  assert.equal(validateMessage({ type: C2S.JOIN_ROOM, payload: { roomCode: 'ABC123' } }).ok, true);
  assert.equal(
    validateMessage({ type: C2S.JOIN_ROOM, payload: { roomCode: 'ab c' } }).code,
    ERROR_CODES.INVALID_PAYLOAD,
  );
  assert.ok(ROOM.sizes.length > 0);
});

test('machine and social payload validators', () => {
  assert.equal(
    validateMessage({ type: C2S.MACHINE_INPUT, payload: { action: 'SPIN' } }).ok,
    true,
  );
  assert.equal(
    validateMessage({ type: C2S.MACHINE_INPUT, payload: { action: 'DROP' } }).code,
    ERROR_CODES.INVALID_PAYLOAD,
  );
  assert.equal(
    validateMessage({ type: C2S.MACHINE_INPUT, payload: { action: 'HOLD', reel: 9, hold: true } }).code,
    ERROR_CODES.INVALID_PAYLOAD,
  );
  assert.equal(
    validateMessage({ type: C2S.REACTION, payload: { emote: EMOTES[0] } }).ok,
    true,
  );
  assert.equal(
    validateMessage({ type: C2S.SABOTAGE, payload: { action: Object.keys(SABOTAGE)[0], targetPlayerId: 'player_1' } }).ok,
    true,
  );
  assert.equal(
    validateMessage({ type: C2S.INTERACTION, payload: { kind: 'CHALLENGE_REQUEST', targetPlayerId: 'player_1' } }).ok,
    true,
  );
  assert.equal(
    validateMessage({ type: C2S.INTERACTION, payload: { kind: 'NOPE' } }).code,
    ERROR_CODES.INVALID_PAYLOAD,
  );
});

test('HELLO requires a session token and honours protocol', () => {
  assert.equal(validateMessage({ type: C2S.HELLO, payload: { sessionToken: 'abcdefgh' } }).ok, true);
  assert.equal(
    validateMessage({ type: C2S.HELLO, payload: {} }).code,
    ERROR_CODES.INVALID_PAYLOAD,
  );
  assert.equal(protocolVersion(), PROTOCOL_VERSION);
});

test('makeError produces server error frames with readable text', () => {
  const err = makeError(ERROR_CODES.ROOM_FULL, ERROR_TEXT[ERROR_CODES.ROOM_FULL], 'c3');
  assert.equal(err.type, S2C.ERROR);
  assert.equal(err.code, ERROR_CODES.ROOM_FULL);
  assert.equal(err.requestId, 'c3');
  assert.ok(err.message.length > 0);
  const anonymous = makeError(ERROR_CODES.INTERNAL, 'boom');
  assert.equal(anonymous.requestId, undefined);
});
