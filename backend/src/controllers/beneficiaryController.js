const pool = require('../config/db');
const { validationResult } = require('express-validator');

/**
 * POST /api/beneficiaries
 */
const addBeneficiary = async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { account_id, nickname } = req.body;

    // Check target account exists
    const [accounts] = await pool.query('SELECT id FROM accounts WHERE id = ?', [account_id]);
    if (accounts.length === 0) return res.status(404).json({ error: 'Account not found' });

    const [result] = await pool.query(
      'INSERT INTO beneficiaries (customer_id, account_id, nickname) VALUES (?, ?, ?)',
      [req.user.id, account_id, nickname || null]
    );

    return res.status(201).json({
      message: 'Beneficiary added',
      beneficiary: { id: result.insertId, customer_id: req.user.id, account_id, nickname },
    });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'Beneficiary already exists' });
    }
    next(err);
  }
};

/**
 * GET /api/beneficiaries
 */
const getBeneficiaries = async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      `SELECT b.id, b.nickname, b.created_at,
              a.id AS account_id, a.account_number, a.account_type,
              c.name AS account_holder_name
       FROM beneficiaries b
       JOIN accounts a ON b.account_id = a.id
       JOIN customers c ON a.customer_id = c.id
       WHERE b.customer_id = ?
       ORDER BY b.created_at DESC`,
      [req.user.id]
    );
    return res.json(rows);
  } catch (err) {
    next(err);
  }
};

/**
 * DELETE /api/beneficiaries/:id
 */
const removeBeneficiary = async (req, res, next) => {
  try {
    const [result] = await pool.query(
      'DELETE FROM beneficiaries WHERE id = ? AND customer_id = ?',
      [req.params.id, req.user.id]
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Beneficiary not found' });
    }
    return res.json({ message: 'Beneficiary removed' });
  } catch (err) {
    next(err);
  }
};

module.exports = { addBeneficiary, getBeneficiaries, removeBeneficiary };
