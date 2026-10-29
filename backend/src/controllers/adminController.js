const pool = require('../config/db');
const { reverseTransactionService, approveTransactionService } = require('../services/transactionService');

// ─── Transaction: Flag / Unflag ───────────────────────────────────────────────

const flagTransaction = async (req, res, next) => {
  try {
    const { reason } = req.body;
    if (!reason || !reason.trim()) return res.status(400).json({ error: 'flag_reason is required' });

    const [result] = await pool.query(
      `UPDATE transactions SET flagged = TRUE, flag_reason = ? WHERE id = ?`,
      [reason.trim(), req.params.id]
    );
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Transaction not found' });

    await pool.query(
      `INSERT INTO audit_logs (transaction_id, event, metadata) VALUES (?, 'TRANSACTION_FLAGGED', ?)`,
      [req.params.id, JSON.stringify({ reason: reason.trim(), flagged_by: req.user.id })]
    );
    return res.json({ message: 'Transaction flagged', transaction_id: req.params.id, reason });
  } catch (err) { next(err); }
};

const unflagTransaction = async (req, res, next) => {
  try {
    const [result] = await pool.query(
      `UPDATE transactions SET flagged = FALSE, flag_reason = NULL WHERE id = ?`,
      [req.params.id]
    );
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Transaction not found' });

    await pool.query(
      `INSERT INTO audit_logs (transaction_id, event, metadata) VALUES (?, 'TRANSACTION_UNFLAGGED', ?)`,
      [req.params.id, JSON.stringify({ unflagged_by: req.user.id })]
    );
    return res.json({ message: 'Transaction unflagged', transaction_id: req.params.id });
  } catch (err) { next(err); }
};

// ─── Transaction: Reverse ─────────────────────────────────────────────────────

const reverseTransaction = async (req, res, next) => {
  try {
    const result = await reverseTransactionService({
      transactionId: parseInt(req.params.id),
      adminId: req.user.id,
    });
    return res.json(result);
  } catch (err) { next(err); }
};

// ─── Transaction: Approve / Reject ───────────────────────────────────────────

const approveTransaction = async (req, res, next) => {
  try {
    const result = await approveTransactionService({
      transactionId: parseInt(req.params.id),
      adminId: req.user.id,
    });
    return res.json(result);
  } catch (err) { next(err); }
};

const rejectTransaction = async (req, res, next) => {
  try {
    const { reason } = req.body;
    const [txns] = await pool.query(
      `SELECT status FROM transactions WHERE id = ?`, [req.params.id]
    );
    if (txns.length === 0) return res.status(404).json({ error: 'Transaction not found' });
    if (txns[0].status !== 'PENDING_APPROVAL')
      return res.status(400).json({ error: `Transaction is not pending approval (status: ${txns[0].status})` });

    await pool.query(
      `UPDATE transactions SET status = 'FAILED', flag_reason = ? WHERE id = ?`,
      [reason ? `Rejected by admin: ${reason}` : 'Rejected by admin', req.params.id]
    );
    await pool.query(
      `INSERT INTO audit_logs (transaction_id, event, metadata) VALUES (?, 'TRANSFER_REJECTED', ?)`,
      [req.params.id, JSON.stringify({ rejected_by: req.user.id, reason: reason || '' })]
    );
    return res.json({ message: 'Transaction rejected', transaction_id: req.params.id });
  } catch (err) { next(err); }
};

// ─── Transaction: Pending Approvals ──────────────────────────────────────────

const getPendingApprovals = async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      `SELECT t.*,
              fa.account_number AS from_account_number,
              ta.account_number AS to_account_number,
              fc.name           AS from_customer_name,
              tc.name           AS to_customer_name
       FROM transactions t
       LEFT JOIN accounts fa  ON t.from_account_id = fa.id
       LEFT JOIN accounts ta  ON t.to_account_id   = ta.id
       LEFT JOIN customers fc ON fa.customer_id     = fc.id
       LEFT JOIN customers tc ON ta.customer_id     = tc.id
       WHERE t.status = 'PENDING_APPROVAL'
       ORDER BY t.created_at ASC`
    );
    return res.json(rows);
  } catch (err) { next(err); }
};

// ─── Transaction: Flagged ─────────────────────────────────────────────────────

const getFlaggedTransactions = async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      `SELECT t.*,
              fa.account_number AS from_account_number,
              ta.account_number AS to_account_number,
              fc.name           AS from_customer_name,
              tc.name           AS to_customer_name
       FROM transactions t
       LEFT JOIN accounts fa  ON t.from_account_id = fa.id
       LEFT JOIN accounts ta  ON t.to_account_id   = ta.id
       LEFT JOIN customers fc ON fa.customer_id     = fc.id
       LEFT JOIN customers tc ON ta.customer_id     = tc.id
       WHERE t.flagged = TRUE
       ORDER BY t.created_at DESC`
    );
    return res.json(rows);
  } catch (err) { next(err); }
};

// ─── Account: Block / Unblock ────────────────────────────────────────────────

const blockAccount = async (req, res, next) => {
  try {
    const { reason } = req.body;
    const [result] = await pool.query(
      `UPDATE accounts SET status = 'FROZEN' WHERE id = ? AND status != 'CLOSED'`,
      [req.params.id]
    );
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Account not found or already closed' });

    await pool.query(
      `INSERT INTO audit_logs (transaction_id, event, metadata) VALUES (NULL, 'ACCOUNT_BLOCKED', ?)`,
      [JSON.stringify({ account_id: req.params.id, reason: reason || 'Admin action', blocked_by: req.user.id })]
    );
    return res.json({ message: 'Account blocked (FROZEN)', account_id: req.params.id });
  } catch (err) { next(err); }
};

const unblockAccount = async (req, res, next) => {
  try {
    const [result] = await pool.query(
      `UPDATE accounts SET status = 'ACTIVE' WHERE id = ? AND status = 'FROZEN'`,
      [req.params.id]
    );
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Account not found or not frozen' });

    await pool.query(
      `INSERT INTO audit_logs (transaction_id, event, metadata) VALUES (NULL, 'ACCOUNT_UNBLOCKED', ?)`,
      [JSON.stringify({ account_id: req.params.id, unblocked_by: req.user.id })]
    );
    return res.json({ message: 'Account unblocked (ACTIVE)', account_id: req.params.id });
  } catch (err) { next(err); }
};

// ─── All accounts (for admin account management tab) ─────────────────────────
const getAllAccounts = async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      `SELECT a.id, a.account_number, a.account_type, a.balance, a.status, a.version, a.created_at,
              c.id AS customer_id, c.name AS customer_name, c.email AS customer_email
       FROM accounts a
       JOIN customers c ON a.customer_id = c.id
       ORDER BY a.created_at DESC`
    );
    return res.json(rows);
  } catch (err) { next(err); }
};

module.exports = {
  flagTransaction, unflagTransaction, reverseTransaction,
  approveTransaction, rejectTransaction,
  getPendingApprovals, getFlaggedTransactions,
  blockAccount, unblockAccount, getAllAccounts,
};
