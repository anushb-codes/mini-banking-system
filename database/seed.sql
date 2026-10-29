-- ============================================================
-- Mini Banking System — Seed Data
-- ============================================================
USE mini_banking;

-- Admin user (password: admin123)
INSERT INTO customers (name, email, phone, password_hash, role) VALUES
('Admin User', 'admin@minibank.com', '9000000000',
 '$2b$10$yFejfn50CmM41tvPDxNpFeffBhidzfZnH2gmmIfG3Qdd3c70Ln76a', 'ADMIN');

-- Sample customers (password: password123 for all)
INSERT INTO customers (name, email, phone, password_hash, role) VALUES
('Ananya Sharma', 'ananya@example.com', '9876543210', '$2b$10$Jqzrf9szdsIqkg3LN/VwTOzbUGtCPd0CxAXxmrVqRt.w.Y64ncPrO', 'CUSTOMER'),
('Rohit Mehta',   'rohit@example.com',  '9123456789', '$2b$10$Jqzrf9szdsIqkg3LN/VwTOzbUGtCPd0CxAXxmrVqRt.w.Y64ncPrO', 'CUSTOMER'),
('Priya Kapoor',  'priya@example.com',  '9988776655', '$2b$10$Jqzrf9szdsIqkg3LN/VwTOzbUGtCPd0CxAXxmrVqRt.w.Y64ncPrO', 'CUSTOMER');

-- Accounts
INSERT INTO accounts (customer_id, account_number, account_type, balance, status) VALUES
(2, 'ACC1000000001', 'SAVINGS',  50000.00, 'ACTIVE'),
(2, 'ACC1000000002', 'CURRENT',  25000.00, 'ACTIVE'),
(3, 'ACC1000000003', 'SAVINGS',  75000.00, 'ACTIVE'),
(4, 'ACC1000000004', 'SAVINGS',  10000.00, 'ACTIVE');

-- Sample transactions
INSERT INTO transactions (from_account_id, to_account_id, amount, transaction_type, status, idempotency_key) VALUES
(NULL, 1, 50000.00, 'DEPOSIT',   'SUCCESS', 'idm-seed-001'),
(NULL, 2, 25000.00, 'DEPOSIT',   'SUCCESS', 'idm-seed-002'),
(NULL, 3, 75000.00, 'DEPOSIT',   'SUCCESS', 'idm-seed-003'),
(NULL, 4, 10000.00, 'DEPOSIT',   'SUCCESS', 'idm-seed-004'),
(1,    3,  2000.00, 'TRANSFER',  'SUCCESS', 'idm-seed-005');

-- Update balances to reflect the transfer
UPDATE accounts SET balance = 48000.00 WHERE id = 1;
UPDATE accounts SET balance = 77000.00 WHERE id = 3;

-- Audit logs
INSERT INTO audit_logs (transaction_id, event, metadata) VALUES
(1, 'DEPOSIT_SUCCESS',  '{"account": "ACC1000000001", "amount": 50000}'),
(2, 'DEPOSIT_SUCCESS',  '{"account": "ACC1000000002", "amount": 25000}'),
(3, 'DEPOSIT_SUCCESS',  '{"account": "ACC1000000003", "amount": 75000}'),
(4, 'DEPOSIT_SUCCESS',  '{"account": "ACC1000000004", "amount": 10000}'),
(5, 'TRANSFER_SUCCESS', '{"from": "ACC1000000001", "to": "ACC1000000003", "amount": 2000}');

-- Beneficiaries
INSERT INTO beneficiaries (customer_id, account_id, nickname) VALUES
(2, 3, 'Rohit Savings');
