const config = require('../config/env');

/**
 * BullMQ requires redis connection options with maxRetriesPerRequest set to null.
 */
const getRedisConnectionOptions = () => {
  try {
    const url = new URL(config.redisUrl);
    return {
      host: url.hostname || 'localhost',
      port: parseInt(url.port, 10) || 6379,
      password: url.password || undefined,
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
      retryStrategy: (times) => {
        if (process.env.NODE_ENV === 'test' || times > 2) {
          return null;
        }
        return Math.min(times * 100, 2000);
      },
    };
  } catch (err) {
    return {
      host: 'localhost',
      port: 6379,
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
      retryStrategy: (times) => {
        if (process.env.NODE_ENV === 'test' || times > 2) {
          return null;
        }
        return Math.min(times * 100, 2000);
      },
    };
  }
};

module.exports = {
  getRedisConnectionOptions,
};
