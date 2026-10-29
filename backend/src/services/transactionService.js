const pool = require('../config/db');

/**
 * Transfer Service — implements atomic, idempotent, deadlock-safe money transfers.
 *
 * Deadlock Prevention: Always lock accounts in ascending ID order.
 * Idempotency: Unique idempotency_key per request.
 * High-Amount: If requires_approval=true, balances are NOT moved yet —
 *              transaction sits in PENDING_APPROVAL until admin approves.
 */

const transferService = async ({ fromAccountId, toAccountId, amount, idempotencyKey, userId, requiresApproval = false }) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // ── 1. Idempotency check ──────────────────────────────────
    const [existing] = await conn.query(
      'SELECT id, status FROM transactions WHERE idempotency_key = ? FOR SHARE',
      [idempotencyKey]
    );
    if (existing.length > 0) {
      await conn.rollback(); conn.release();
      return { status: 'idempotent', transaction: existing[0] };
    }

    // ── 2. Lock accounts in ascending ID order (deadlock prevention) ──
    const lockOrder = [fromAccountId, toAccountId].sort((a, b) => a - b);
    const [lockedAccounts] = await conn.query(
      `SELECT id, balance, status, version, account_number
       FROM accounts WHERE id IN (?, ?) ORDER BY id ASC FOR UPDATE`,
      lockOrder
    );
    if (lockedAccounts.length !== 2) {
      await conn.rollback(); conn.release();
      throw Object.assign(new Error('One or both accounts not found'), { status: 404 });
    }

    const fromAcc = lockedAccounts.find(a => a.id === fromAccountId);
    const toAcc   = lockedAccounts.find(a => a.id === toAccountId);

    // ── 3. Validate statuses ──────────────────────────────────
    if (fromAcc.status !== 'ACTIVE')
      throw Object.assign(new Error(`Source account is ${fromAcc.status}`),      { status: 400 });
    if (toAcc.status !== 'ACTIVE')
      throw Object.assign(new Error(`Destination account is ${toAcc.status}`),    { status: 400 });

    // ── 4. Balance check (even for pending approval, validate upfront) ─
    if (parseFloat(fromAcc.balance) < parseFloat(amount)) {
      await conn.rollback(); conn.release();
      throw Object.assign(
        new Error(`Insufficient balance. Available: ${fromAcc.balance}, Requested: ${amount}`),
        { status: 400 }
      );
    }

    const txnStatus = requiresApproval ? 'PENDING_APPROVAL' : 'PENDING';

    // ── 5. Create transaction record ──────────────────────────
    const [txnResult] = await conn.query(
      `INSERT INTO transactions
         (from_account_id, to_account_id, amount, transaction_type, status, idempotency_key, requires_approval)
       VALUES (?, ?, ?, 'TRANSFER', ?, ?, ?)`,
      [fromAccountId, toAccountId, amount, txnStatus, idempotencyKey, requiresApproval ? 1 : 0]
    );
    const transactionId = txnResult.insertId;

    if (!requiresApproval) {
      // ── 6a. Immediately move money ──────────────────────────
      const [debitResult] = await conn.query(
        `UPDATE accounts SET balance = balance - ?, version = version + 1
         WHERE id = ? AND version = ?`,
        [amount, fromAccountId, fromAcc.version]
      );
      if (debitResult.affectedRows === 0) {
        await conn.rollback(); conn.release();
        throw Object.assign(new Error('Concurrent modification — please retry'), { status: 409 });
      }
      await conn.query(
        `UPDATE accounts SET balance = balance + ?, version = version + 1 WHERE id = ?`,
        [amount, toAccountId]
      );
      await conn.query(`UPDATE transactions SET status = 'SUCCESS' WHERE id = ?`, [transactionId]);
      await conn.query(
        `INSERT INTO audit_logs (transaction_id, event, metadata) VALUES (?, 'TRANSFER_SUCCESS', ?)`,
        [transactionId, JSON.stringify({ from: fromAcc.account_number, to: toAcc.account_number, amount, initiated_by: userId })]
      );
    } else {
      // ── 6b. High-amount: just log, wait for admin approval ──
      await conn.query(
        `INSERT INTO audit_logs (transaction_id, event, metadata) VALUES (?, 'TRANSFER_PENDING_APPROVAL', ?)`,
        [transactionId, JSON.stringify({ from: fromAcc.account_number, to: toAcc.account_number, amount, initiated_by: userId })]
      );
    }

    await conn.commit(); conn.release();

    return {
      status: requiresApproval ? 'pending_approval' : 'success',
      transaction: { id: transactionId, from_account_id: fromAccountId, to_account_id: toAccountId, amount, transaction_type: 'TRANSFER', status: txnStatus, idempotency_key: idempotencyKey },
    };
  } catch (err) {
    await conn.rollback(); conn.release();
    throw err;
  }
};

