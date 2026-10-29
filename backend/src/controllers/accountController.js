const pool = require('../config/db');
const { validationResult } = require('express-validator');
const { v4: uuidv4 } = require('uuid');



/**
 * Generate a unique account number like ACC + 10 random digits
 */
const generateAccountNumber = () => {
  const digits = Math.floor(1000000000 + Math.random() * 9000000000);
  return `ACC${digits}`;
};

/**
 * POST /api/accounts
 */
const createAccount = async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { account_type } = req.body;
    const account_number = generateAccountNumber();

    const [result] = await pool.query(
      `INSERT INTO accounts (customer_id, account_number, account_type, balance, status)
       VALUES (?, ?, ?, 0.00, 'ACTIVE')`,
      [req.user.id, account_number, account_type || 'SAVINGS']
    );

    return res.status(201).json({
      message: 'Account created successfully',
      account: {
        id: result.insertId,
        customer_id: req.user.id,
        account_number,
        account_type: account_type || 'SAVINGS',
        balance: 0.00,
        status: 'ACTIVE',
      },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/accounts
 */
const getMyAccounts = async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      `SELECT id, account_number, account_type, balance, status, version, created_at
       FROM accounts WHERE customer_id = ? ORDER BY created_at DESC`,
      [req.user.id]
    );
    return res.json(rows);
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/accounts/:id
 */
const getAccount = async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      `SELECT a.id, a.account_number, a.account_type, a.balance, a.status, a.version, a.created_at,
              c.name AS customer_name, c.email AS customer_email
       FROM accounts a JOIN customers c ON a.customer_id = c.id
       WHERE a.id = ?`,
      [req.params.id]
    );

    if (rows.length === 0) return res.status(404).json({ error: 'Account not found' });

    // Only owner or admin can see
    const account = rows[0];
    const [ownerRows] = await pool.query(
      'SELECT customer_id FROM accounts WHERE id = ?', [req.params.id]
    );
    if (ownerRows[0].customer_id !== req.user.id && req.user.role !== 'ADMIN') {
      return res.status(403).json({ error: 'Forbidden' });
    }

    return res.json(account);
  } catch (err) {
    next(err);
  }
};

/**
 * PUT /api/accounts/:id/status  (Admin only)
 */
const updateAccountStatus = async (req, res, next) => {
  try {
    const { status } = req.body;
    const validStatuses = ['ACTIVE', 'FROZEN', 'CLOSED'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: 'Invalid status. Must be ACTIVE, FROZEN, or CLOSED' });
    }

    const [result] = await pool.query(
      'UPDATE accounts SET status = ? WHERE id = ?',
      [status, req.params.id]
    );

    if (result.affectedRows === 0) return res.status(404).json({ error: 'Account not found' });

    // Audit log
    await pool.query(
      `INSERT INTO audit_logs (transaction_id, event, metadata)
       VALUES (NULL, ?, ?)`,
      [`ACCOUNT_STATUS_CHANGED`, JSON.stringify({ account_id: req.params.id, new_status: status, by: req.user.id })]
    );

    return res.json({ message: `Account status updated to ${status}` });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/accounts/lookup?account_number=ACC...
 * Public-ish: any authenticated user can look up an account number
 * to verify it exists before making a transfer.
 */
const lookupByAccountNumber = async (req, res, next) => {
  try {
    const { account_number } = req.query;
    if (!account_number || !account_number.trim()) {
      return res.status(400).json({ error: 'account_number query param is required' });
    }
    const [rows] = await pool.query(
      `SELECT a.id, a.account_number, a.account_type, a.status,
              c.name AS holder_name
       FROM accounts a
       JOIN customers c ON a.customer_id = c.id
       WHERE a.account_number = ?`,
      [account_number.trim()]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Account not found' });
    }
    return res.json(rows[0]);
  } catch (err) {
    next(err);
  }
};

module.exports = { createAccount, getMyAccounts, getAccount, updateAccountStatus, lookupByAccountNumber };
