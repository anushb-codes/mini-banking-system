const pool = require('../config/db');
const { validationResult } = require('express-validator');

/**
 * GET /api/customers/me
 */
const getProfile = async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      'SELECT id, name, email, phone, role, created_at FROM customers WHERE id = ?',
      [req.user.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Customer not found' });
    return res.json(rows[0]);
  } catch (err) {
    next(err);
  }
};

/**
 * PUT /api/customers/me
 */
const updateProfile = async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { name, phone } = req.body;
    await pool.query(
      'UPDATE customers SET name = ?, phone = ? WHERE id = ?',
      [name, phone || null, req.user.id]
    );
    return res.json({ message: 'Profile updated successfully' });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/admin/customers  (Admin only)
 */
const getAllCustomers = async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      'SELECT id, name, email, phone, role, created_at FROM customers ORDER BY created_at DESC'
    );
    return res.json(rows);
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/customers/search?q=...  (All authenticated users)
 * Searches name, email, phone using LIKE %q%.
 * Returns public-safe fields only (no password_hash).
 * Limited to 50 results.
 */
const searchCustomers = async (req, res, next) => {
  try {
    const q = (req.query.q || '').trim();
    if (!q) {
      // No query — return recent customers (last 20)
      const [rows] = await pool.query(
        `SELECT id, name, email, phone, role, created_at FROM customers ORDER BY created_at DESC LIMIT 20`
      );
      return res.json({ data: rows, query: q });
    }

    const pattern = `%${q}%`;
    const [rows] = await pool.query(
      `SELECT c.id, c.name, c.email, c.phone, c.role, c.created_at,
              COUNT(a.id) AS account_count
       FROM customers c
       LEFT JOIN accounts a ON a.customer_id = c.id
       WHERE c.name LIKE ? OR c.email LIKE ? OR c.phone LIKE ?
       GROUP BY c.id
       ORDER BY c.name ASC
       LIMIT 50`,
      [pattern, pattern, pattern]
    );
    return res.json({ data: rows, query: q });
  } catch (err) {
    next(err);
  }
};

module.exports = { getProfile, updateProfile, getAllCustomers, searchCustomers };
