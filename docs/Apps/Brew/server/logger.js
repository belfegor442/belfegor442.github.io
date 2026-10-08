const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };

const REDACT_KEYS = /(token|secret|password|authorization|credential|sessionKey)/i;

function redact(value, depth = 0) {
  if (depth > 4) return '[deep]';
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => redact(v, depth + 1));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = REDACT_KEYS.test(k) ? '[redacted]' : redact(v, depth + 1);
    }
    return out;
  }
  return value;
}

export class Logger {
  constructor({ level = 'info', format = 'pretty', bindings = {}, stream = process.stdout } = {}) {
    this.levelName = LEVELS[level] === undefined ? 'info' : level;
    this.threshold = LEVELS[this.levelName];
    this.format = format;
    this.bindings = bindings;
    this.stream = stream;
  }

  child(bindings = {}) {
    return new Logger({
      level: this.levelName,
      format: this.format,
      bindings: { ...this.bindings, ...bindings },
      stream: this.stream,
    });
  }

  setLevel(level) {
    if (LEVELS[level] !== undefined) {
      this.levelName = level;
      this.threshold = LEVELS[level];
    }
  }

  write(level, message, data) {
    if (LEVELS[level] < this.threshold) return;
    const record = {
      time: new Date().toISOString(),
      level,
      message,
      ...redact(this.bindings),
      ...(data ? redact(data) : {}),
    };
    if (this.format === 'json') {
      this.stream.write(`${JSON.stringify(record)}\n`);
      return;
    }
    const { time, level: lvl, message: msg, ...rest } = record;
    const extras = Object.keys(rest).length ? ` ${JSON.stringify(rest)}` : '';
    this.stream.write(`${time.slice(11, 23)} ${lvl.toUpperCase().padEnd(5)} ${msg}${extras}\n`);
  }

  debug(message, data) {
    this.write('debug', message, data);
  }

  info(message, data) {
    this.write('info', message, data);
  }

  warn(message, data) {
    this.write('warn', message, data);
  }

  error(message, data) {
    this.write('error', message, data);
  }
}

export function createLogger(config) {
  return new Logger({ level: config.logLevel, format: config.logFormat });
}
