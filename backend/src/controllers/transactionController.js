const pool = require('../config/db');
const { validationResult } = require('express-validator');
const { v4: uuidv4 } = require('uuid');
const { transferService, depositService, withdrawService } = require('../services/transactionService');
const { generateOTP, verifyOTP, isHighAmount, HIGH_AMOUNT_THRESHOLD } = require('../services/otpService');

/**
 * POST /api/transactions/deposit
 */
const deposit = async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { account_id, amount, idempotency_key } = req.body;

    const [accounts] = await pool.query('SELECT customer_id FROM accounts WHERE id = ?', [account_id]);
    if (accounts.length === 0) return res.status(404).json({ error: 'Account not found' });
    if (accounts[0].customer_id !== req.user.id && req.user.role !== 'ADMIN')
      return res.status(403).json({ error: 'Forbidden' });

    const result = await depositService({
      toAccountId: account_id, amount: parseFloat(amount),
      idempotencyKey: idempotency_key || uuidv4(), userId: req.user.id,
    });
    return res.status(result.status === 'idempotent' ? 200 : 201).json(result);
  } catch (err) { next(err); }
};

/**
 * POST /api/transactions/withdraw
 */
const withdraw = async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { account_id, amount, idempotency_key } = req.body;

    const [accounts] = await pool.query('SELECT customer_id FROM accounts WHERE id = ?', [account_id]);
    if (accounts.length === 0) return res.status(404).json({ error: 'Account not found' });
    if (accounts[0].customer_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });

    const result = await withdrawService({
      fromAccountId: account_id, amount: parseFloat(amount),
      idempotencyKey: idempotency_key || uuidv4(), userId: req.user.id,
    });
    return res.status(result.status === 'idempotent' ? 200 : 201).json(result);
  } catch (err) { next(err); }
};

/**
 * POST /api/transactions/request-otp
 * Called when amount >= threshold. Returns OTP (dummy).
 */
const requestOTP = async (req, res, next) => {
  try {
    const { from_account_id, to_account_id, amount, idempotency_key } = req.body;
    if (!from_account_id || !to_account_id || !amount)
      return res.status(400).json({ error: 'from_account_id, to_account_id, amount are required' });

    if (!isHighAmount(amount))
      return res.status(400).json({ error: `OTP is only required for transfers ≥ ₹${HIGH_AMOUNT_THRESHOLD.toLocaleString()}` });

    // Verify source account ownership
    const [accounts] = await pool.query('SELECT customer_id FROM accounts WHERE id = ?', [from_account_id]);
    if (accounts.length === 0) return res.status(404).json({ error: 'Source account not found' });
    if (accounts[0].customer_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });

    const transferPayload = { from_account_id, to_account_id, amount, idempotency_key: idempotency_key || uuidv4() };
    const otp = await generateOTP({ customerId: req.user.id, transferPayload });

    return res.json({
      message: `OTP generated. In production this would be sent via SMS/email. For demo, use this OTP:`,
      otp,                         // ← returned directly (demo only)
      expires_in_seconds: 300,
      threshold: HIGH_AMOUNT_THRESHOLD,
    });
  } catch (err) { next(err); }
};

/**
 * POST /api/transactions/verify-otp
 * Verifies OTP, then submits the transfer as PENDING_APPROVAL.
 */
const verifyOTPAndTransfer = async (req, res, next) => {
  try {
    const { otp } = req.body;
    if (!otp) return res.status(400).json({ error: 'otp is required' });

    const payload = await verifyOTP({ customerId: req.user.id, otp });

    // Verify source ownership again
    const [accounts] = await pool.query('SELECT customer_id FROM accounts WHERE id = ?', [payload.from_account_id]);
    if (accounts.length === 0) return res.status(404).json({ error: 'Source account not found' });
    if (accounts[0].customer_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });

    const result = await transferService({
      fromAccountId:  payload.from_account_id,
      toAccountId:    payload.to_account_id,
      amount:         parseFloat(payload.amount),
      idempotencyKey: payload.idempotency_key,
      userId:         req.user.id,
      requiresApproval: true,
    });

    return res.status(202).json({
      ...result,
      message: `Transfer of ₹${parseFloat(payload.amount).toLocaleString('en-IN')} submitted for admin approval.`,
    });
  } catch (err) { next(err); }
};

/**
 * POST /api/transactions/transfer  (normal — amount < threshold)
 */
