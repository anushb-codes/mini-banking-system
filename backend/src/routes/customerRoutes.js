const express = require('express');
const { body } = require('express-validator');
const { authenticate } = require('../middleware/auth');
const { getProfile, updateProfile, searchCustomers } = require('../controllers/customerController');

const router = express.Router();

router.get('/me', authenticate, getProfile);

router.put('/me', authenticate, [
  body('name').trim().notEmpty().withMessage('Name is required'),
], updateProfile);

// Search customers — accessible to all authenticated users
// GET /api/customers/search?q=searchterm
router.get('/search', authenticate, searchCustomers);

module.exports = router;
