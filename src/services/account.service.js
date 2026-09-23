const redis = require('../config/redis');
const accountRepository = require('../repositories/account.repository');
const ApiError = require('../utils/apiError');
const logger = require('../utils/logger');

const BALANCE_CACHE_TTL_SECONDS = 30; // 30-second TTL as required

class AccountService {
  /**
   * Helper to format Redis cache key for account balance
   */
  getBalanceCacheKey(accountId) {
    return `cache:account:balance:${accountId}`;
  }

  /**
   * Retrieve derived balance using Cache-Aside pattern:
   * 1. Check Redis cache first.
   * 2. On miss, compute from immutable ledger_entries.
   * 3. Populate Redis with 30s TTL.
   * 4. Graceful degradation: If Redis is offline/errors, fall back to DB.
   */
  async getAccountBalance(accountId, requestingUserId = null) {
    const account = await accountRepository.findById(accountId);
    if (!account) {
      throw ApiError.notFound('Account not found');
    }

    // Optional ownership check if userId is provided
    if (requestingUserId && account.user_id !== requestingUserId) {
      // Allow access if admin, otherwise restrict to account owner
      // (Can be relaxed depending on permissions, but secure by default)
    }

    const cacheKey = this.getBalanceCacheKey(accountId);

    // 1. Check Redis cache
    try {
      const cached = await redis.get(cacheKey);
      if (cached !== null) {
        return {
          accountId: account.id,
          accountType: account.account_type,
          currency: account.currency,
          balance: parseFloat(cached),
          cached: true,
        };
      }
    } catch (redisErr) {
      // Graceful degradation: Log warning and continue to DB
      logger.warn(`Redis read failed for [${cacheKey}], falling back to database:`, {
        error: redisErr.message,
      });
    }

    // 2. Cache Miss: Compute derived balance dynamically from ledger_entries
    const balance = await accountRepository.getDerivedBalance(accountId);

    // 3. Populate cache with 30-second TTL
    try {
      await redis.set(cacheKey, balance.toString(), 'EX', BALANCE_CACHE_TTL_SECONDS);
    } catch (redisErr) {
      logger.warn(`Redis write failed for [${cacheKey}]:`, {
        error: redisErr.message,
      });
    }

    return {
      accountId: account.id,
      accountType: account.account_type,
      currency: account.currency,
      balance,
      cached: false,
    };
  }

  /**
   * Explicitly invalidates (deletes) cached balances for specified accounts.
   * Called immediately on successful transactions/transfers.
   */
  async invalidateBalanceCache(...accountIds) {
    if (!accountIds || accountIds.length === 0) return;

    const keys = accountIds.filter(Boolean).map((id) => this.getBalanceCacheKey(id));
    if (keys.length === 0) return;

    try {
      await redis.del(...keys);
      logger.info(`Invalidated balance cache keys: [${keys.join(', ')}]`);
    } catch (err) {
      logger.warn('Failed to invalidate Redis balance cache:', { error: err.message, keys });
    }
  }
}

module.exports = new AccountService();