const transfer = async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { from_account_id, to_account_id, amount, idempotency_key } = req.body;

    if (from_account_id === to_account_id)
      return res.status(400).json({ error: 'Source and destination accounts cannot be the same' });

    // Block high-amount direct transfers
    if (isHighAmount(amount)) {
      return res.status(400).json({
        error: `Transfers ≥ ₹${HIGH_AMOUNT_THRESHOLD.toLocaleString()} require OTP verification. Use POST /transactions/request-otp first.`,
        requires_otp: true,
        threshold: HIGH_AMOUNT_THRESHOLD,
      });
    }

    const [accounts] = await pool.query('SELECT customer_id FROM accounts WHERE id = ?', [from_account_id]);
    if (accounts.length === 0) return res.status(404).json({ error: 'Source account not found' });
    if (accounts[0].customer_id !== req.user.id) return res.status(403).json({ error: 'Forbidden — not your source account' });

    const result = await transferService({
      fromAccountId: from_account_id, toAccountId: to_account_id,
      amount: parseFloat(amount), idempotencyKey: idempotency_key || uuidv4(),
      userId: req.user.id, requiresApproval: false,
    });
    return res.status(result.status === 'idempotent' ? 200 : 201).json(result);
  } catch (err) { next(err); }
};

/**
 * GET /api/accounts/:id/transactions  (paginated history)
 */
const getTransactionHistory = async (req, res, next) => {
  try {
    const accountId = req.params.id;
    const page   = parseInt(req.query.page   || '0');
    const size   = parseInt(req.query.size   || '20');
    const type   = req.query.type;
    const status = req.query.status;
    const from   = req.query.from;
    const to     = req.query.to;

    const [accounts] = await pool.query('SELECT customer_id FROM accounts WHERE id = ?', [accountId]);
    if (accounts.length === 0) return res.status(404).json({ error: 'Account not found' });
    if (accounts[0].customer_id !== req.user.id && req.user.role !== 'ADMIN')
      return res.status(403).json({ error: 'Forbidden' });

    let conditions = ['(t.from_account_id = ? OR t.to_account_id = ?)'];
    let params     = [accountId, accountId];
    if (type)   { conditions.push('t.transaction_type = ?'); params.push(type); }
    if (status) { conditions.push('t.status = ?');           params.push(status); }
    if (from)   { conditions.push('t.created_at >= ?');      params.push(from); }
    if (to)     { conditions.push('t.created_at <= ?');      params.push(to); }

    const whereClause = conditions.join(' AND ');
    const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM transactions t WHERE ${whereClause}`, params);

    const [rows] = await pool.query(
      `SELECT t.id, t.from_account_id, t.to_account_id, t.amount,
              t.transaction_type, t.status, t.flagged, t.flag_reason,
              t.requires_approval, t.idempotency_key, t.created_at,
              fa.account_number AS from_account_number,
              ta.account_number AS to_account_number
       FROM transactions t
       LEFT JOIN accounts fa ON t.from_account_id = fa.id
       LEFT JOIN accounts ta ON t.to_account_id   = ta.id
       WHERE ${whereClause}
       ORDER BY t.created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, size, page * size]
    );
    return res.json({ data: rows, pagination: { page, size, total, totalPages: Math.ceil(total / size) } });
  } catch (err) { next(err); }
};

/**
 * GET /api/admin/transactions  (paginated, all)
 */
const getAllTransactions = async (req, res, next) => {
  try {
    const page = parseInt(req.query.page || '0');
    const size = parseInt(req.query.size || '50');
    const [rows] = await pool.query(
      `SELECT t.*, fa.account_number AS from_account_number, ta.account_number AS to_account_number,
              fc.name AS from_customer_name, tc.name AS to_customer_name
       FROM transactions t
       LEFT JOIN accounts fa  ON t.from_account_id = fa.id
       LEFT JOIN accounts ta  ON t.to_account_id   = ta.id
       LEFT JOIN customers fc ON fa.customer_id = fc.id
       LEFT JOIN customers tc ON ta.customer_id = tc.id
       ORDER BY t.created_at DESC LIMIT ? OFFSET ?`,
      [size, page * size]
    );
    const [[{ total }]] = await pool.query('SELECT COUNT(*) AS total FROM transactions');
    return res.json({ data: rows, pagination: { page, size, total } });
  } catch (err) { next(err); }
};

module.exports = { deposit, withdraw, transfer, requestOTP, verifyOTPAndTransfer, getTransactionHistory, getAllTransactions };
