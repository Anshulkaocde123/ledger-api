const app = require('./app');
const config = require('./config/env');
const logger = require('./utils/logger');
const { createAuditWorker } = require('./workers/audit.worker');

const PORT = config.port;

const server = app.listen(PORT, () => {
  logger.info(`ledger-api server running in ${config.nodeEnv} mode on port ${PORT}`);
});

// Start embedded BullMQ audit worker by default (enables single-container / Render Free Tier operation)
let auditWorker = null;
if (process.env.START_WORKER !== 'false' && config.nodeEnv !== 'test') {
  try {
    logger.info('Starting embedded BullMQ audit worker process...');
    auditWorker = createAuditWorker();
  } catch (err) {
    logger.error('Failed to start embedded BullMQ audit worker:', { error: err.message });
  }
}

const handleShutdown = async (signal) => {
  logger.info(`Received ${signal}. Gracefully shutting down server...`);
  if (auditWorker) {
    try {
      await auditWorker.close();
      logger.info('Embedded audit worker closed successfully.');
    } catch (err) {
      logger.error('Error closing embedded audit worker:', { error: err.message });
    }
  }
  server.close(() => {
    logger.info('HTTP server closed. Exiting process.');
    process.exit(0);
  });
};

process.on('SIGTERM', () => handleShutdown('SIGTERM'));
process.on('SIGINT', () => handleShutdown('SIGINT'));

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection at:', { promise, reason });
  handleShutdown('unhandledRejection');
});

process.on('uncaughtException', (err) => {
  logger.error('Uncaught Exception thrown:', { error: err.message, stack: err.stack });
  process.exit(1);
});
