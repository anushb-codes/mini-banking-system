-- ============================================================
-- Mini Banking System — MySQL Schema
-- ============================================================

CREATE DATABASE IF NOT EXISTS mini_banking;
USE mini_banking;

-- ============================================================
-- 1. CUSTOMERS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS customers (
  id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name          VARCHAR(100)    NOT NULL,
  email         VARCHAR(150)    NOT NULL UNIQUE,
  phone         VARCHAR(20),
  password_hash VARCHAR(255)    NOT NULL,
  role          ENUM('CUSTOMER','ADMIN') NOT NULL DEFAULT 'CUSTOMER',
  created_at    DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,

  INDEX idx_customers_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============================================================
-- 2. ACCOUNTS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS accounts (
  id             BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  customer_id    BIGINT UNSIGNED NOT NULL,
  account_number VARCHAR(20)     NOT NULL UNIQUE,
  account_type   ENUM('SAVINGS','CURRENT') NOT NULL DEFAULT 'SAVINGS',
  balance        DECIMAL(15,2)   NOT NULL DEFAULT 0.00,
  status         ENUM('ACTIVE','FROZEN','CLOSED') NOT NULL DEFAULT 'ACTIVE',
  version        INT             NOT NULL DEFAULT 0 COMMENT 'Optimistic locking version',
  created_at     DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT fk_accounts_customer FOREIGN KEY (customer_id)
    REFERENCES customers(id) ON DELETE RESTRICT ON UPDATE CASCADE,

  INDEX idx_accounts_customer_id    (customer_id),
  INDEX idx_accounts_account_number (account_number),
  INDEX idx_accounts_status         (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============================================================
-- 3. TRANSACTIONS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS transactions (
  id               BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  from_account_id  BIGINT UNSIGNED NULL  COMMENT 'NULL for DEPOSIT',
  to_account_id    BIGINT UNSIGNED NULL  COMMENT 'NULL for WITHDRAWAL',
  amount           DECIMAL(15,2)   NOT NULL,
  transaction_type ENUM('DEPOSIT','WITHDRAWAL','TRANSFER') NOT NULL,
  status           ENUM('PENDING','SUCCESS','FAILED','REVERSED') NOT NULL DEFAULT 'PENDING',
  idempotency_key  VARCHAR(100)    NOT NULL UNIQUE,
  created_at       DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT fk_txn_from_account FOREIGN KEY (from_account_id)
    REFERENCES accounts(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_txn_to_account   FOREIGN KEY (to_account_id)
    REFERENCES accounts(id) ON DELETE RESTRICT ON UPDATE CASCADE,

  INDEX idx_txn_from_account_id       (from_account_id, created_at),
  INDEX idx_txn_to_account_id         (to_account_id,   created_at),
  INDEX idx_txn_status                (status),
  INDEX idx_txn_idempotency_key       (idempotency_key),
  INDEX idx_txn_created_at            (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============================================================
-- 4. BENEFICIARIES TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS beneficiaries (
  id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  customer_id BIGINT UNSIGNED NOT NULL,
  account_id  BIGINT UNSIGNED NOT NULL,
  nickname    VARCHAR(50),
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT fk_bene_customer FOREIGN KEY (customer_id)
    REFERENCES customers(id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_bene_account  FOREIGN KEY (account_id)
    REFERENCES accounts(id)  ON DELETE CASCADE ON UPDATE CASCADE,

  UNIQUE KEY uq_bene_customer_account (customer_id, account_id),
  INDEX idx_bene_customer_id (customer_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============================================================
-- 5. AUDIT_LOGS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS audit_logs (
  id             BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  transaction_id BIGINT UNSIGNED NULL,
  event          VARCHAR(100)    NOT NULL,
  metadata       JSON,
  created_at     DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT fk_audit_transaction FOREIGN KEY (transaction_id)
    REFERENCES transactions(id) ON DELETE SET NULL ON UPDATE CASCADE,

  INDEX idx_audit_transaction_id (transaction_id),
  INDEX idx_audit_event          (event),
  INDEX idx_audit_created_at     (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
