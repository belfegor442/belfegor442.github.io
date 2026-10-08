import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const OPCODE = { CONT: 0x0, TEXT: 0x1, BINARY: 0x2, CLOSE: 0x8, PING: 0x9, PONG: 0xa };
const MAX_CONTROL_PAYLOAD = 125;

function acceptKey(key) {
  return crypto.createHash('sha1').update(`${key}${WS_GUID}`).digest('base64');
}

export function encodeFrame(opcode, payload = Buffer.alloc(0), mask = false) {
  const len = payload.length;
  let header;
  let offset = 2;
  if (len < 126) {
    header = Buffer.alloc(2);
    header[1] = len;
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[1] = 126;
    header.writeUInt16BE(len, 2);
    offset = 4;
  } else {
    header = Buffer.alloc(10);
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
    offset = 10;
  }
  header[0] = 0x80 | opcode;
  if (!mask) {
    return Buffer.concat([header, payload]);
  }
  const maskKey = crypto.randomBytes(4);
  const masked = Buffer.from(payload);
  for (let i = 0; i < masked.length; i += 1) masked[i] ^= maskKey[i & 3];
  const head = Buffer.concat([header, maskKey]);
  head[1] |= 0x80;
  return Buffer.concat([head, masked]);
}

export class WebSocketConnection extends EventEmitter {
  constructor(socket, { maxPayload = 8192, onMessage, onClose, onError } = {}) {
    super();
    this.setMaxListeners(32);
    this.socket = socket;
    this.maxPayload = maxPayload;
    this.alive = true;
    this.closed = false;
    this.closeSent = false;
    this.fragments = [];
    this.fragmentOpcode = null;
    this.buffer = Buffer.alloc(0);
    this.cursor = 0;
    this.bytesRead = 0;
    this.bytesWritten = 0;
    this.lastPongAt = Date.now();
    this.onMessage = onMessage;
    this.onClose = onClose;
    this.onError = onError;

    socket.on('data', (chunk) => this.onData(chunk));
    socket.on('error', (err) => this.fail(err));
    socket.on('close', () => this.finish(1006, 'socket closed'));
    socket.setTimeout(0);
    socket.setNoDelay(true);
  }

  onData(chunk) {
    this.bytesRead += chunk.length;
    this.buffer = this.cursor
      ? Buffer.concat([this.buffer.subarray(this.cursor), chunk])
      : Buffer.concat([this.buffer, chunk]);
    this.cursor = 0;
    if (this.buffer.length > this.maxPayload * 4 + 65536) {
      this.close(1009, 'frame buffer overflow');
      return;
    }
    this.parse();
  }

  parse() {
    let handled = true;
    while (handled) {
      handled = this.parseFrame();
    }
    if (this.cursor > 0) {
      this.buffer = this.buffer.subarray(this.cursor);
      this.cursor = 0;
    }
  }

  parseFrame() {
    const buf = this.buffer;
    if (buf.length - this.cursor < 2) return false;
    const start = this.cursor;
    const b0 = buf[start];
    const b1 = buf[start + 1];
    const fin = (b0 & 0x80) !== 0;
    const rsv = b0 & 0x70;
    const opcode = b0 & 0x0f;
    const masked = (b1 & 0x80) !== 0;
    let len = b1 & 0x7f;
    let offset = start + 2;

    if (rsv !== 0) {
      this.close(1002, 'reserved bits unsupported');
      return false;
    }
    if (len === 126) {
      if (buf.length - offset < 2) return false;
      len = buf.readUInt16BE(offset);
      offset += 2;
    } else if (len === 127) {
      if (buf.length - offset < 8) return false;
      const big = buf.readBigUInt64BE(offset);
      if (big > BigInt(this.maxPayload)) {
        this.close(1009, 'payload too large');
        return false;
      }
      len = Number(big);
      offset += 8;
    }

    const isControl = (opcode & 0x8) !== 0;
    if (isControl && (!fin || len > MAX_CONTROL_PAYLOAD)) {
      this.close(1002, 'bad control frame');
      return false;
    }
    if (!isControl && len > this.maxPayload) {
      this.close(1009, 'payload too large');
      return false;
    }

    let maskKey = null;
    if (masked) {
      if (buf.length - offset < 4) return false;
      maskKey = buf.subarray(offset, offset + 4);
      offset += 4;
    }

    if (buf.length - offset < len) return false;

    let payload = buf.subarray(offset, offset + len);
    if (maskKey) {
      payload = Buffer.from(payload);
      for (let i = 0; i < payload.length; i += 1) payload[i] ^= maskKey[i & 3];
    }
    this.cursor = offset + len;

    if (!masked && this.alive) {
      this.close(1002, 'client frames must be masked');
      return false;
    }

    switch (opcode) {
      case OPCODE.PING:
        this.rawSend(encodeFrame(OPCODE.PONG, payload));
        break;
      case OPCODE.PONG:
        this.lastPongAt = Date.now();
        this.emit('pong', payload);
        break;
      case OPCODE.CLOSE: {
        const code = payload.length >= 2 ? payload.readUInt16BE(0) : 1005;
        if (!this.closeSent && payload.length <= 125) {
          this.closeSent = true;
          this.rawSend(encodeFrame(OPCODE.CLOSE, payload));
        }
        this.close(code === 1005 ? 1000 : code, 'peer close', true);
        break;
      }
      case OPCODE.TEXT:
      case OPCODE.BINARY: {
        if (this.fragmentOpcode) {
          this.close(1002, 'interleaved data frame');
          break;
        }
        if (!fin) {
          this.fragmentOpcode = opcode;
          this.fragments = [payload];
          if (payload.length > this.maxPayload) this.close(1009, 'payload too large');
        } else {
          this.deliver(opcode, payload);
        }
        break;
      }
      case OPCODE.CONT: {
        if (!this.fragmentOpcode) {
          this.close(1002, 'unexpected continuation');
          break;
        }
        this.fragments.push(payload);
        const total = this.fragments.reduce((n, f) => n + f.length, 0);
        if (total > this.maxPayload) {
          this.close(1009, 'payload too large');
          break;
        }
        if (fin) {
          const full = Buffer.concat(this.fragments);
          const op = this.fragmentOpcode;
          this.fragments = [];
          this.fragmentOpcode = null;
          this.deliver(op, full);
        }
        break;
      }
      default:
        this.close(1002, 'unknown opcode');
    }
    return true;
  }

