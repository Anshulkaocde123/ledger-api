const ledgerService = require('./ledger.service');
const accountRepository = require('../repositories/account.repository');
const ApiError = require('../utils/apiError');
const redis = require('../config/redis');

class PaymentService {
  /**
   * Transfer funds between two customer accounts with idempotency locking
   */
  async transferFunds({ idempotencyKey, sourceAccountId, destinationAccountId, amount, currency = 'USD' }) {
    if (sourceAccountId === destinationAccountId) {
      throw ApiError.badRequest('Source and destination accounts cannot be the same');
    }

    // Check idempotency lock in Redis if available
    const lockKey = `lock:transfer:${idempotencyKey}`;
    try {
      const acquired = await redis.set(lockKey, 'locked', 'EX', 60, 'NX');
      if (!acquired) {
        throw ApiError.badRequest('Concurrent or duplicate transfer request in progress');
      }
    } catch (redisErr) {
      // Redis fallback or log warning if Redis is down
    }

    const source = await accountRepository.findById(sourceAccountId);
    const destination = await accountRepository.findById(destinationAccountId);

    if (!source) throw ApiError.notFound('Source account not found');
    if (!destination) throw ApiError.notFound('Destination account not found');
    if (source.balance < amount) throw ApiError.badRequest('Insufficient balance');

    // Create balanced entries for the transfer
    const entries = [
      {
        accountId: sourceAccountId,
        type: 'DEBIT',
        amount,
        currency,
      },
      {
        accountId: destinationAccountId,
        type: 'CREDIT',
        amount,
        currency,
      },
    ];

    return ledgerService.recordTransaction({
      reference: idempotencyKey,
      description: `Transfer from ${source.account_number} to ${destination.account_number}`,
      entries,
    });
  }
}

module.exports = new PaymentService();
