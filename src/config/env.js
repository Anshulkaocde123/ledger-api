const dotenv = require('dotenv');

dotenv.config();

module.exports = {
  port: process.env.PORT || 3000,
  nodeEnv: process.env.NODE_ENV || 'development',
  databaseUrl: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/ledger_db',
  redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
  jwtSecret: process.env.JWT_SECRET || 'default_jwt_secret',
  jwtRefreshSecret: process.env.JWT_REFRESH_SECRET || 'default_jwt_refresh_secret',
};