// ─────────────────────────────────────────────────────────────
const depositService = async ({ toAccountId, amount, idempotencyKey, userId }) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [existing] = await conn.query('SELECT id, status FROM transactions WHERE idempotency_key = ?', [idempotencyKey]);
    if (existing.length > 0) { await conn.rollback(); conn.release(); return { status: 'idempotent', transaction: existing[0] }; }

    const [accounts] = await conn.query('SELECT id, status FROM accounts WHERE id = ? FOR UPDATE', [toAccountId]);
    if (accounts.length === 0) { await conn.rollback(); conn.release(); throw Object.assign(new Error('Account not found'), { status: 404 }); }
    if (accounts[0].status !== 'ACTIVE') { await conn.rollback(); conn.release(); throw Object.assign(new Error(`Account is ${accounts[0].status}`), { status: 400 }); }

    const [txnResult] = await conn.query(
      `INSERT INTO transactions (from_account_id, to_account_id, amount, transaction_type, status, idempotency_key)
       VALUES (NULL, ?, ?, 'DEPOSIT', 'PENDING', ?)`, [toAccountId, amount, idempotencyKey]
    );
    const transactionId = txnResult.insertId;
    await conn.query('UPDATE accounts SET balance = balance + ? WHERE id = ?', [amount, toAccountId]);
    await conn.query("UPDATE transactions SET status = 'SUCCESS' WHERE id = ?", [transactionId]);
    await conn.query(`INSERT INTO audit_logs (transaction_id, event, metadata) VALUES (?, 'DEPOSIT_SUCCESS', ?)`,
      [transactionId, JSON.stringify({ account_id: toAccountId, amount, initiated_by: userId })]);
    await conn.commit(); conn.release();
    return { status: 'success', transaction: { id: transactionId, to_account_id: toAccountId, amount, transaction_type: 'DEPOSIT', status: 'SUCCESS' } };
  } catch (err) { await conn.rollback(); conn.release(); throw err; }
};

// ─────────────────────────────────────────────────────────────
const withdrawService = async ({ fromAccountId, amount, idempotencyKey, userId }) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [existing] = await conn.query('SELECT id, status FROM transactions WHERE idempotency_key = ?', [idempotencyKey]);
    if (existing.length > 0) { await conn.rollback(); conn.release(); return { status: 'idempotent', transaction: existing[0] }; }

    const [accounts] = await conn.query('SELECT id, balance, status FROM accounts WHERE id = ? FOR UPDATE', [fromAccountId]);
    if (accounts.length === 0) { await conn.rollback(); conn.release(); throw Object.assign(new Error('Account not found'), { status: 404 }); }
    if (accounts[0].status !== 'ACTIVE') { await conn.rollback(); conn.release(); throw Object.assign(new Error(`Account is ${accounts[0].status}`), { status: 400 }); }
    if (parseFloat(accounts[0].balance) < parseFloat(amount)) { await conn.rollback(); conn.release(); throw Object.assign(new Error('Insufficient balance'), { status: 400 }); }

    const [txnResult] = await conn.query(
      `INSERT INTO transactions (from_account_id, to_account_id, amount, transaction_type, status, idempotency_key)
       VALUES (?, NULL, ?, 'WITHDRAWAL', 'PENDING', ?)`, [fromAccountId, amount, idempotencyKey]
    );
    const transactionId = txnResult.insertId;
    await conn.query('UPDATE accounts SET balance = balance - ? WHERE id = ?', [amount, fromAccountId]);
    await conn.query("UPDATE transactions SET status = 'SUCCESS' WHERE id = ?", [transactionId]);
    await conn.query(`INSERT INTO audit_logs (transaction_id, event, metadata) VALUES (?, 'WITHDRAWAL_SUCCESS', ?)`,
      [transactionId, JSON.stringify({ account_id: fromAccountId, amount, initiated_by: userId })]);
    await conn.commit(); conn.release();
    return { status: 'success', transaction: { id: transactionId, from_account_id: fromAccountId, amount, transaction_type: 'WITHDRAWAL', status: 'SUCCESS' } };
  } catch (err) { await conn.rollback(); conn.release(); throw err; }
};

/**
 * Reverse a SUCCESS transaction — atomically moves money back.
 * Creates a new REVERSED transaction record.
 */
