const express = require('express');
const { body } = require('express-validator');
const { authenticate } = require('../middleware/auth');
const { addBeneficiary, getBeneficiaries, removeBeneficiary } = require('../controllers/beneficiaryController');

const router = express.Router();

router.post('/', authenticate, [
  body('account_id').isInt({ min: 1 }).withMessage('Valid account_id required'),
  body('nickname').optional().trim(),
], addBeneficiary);

router.get('/', authenticate, getBeneficiaries);

router.delete('/:id', authenticate, removeBeneficiary);

module.exports = router;
