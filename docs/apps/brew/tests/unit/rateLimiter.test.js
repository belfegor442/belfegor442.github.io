import test from 'node:test';
import assert from 'node:assert/strict';
import { TokenBucket, RateLimiter } from '../../server/security/rateLimiter.js';
import { RATE_LIMITS } from '../../shared/constants.js';

test('TokenBucket spends and refuses when empty', () => {
  const bucket = new TokenBucket({ tokens: 3, refillPerSec: 1 });
  const now = Date.now();
  assert.equal(bucket.tryTake(1, now), true);
  assert.equal(bucket.tryTake(1, now), true);
  assert.equal(bucket.tryTake(1, now), true);
  assert.equal(bucket.tryTake(1, now), false);
  assert.ok(bucket.available(now) < 1);
});

test('TokenBucket refills over time up to capacity', () => {
  const bucket = new TokenBucket({ tokens: 2, refillPerSec: 2 });
  const now = Date.now();
  assert.equal(bucket.tryTake(2, now), true);
  assert.equal(bucket.tryTake(1, now), false);
  assert.equal(bucket.tryTake(1, now + 400), false, 'not enough time yet');
  assert.equal(bucket.tryTake(1, now + 600), true, 'one token refilled after 500ms');
  assert.equal(bucket.tryTake(5, now + 100_000), false, 'refill never exceeds capacity');
  assert.ok(bucket.available(now + 100_000) <= 2);
});

test('RateLimiter enforces per-category budgets', () => {
  let clock = 0;
  const limiter = new RateLimiter({ limits: RATE_LIMITS, clock: () => clock });
  const budget = RATE_LIMITS.CHAT.tokens;
  for (let i = 0; i < budget; i += 1) {
    assert.equal(limiter.allow('CHAT'), true, `chat ${i} allowed`);
  }
  assert.equal(limiter.allow('CHAT'), false, 'chat budget exhausted');
  assert.equal(limiter.allow('MOVE'), true, 'other categories keep their own buckets');
});

test('RateLimiter honours multiplier, disabled mode and reset', () => {
  let clock = 0;
  const strict = new RateLimiter({ limits: RATE_LIMITS, multiplier: 0.2, clock: () => clock });
  const tokens = Math.max(1, RATE_LIMITS.CHAT.tokens * 0.2);
  let allowed = 0;
  while (strict.allow('CHAT')) allowed += 1;
  assert.equal(allowed, Math.floor(tokens));

  const off = new RateLimiter({ limits: RATE_LIMITS, enabled: false });
  for (let i = 0; i < 500; i += 1) assert.equal(off.allow('CHAT'), true);

  const limiter = new RateLimiter({ limits: RATE_LIMITS, clock: () => clock });
  while (limiter.allow('REACTION')) {
    /* drain */
  }
  assert.equal(limiter.allow('REACTION'), false);
  limiter.reset();
  assert.equal(limiter.allow('REACTION'), true);
});

test('unknown categories fall back to the default limit', () => {
  const limiter = new RateLimiter({ limits: RATE_LIMITS });
  const budget = RATE_LIMITS.default.tokens;
  let allowed = 0;
  while (limiter.allow('SOME_UNKNOWN')) allowed += 1;
  assert.ok(allowed >= budget, `expected at least ${budget} tokens, got ${allowed}`);
});