const reverseTransactionService = async ({ transactionId, adminId }) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // Load original transaction
    const [txns] = await conn.query(
      `SELECT * FROM transactions WHERE id = ? FOR UPDATE`, [transactionId]
    );
    if (txns.length === 0) throw Object.assign(new Error('Transaction not found'), { status: 404 });

    const txn = txns[0];
    if (txn.status !== 'SUCCESS')
      throw Object.assign(new Error(`Only SUCCESS transactions can be reversed (current: ${txn.status})`), { status: 400 });
    if (txn.transaction_type !== 'TRANSFER')
      throw Object.assign(new Error('Only TRANSFER transactions can be reversed'), { status: 400 });

    // Lock both accounts (ascending order)
    const lockOrder = [txn.from_account_id, txn.to_account_id].sort((a, b) => a - b);
    const [accounts] = await conn.query(
      `SELECT id, balance, status, version, account_number FROM accounts WHERE id IN (?, ?) ORDER BY id ASC FOR UPDATE`,
      lockOrder
    );
    if (accounts.length !== 2) throw Object.assign(new Error('Accounts no longer exist'), { status: 404 });

    const toAcc   = accounts.find(a => a.id === txn.to_account_id);
    const fromAcc = accounts.find(a => a.id === txn.from_account_id);

    if (parseFloat(toAcc.balance) < parseFloat(txn.amount))
      throw Object.assign(new Error(`Destination account has insufficient balance for reversal (${toAcc.balance} < ${txn.amount})`), { status: 400 });

    // Mark original as REVERSED
    await conn.query(`UPDATE transactions SET status = 'REVERSED' WHERE id = ?`, [transactionId]);

    // Create reversal transaction
    const reverseKey = `reverse-${transactionId}-${Date.now()}`;
    const [revResult] = await conn.query(
      `INSERT INTO transactions (from_account_id, to_account_id, amount, transaction_type, status, idempotency_key, requires_approval)
       VALUES (?, ?, ?, 'TRANSFER', 'SUCCESS', ?, 0)`,
      [txn.to_account_id, txn.from_account_id, txn.amount, reverseKey]
    );

    // Move money back
    await conn.query(`UPDATE accounts SET balance = balance - ?, version = version + 1 WHERE id = ?`, [txn.amount, txn.to_account_id]);
    await conn.query(`UPDATE accounts SET balance = balance + ?, version = version + 1 WHERE id = ?`, [txn.amount, txn.from_account_id]);

    // Audit
    await conn.query(
      `INSERT INTO audit_logs (transaction_id, event, metadata) VALUES (?, 'TRANSACTION_REVERSED', ?)`,
      [revResult.insertId, JSON.stringify({ original_txn_id: transactionId, reversed_by: adminId, amount: txn.amount })]
    );

    await conn.commit(); conn.release();
    return { status: 'reversed', original_transaction_id: transactionId, reversal_transaction_id: revResult.insertId };
  } catch (err) { await conn.rollback(); conn.release(); throw err; }
};

/**
 * Approve a PENDING_APPROVAL transaction — moves money atomically.
 */
const approveTransactionService = async ({ transactionId, adminId }) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [txns] = await conn.query(`SELECT * FROM transactions WHERE id = ? FOR UPDATE`, [transactionId]);
    if (txns.length === 0) throw Object.assign(new Error('Transaction not found'), { status: 404 });

    const txn = txns[0];
    if (txn.status !== 'PENDING_APPROVAL')
      throw Object.assign(new Error(`Transaction is not pending approval (status: ${txn.status})`), { status: 400 });

    // Lock accounts
    const lockOrder = [txn.from_account_id, txn.to_account_id].sort((a, b) => a - b);
    const [accounts] = await conn.query(
      `SELECT id, balance, status, version FROM accounts WHERE id IN (?, ?) ORDER BY id ASC FOR UPDATE`,
      lockOrder
    );
    if (accounts.length !== 2) throw Object.assign(new Error('Accounts not found'), { status: 404 });

    const fromAcc = accounts.find(a => a.id === txn.from_account_id);
    const toAcc   = accounts.find(a => a.id === txn.to_account_id);

    if (fromAcc.status !== 'ACTIVE') throw Object.assign(new Error(`Source account is ${fromAcc.status}`), { status: 400 });
    if (parseFloat(fromAcc.balance) < parseFloat(txn.amount))
      throw Object.assign(new Error('Insufficient balance at time of approval'), { status: 400 });

    // Debit / credit
    await conn.query(`UPDATE accounts SET balance = balance - ?, version = version + 1 WHERE id = ?`, [txn.amount, txn.from_account_id]);
    await conn.query(`UPDATE accounts SET balance = balance + ?, version = version + 1 WHERE id = ?`, [txn.amount, txn.to_account_id]);

    // Mark approved
    await conn.query(
      `UPDATE transactions SET status = 'SUCCESS', approved_by = ?, approved_at = NOW() WHERE id = ?`,
      [adminId, transactionId]
    );

    await conn.query(
      `INSERT INTO audit_logs (transaction_id, event, metadata) VALUES (?, 'TRANSFER_APPROVED', ?)`,
      [transactionId, JSON.stringify({ approved_by: adminId, amount: txn.amount })]
    );

    await conn.commit(); conn.release();
    return { status: 'approved', transaction_id: transactionId };
  } catch (err) { await conn.rollback(); conn.release(); throw err; }
};

module.exports = { transferService, depositService, withdrawService, reverseTransactionService, approveTransactionService };
