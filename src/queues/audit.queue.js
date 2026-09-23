const { Queue } = require('bullmq');
const { getRedisConnectionOptions } = require('./connection');
const logger = require('../utils/logger');

const connection = getRedisConnectionOptions();

// Main Audit Log Queue
const auditQueue = new Queue('audit-logs', {
  connection,
  defaultJobOptions: {
    attempts: 3, // Retry up to 3 times
    backoff: {
      type: 'exponential',
      delay: 1000, // 1s, 2s, 4s
    },
    removeOnComplete: true,
  },
});

auditQueue.on('error', (err) => {
  if (process.env.NODE_ENV !== 'test') {
    logger.error('BullMQ auditQueue connection error:', { error: err.message });
  }
});

// Dead-Letter Queue (DLQ) for permanently failed audit events
const auditDlq = new Queue('audit-logs-dlq', {
  connection,
  defaultJobOptions: {
    removeOnComplete: false,
    removeOnFail: false,
  },
});

auditDlq.on('error', (err) => {
  if (process.env.NODE_ENV !== 'test') {
    logger.error('BullMQ auditDlq connection error:', { error: err.message });
  }
});

/**
 * Enqueues an audit log job safely without blocking transaction responses.
 */
const enqueueAuditLog = async (auditData) => {
  try {
    const job = await auditQueue.add('log-transfer', auditData);
    logger.debug(`Enqueued audit log job [${job.id}] for entity ${auditData.entityId}`);
    return job;
  } catch (err) {
    logger.error('Failed to enqueue audit log job to Redis queue:', {
      error: err.message,
      auditData,
    });
    return null;
  }
};

module.exports = {
  auditQueue,
  auditDlq,
  enqueueAuditLog,
};
