/**
 * otpService.js — Stateless Signed OTP Tokens
 * ============================================
 * Zero database reads or writes.
 *
 * Flow:
 *  1. generateOTP({ customerId, transferPayload })
 *     - Generates a 6-digit OTP.
 *     - SHA-256 hashes it with a per-token salt.
 *     - Signs a JWT containing { customerId, otpHash, salt, transferPayload }.
 *     - Returns { otp (raw, demo-only), otpToken (signed JWT) }.
 *
 *  2. verifyOTP({ otpToken, userEnteredOTP })
 *     - Verifies JWT signature & expiry in-memory (no DB).
 *     - Re-hashes userEnteredOTP with the embedded salt.
 *     - Compares against stored otpHash (constant-time compare).
 *     - Returns transferPayload on success.
 */

const crypto = require('crypto');
const jwt    = require('jsonwebtoken');

const HIGH_AMOUNT_THRESHOLD = 25000; // Rs. 25,000

// Use a dedicated OTP secret — separate from the auth JWT secret.
// Falls back to a deterministic dev value so hot-reload doesn't break tokens.
const OTP_SECRET = process.env.OTP_SECRET || process.env.JWT_SECRET || 'otp_dev_secret_change_in_prod';
const OTP_TTL_SECONDS = 300; // 5 minutes

/**
 * Hash an OTP string with a salt using SHA-256.
 * @param {string} otp   - Raw 6-digit string
 * @param {string} salt  - Random hex salt
 * @returns {string}       hex digest
 */
const hashOTP = (otp, salt) =>
  crypto.createHmac('sha256', salt).update(String(otp)).digest('hex');

/**
 * Generate a stateless OTP token.
 *
 * @param {{ customerId: number, transferPayload: object }} params
 * @returns {{ otp: string, otpToken: string }}
 */
const generateOTP = async ({ customerId, transferPayload }) => {
  const otp  = String(Math.floor(100000 + Math.random() * 900000)); // 6-digit
  const salt = crypto.randomBytes(16).toString('hex');              // unique per token
  const otpHash = hashOTP(otp, salt);

  const otpToken = jwt.sign(
    {
      customerId,
      otpHash,
      salt,
      transferPayload,
    },
    OTP_SECRET,
    { expiresIn: OTP_TTL_SECONDS } // token self-expires in 5 min
  );

  // Return both — `otp` is shown in the demo UI only.
  // In production you would SMS/email `otp` and never expose it over the API.
  return { otp, otpToken };
};

/**
 * Verify a stateless OTP token.
 *
 * @param {{ otpToken: string, userEnteredOTP: string }} params
 * @returns {object} transferPayload stored inside the token
 */
const verifyOTP = async ({ otpToken, userEnteredOTP }) => {
  let decoded;
  try {
    decoded = jwt.verify(otpToken, OTP_SECRET);
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      throw Object.assign(new Error('OTP has expired. Please request a new one.'), { status: 400 });
    }
    throw Object.assign(new Error('Invalid OTP token. Please request a new one.'), { status: 400 });
  }

  // Constant-time compare: re-hash user input with embedded salt
  const expectedHash = hashOTP(userEnteredOTP, decoded.salt);
  const actualHash   = decoded.otpHash;

  // Use timingSafeEqual to prevent timing-based attacks
  const expectedBuf = Buffer.from(expectedHash, 'hex');
  const actualBuf   = Buffer.from(actualHash,   'hex');

  if (
    expectedBuf.length !== actualBuf.length ||
    !crypto.timingSafeEqual(expectedBuf, actualBuf)
  ) {
    throw Object.assign(new Error('Incorrect OTP. Please try again.'), { status: 400 });
  }

  return decoded.transferPayload;
};

const isHighAmount = (amount) => parseFloat(amount) >= HIGH_AMOUNT_THRESHOLD;

module.exports = { generateOTP, verifyOTP, isHighAmount, HIGH_AMOUNT_THRESHOLD };
