const { Pool } = require('pg');
const config = require('./env');

const poolConfig = {
  connectionString: config.databaseUrl,
};

// Enable SSL with certificate verification bypass for cloud-managed databases (e.g. Render, Railway, Neon, RDS)
if (
  process.env.DATABASE_SSL === 'true' ||
  (config.databaseUrl && (config.databaseUrl.includes('sslmode=require') || config.databaseUrl.includes('render.com') || config.databaseUrl.includes('railway.app')))
) {
  poolConfig.ssl = { rejectUnauthorized: false };
}

const pool = new Pool(poolConfig);

pool.on('error', (err) => {
  console.error('Unexpected error on idle PostgreSQL client', err);
});

module.exports = {
  query: (text, params) => pool.query(text, params),
  getClient: () => pool.connect(),
  pool,
};
