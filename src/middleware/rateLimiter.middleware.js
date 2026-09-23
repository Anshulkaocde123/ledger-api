const redis = require('../config/redis');
const logger = require('../utils/logger');

/**
 * Token Bucket Lua script executed atomically in Redis.
 *
 * KEYS[1] = ratelimit:{user_id}:{endpoint}
 * ARGV[1] = bucket capacity (max tokens)
 * ARGV[2] = refill rate per millisecond
 * ARGV[3] = current timestamp in milliseconds
 * ARGV[4] = token cost per request (usually 1)
 * ARGV[5] = bucket TTL in seconds
 *
 * Returns array:
 * [1, remaining_tokens, 0]           -> Allowed
 * [0, 0, retry_after_in_seconds]     -> Rate limit exceeded
 */
const TOKEN_BUCKET_LUA = `
local key = KEYS[1]
local capacity = tonumber(ARGV[1])
local refill_rate = tonumber(ARGV[2])
local now = tonumber(ARGV[3])
local cost = tonumber(ARGV[4])
local ttl = tonumber(ARGV[5])

local data = redis.call('HMGET', key, 'tokens', 'last_updated')
local tokens = tonumber(data[1])
local last_updated = tonumber(data[2])

if tokens == nil then
  tokens = capacity
  last_updated = now
else
  local elapsed = now - last_updated
  if elapsed > 0 then
    tokens = math.min(capacity, tokens + (elapsed * refill_rate))
    last_updated = now
  end
end

if tokens >= cost then
  tokens = tokens - cost
  redis.call('HSET', key, 'tokens', tokens, 'last_updated', last_updated)
  redis.call('EXPIRE', key, ttl)
  return {1, math.floor(tokens), 0}
else
  redis.call('HSET', key, 'tokens', tokens, 'last_updated', last_updated)
  redis.call('EXPIRE', key, ttl)
  local missing = cost - tokens
  local retry_after = math.ceil(missing / (refill_rate * 1000))
  if retry_after < 1 then
    retry_after = 1
  end
  return {0, 0, retry_after}
end
`;

/**
 * Factory creating an Express middleware with token bucket rate limiting.
 *
 * @param {Object} options
 * @param {string} options.endpoint - Endpoint identifier (e.g. 'login', 'transfers')
 * @param {number} options.capacity - Maximum bucket size (burst allowance)
 * @param {number} options.refillRatePerMinute - Number of tokens refilled per minute
 * @param {Function} [options.keyGenerator] - Custom function to extract user identifier
 */
const createRateLimiter = ({
  endpoint,
  capacity,
  refillRatePerMinute,
  keyGenerator,
}) => {
  const refillRatePerMs = refillRatePerMinute / 60000;
  const bucketTtlSeconds = Math.max(3600, Math.ceil(capacity / (refillRatePerMinute / 60)) * 2);

  return async (req, res, next) => {
    try {
      // Determine user identifier: priority to authenticated userId, then email or IP
      const userId = keyGenerator
        ? keyGenerator(req)
        : req.user?.userId || req.body?.email || req.ip || 'anonymous';

      // Required key format: ratelimit:{user_id}:{endpoint}
      const redisKey = `ratelimit:${userId}:${endpoint}`;
      const now = Date.now();
      const cost = 1;

      const [allowed, remainingTokens, retryAfter] = await redis.eval(
        TOKEN_BUCKET_LUA,
        1,
        redisKey,
        capacity,
        refillRatePerMs,
        now,
        cost,
        bucketTtlSeconds
      );

      res.setHeader('X-RateLimit-Limit', capacity);

      if (allowed === 1) {
        res.setHeader('X-RateLimit-Remaining', remainingTokens);
        return next();
      }

      // Limit exceeded: Return HTTP 429 with Retry-After header
      res.setHeader('Retry-After', retryAfter);
      res.setHeader('X-RateLimit-Remaining', 0);

      logger.warn(`Rate limit exceeded for [${redisKey}]. Retry-After: ${retryAfter}s`);

      return res.status(429).json({
        success: false,
        message: 'Too many requests. Please try again later.',
        retryAfter,
      });
    } catch (err) {
      // In case of Redis outage, fail-open and log warning so API continues functioning
      logger.error('Rate limiter Redis error, failing open:', { error: err.message, endpoint });
      return next();
    }
  };
};

// Preset limiters as required
// Stricter limits on login (5 requests / minute) to slow brute force
const loginRateLimiter = createRateLimiter({
  endpoint: 'login',
  capacity: 5,
  refillRatePerMinute: 5,
  keyGenerator: (req) => req.body?.email || req.ip || 'anonymous',
});

// Moderate limits on transfers (20 requests / minute)
const transferRateLimiter = createRateLimiter({
  endpoint: 'transfers',
  capacity: 20,
  refillRatePerMinute: 20,
  keyGenerator: (req) => req.user?.userId || req.ip || 'anonymous',
});

module.exports = {
  createRateLimiter,
  loginRateLimiter,
  transferRateLimiter,
  TOKEN_BUCKET_LUA,
};
