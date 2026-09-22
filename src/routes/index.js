const express = require('express');
const authController = require('../controllers/auth.controller');
const accountController = require('../controllers/account.controller');
const transactionController = require('../controllers/transaction.controller');
const { authenticate } = require('../middleware/auth.middleware');

const router = express.Router();

// Health Check
router.get('/health', (req, res) => {
  res.status(200).json({ status: 'UP', timestamp: new Date().toISOString() });
});

// Auth Routes
router.post('/auth/register', authController.register);
router.post('/auth/login', authController.login);

// Account Routes
router.post('/accounts', authenticate, accountController.createAccount);
router.get('/accounts', authenticate, accountController.getUserAccounts);
router.get('/accounts/:id', authenticate, accountController.getAccountById);
router.get('/accounts/:accountId/entries', authenticate, transactionController.getAccountEntries);

// Transaction & Payment Routes
router.post('/transactions', authenticate, transactionController.recordTransaction);
router.post('/payments/transfer', authenticate, transactionController.transfer);
router.get('/transactions/:id', authenticate, transactionController.getTransactionById);

module.exports = router;
