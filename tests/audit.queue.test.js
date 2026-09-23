const { auditQueue, auditDlq, enqueueAuditLog } = require('../src/queues/audit.queue');
const { processAuditJob, createAuditWorker } = require('../src/workers/audit.worker');
const auditLogRepository = require('../src/repositories/auditLog.repository');

jest.mock('../src/repositories/auditLog.repository');
jest.mock('bullmq', () => {
  const original = jest.requireActual('bullmq');
  return {
    ...original,
    Queue: jest.fn().mockImplementation((name, opts) => ({
      name,
      opts,
      add: jest.fn().mockResolvedValue({ id: 'job-123' }),
      on: jest.fn(),
      close: jest.fn().mockResolvedValue(),
    })),
    Worker: jest.fn().mockImplementation((name, processor, opts) => {
      const handlers = {};
      return {
        name,
        processor,
        opts,
        on: jest.fn((event, handler) => {
          handlers[event] = handler;
        }),
        emit: (event, ...args) => {
          if (handlers[event]) handlers[event](...args);
        },
        close: jest.fn().mockResolvedValue(true),
      };
    }),
  };
});

describe('BullMQ Audit Queue and Worker Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('enqueueAuditLog', () => {
    it('should add a job to the audit queue with payload', async () => {
      const auditPayload = {
        actorId: 'usr-1',
        action: 'TRANSFER_EXECUTED',
        entityType: 'TRANSACTION',
        entityId: 'tx-999',
        metadata: { amount: 150 },
      };

      const job = await enqueueAuditLog(auditPayload);

      expect(auditQueue.add).toHaveBeenCalledWith('log-transfer', auditPayload);
      expect(job.id).toBe('job-123');
    });
  });

  describe('processAuditJob', () => {
    it('should call auditLogRepository.create with the job payload', async () => {
      const mockJob = {
        id: 'job-1',
        attemptsMade: 0,
        data: {
          actorId: 'user-abc',
          action: 'TRANSFER_EXECUTED',
          entityType: 'TRANSACTION',
          entityId: 'tx-100',
          metadata: { amount: 50 },
        },
      };

      auditLogRepository.create.mockResolvedValue({ id: 'audit-row-1' });

      await processAuditJob(mockJob);

      expect(auditLogRepository.create).toHaveBeenCalledWith({
        actorId: 'user-abc',
        action: 'TRANSFER_EXECUTED',
        entityType: 'TRANSACTION',
        entityId: 'tx-100',
        metadata: { amount: 50 },
      });
    });
  });

  describe('Audit Worker Dead-Letter Queue (DLQ) behavior', () => {
    it('should push job to DLQ when max attempts (3) are exceeded', async () => {
      const worker = createAuditWorker();

      const failedJob = {
        id: 'job-fail-final',
        attemptsMade: 3,
        opts: { attempts: 3 },
        data: {
          actorId: 'user-fail',
          action: 'TRANSFER_EXECUTED',
          entityType: 'TRANSACTION',
          entityId: 'tx-failed',
        },
      };

      const error = new Error('Database connection failed');

      // Trigger the 'failed' handler registered on worker
      await worker.emit('failed', failedJob, error);

      // Verify that job was pushed to DLQ
      expect(auditDlq.add).toHaveBeenCalledWith(
        'dead-letter-audit',
        expect.objectContaining({
          originalJobId: 'job-fail-final',
          error: 'Database connection failed',
          attemptsMade: 3,
        })
      );
    });

    it('should not push to DLQ if attempts have not yet reached max attempts', async () => {
      const worker = createAuditWorker();

      const retryJob = {
        id: 'job-retry-1',
        attemptsMade: 1, // Attempt 1 of 3 (will be retried by BullMQ)
        opts: { attempts: 3 },
        data: {
          actorId: 'user-retry',
          action: 'TRANSFER_EXECUTED',
        },
      };

      const error = new Error('Transient DB timeout');

      await worker.emit('failed', retryJob, error);

      // DLQ should NOT be called yet
      expect(auditDlq.add).not.toHaveBeenCalled();
    });
  });
});
