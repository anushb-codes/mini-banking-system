const express = require('express');
const { body } = require('express-validator');
const { authenticate, requireAdmin } = require('../middleware/auth');
const {
  createAccount,
  getMyAccounts,
  getAccount,
  updateAccountStatus,
  lookupByAccountNumber,
} = require('../controllers/accountController');
const { getTransactionHistory } = require('../controllers/transactionController');

const router = express.Router();

router.post('/', authenticate, [
  body('account_type').isIn(['SAVINGS', 'CURRENT']).withMessage('account_type must be SAVINGS or CURRENT'),
], createAccount);

router.get('/', authenticate, getMyAccounts);

// MUST be before /:id so it's not swallowed as an id param
router.get('/lookup', authenticate, lookupByAccountNumber);

router.get('/:id', authenticate, getAccount);

router.put('/:id/status', authenticate, requireAdmin, updateAccountStatus);

router.get('/:id/transactions', authenticate, getTransactionHistory);

module.exports = router;
