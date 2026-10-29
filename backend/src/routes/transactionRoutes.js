const express = require('express');
const { body } = require('express-validator');
const { authenticate } = require('../middleware/auth');
const { deposit, withdraw, transfer, requestOTP, verifyOTPAndTransfer } = require('../controllers/transactionController');

const router = express.Router();

router.post('/deposit', authenticate, [
  body('account_id').isInt({ min: 1 }),
  body('amount').isFloat({ min: 0.01 }),
], deposit);

router.post('/withdraw', authenticate, [
  body('account_id').isInt({ min: 1 }),
  body('amount').isFloat({ min: 0.01 }),
], withdraw);

router.post('/transfer', authenticate, [
  body('from_account_id').isInt({ min: 1 }),
  body('to_account_id').isInt({ min: 1 }),
  body('amount').isFloat({ min: 0.01 }),
], transfer);

// High-amount OTP flow
router.post('/request-otp',  authenticate, requestOTP);
router.post('/verify-otp',   authenticate, verifyOTPAndTransfer);

module.exports = router;
