const express = require('express');
const authController = require('../controllers/auth.controller');
const accountController = require('../controllers/account.controller');
const transactionController = require('../controllers/transaction.controller');
const { authenticate, authorize } = require('../middleware/auth.middleware');

const router = express.Router();

// Health Check
router.get('/health', (req, res) => {
  res.status(200).json({ status: 'UP', timestamp: new Date().toISOString() });
});

// Authentication Routes
router.post('/auth/signup', authController.signup);
router.post('/auth/register', authController.register); // alias
router.post('/auth/login', authController.login);
router.post('/auth/refresh', authController.refresh);

// Account Routes (Protected - Authenticated Users)
router.post('/accounts', authenticate, accountController.createAccount);
router.get('/accounts', authenticate, accountController.getUserAccounts);
router.get('/accounts/:id', authenticate, accountController.getAccountById);
router.get('/accounts/:accountId/entries', authenticate, transactionController.getAccountEntries);

// Transaction & Payment Routes (Protected)
router.post('/transactions', authenticate, transactionController.recordTransaction);
router.post('/payments/transfer', authenticate, transactionController.transfer);
router.get('/transactions/:id', authenticate, transactionController.getTransactionById);

// Example Administrative Route (Demonstrating authorize middleware)
router.get('/admin/system-status', authenticate, authorize('admin'), (req, res) => {
  res.status(200).json({ status: 'HEALTHY', role: req.user.role });
});

module.exports = router;
