const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const config = require('../config/env');
const logger = require('../utils/logger');

const runMigrations = async () => {
  const poolConfig = {
    connectionString: config.databaseUrl,
  };

  if (
    process.env.DATABASE_SSL === 'true' ||
    (config.databaseUrl && (config.databaseUrl.includes('sslmode=require') || config.databaseUrl.includes('render.com') || config.databaseUrl.includes('railway.app')))
  ) {
    poolConfig.ssl = { rejectUnauthorized: false };
  }

  const pool = new Pool(poolConfig);

  const client = await pool.connect();

  try {
    logger.info('Connected to PostgreSQL for migrations. Ensuring schema_migrations table exists...');

    // 1. Create migrations tracking table if not exists
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version VARCHAR(255) PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    // 2. Discover .up.sql migration files
    const migrationsDir = path.resolve(__dirname, '../../migrations');
    if (!fs.existsSync(migrationsDir)) {
      logger.warn(`Migrations directory not found at ${migrationsDir}`);
      return;
    }

    const files = fs
      .readdirSync(migrationsDir)
      .filter((file) => file.endsWith('.up.sql'))
      .sort(); // Natural chronological sort (e.g. 001_..., 002_...)

    // 3. Query already applied migrations
    const appliedResult = await client.query('SELECT version FROM schema_migrations');
    const appliedVersions = new Set(appliedResult.rows.map((r) => r.version));

    // 4. Apply pending migrations sequentially
    for (const file of files) {
      if (appliedVersions.has(file)) {
        logger.info(`Migration already applied: ${file} (Skipping)`);
        continue;
      }

      logger.info(`Applying migration: ${file}...`);
      const filePath = path.join(migrationsDir, file);
      const sql = fs.readFileSync(filePath, 'utf8');

      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [file]);
        await client.query('COMMIT');
        logger.info(`Successfully applied migration: ${file}`);
      } catch (err) {
        await client.query('ROLLBACK');
        logger.error(`Migration failed on file [${file}]:`, { error: err.message });
        throw err;
      }
    }

    logger.info('All database migrations completed successfully.');
  } finally {
    client.release();
    await pool.end();
  }
};

if (require.main === module) {
  runMigrations()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Migration failed:', err);
      process.exit(1);
    });
}

module.exports = runMigrations;
