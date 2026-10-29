# Mini Banking System — Comprehensive SQL Query Documentation

> **Schema version**: includes `migration_admin.sql` (flagging, OTP, approvals).
> All queries are executed by the Node.js backend via the `mysql2` connection pool.

---

## Table of Contents

1. [Authentication](#1-authentication)
2. [Customer Profile](#2-customer-profile)
3. [Customer Search](#3-customer-search)
4. [Accounts](#4-accounts)
5. [Account Lookup (Transfer Recipient)](#5-account-lookup)
6. [Beneficiaries](#6-beneficiaries)
7. [Atomic Transfer — Full BEGIN…COMMIT Flow](#7-atomic-transfer)
8. [Deposit](#8-deposit)
9. [Withdrawal](#9-withdrawal)
10. [OTP Verification (High-Amount Transfers)](#10-otp-verification)
11. [Transaction History (Paginated)](#11-transaction-history)
12. [Admin — Dashboard Stats](#12-admin-dashboard)
13. [Admin — All Transactions](#13-admin-all-transactions)
14. [Admin — Pending Approvals](#14-admin-pending-approvals)
15. [Admin — Flagged Transactions](#15-admin-flagged-transactions)
16. [Admin — Flag / Unflag](#16-admin-flag--unflag)
17. [Admin — Reverse Transaction](#17-admin-reverse-transaction)
18. [Admin — Approve Transaction](#18-admin-approve-transaction)
19. [Admin — Reject Transaction](#19-admin-reject-transaction)
20. [Admin — Block / Unblock Account](#20-admin-block--unblock-account)
21. [Admin — All Accounts](#21-admin-all-accounts)
22. [Admin — All Customers](#22-admin-all-customers)
23. [Audit Logs](#23-audit-logs)
24. [Locking Mechanics Deep Dive](#24-locking-mechanics-deep-dive)
25. [Index Usage Summary](#25-index-usage-summary)

---

## 1. Authentication

### 1.1 Login — Find customer by email

**Frontend trigger**: User submits the Login form.

```sql
SELECT id, name, email, password_hash, role
FROM customers
WHERE email = :email
LIMIT 1;
```

| Variable | Source | Description |
|---|---|---|
| `:email` | POST body `email` | Looked up by exact unique index |

**Index hit**: `idx_customers_email (email)` — unique index, single-row lookup O(log n).

**Business logic**: `password_hash` is compared using `bcrypt.compare()` in Node.js. JWT token is issued on success containing `{ id, name, role }`.

---

### 1.2 Register — Create new customer

```sql
INSERT INTO customers (name, email, phone, password_hash, role)
VALUES (:name, :email, :phone, :hash, 'CUSTOMER');
```

**Business logic**: Password is hashed with `bcrypt` (10 rounds) before insert. Email uniqueness is enforced by the `UNIQUE` constraint; a duplicate raises error `ER_DUP_ENTRY`.

---

### 1.3 Auth middleware — Validate JWT on every protected request

```sql
SELECT id, name, email, role
FROM customers
WHERE id = :id
LIMIT 1;
```

| Variable | Source |
|---|---|
| `:id` | Decoded from JWT payload (`req.user.id`) |

**Index hit**: PRIMARY KEY — O(1) lookup.

---

## 2. Customer Profile

### 2.1 Get my profile

**Endpoint**: `GET /api/customers/me`

```sql
SELECT id, name, email, phone, role, created_at
FROM customers
WHERE id = :id;
```

**Index hit**: PRIMARY KEY.

---

### 2.2 Update my profile

**Endpoint**: `PUT /api/customers/me`

```sql
UPDATE customers
SET name = :name, phone = :phone
WHERE id = :id;
```

---

## 3. Customer Search

### 3.1 Search customers (all authenticated users)

**Endpoint**: `GET /api/customers/search?q=:query`

```sql
-- With search query
SELECT c.id, c.name, c.email, c.phone, c.role, c.created_at,
       COUNT(a.id) AS account_count
FROM customers c
LEFT JOIN accounts a ON a.customer_id = c.id
WHERE c.name  LIKE :pattern
   OR c.email LIKE :pattern
   OR c.phone LIKE :pattern
GROUP BY c.id
ORDER BY c.name ASC
LIMIT 50;
```

```sql
-- Without search query (browse recent)
SELECT id, name, email, phone, role, created_at
FROM customers
ORDER BY created_at DESC
LIMIT 20;
```

| Variable | Value |
|---|---|
| `:pattern` | `%` + query + `%` (case-insensitive in utf8mb4_unicode_ci) |

**Index hit**: For the LIKE with leading wildcard (`%term%`), MySQL cannot use the `idx_customers_email` index and falls back to a full table scan. For larger datasets, consider a `FULLTEXT INDEX` on `(name, email, phone)`.

**Business logic**: Returns public-safe fields only (no `password_hash`). Account count is included so users can see how many accounts a customer has before adding as a beneficiary.

---

## 4. Accounts

### 4.1 List my accounts

**Endpoint**: `GET /api/accounts`

```sql
SELECT id, account_number, account_type, balance, status, version, created_at
FROM accounts
WHERE customer_id = :customerId
ORDER BY created_at ASC;
```

**Index hit**: `idx_accounts_customer_id (customer_id)`.

---

### 4.2 Open a new account

**Endpoint**: `POST /api/accounts`

```sql
INSERT INTO accounts (customer_id, account_number, account_type, balance, status)
VALUES (:customerId, :accountNumber, :accountType, 0.00, 'ACTIVE');
```

**Business logic**: Account number is auto-generated as `ACC` + zero-padded counter, guaranteed unique.

---

## 5. Account Lookup

### 5.1 Lookup by account number (transfer recipient verification)

**Endpoint**: `GET /api/accounts/lookup?account_number=:num`

```sql
SELECT a.id, a.account_number, a.account_type, a.status,
       c.name AS holder_name
FROM accounts a
JOIN customers c ON a.customer_id = c.id
WHERE a.account_number = :accountNumber
LIMIT 1;
```

**Index hit**: `idx_accounts_account_number (account_number)` — unique index, instant lookup.

**Business logic**: Used by the frontend transfer form for live recipient verification as the user types (debounced 500 ms). Returns account holder name so the sender can visually confirm they're sending to the right person.

---

## 6. Beneficiaries

### 6.1 List my beneficiaries

**Endpoint**: `GET /api/beneficiaries`

```sql
SELECT b.id, b.nickname, b.created_at,
       a.account_number, a.account_type,
       c.name AS account_holder_name
FROM beneficiaries b
JOIN accounts a  ON b.account_id  = a.id
JOIN customers c ON a.customer_id = c.id
WHERE b.customer_id = :customerId
ORDER BY b.created_at DESC;
```

**Index hit**: `idx_bene_customer_id (customer_id)`.

---

### 6.2 Add beneficiary

```sql
INSERT INTO beneficiaries (customer_id, account_id, nickname)
VALUES (:customerId, :accountId, :nickname);
```

**Constraint**: `uq_bene_customer_account (customer_id, account_id)` prevents duplicate beneficiaries.

---

### 6.3 Delete beneficiary

```sql
DELETE FROM beneficiaries
WHERE id = :id AND customer_id = :customerId;
```

---

## 7. Atomic Transfer

**Endpoint**: `POST /api/transactions/transfer` (< ₹25,000)
or via admin approval (≥ ₹25,000)

This is the most critical path in the system. It uses an explicit transaction with carefully ordered `FOR UPDATE` locks to prevent deadlocks and race conditions.

### Full BEGIN…COMMIT Flow

```sql
-- STEP 1: Begin transaction
BEGIN;

-- STEP 2: Idempotency check (shared lock — allows concurrent reads, blocks writes)
SELECT id, status
FROM transactions
WHERE idempotency_key = :idempotencyKey
FOR SHARE;
-- If rows found → ROLLBACK and return cached result (idempotent replay)

-- STEP 3: Lock accounts in ASCENDING ID order (deadlock prevention)
--         Both accounts are locked in a single query, sorted by id.
--         If Thread A locks (id=3, id=7) and Thread B locks (id=7, id=3),
--         without ordering this would deadlock. Ascending order eliminates that.
SELECT id, balance, status, version, account_number
FROM accounts
WHERE id IN (:lowerAccountId, :higherAccountId)
ORDER BY id ASC
FOR UPDATE;

-- STEP 4: Business validations (done in application layer on locked rows)
--         • Source account status must be ACTIVE
--         • Destination account status must be ACTIVE
--         • Source balance >= amount

-- STEP 5: Insert transaction record
INSERT INTO transactions
  (from_account_id, to_account_id, amount, transaction_type, status,
   idempotency_key, requires_approval)
VALUES
  (:fromAccountId, :toAccountId, :amount, 'TRANSFER', 'PENDING',
   :idempotencyKey, :requiresApproval);

-- ── Branch A: Normal transfer (requiresApproval = FALSE) ──────────────────

-- STEP 6a-1: Debit source (with optimistic lock version check)
UPDATE accounts
SET balance = balance - :amount,
    version = version + 1
WHERE id = :fromAccountId
  AND version = :currentVersion;
-- affectedRows === 0 → concurrent modification detected → ROLLBACK + 409

-- STEP 6a-2: Credit destination
UPDATE accounts
SET balance = balance + :amount,
    version = version + 1
WHERE id = :toAccountId;

-- STEP 6a-3: Mark transaction as success
UPDATE transactions
SET status = 'SUCCESS'
WHERE id = :transactionId;

-- STEP 6a-4: Audit log
INSERT INTO audit_logs (transaction_id, event, metadata)
VALUES (:transactionId, 'TRANSFER_SUCCESS',
        '{"from": ":fromAccNum", "to": ":toAccNum", "amount": :amount}');

-- ── Branch B: High-amount (requiresApproval = TRUE) ───────────────────────

-- STEP 6b-1: Transaction stays in PENDING_APPROVAL, no money moved yet
INSERT INTO audit_logs (transaction_id, event, metadata)
VALUES (:transactionId, 'TRANSFER_PENDING_APPROVAL',
        '{"from": ":fromAccNum", "to": ":toAccNum", "amount": :amount}');

-- STEP 7: Commit
COMMIT;
```

### Locking Diagram

```
Thread A transfers from acc_id=3 → acc_id=7
Thread B transfers from acc_id=7 → acc_id=3

WITHOUT ordering:           WITH ascending-ID ordering:
A locks acc 3 ──────────►  A locks acc 3 ──────────►
B locks acc 7 ──────────►  B locks acc 3 ──── WAITS ►
A waits for acc 7 ──────►  A locks acc 7 ──────────►
B waits for acc 3 ──────►  A commits, B proceeds
          ↕
       DEADLOCK           NO DEADLOCK ✓
```

### Variables

| Variable | Source |
|---|---|
| `:fromAccountId` | POST body `from_account_id` |
| `:toAccountId` | POST body `to_account_id` |
| `:amount` | POST body `amount` (parsed float) |
| `:idempotencyKey` | POST body or `uuidv4()` auto-generated |
| `:currentVersion` | Read from locked account row (optimistic locking) |

---

## 8. Deposit

**Endpoint**: `POST /api/transactions/deposit`

```sql
BEGIN;

-- Idempotency check
SELECT id, status FROM transactions WHERE idempotency_key = :idempotencyKey;

-- Lock target account
SELECT id, status FROM accounts WHERE id = :accountId FOR UPDATE;

-- Insert transaction
INSERT INTO transactions
  (from_account_id, to_account_id, amount, transaction_type, status, idempotency_key)
VALUES (NULL, :accountId, :amount, 'DEPOSIT', 'PENDING', :idempotencyKey);

-- Credit account
UPDATE accounts SET balance = balance + :amount WHERE id = :accountId;

-- Mark success
UPDATE transactions SET status = 'SUCCESS' WHERE id = :transactionId;

-- Audit
INSERT INTO audit_logs (transaction_id, event, metadata)
VALUES (:transactionId, 'DEPOSIT_SUCCESS',
        '{"account_id": :accountId, "amount": :amount}');

COMMIT;
```

**Index hit**: PRIMARY KEY on `accounts.id` for the `FOR UPDATE` lock.

---

## 9. Withdrawal

**Endpoint**: `POST /api/transactions/withdraw`

```sql
BEGIN;

SELECT id, status FROM transactions WHERE idempotency_key = :idempotencyKey;

SELECT id, balance, status FROM accounts WHERE id = :accountId FOR UPDATE;
-- Application checks: status = ACTIVE, balance >= amount

INSERT INTO transactions
  (from_account_id, to_account_id, amount, transaction_type, status, idempotency_key)
VALUES (:accountId, NULL, :amount, 'WITHDRAWAL', 'PENDING', :idempotencyKey);

UPDATE accounts SET balance = balance - :amount WHERE id = :accountId;

UPDATE transactions SET status = 'SUCCESS' WHERE id = :transactionId;

INSERT INTO audit_logs (transaction_id, event, metadata)
VALUES (:transactionId, 'WITHDRAWAL_SUCCESS',
        '{"account_id": :accountId, "amount": :amount}');

COMMIT;
```

---

## 10. OTP Verification

Used for transfers ≥ ₹25,000.

### 10.1 Generate OTP

**Endpoint**: `POST /api/transactions/request-otp`

```sql
-- Invalidate previous unused OTPs
UPDATE otp_verifications
SET used = TRUE
WHERE customer_id = :customerId AND used = FALSE;

-- Insert new OTP record
INSERT INTO otp_verifications (customer_id, otp_code, context, expires_at)
VALUES (:customerId, :otpCode, :contextJson, :expiresAt);
```

| Variable | Value |
|---|---|
| `:otpCode` | 6-digit random number (100000–999999) |
| `:contextJson` | JSON string of `{from_account_id, to_account_id, amount, idempotency_key}` |
| `:expiresAt` | `NOW() + 5 minutes` |

---

### 10.2 Verify OTP

**Endpoint**: `POST /api/transactions/verify-otp`

```sql
-- Fetch latest unused OTP for customer
SELECT id, otp_code, context, expires_at, used
FROM otp_verifications
WHERE customer_id = :customerId AND used = FALSE
ORDER BY created_at DESC
LIMIT 1;

-- Application checks:
--   • Row exists
--   • expires_at > NOW()
--   • otp_code === submitted OTP

-- Mark as used
UPDATE otp_verifications SET used = TRUE WHERE id = :otpId;
```

After successful verification, the stored `context` JSON is parsed and passed to `transferService` with `requiresApproval = true`, creating a `PENDING_APPROVAL` transaction.

---

## 11. Transaction History

**Endpoint**: `GET /api/accounts/:id/transactions?page=0&size=10&type=&status=`

### 11.1 Count query (for pagination metadata)

```sql
SELECT COUNT(*) AS total
FROM transactions t
WHERE (t.from_account_id = :accountId OR t.to_account_id = :accountId)
  [AND t.transaction_type = :type]
  [AND t.status = :status]
  [AND t.created_at >= :from]
  [AND t.created_at <= :to];
```

### 11.2 Data query (paginated)

```sql
SELECT t.id, t.from_account_id, t.to_account_id, t.amount,
       t.transaction_type, t.status, t.flagged, t.flag_reason,
       t.requires_approval, t.idempotency_key, t.created_at,
       fa.account_number AS from_account_number,
       ta.account_number AS to_account_number
FROM transactions t
LEFT JOIN accounts fa ON t.from_account_id = fa.id
LEFT JOIN accounts ta ON t.to_account_id   = ta.id
WHERE (t.from_account_id = :accountId OR t.to_account_id = :accountId)
  [AND t.transaction_type = :type]
  [AND t.status = :status]
ORDER BY t.created_at DESC
LIMIT :size OFFSET :offset;
```

| Variable | Source |
|---|---|
| `:accountId` | URL param `:id` |
| `:size` | Query param `size` (default 10) |
| `:offset` | `page * size` |
| `:type` | Optional filter: `DEPOSIT`, `WITHDRAWAL`, `TRANSFER` |
| `:status` | Optional filter: `SUCCESS`, `PENDING_APPROVAL`, `FAILED`, `REVERSED` |

**Index hits**:
- `idx_txn_from_account_id (from_account_id, created_at)` — covers the `from` filter + ORDER BY
- `idx_txn_to_account_id (to_account_id, created_at)` — covers the `to` filter
- `idx_txn_created_at (created_at)` — covers ORDER BY when no account filter applies

**Note on `flagged` column**: The `flagged` and `flag_reason` fields are returned here. The frontend reads these and displays an alert banner when any transaction has `flagged = 1`.

---

## 12. Admin Dashboard

**Endpoint**: `GET /api/admin/dashboard`

Seven individual count/aggregate queries (executed concurrently via `Promise.all`):

```sql
SELECT COUNT(*) AS count FROM customers;

SELECT COUNT(*) AS count FROM accounts;

SELECT COUNT(*) AS count FROM transactions;

SELECT SUM(balance) AS total FROM accounts WHERE status = 'ACTIVE';

SELECT COUNT(*) AS count FROM audit_logs;

SELECT COUNT(*) AS count FROM transactions WHERE status = 'PENDING_APPROVAL';

SELECT COUNT(*) AS count FROM transactions WHERE flagged = TRUE;

SELECT COUNT(*) AS count FROM accounts WHERE status = 'FROZEN';
```

**Index hits**:
- `idx_txn_status (status)` for the `PENDING_APPROVAL` and `flagged` counts
- `idx_accounts_status (status)` for frozen accounts count

---

## 13. Admin — All Transactions

**Endpoint**: `GET /api/admin/transactions?page=0&size=50`

```sql
SELECT t.*,
       fa.account_number AS from_account_number,
       ta.account_number AS to_account_number,
       fc.name AS from_customer_name,
       tc.name AS to_customer_name
FROM transactions t
LEFT JOIN accounts  fa ON t.from_account_id = fa.id
LEFT JOIN accounts  ta ON t.to_account_id   = ta.id
LEFT JOIN customers fc ON fa.customer_id    = fc.id
LEFT JOIN customers tc ON ta.customer_id    = tc.id
ORDER BY t.created_at DESC
LIMIT :size OFFSET :offset;

SELECT COUNT(*) AS total FROM transactions;
```

**Index hit**: `idx_txn_created_at (created_at)` for ORDER BY.

---

## 14. Admin — Pending Approvals

**Endpoint**: `GET /api/admin/transactions/pending`

```sql
SELECT t.*,
       fa.account_number AS from_account_number,
       ta.account_number AS to_account_number,
       fc.name           AS from_customer_name,
       tc.name           AS to_customer_name
FROM transactions t
LEFT JOIN accounts  fa ON t.from_account_id = fa.id
LEFT JOIN accounts  ta ON t.to_account_id   = ta.id
LEFT JOIN customers fc ON fa.customer_id    = fc.id
LEFT JOIN customers tc ON ta.customer_id    = tc.id
WHERE t.status = 'PENDING_APPROVAL'
ORDER BY t.created_at ASC;
```

**Index hit**: `idx_txn_status (status)` narrows to `PENDING_APPROVAL` rows only.

**Business logic**: Oldest first (ASC) — admin processes in FIFO order to avoid starvation.

---

## 15. Admin — Flagged Transactions

**Endpoint**: `GET /api/admin/transactions/flagged`

```sql
SELECT t.*,
       fa.account_number AS from_account_number,
       ta.account_number AS to_account_number,
       fc.name           AS from_customer_name,
       tc.name           AS to_customer_name
FROM transactions t
LEFT JOIN accounts  fa ON t.from_account_id = fa.id
LEFT JOIN accounts  ta ON t.to_account_id   = ta.id
LEFT JOIN customers fc ON fa.customer_id    = fc.id
LEFT JOIN customers tc ON ta.customer_id    = tc.id
WHERE t.flagged = TRUE
ORDER BY t.created_at DESC;
```

---

## 16. Admin — Flag / Unflag

### Flag

**Endpoint**: `PUT /api/admin/transactions/:id/flag`

```sql
UPDATE transactions
SET flagged = TRUE, flag_reason = :reason
WHERE id = :transactionId;

INSERT INTO audit_logs (transaction_id, event, metadata)
VALUES (:transactionId, 'TRANSACTION_FLAGGED',
        '{"reason": ":reason", "flagged_by": :adminId}');
```

**Effect on customer**: The `flagged` and `flag_reason` fields are returned by the transaction history endpoint. The frontend detects any `flagged = 1` rows and shows a prominent red banner at the top of the Transactions page.

### Unflag

```sql
UPDATE transactions
SET flagged = FALSE, flag_reason = NULL
WHERE id = :transactionId;

INSERT INTO audit_logs (transaction_id, event, metadata)
VALUES (:transactionId, 'TRANSACTION_UNFLAGGED',
        '{"unflagged_by": :adminId}');
```

---

## 17. Admin — Reverse Transaction

**Endpoint**: `PUT /api/admin/transactions/:id/reverse`

Only `SUCCESS` + `TRANSFER` transactions can be reversed.

```sql
BEGIN;

-- Lock original transaction row
SELECT * FROM transactions WHERE id = :transactionId FOR UPDATE;
-- Validate: status = 'SUCCESS' AND transaction_type = 'TRANSFER'

-- Lock both accounts (ascending ID order, same deadlock prevention)
SELECT id, balance, status, version, account_number
FROM accounts
WHERE id IN (:lowerAccountId, :higherAccountId)
ORDER BY id ASC
FOR UPDATE;
-- Validate: destination account has enough balance for reversal

-- Mark original as REVERSED
UPDATE transactions SET status = 'REVERSED' WHERE id = :transactionId;

-- Create reversal transaction (money flows back: to→from)
INSERT INTO transactions
  (from_account_id, to_account_id, amount, transaction_type, status,
   idempotency_key, requires_approval)
VALUES
  (:originalToAccountId, :originalFromAccountId, :amount, 'TRANSFER', 'SUCCESS',
   :reverseKey, 0);

-- Move money back
UPDATE accounts SET balance = balance - :amount, version = version + 1
WHERE id = :originalToAccountId;

UPDATE accounts SET balance = balance + :amount, version = version + 1
WHERE id = :originalFromAccountId;

-- Audit
INSERT INTO audit_logs (transaction_id, event, metadata)
VALUES (:reversalTransactionId, 'TRANSACTION_REVERSED',
        '{"original_txn_id": :transactionId, "reversed_by": :adminId}');

COMMIT;
```

**Business logic**: Creates a brand-new transaction record (the reversal) rather than deleting the original. This preserves the full audit trail — the original shows `REVERSED`, and the new one shows `SUCCESS` flowing in the opposite direction.

---

## 18. Admin — Approve Transaction

**Endpoint**: `PUT /api/admin/transactions/:id/approve`

Moves money for a `PENDING_APPROVAL` transfer.

```sql
BEGIN;

SELECT * FROM transactions WHERE id = :transactionId FOR UPDATE;
-- Validate: status = 'PENDING_APPROVAL'

SELECT id, balance, status, version
FROM accounts
WHERE id IN (:lowerAccountId, :higherAccountId)
ORDER BY id ASC
FOR UPDATE;
-- Validate: source ACTIVE, balance still sufficient

UPDATE accounts SET balance = balance - :amount, version = version + 1
WHERE id = :fromAccountId;

UPDATE accounts SET balance = balance + :amount, version = version + 1
WHERE id = :toAccountId;

UPDATE transactions
SET status = 'SUCCESS', approved_by = :adminId, approved_at = NOW()
WHERE id = :transactionId;

INSERT INTO audit_logs (transaction_id, event, metadata)
VALUES (:transactionId, 'TRANSFER_APPROVED',
        '{"approved_by": :adminId, "amount": :amount}');

COMMIT;
```

**Note**: Balance is re-validated at approval time. If the customer spent their balance before approval, the approval will correctly fail with "Insufficient balance at time of approval."

---

## 19. Admin — Reject Transaction

**Endpoint**: `PUT /api/admin/transactions/:id/reject`

```sql
SELECT status FROM transactions WHERE id = :transactionId;
-- Validate: status = 'PENDING_APPROVAL'

UPDATE transactions
SET status = 'FAILED',
    flag_reason = CONCAT('Rejected by admin: ', :reason)
WHERE id = :transactionId;

INSERT INTO audit_logs (transaction_id, event, metadata)
VALUES (:transactionId, 'TRANSFER_REJECTED',
        '{"rejected_by": :adminId, "reason": ":reason"}');
```

**Note**: No money was ever held (PENDING_APPROVAL doesn't debit the source), so no rollback of funds is needed on rejection.

---

## 20. Admin — Block / Unblock Account

### Block (FREEZE)

**Endpoint**: `PUT /api/admin/accounts/:id/block`

```sql
UPDATE accounts
SET status = 'FROZEN'
WHERE id = :accountId AND status != 'CLOSED';

INSERT INTO audit_logs (transaction_id, event, metadata)
VALUES (NULL, 'ACCOUNT_BLOCKED',
        '{"account_id": :accountId, "reason": ":reason", "blocked_by": :adminId}');
```

**Guard**: Only non-CLOSED accounts can be frozen (`AND status != 'CLOSED'`). If `affectedRows = 0`, the account either doesn't exist or is already closed.

### Unblock

```sql
UPDATE accounts
SET status = 'ACTIVE'
WHERE id = :accountId AND status = 'FROZEN';

INSERT INTO audit_logs (transaction_id, event, metadata)
VALUES (NULL, 'ACCOUNT_UNBLOCKED',
        '{"account_id": :accountId, "unblocked_by": :adminId}');
```

**Guard**: Only `FROZEN` accounts can be unblocked.

---

## 21. Admin — All Accounts

**Endpoint**: `GET /api/admin/accounts`

```sql
SELECT a.id, a.account_number, a.account_type, a.balance,
       a.status, a.version, a.created_at,
       c.id    AS customer_id,
       c.name  AS customer_name,
       c.email AS customer_email
FROM accounts a
JOIN customers c ON a.customer_id = c.id
ORDER BY a.created_at DESC;
```

---

## 22. Admin — All Customers

**Endpoint**: `GET /api/admin/customers`

```sql
SELECT id, name, email, phone, role, created_at
FROM customers
ORDER BY created_at DESC;
```

---

## 23. Audit Logs

Audit logs are written as side-effects of every mutation. They are append-only and never deleted.

### Event Catalogue

| Event | Trigger |
|---|---|
| `DEPOSIT_SUCCESS` | Deposit completes |
| `WITHDRAWAL_SUCCESS` | Withdrawal completes |
| `TRANSFER_SUCCESS` | Transfer completes |
| `TRANSFER_PENDING_APPROVAL` | High-amount transfer queued |
| `TRANSFER_APPROVED` | Admin approves pending transfer |
| `TRANSFER_REJECTED` | Admin rejects pending transfer |
| `TRANSACTION_REVERSED` | Admin reverses a success transfer |
| `TRANSACTION_FLAGGED` | Admin flags a transaction |
| `TRANSACTION_UNFLAGGED` | Admin removes flag |
| `ACCOUNT_BLOCKED` | Admin freezes an account |
| `ACCOUNT_UNBLOCKED` | Admin unfreezes an account |

### Write pattern (all events)

```sql
INSERT INTO audit_logs (transaction_id, event, metadata)
VALUES (:txnId, ':eventName', :jsonMetadata);
```

`transaction_id` is `NULL` for account-level events (block/unblock).

---

## 24. Locking Mechanics Deep Dive

### FOR UPDATE vs FOR SHARE

| Lock | SQL | Use case |
|---|---|---|
| `FOR SHARE` (shared read lock) | `SELECT … FOR SHARE` | Idempotency check — allows concurrent reads of the same key, blocks writers |
| `FOR UPDATE` (exclusive write lock) | `SELECT … FOR UPDATE` | Account balance modification — blocks all other reads and writes of the locked rows |

### Optimistic Locking (version column)

Every account has a `version INT` column incremented on each balance change:

```sql
-- Debit with optimistic lock check
UPDATE accounts
SET balance = balance - :amount, version = version + 1
WHERE id = :fromAccountId AND version = :expectedVersion;
```

If `affectedRows = 0`, another concurrent transaction modified this account between our `SELECT FOR UPDATE` and `UPDATE`. The application rolls back and returns HTTP 409 Conflict, asking the client to retry.

This is a double safety net — `FOR UPDATE` prevents simultaneous modifications, but the version check catches the rare race between connection checkout and actual write.

### Transaction Isolation Level

MySQL default: **REPEATABLE READ**. Within a single transaction, all reads see the same snapshot as of the transaction start — except rows locked with `FOR UPDATE` or `FOR SHARE`, which always read the latest committed version.

### Deadlock Prevention Strategy

```
Always acquire locks in ascending account_id order.

If transferring A → B:
  lockOrder = [min(A.id, B.id), max(A.id, B.id)]
  SELECT ... WHERE id IN (lockOrder[0], lockOrder[1]) ORDER BY id ASC FOR UPDATE
```

This guarantees that any two concurrent threads competing for the same two accounts will always request the locks in the same order, making a circular wait impossible.

---

## 25. Index Usage Summary

| Index | Columns | Used By |
|---|---|---|
| `PRIMARY` on `customers` | `id` | Auth middleware, profile GET |
| `idx_customers_email` | `email` | Login |
| `PRIMARY` on `accounts` | `id` | Every deposit/withdrawal/transfer lock |
| `idx_accounts_customer_id` | `customer_id` | List my accounts, beneficiary joins |
| `idx_accounts_account_number` | `account_number` | Account lookup for transfer |
| `idx_accounts_status` | `status` | Admin dashboard frozen count |
| `PRIMARY` on `transactions` | `id` | Every reversal/approval lock |
| `idx_txn_idempotency_key` | `idempotency_key` | Idempotency check |
| `idx_txn_from_account_id` | `from_account_id, created_at` | History query + ORDER BY |
| `idx_txn_to_account_id` | `to_account_id, created_at` | History query + ORDER BY |
| `idx_txn_status` | `status` | Pending approval count, flagged list |
| `idx_txn_created_at` | `created_at` | Admin all-transactions ORDER BY |
| `idx_audit_transaction_id` | `transaction_id` | Audit lookup per transaction |
| `idx_audit_event` | `event` | Event-type filtering |
| `idx_audit_created_at` | `created_at` | Audit log chronological listing |
| `idx_bene_customer_id` | `customer_id` | List beneficiaries |
| `uq_bene_customer_account` | `customer_id, account_id` | Duplicate beneficiary prevention |

---

*End of QUERIES_DOC.md*
