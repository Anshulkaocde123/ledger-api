const redis = require('../src/config/redis');
const {
  createRateLimiter,
  loginRateLimiter,
  transferRateLimiter,
} = require('../src/middleware/rateLimiter.middleware');

jest.mock('../src/config/redis');

describe('Token Bucket Rate Limiter Middleware Tests', () => {
  let req;
  let res;
  let next;

  beforeEach(() => {
    jest.clearAllMocks();
    req = {
      user: { userId: 'user-456' },
      body: { email: 'client@example.com' },
      ip: '127.0.0.1',
      headers: {},
    };
    res = {
      setHeader: jest.fn(),
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    next = jest.fn();
  });

  it('should format redis key as ratelimit:{user_id}:{endpoint}', async () => {
    const limiter = createRateLimiter({
      endpoint: 'custom_action',
      capacity: 10,
      refillRatePerMinute: 10,
    });

    redis.eval.mockResolvedValue([1, 9, 0]);

    await limiter(req, res, next);

    expect(redis.eval).toHaveBeenCalledWith(
      expect.any(String),
      1,
      'ratelimit:user-456:custom_action',
      10,
      expect.any(Number),
      expect.any(Number),
      1,
      expect.any(Number)
    );
    expect(res.setHeader).toHaveBeenCalledWith('X-RateLimit-Limit', 10);
    expect(res.setHeader).toHaveBeenCalledWith('X-RateLimit-Remaining', 9);
    expect(next).toHaveBeenCalledWith();
  });

  it('should use email or IP when user is unauthenticated (e.g. login)', async () => {
    const unauthReq = {
      body: { email: 'bruteforce@target.com' },
      ip: '192.168.1.100',
    };

    redis.eval.mockResolvedValue([1, 4, 0]);

    await loginRateLimiter(unauthReq, res, next);

    expect(redis.eval).toHaveBeenCalledWith(
      expect.any(String),
      1,
      'ratelimit:bruteforce@target.com:login',
      5,
      expect.any(Number),
      expect.any(Number),
      1,
      expect.any(Number)
    );
    expect(next).toHaveBeenCalledWith();
  });

  it('should return HTTP 429 with Retry-After header when rate limit is exceeded', async () => {
    // Lua returns: [allowed=0, remaining=0, retryAfter=12]
    redis.eval.mockResolvedValue([0, 0, 12]);

    await transferRateLimiter(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.setHeader).toHaveBeenCalledWith('X-RateLimit-Limit', 20);
    expect(res.setHeader).toHaveBeenCalledWith('X-RateLimit-Remaining', 0);
    expect(res.setHeader).toHaveBeenCalledWith('Retry-After', 12);
    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        retryAfter: 12,
      })
    );
  });

  it('should fail-open and call next() if Redis experiences an error', async () => {
    redis.eval.mockRejectedValue(new Error('Redis connection timeout'));

    await transferRateLimiter(req, res, next);

    // Should not crash or block the request
    expect(next).toHaveBeenCalledWith();
  });
});
