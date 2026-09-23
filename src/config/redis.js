const Redis = require('ioredis');
const config = require('./env');

const redis = new Redis(config.redisUrl, {
  lazyConnect: true,
  maxRetriesPerRequest: 1,
  enableOfflineQueue: false,
  retryStrategy: (times) => {
    // If in test environment or exceeded attempts, stop retrying
    if (process.env.NODE_ENV === 'test' || times > 3) {
      return null;
    }
    return Math.min(times * 100, 2000);
  },
});

redis.on('error', (err) => {
  // Avoid spamming test logs if Redis is intentionally offline
  if (process.env.NODE_ENV !== 'test') {
    console.error('Redis connection error:', err.message);
  }
});

module.exports = redis;
