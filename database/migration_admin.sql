-- ============================================================
-- Mini Banking System — Migration: Admin Features
-- ============================================================
USE mini_banking;

-- ── 1. Extend transactions table ──────────────────────────────
ALTER TABLE transactions
  ADD COLUMN flagged           BOOLEAN       NOT NULL DEFAULT FALSE      AFTER status,
  ADD COLUMN flag_reason       VARCHAR(255)  NULL                        AFTER flagged,
  ADD COLUMN requires_approval BOOLEAN       NOT NULL DEFAULT FALSE      AFTER flag_reason,
  ADD COLUMN approved_by       BIGINT UNSIGNED NULL                      AFTER requires_approval,
  ADD COLUMN approved_at       DATETIME      NULL                        AFTER approved_by;

ALTER TABLE transactions
  MODIFY COLUMN status ENUM('PENDING','PENDING_APPROVAL','SUCCESS','FAILED','REVERSED') NOT NULL DEFAULT 'PENDING';

-- Indexes for admin queries
ALTER TABLE transactions
  ADD INDEX idx_txn_flagged           (flagged),
  ADD INDEX idx_txn_requires_approval (requires_approval),
  ADD INDEX idx_txn_approved_by       (approved_by);

-- ── 2. OTP verifications table ────────────────────────────────
CREATE TABLE IF NOT EXISTS otp_verifications (
  id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  customer_id BIGINT UNSIGNED NOT NULL,
  otp_code    VARCHAR(10)     NOT NULL,
  context     JSON            NOT NULL  COMMENT 'Stores pending transfer payload',
  expires_at  DATETIME        NOT NULL,
  used        BOOLEAN         NOT NULL DEFAULT FALSE,
  created_at  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT fk_otp_customer FOREIGN KEY (customer_id)
    REFERENCES customers(id) ON DELETE CASCADE,

  INDEX idx_otp_customer_id (customer_id),
  INDEX idx_otp_expires_at  (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