  deliver(opcode, payload) {
    if (!this.alive) return;
    if (opcode === OPCODE.BINARY) {
      this.emit('binary', payload);
      return;
    }
    const text = payload.toString('utf8');
    if (Buffer.byteLength(text, 'utf8') !== payload.length) {
      this.emit('malformed');
      return;
    }
    if (this.onMessage) this.onMessage(text);
    this.emit('message', text);
  }

  rawSend(frame) {
    if (this.closed || this.socket.destroyed) return false;
    this.bytesWritten += frame.length;
    return this.socket.write(frame);
  }

  send(text) {
    if (this.closed || !this.alive) return false;
    const payload = Buffer.from(text, 'utf8');
    if (payload.length > this.maxPayload) return false;
    return this.rawSend(encodeFrame(OPCODE.TEXT, payload));
  }

  ping(payload = Buffer.alloc(0)) {
    if (this.closed || !this.alive) return false;
    return this.rawSend(encodeFrame(OPCODE.PING, payload));
  }

  get bufferedAmount() {
    return this.socket.writableLength || 0;
  }

  close(code = 1000, reason = '', fromPeer = false) {
    if (this.closed) return;
    this.alive = false;
    if (!fromPeer && !this.closeSent) {
      this.closeSent = true;
      const text = Buffer.from(reason || '', 'utf8').subarray(0, 120);
      const body = Buffer.alloc(2 + text.length);
      body.writeUInt16BE(code, 0);
      text.copy(body, 2);
      this.rawSend(encodeFrame(OPCODE.CLOSE, body));
    }
    const timer = setTimeout(() => this.finish(code, reason), 400);
    if (typeof timer.unref === 'function') timer.unref();
    try {
      this.socket.end();
    } catch {
      this.finish(code, reason);
    }
  }

  fail(err) {
    if (this.onError) this.onError(err);
    this.emit('error', err);
    this.finish(1006, err && err.message ? err.message : 'socket error');
  }

  finish(code, reason) {
    if (this.closed) return;
    this.closed = true;
    this.alive = false;
    try {
      this.socket.destroy();
    } catch {
      /* socket already gone */
    }
    if (this.onClose) this.onClose(code, reason);
    this.emit('close', code, reason);
  }
}

export function handleUpgrade(req, socket, head, options = {}) {
  const key = req.headers['sec-websocket-key'];
  const version = req.headers['sec-websocket-version'];
  const upgrade = String(req.headers.upgrade || '').toLowerCase();
  if (upgrade !== 'websocket' || !key || version !== '13') {
    socket.write('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
    socket.destroy();
    return null;
  }
  const accept = acceptKey(String(key));
  const protocols = options.protocol ? `\r\nSec-WebSocket-Protocol: ${options.protocol}` : '';
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
      'Upgrade: websocket\r\n' +
      'Connection: Upgrade\r\n' +
      `Sec-WebSocket-Accept: ${accept}${protocols}\r\n\r\n`,
  );
  const conn = new WebSocketConnection(socket, options);
  if (head && head.length) conn.onData(head);
  if (options.onOpen) options.onOpen(conn, req);
  return conn;
}
