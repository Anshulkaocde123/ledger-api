const { Worker } = require('bullmq');
const { getRedisConnectionOptions } = require('../queues/connection');
const { auditDlq } = require('../queues/audit.queue');
const auditLogRepository = require('../repositories/auditLog.repository');
const logger = require('../utils/logger');

const connection = getRedisConnectionOptions();

/**
 * Worker processor function for writing audit logs to PostgreSQL
 */
const processAuditJob = async (job) => {
  const { actorId, action, entityType, entityId, metadata } = job.data;

  logger.info(`[AuditWorker] Processing job ${job.id} (Attempt ${job.attemptsMade + 1}): ${action} on ${entityType}:${entityId}`);

  await auditLogRepository.create({
    actorId,
    action,
    entityType,
    entityId,
    metadata,
  });

  logger.info(`[AuditWorker] Successfully persisted audit log for job ${job.id}`);
};

/**
 * Creates and initializes the BullMQ Worker
 */
const createAuditWorker = () => {
  const worker = new Worker('audit-logs', processAuditJob, {
    connection,
    concurrency: 5,
  });

  worker.on('completed', (job) => {
    logger.debug(`[AuditWorker] Job ${job.id} completed successfully`);
  });

  worker.on('failed', async (job, err) => {
    const attemptsMade = job ? job.attemptsMade : 0;
    const maxAttempts = job?.opts?.attempts || 3;

    logger.error(
      `[AuditWorker] Job ${job?.id} failed on attempt ${attemptsMade}/${maxAttempts}:`,
      { error: err.message }
    );

    // If all retries exhausted, push to Dead-Letter Queue (DLQ)
    if (job && attemptsMade >= maxAttempts) {
      logger.warn(`[AuditWorker] Job ${job.id} exceeded all ${maxAttempts} retries. Moving to Dead-Letter Queue.`);
      try {
        await auditDlq.add('dead-letter-audit', {
          originalJobId: job.id,
          data: job.data,
          error: err.message,
          stack: err.stack,
          failedAt: new Date().toISOString(),
          attemptsMade,
        });
        logger.info(`[AuditWorker] Job ${job.id} successfully parked in DLQ`);
      } catch (dlqErr) {
        logger.error(`[AuditWorker] CRITICAL: Failed to push job ${job.id} to DLQ:`, {
          error: dlqErr.message,
        });
      }
    }
  });

  worker.on('error', (err) => {
    logger.error('[AuditWorker] Internal worker error:', { error: err.message });
  });

  return worker;
};

module.exports = {
  createAuditWorker,
  processAuditJob,
};
