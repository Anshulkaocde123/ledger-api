const app = require('./app');
const config = require('./config/env');
const logger = require('./utils/logger');

const PORT = config.port;

const server = app.listen(PORT, () => {
  logger.info(`ledger-api server running in ${config.nodeEnv} mode on port ${PORT}`);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection at:', { promise, reason });
  server.close(() => process.exit(1));
});

process.on('uncaughtException', (err) => {
  logger.error('Uncaught Exception thrown:', { error: err.message, stack: err.stack });
  process.exit(1);
});
