const Redis = require('ioredis');
const config = require('./env');

const redis = new Redis(config.redisUrl, {
  lazyConnect: true,
  maxRetriesPerRequest: 3,
});

redis.on('error', (err) => {
  console.error('Redis connection error:', err);
});

module.exports = redis;
