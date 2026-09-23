const { createAuditWorker } = require('./workers/audit.worker');
const logger = require('./utils/logger');

logger.info('Starting ledger-api background audit worker process...');

const worker = createAuditWorker();

logger.info('Audit worker is listening for jobs on "audit-logs" queue.');

const handleShutdown = async (signal) => {
  logger.info(`Received ${signal}. Gracefully closing audit worker...`);
  try {
    await worker.close();
    logger.info('Audit worker closed. Exiting process.');
    process.exit(0);
  } catch (err) {
    logger.error('Error during worker shutdown:', { error: err.message });
    process.exit(1);
  }
};

process.on('SIGTERM', () => handleShutdown('SIGTERM'));
process.on('SIGINT', () => handleShutdown('SIGINT'));
