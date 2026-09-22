const ledgerService = require('../services/ledger.service');
const paymentService = require('../services/payment.service');
const transactionRepository = require('../repositories/transaction.repository');
const ApiError = require('../utils/apiError');
const { sendSuccess } = require('../utils/response');

class TransactionController {
  async recordTransaction(req, res, next) {
    try {
      const { reference, description, entries } = req.body;
      const result = await ledgerService.recordTransaction({
        reference,
        description,
        entries,
      });

      return sendSuccess(res, result, 201, 'Transaction posted successfully');
    } catch (err) {
      return next(err);
    }
  }

  async transfer(req, res, next) {
    try {
      const idempotencyKey = req.headers['x-idempotency-key'] || req.body.idempotencyKey;
      if (!idempotencyKey) {
        throw ApiError.badRequest('Idempotency key required in X-Idempotency-Key header or body');
      }

      const { sourceAccountId, destinationAccountId, amount, currency } = req.body;
      const result = await paymentService.transferFunds({
        idempotencyKey,
        sourceAccountId,
        destinationAccountId,
        amount,
        currency,
      });

      return sendSuccess(res, result, 200, 'Funds transferred successfully');
    } catch (err) {
      return next(err);
    }
  }

  async getTransactionById(req, res, next) {
    try {
      const { id } = req.params;
      const tx = await transactionRepository.findById(id);
      if (!tx) {
        throw ApiError.notFound('Transaction not found');
      }

      return sendSuccess(res, tx, 200);
    } catch (err) {
      return next(err);
    }
  }

  async getAccountEntries(req, res, next) {
    try {
      const { accountId } = req.params;
      const entries = await transactionRepository.getEntriesByAccountId(accountId);
      return sendSuccess(res, entries, 200);
    } catch (err) {
      return next(err);
    }
  }
}

module.exports = new TransactionController();
