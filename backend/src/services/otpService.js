const pool = require('../config/db');

const HIGH_AMOUNT_THRESHOLD = 25000; // Rs. 25,000

/**
 * Generate a 6-digit dummy OTP, store it in DB with 5-min expiry.
 * Returns the OTP (in real life this would be SMS/email — here we return it directly).
 */
const generateOTP = async ({ customerId, transferPayload }) => {
  const otp      = String(Math.floor(100000 + Math.random() * 900000)); // 6-digit
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes

  // Invalidate any previous unused OTPs for this customer
  await pool.query(
    'UPDATE otp_verifications SET used = TRUE WHERE customer_id = ? AND used = FALSE',
    [customerId]
  );

  await pool.query(
    `INSERT INTO otp_verifications (customer_id, otp_code, context, expires_at)
     VALUES (?, ?, ?, ?)`,
    [customerId, otp, JSON.stringify(transferPayload), expiresAt]
  );

  return otp;
};

/**
 * Verify OTP. Returns the stored transfer context if valid.
 * Marks OTP as used on success.
 */
const verifyOTP = async ({ customerId, otp }) => {
  const [rows] = await pool.query(
    `SELECT id, otp_code, context, expires_at, used
     FROM otp_verifications
     WHERE customer_id = ? AND used = FALSE
     ORDER BY created_at DESC LIMIT 1`,
    [customerId]
  );

  if (rows.length === 0) {
    throw Object.assign(new Error('No active OTP found. Please request a new one.'), { status: 400 });
  }

  const record = rows[0];

  if (new Date(record.expires_at) < new Date()) {
    throw Object.assign(new Error('OTP has expired. Please request a new one.'), { status: 400 });
  }

  if (record.otp_code !== String(otp).trim()) {
    throw Object.assign(new Error('Incorrect OTP. Please try again.'), { status: 400 });
  }

  // Mark used
  await pool.query('UPDATE otp_verifications SET used = TRUE WHERE id = ?', [record.id]);

  return typeof record.context === 'string' ? JSON.parse(record.context) : record.context;
};

const isHighAmount = (amount) => parseFloat(amount) >= HIGH_AMOUNT_THRESHOLD;

module.exports = { generateOTP, verifyOTP, isHighAmount, HIGH_AMOUNT_THRESHOLD };
