const bcrypt = require('bcrypt');
const pool = require('../config/db');
const { generateToken } = require('../config/jwt');
const { validationResult } = require('express-validator');

/**
 * POST /api/auth/register
 */
const register = async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { name, email, phone, password } = req.body;

    // Check duplicate
    const [existing] = await pool.query('SELECT id FROM customers WHERE email = ?', [email]);
    if (existing.length > 0) {
      return res.status(409).json({ error: 'Email already registered' });
    }

    const password_hash = await bcrypt.hash(password, 10);

    const [result] = await pool.query(
      'INSERT INTO customers (name, email, phone, password_hash, role) VALUES (?, ?, ?, ?, ?)',
      [name, email, phone || null, password_hash, 'CUSTOMER']
    );

    const token = generateToken({ id: result.insertId, email, role: 'CUSTOMER' });

    return res.status(201).json({
      message: 'Registration successful',
      token,
      user: { id: result.insertId, name, email, role: 'CUSTOMER' },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/auth/login
 */
const login = async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { email, password } = req.body;

    const [rows] = await pool.query(
      'SELECT id, name, email, password_hash, role FROM customers WHERE email = ?',
      [email]
    );

    if (rows.length === 0) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const customer = rows[0];
    const valid = await bcrypt.compare(password, customer.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const token = generateToken({ id: customer.id, email: customer.email, role: customer.role });

    return res.json({
      message: 'Login successful',
      token,
      user: { id: customer.id, name: customer.name, email: customer.email, role: customer.role },
    });
  } catch (err) {
    next(err);
  }
};

module.exports = { register, login };
