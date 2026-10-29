const express = require('express');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { getAllCustomers } = require('../controllers/customerController');
const { getAllTransactions } = require('../controllers/transactionController');
const {
  flagTransaction, unflagTransaction, reverseTransaction,
  approveTransaction, rejectTransaction,
  getPendingApprovals, getFlaggedTransactions,
  blockAccount, unblockAccount, getAllAccounts,
} = require('../controllers/adminController');
const pool = require('../config/db');

const router = express.Router();
router.use(authenticate, requireAdmin);

// ── Dashboard ──────────────────────────────────────────────────────────
router.get('/dashboard', async (req, res, next) => {
  try {
    const [[customers]]       = await pool.query('SELECT COUNT(*) AS count FROM customers');
    const [[accounts]]        = await pool.query('SELECT COUNT(*) AS count FROM accounts');
    const [[transactions]]    = await pool.query('SELECT COUNT(*) AS count FROM transactions');
    const [[totalBalance]]    = await pool.query('SELECT SUM(balance) AS total FROM accounts WHERE status = "ACTIVE"');
    const [[auditLogs]]       = await pool.query('SELECT COUNT(*) AS count FROM audit_logs');
    const [[pendingApprovals]]= await pool.query('SELECT COUNT(*) AS count FROM transactions WHERE status = "PENDING_APPROVAL"');
    const [[flagged]]         = await pool.query('SELECT COUNT(*) AS count FROM transactions WHERE flagged = TRUE');
    const [[blockedAccounts]] = await pool.query('SELECT COUNT(*) AS count FROM accounts WHERE status = "FROZEN"');
    return res.json({
      total_customers: customers.count,
      total_accounts: accounts.count,
      total_transactions: transactions.count,
      total_balance: totalBalance.total || 0,
      total_audit_logs: auditLogs.count,
      pending_approvals: pendingApprovals.count,
      flagged_transactions: flagged.count,
      blocked_accounts: blockedAccounts.count,
    });
  } catch (err) { next(err); }
});

// ── Customers ──────────────────────────────────────────────────────────
router.get('/customers', getAllCustomers);

// ── Accounts ───────────────────────────────────────────────────────────
router.get('/accounts',           getAllAccounts);
router.put('/accounts/:id/block', blockAccount);
router.put('/accounts/:id/unblock', unblockAccount);

// ── Transactions ───────────────────────────────────────────────────────
router.get('/transactions',              getAllTransactions);
router.get('/transactions/pending',      getPendingApprovals);
router.get('/transactions/flagged',      getFlaggedTransactions);

router.put('/transactions/:id/flag',     flagTransaction);
router.put('/transactions/:id/unflag',   unflagTransaction);
router.put('/transactions/:id/reverse',  reverseTransaction);
router.put('/transactions/:id/approve',  approveTransaction);
router.put('/transactions/:id/reject',   rejectTransaction);

module.exports = router;
