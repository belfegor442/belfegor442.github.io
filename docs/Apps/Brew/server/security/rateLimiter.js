export class TokenBucket {
  constructor({ tokens, refillPerSec }) {
    this.capacity = tokens;
    this.tokens = tokens;
    this.refillPerSec = refillPerSec;
    this.updatedAt = Date.now();
  }

  refill(now = Date.now()) {
    const elapsed = (now - this.updatedAt) / 1000;
    if (elapsed <= 0) return;
    this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.refillPerSec);
    this.updatedAt = now;
  }

  tryTake(cost = 1, now = Date.now()) {
    this.refill(now);
    if (this.tokens < cost) return false;
    this.tokens -= cost;
    return true;
  }

  available(now = Date.now()) {
    this.refill(now);
    return this.tokens;
  }
}

export class RateLimiter {
  constructor({ limits, enabled = true, multiplier = 1, clock = Date.now } = {}) {
    this.limits = limits;
    this.enabled = enabled;
    this.multiplier = multiplier;
    this.clock = clock;
    this.buckets = new Map();
  }

  limitFor(category) {
    const base = this.limits[category] || this.limits.default;
    return {
      tokens: Math.max(1, base.tokens * this.multiplier),
      refillPerSec: Math.max(0.05, base.refillPerSec * this.multiplier),
    };
  }

  bucket(category) {
    let bucket = this.buckets.get(category);
    if (!bucket) {
      bucket = new TokenBucket(this.limitFor(category));
      this.buckets.set(category, bucket);
    }
    return bucket;
  }

  allow(category, cost = 1) {
    if (!this.enabled) return true;
    return this.bucket(category).tryTake(cost, this.clock());
  }

  reset() {
    this.buckets.clear();
  }
}
