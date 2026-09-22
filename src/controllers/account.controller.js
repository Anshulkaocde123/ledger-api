const accountRepository = require('../repositories/account.repository');
const ApiError = require('../utils/apiError');
const { sendSuccess } = require('../utils/response');

class AccountController {
  async createAccount(req, res, next) {
    try {
      const { accountNumber, type, currency } = req.body;
      const userId = req.user.userId;

      const account = await accountRepository.create({
        userId,
        accountNumber,
        type,
        currency,
      });

      return sendSuccess(res, account, 201, 'Account created successfully');
    } catch (err) {
      return next(err);
    }
  }

  async getAccountById(req, res, next) {
    try {
      const { id } = req.params;
      const account = await accountRepository.findById(id);
      if (!account) {
        throw ApiError.notFound('Account not found');
      }

      return sendSuccess(res, account, 200);
    } catch (err) {
      return next(err);
    }
  }

  async getUserAccounts(req, res, next) {
    try {
      const userId = req.user.userId;
      const accounts = await accountRepository.findByUserId(userId);
      return sendSuccess(res, accounts, 200);
    } catch (err) {
      return next(err);
    }
  }
}

module.exports = new AccountController();
