# Mini Banking System — Comprehensive SQL Query Documentation

> **Schema version**: includes `database/migration_admin.sql` (flagging, OTP, approval columns).
> All queries executed by the Node.js backend via the `mysql2` connection pool.
>
> **Legend for source references**:
> Each query entry includes a `📄 Source` field with the **full file path** and **exact line number(s)**
> where that SQL statement is executed in the codebase.

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

### 1.1 Register — Duplicate email check

**Endpoint**: `POST /api/auth/register`

```sql
SELECT id FROM customers WHERE email = ?
```

> 📄 **Source**: `backend/src/controllers/authController.js` — **Line 19**

| Variable | Source |
|---|---|
| `?` | `req.body.email` |

**Index hit**: `idx_customers_email (email)` — unique index, single-row O(log n) lookup.

---

### 1.2 Register — Insert new customer

```sql
INSERT INTO customers (name, email, phone, password_hash, role)
VALUES (?, ?, ?, ?, ?)
```

> 📄 **Source**: `backend/src/controllers/authController.js` — **Lines 26–29**

**Business logic**: Password is hashed with `bcrypt` (10 rounds) before insert. Duplicate email raises `ER_DUP_ENTRY`.

---

### 1.3 Login — Find customer by email

**Endpoint**: `POST /api/auth/login`

```sql
SELECT id, name, email, password_hash, role
FROM customers
WHERE email = ?
```

> 📄 **Source**: `backend/src/controllers/authController.js` — **Lines 55–58**

| Variable | Source |
|---|---|
| `?` | `req.body.email` |

**Index hit**: `idx_customers_email (email)` — unique index, O(log n) lookup.

**Business logic**: `password_hash` compared via `bcrypt.compare()`. JWT issued on success containing `{ id, name, role }`.

---

### 1.4 Auth middleware — JWT validation on every protected request

> **Note**: The `authenticate` middleware in `backend/src/middleware/auth.js` decodes the JWT in-memory (lines 12–14) — **no DB query** is made. The user payload `{ id, email, role }` is embedded in the token itself and attached to `req.user`.

---

## 2. Customer Profile

### 2.1 Get my profile

**Endpoint**: `GET /api/customers/me`

```sql
SELECT id, name, email, phone, role, created_at
FROM customers
WHERE id = ?
```

> 📄 **Source**: `backend/src/controllers/customerController.js` — **Lines 9–12**

| Variable | Source |
|---|---|
| `?` | `req.user.id` (from JWT) |

**Index hit**: `PRIMARY KEY (id)` — O(1).

---

### 2.2 Update my profile

**Endpoint**: `PUT /api/customers/me`

```sql
UPDATE customers
SET name = ?, phone = ?
WHERE id = ?
```

> 📄 **Source**: `backend/src/controllers/customerController.js` — **Lines 29–32**

| Variable | Source |
|---|---|
| `name` | `req.body.name` |
| `phone` | `req.body.phone` (nullable) |
| `id` | `req.user.id` |

---

## 3. Customer Search

### 3.1 Browse latest customers (no query)

**Endpoint**: `GET /api/customers/search` (no `q` param)

```sql
SELECT id, name, email, phone, role, created_at
FROM customers
ORDER BY created_at DESC
LIMIT 20
```

> 📄 **Source**: `backend/src/controllers/customerController.js` — **Lines 64–66**

---

### 3.2 Search customers by name / email / phone

**Endpoint**: `GET /api/customers/search?q=:query`

```sql
SELECT c.id, c.name, c.email, c.phone, c.role, c.created_at,
       COUNT(a.id) AS account_count
FROM customers c
LEFT JOIN accounts a ON a.customer_id = c.id
WHERE c.name  LIKE ?
   OR c.email LIKE ?
   OR c.phone LIKE ?
GROUP BY c.id
ORDER BY c.name ASC
LIMIT 50
```

> 📄 **Source**: `backend/src/controllers/customerController.js` — **Lines 71–81**

| Variable | Value |
|---|---|
| `?` (×3) | `%` + `req.query.q` + `%` |

**Index hit**: Leading-wildcard LIKE (`%term%`) cannot use `idx_customers_email` — falls back to full table scan. For large datasets, consider a `FULLTEXT INDEX` on `(name, email, phone)`.

**Business logic**: Returns public-safe fields only (no `password_hash`). Account count included so users can see how many accounts a customer has.

---

## 4. Accounts

### 4.1 Ownership check (used before deposit/withdraw/transfer)

```sql
SELECT customer_id FROM accounts WHERE id = ?
```

> 📄 **Source**:
> - `backend/src/controllers/transactionController.js` — **Line 17** (deposit ownership)
> - `backend/src/controllers/transactionController.js` — **Line 40** (withdraw ownership)
> - `backend/src/controllers/transactionController.js` — **Line 66** (OTP request ownership)
> - `backend/src/controllers/transactionController.js` — **Line 94** (OTP verify ownership)
> - `backend/src/controllers/transactionController.js` — **Line 136** (transfer source ownership)
> - `backend/src/controllers/transactionController.js` — **Line 162** (transaction history ownership)

---

### 4.2 Open a new account

**Endpoint**: `POST /api/accounts`

```sql
INSERT INTO accounts (customer_id, account_number, account_type, balance, status)
VALUES (?, ?, ?, 0.00, 'ACTIVE')
```

> 📄 **Source**: `backend/src/controllers/accountController.js` — **Lines 26–30**

---

### 4.3 List my accounts

**Endpoint**: `GET /api/accounts`

```sql
SELECT id, account_number, account_type, balance, status, version, created_at
FROM accounts
WHERE customer_id = ?
ORDER BY created_at DESC
```

> 📄 **Source**: `backend/src/controllers/accountController.js` — **Lines 53–57**

**Index hit**: `idx_accounts_customer_id (customer_id)`.

---

### 4.4 Get single account (with customer join)

**Endpoint**: `GET /api/accounts/:id`

```sql
SELECT a.id, a.account_number, a.account_type, a.balance,
       a.status, a.version, a.created_at,
       c.name AS customer_name, c.email AS customer_email
FROM accounts a
JOIN customers c ON a.customer_id = c.id
WHERE a.id = ?
```

> 📄 **Source**: `backend/src/controllers/accountController.js` — **Lines 69–75**

---

## 5. Account Lookup

### 5.1 Lookup by account number (transfer recipient verification)

**Endpoint**: `GET /api/accounts/lookup?account_number=:num`

```sql
SELECT a.id, a.account_number, a.account_type, a.status,
       c.name AS holder_name
FROM accounts a
JOIN customers c ON a.customer_id = c.id
WHERE a.account_number = ?
```

> 📄 **Source**: `backend/src/controllers/accountController.js` — **Lines 136–143**

**Index hit**: `idx_accounts_account_number (account_number)` — unique index, instant O(log n) lookup.

**Business logic**: Used by the frontend transfer form for live recipient verification (debounced). Returns the account holder's name so the sender can visually confirm the recipient.

---

## 6. Beneficiaries

### 6.1 Validate account exists before adding beneficiary

```sql
SELECT id FROM accounts WHERE id = ?
```

> 📄 **Source**: `backend/src/controllers/beneficiaryController.js` — **Line 15**

---

### 6.2 Add beneficiary

**Endpoint**: `POST /api/beneficiaries`

```sql
INSERT INTO beneficiaries (customer_id, account_id, nickname)
VALUES (?, ?, ?)
```

> 📄 **Source**: `backend/src/controllers/beneficiaryController.js` — **Lines 18–21**

**Constraint**: `uq_bene_customer_account (customer_id, account_id)` prevents duplicates — raises `ER_DUP_ENTRY` on violation.

---

### 6.3 List my beneficiaries

**Endpoint**: `GET /api/beneficiaries`

```sql
SELECT b.id, b.nickname, b.created_at,
       a.id AS account_id, a.account_number, a.account_type,
       c.name AS account_holder_name
FROM beneficiaries b
JOIN accounts a  ON b.account_id  = a.id
JOIN customers c ON a.customer_id = c.id
WHERE b.customer_id = ?
ORDER BY b.created_at DESC
```

> 📄 **Source**: `backend/src/controllers/beneficiaryController.js` — **Lines 40–50**

**Index hit**: `idx_bene_customer_id (customer_id)`.

---

### 6.4 Delete beneficiary

**Endpoint**: `DELETE /api/beneficiaries/:id`

```sql
DELETE FROM beneficiaries
WHERE id = ? AND customer_id = ?
```

> 📄 **Source**: `backend/src/controllers/beneficiaryController.js` — **Lines 62–65**

---

## 7. Atomic Transfer

**Endpoint**: `POST /api/transactions/transfer` (< ₹25,000) or approved high-value.

All queries below run inside a single `BEGIN … COMMIT` block.

### Step 1 — Idempotency check (FOR SHARE)

```sql
SELECT id, status
FROM transactions
WHERE idempotency_key = ?
FOR SHARE
```

> 📄 **Source**: `backend/src/services/transactionService.js` — **Lines 18–21** (`transferService`)

**Lock type**: `FOR SHARE` — allows concurrent reads of this key, blocks any writer trying to insert the same key.

---

### Step 2 — Lock both accounts in ascending ID order

```sql
SELECT id, balance, status, version, account_number
FROM accounts
WHERE id IN (?, ?)
ORDER BY id ASC
FOR UPDATE
```

> 📄 **Source**: `backend/src/services/transactionService.js` — **Lines 29–33** (`transferService`)

**Deadlock prevention**: Accounts are always locked in ascending `id` order (`[fromId, toId].sort()` at line 28), making a circular wait impossible between concurrent threads.

---

### Step 3 — Insert transaction record (PENDING / PENDING_APPROVAL)

```sql
INSERT INTO transactions
  (from_account_id, to_account_id, amount, transaction_type,
   status, idempotency_key, requires_approval)
VALUES (?, ?, ?, 'TRANSFER', ?, ?, ?)
```

> 📄 **Source**: `backend/src/services/transactionService.js` — **Lines 60–65** (`transferService`)

---

### Step 4a — Debit source (optimistic lock check)

```sql
UPDATE accounts
SET balance = balance - ?, version = version + 1
WHERE id = ? AND version = ?
```

> 📄 **Source**: `backend/src/services/transactionService.js` — **Lines 70–74** (`transferService`)

`affectedRows === 0` → concurrent modification detected → `ROLLBACK` + HTTP 409.

---

### Step 4b — Credit destination

```sql
UPDATE accounts
SET balance = balance + ?, version = version + 1
WHERE id = ?
```

> 📄 **Source**: `backend/src/services/transactionService.js` — **Lines 79–82** (`transferService`)

---

### Step 4c — Mark transaction SUCCESS

```sql
UPDATE transactions SET status = 'SUCCESS' WHERE id = ?
```

> 📄 **Source**: `backend/src/services/transactionService.js` — **Line 83** (`transferService`)

---

### Step 4d — Audit log (transfer success)

```sql
INSERT INTO audit_logs (transaction_id, event, metadata)
VALUES (?, 'TRANSFER_SUCCESS', ?)
```

> 📄 **Source**: `backend/src/services/transactionService.js` — **Lines 84–87** (`transferService`)

---

### Step 4e (branch B) — Audit log for high-amount pending

```sql
INSERT INTO audit_logs (transaction_id, event, metadata)
VALUES (?, 'TRANSFER_PENDING_APPROVAL', ?)
```

> 📄 **Source**: `backend/src/services/transactionService.js` — **Lines 90–93** (`transferService`)

---

## 8. Deposit

**Endpoint**: `POST /api/transactions/deposit`

All inside `BEGIN … COMMIT`.

### 8.1 Idempotency check

```sql
SELECT id, status FROM transactions WHERE idempotency_key = ?
```

> 📄 **Source**: `backend/src/services/transactionService.js` — **Line 113** (`depositService`)

---

### 8.2 Lock target account

```sql
SELECT id, status FROM accounts WHERE id = ? FOR UPDATE
```

> 📄 **Source**: `backend/src/services/transactionService.js` — **Line 116** (`depositService`)

---

### 8.3 Insert deposit transaction

```sql
INSERT INTO transactions
  (from_account_id, to_account_id, amount, transaction_type, status, idempotency_key)
VALUES (NULL, ?, ?, 'DEPOSIT', 'PENDING', ?)
```

> 📄 **Source**: `backend/src/services/transactionService.js` — **Lines 120–123** (`depositService`)

---

### 8.4 Credit account balance

```sql
UPDATE accounts SET balance = balance + ? WHERE id = ?
```

> 📄 **Source**: `backend/src/services/transactionService.js` — **Line 125** (`depositService`)

---

### 8.5 Mark deposit SUCCESS + audit

```sql
UPDATE transactions SET status = 'SUCCESS' WHERE id = ?
INSERT INTO audit_logs (transaction_id, event, metadata) VALUES (?, 'DEPOSIT_SUCCESS', ?)
```

> 📄 **Source**: `backend/src/services/transactionService.js` — **Lines 126–128** (`depositService`)

---

## 9. Withdrawal

**Endpoint**: `POST /api/transactions/withdraw`

All inside `BEGIN … COMMIT`.

### 9.1 Idempotency check

```sql
SELECT id, status FROM transactions WHERE idempotency_key = ?
```

> 📄 **Source**: `backend/src/services/transactionService.js` — **Line 139** (`withdrawService`)

---

### 9.2 Lock source account (with balance)

```sql
SELECT id, balance, status FROM accounts WHERE id = ? FOR UPDATE
```

> 📄 **Source**: `backend/src/services/transactionService.js` — **Line 142** (`withdrawService`)

---

### 9.3 Insert withdrawal transaction

```sql
INSERT INTO transactions
  (from_account_id, to_account_id, amount, transaction_type, status, idempotency_key)
VALUES (?, NULL, ?, 'WITHDRAWAL', 'PENDING', ?)
```

> 📄 **Source**: `backend/src/services/transactionService.js` — **Lines 147–150** (`withdrawService`)

---

### 9.4 Debit balance + mark SUCCESS + audit

```sql
UPDATE accounts SET balance = balance - ? WHERE id = ?
UPDATE transactions SET status = 'SUCCESS' WHERE id = ?
INSERT INTO audit_logs (transaction_id, event, metadata) VALUES (?, 'WITHDRAWAL_SUCCESS', ?)
```

> 📄 **Source**: `backend/src/services/transactionService.js` — **Lines 152–155** (`withdrawService`)

---

## 10. OTP Verification

### 10.1 Generate OTP — invalidate previous

```sql
UPDATE otp_verifications
SET used = TRUE
WHERE customer_id = ? AND used = FALSE
```

> 📄 **Source**: `backend/src/services/otpService.js` — **Lines 14–16** (`generateOTP`)

---

### 10.2 Generate OTP — insert new record

```sql
INSERT INTO otp_verifications (customer_id, otp_code, context, expires_at)
VALUES (?, ?, ?, ?)
```

> 📄 **Source**: `backend/src/services/otpService.js` — **Lines 19–23** (`generateOTP`)

| Variable | Value |
|---|---|
| `otp_code` | 6-digit random (100000–999999) |
| `context` | JSON `{from_account_id, to_account_id, amount, idempotency_key}` |
| `expires_at` | `NOW() + 5 minutes` |

---

### 10.3 Verify OTP — fetch latest unused

```sql
SELECT id, otp_code, context, expires_at, used
FROM otp_verifications
WHERE customer_id = ? AND used = FALSE
ORDER BY created_at DESC
LIMIT 1
```

> 📄 **Source**: `backend/src/services/otpService.js` — **Lines 33–38** (`verifyOTP`)

---

### 10.4 Verify OTP — mark as used

```sql
UPDATE otp_verifications SET used = TRUE WHERE id = ?
```

> 📄 **Source**: `backend/src/services/otpService.js` — **Line 56** (`verifyOTP`)

---

## 11. Transaction History

**Endpoint**: `GET /api/accounts/:id/transactions`

### 11.1 Count query (for pagination)

```sql
SELECT COUNT(*) AS total
FROM transactions t
WHERE (t.from_account_id = ? OR t.to_account_id = ?)
  [AND t.transaction_type = ?]
  [AND t.status = ?]
  [AND t.created_at >= ?]
  [AND t.created_at <= ?]
```

> 📄 **Source**: `backend/src/controllers/transactionController.js` — **Line 175** (`getTransactionHistory`)

---

### 11.2 Paginated data query

```sql
SELECT t.id, t.from_account_id, t.to_account_id, t.amount,
       t.transaction_type, t.status, t.flagged, t.flag_reason,
       t.requires_approval, t.idempotency_key, t.created_at,
       fa.account_number AS from_account_number,
       ta.account_number AS to_account_number
FROM transactions t
LEFT JOIN accounts fa ON t.from_account_id = fa.id
LEFT JOIN accounts ta ON t.to_account_id   = ta.id
WHERE (t.from_account_id = ? OR t.to_account_id = ?)
  [AND filters...]
ORDER BY t.created_at DESC
LIMIT ? OFFSET ?
```

> 📄 **Source**: `backend/src/controllers/transactionController.js` — **Lines 177–190** (`getTransactionHistory`)

| Variable | Source |
|---|---|
| `accountId` | `req.params.id` |
| `size` | `req.query.size` (default 20) |
| `offset` | `page * size` |
| `type` | Optional `req.query.type` |
| `status` | Optional `req.query.status` |

**Index hits**:
- `idx_txn_from_account_id` — covers `from_account_id` filter
- `idx_txn_to_account_id` — covers `to_account_id` filter
- `idx_txn_created_at` — covers `ORDER BY`

**Customer flag visibility**: The `flagged` and `flag_reason` fields are returned here. The frontend (`frontend/src/pages/Transactions.jsx`) reads these on every load and displays a red dismissible banner when any row has `flagged = 1`.

---

## 12. Admin Dashboard

**Endpoint**: `GET /api/admin/dashboard`

Eight queries executed in sequence (inside a single route handler):

```sql
-- 1
SELECT COUNT(*) AS count FROM customers
-- 2
SELECT COUNT(*) AS count FROM accounts
-- 3
SELECT COUNT(*) AS count FROM transactions
-- 4
SELECT SUM(balance) AS total FROM accounts WHERE status = "ACTIVE"
-- 5
SELECT COUNT(*) AS count FROM audit_logs
-- 6
SELECT COUNT(*) AS count FROM transactions WHERE status = "PENDING_APPROVAL"
-- 7
SELECT COUNT(*) AS count FROM transactions WHERE flagged = TRUE
-- 8
SELECT COUNT(*) AS count FROM accounts WHERE status = "FROZEN"
```

> 📄 **Source**: `backend/src/routes/adminRoutes.js` — **Lines 19–26** (inline route handler in `router.get('/dashboard', ...)`)

**Index hits**:
- `idx_txn_status` for queries 6 & 7
- `idx_accounts_status` for queries 4 & 8

---

## 13. Admin — All Transactions

**Endpoint**: `GET /api/admin/transactions`

### 13.1 Data query

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
LIMIT ? OFFSET ?
```

> 📄 **Source**: `backend/src/controllers/transactionController.js` — **Lines 202–212** (`getAllTransactions`)

### 13.2 Count query

```sql
SELECT COUNT(*) AS total FROM transactions
```

> 📄 **Source**: `backend/src/controllers/transactionController.js` — **Line 213** (`getAllTransactions`)

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
ORDER BY t.created_at ASC
```

> 📄 **Source**: `backend/src/controllers/adminController.js` — **Lines 91–104** (`getPendingApprovals`)

**Business logic**: Sorted ASC (oldest first) for FIFO admin review — prevents starvation of early submissions.

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
ORDER BY t.created_at DESC
```

> 📄 **Source**: `backend/src/controllers/adminController.js` — **Lines 113–126** (`getFlaggedTransactions`)

---

## 16. Admin — Flag / Unflag

### 16.1 Flag a transaction

**Endpoint**: `PUT /api/admin/transactions/:id/flag`

```sql
UPDATE transactions SET flagged = TRUE, flag_reason = ? WHERE id = ?
```

> 📄 **Source**: `backend/src/controllers/adminController.js` — **Lines 11–14** (`flagTransaction`)

```sql
INSERT INTO audit_logs (transaction_id, event, metadata)
VALUES (?, 'TRANSACTION_FLAGGED', ?)
```

> 📄 **Source**: `backend/src/controllers/adminController.js` — **Lines 17–20** (`flagTransaction`)

**Customer visibility**: The flagged status is returned by the transaction history endpoint (section 11). The frontend `Transactions.jsx` (lines 225–229) filters `rows.filter(t => t.flagged)` and surfaces a red alert banner at the top of the page.

---

### 16.2 Unflag a transaction

**Endpoint**: `PUT /api/admin/transactions/:id/unflag`

```sql
UPDATE transactions SET flagged = FALSE, flag_reason = NULL WHERE id = ?
```

> 📄 **Source**: `backend/src/controllers/adminController.js` — **Lines 27–30** (`unflagTransaction`)

```sql
INSERT INTO audit_logs (transaction_id, event, metadata)
VALUES (?, 'TRANSACTION_UNFLAGGED', ?)
```

> 📄 **Source**: `backend/src/controllers/adminController.js` — **Lines 33–36** (`unflagTransaction`)

---

## 17. Admin — Reverse Transaction

**Endpoint**: `PUT /api/admin/transactions/:id/reverse`

All inside `BEGIN … COMMIT` in `reverseTransactionService`.

### 17.1 Lock original transaction

```sql
SELECT * FROM transactions WHERE id = ? FOR UPDATE
```

> 📄 **Source**: `backend/src/services/transactionService.js` — **Lines 171–173** (`reverseTransactionService`)

---

### 17.2 Lock both accounts (ascending ID order)

```sql
SELECT id, balance, status, version, account_number
FROM accounts
WHERE id IN (?, ?)
ORDER BY id ASC
FOR UPDATE
```

> 📄 **Source**: `backend/src/services/transactionService.js` — **Lines 184–187** (`reverseTransactionService`)

---

### 17.3 Mark original as REVERSED

```sql
UPDATE transactions SET status = 'REVERSED' WHERE id = ?
```

> 📄 **Source**: `backend/src/services/transactionService.js` — **Line 197** (`reverseTransactionService`)

---

### 17.4 Create reversal transaction record

```sql
INSERT INTO transactions
  (from_account_id, to_account_id, amount, transaction_type, status, idempotency_key, requires_approval)
VALUES (?, ?, ?, 'TRANSFER', 'SUCCESS', ?, 0)
```

> 📄 **Source**: `backend/src/services/transactionService.js` — **Lines 201–205** (`reverseTransactionService`)

---

### 17.5 Move money back

```sql
UPDATE accounts SET balance = balance - ?, version = version + 1 WHERE id = ?
UPDATE accounts SET balance = balance + ?, version = version + 1 WHERE id = ?
```

> 📄 **Source**: `backend/src/services/transactionService.js` — **Lines 208–209** (`reverseTransactionService`)

---

### 17.6 Audit log

```sql
INSERT INTO audit_logs (transaction_id, event, metadata)
VALUES (?, 'TRANSACTION_REVERSED', ?)
```

> 📄 **Source**: `backend/src/services/transactionService.js` — **Lines 212–215** (`reverseTransactionService`)

**Business logic**: Creates a new transaction record (the reversal) — never deletes the original. Original shows `REVERSED`, new record shows `SUCCESS` flowing in the opposite direction.

---

## 18. Admin — Approve Transaction

**Endpoint**: `PUT /api/admin/transactions/:id/approve`

All inside `BEGIN … COMMIT` in `approveTransactionService`.

### 18.1 Lock transaction

```sql
SELECT * FROM transactions WHERE id = ? FOR UPDATE
```

> 📄 **Source**: `backend/src/services/transactionService.js` — **Line 230** (`approveTransactionService`)

---

### 18.2 Lock accounts (ascending ID)

```sql
SELECT id, balance, status, version
FROM accounts
WHERE id IN (?, ?)
ORDER BY id ASC
FOR UPDATE
```

> 📄 **Source**: `backend/src/services/transactionService.js` — **Lines 239–242** (`approveTransactionService`)

---

### 18.3 Debit source / Credit destination

```sql
UPDATE accounts SET balance = balance - ?, version = version + 1 WHERE id = ?
UPDATE accounts SET balance = balance + ?, version = version + 1 WHERE id = ?
```

> 📄 **Source**: `backend/src/services/transactionService.js` — **Lines 253–254** (`approveTransactionService`)

---

### 18.4 Mark approved

```sql
UPDATE transactions
SET status = 'SUCCESS', approved_by = ?, approved_at = NOW()
WHERE id = ?
```

> 📄 **Source**: `backend/src/services/transactionService.js` — **Lines 257–260** (`approveTransactionService`)

---

### 18.5 Audit log

```sql
INSERT INTO audit_logs (transaction_id, event, metadata)
VALUES (?, 'TRANSFER_APPROVED', ?)
```

> 📄 **Source**: `backend/src/services/transactionService.js` — **Lines 262–265** (`approveTransactionService`)

**Note**: Balance re-validated at approval time (line 249). If the customer spent their balance before admin approval, it correctly fails with "Insufficient balance at time of approval."

---

## 19. Admin — Reject Transaction

**Endpoint**: `PUT /api/admin/transactions/:id/reject`

### 19.1 Validate status

```sql
SELECT status FROM transactions WHERE id = ?
```

> 📄 **Source**: `backend/src/controllers/adminController.js` — **Lines 68–70** (`rejectTransaction`)

---

### 19.2 Mark as FAILED

```sql
UPDATE transactions
SET status = 'FAILED', flag_reason = ?
WHERE id = ?
```

> 📄 **Source**: `backend/src/controllers/adminController.js` — **Lines 75–78** (`rejectTransaction`)

---

### 19.3 Audit log

```sql
INSERT INTO audit_logs (transaction_id, event, metadata)
VALUES (?, 'TRANSFER_REJECTED', ?)
```

> 📄 **Source**: `backend/src/controllers/adminController.js` — **Lines 79–82** (`rejectTransaction`)

**Note**: No funds were held during `PENDING_APPROVAL`, so no balance rollback is needed on rejection.

---

## 20. Admin — Block / Unblock Account

### 20.1 Block (FREEZE)

**Endpoint**: `PUT /api/admin/accounts/:id/block`

```sql
UPDATE accounts SET status = 'FROZEN'
WHERE id = ? AND status != 'CLOSED'
```

> 📄 **Source**: `backend/src/controllers/adminController.js` — **Lines 136–139** (`blockAccount`)

```sql
INSERT INTO audit_logs (transaction_id, event, metadata)
VALUES (NULL, 'ACCOUNT_BLOCKED', ?)
```

> 📄 **Source**: `backend/src/controllers/adminController.js` — **Lines 142–145** (`blockAccount`)

**Guard**: `AND status != 'CLOSED'` — `affectedRows = 0` means account doesn't exist or is already closed.

---

### 20.2 Unblock (ACTIVE)

**Endpoint**: `PUT /api/admin/accounts/:id/unblock`

```sql
UPDATE accounts SET status = 'ACTIVE'
WHERE id = ? AND status = 'FROZEN'
```

> 📄 **Source**: `backend/src/controllers/adminController.js` — **Lines 152–155** (`unblockAccount`)

```sql
INSERT INTO audit_logs (transaction_id, event, metadata)
VALUES (NULL, 'ACCOUNT_UNBLOCKED', ?)
```

> 📄 **Source**: `backend/src/controllers/adminController.js` — **Lines 158–161** (`unblockAccount`)

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
ORDER BY a.created_at DESC
```

> 📄 **Source**: `backend/src/controllers/adminController.js` — **Lines 169–175** (`getAllAccounts`)

---

## 22. Admin — All Customers

**Endpoint**: `GET /api/admin/customers`

```sql
SELECT id, name, email, phone, role, created_at
FROM customers
ORDER BY created_at DESC
```

> 📄 **Source**: `backend/src/controllers/customerController.js` — **Lines 44–46** (`getAllCustomers`)

---

## 23. Audit Logs

All audit log writes use the same INSERT pattern. They are append-only, never deleted.

```sql
INSERT INTO audit_logs (transaction_id, event, metadata)
VALUES (?, '<EVENT_NAME>', ?)
```

### Event → Source File Cross-Reference

| Event | Source File | Line(s) |
|---|---|---|
| `DEPOSIT_SUCCESS` | `backend/src/services/transactionService.js` | 127–128 |
| `WITHDRAWAL_SUCCESS` | `backend/src/services/transactionService.js` | 154–155 |
| `TRANSFER_SUCCESS` | `backend/src/services/transactionService.js` | 84–87 |
| `TRANSFER_PENDING_APPROVAL` | `backend/src/services/transactionService.js` | 90–93 |
| `TRANSFER_APPROVED` | `backend/src/services/transactionService.js` | 262–265 |
| `TRANSFER_REJECTED` | `backend/src/controllers/adminController.js` | 79–82 |
| `TRANSACTION_REVERSED` | `backend/src/services/transactionService.js` | 212–215 |
| `TRANSACTION_FLAGGED` | `backend/src/controllers/adminController.js` | 17–20 |
| `TRANSACTION_UNFLAGGED` | `backend/src/controllers/adminController.js` | 33–36 |
| `ACCOUNT_BLOCKED` | `backend/src/controllers/adminController.js` | 142–145 |
| `ACCOUNT_UNBLOCKED` | `backend/src/controllers/adminController.js` | 158–161 |
| `ACCOUNT_STATUS_CHANGED` | `backend/src/controllers/accountController.js` | 113–117 |

---

## 24. Locking Mechanics Deep Dive

### FOR UPDATE vs FOR SHARE

| Lock | Used At | Purpose |
|---|---|---|
| `FOR SHARE` | `transactionService.js:18` (idempotency check) | Allows concurrent reads of the same key, blocks writers |
| `FOR UPDATE` | `transactionService.js:29` (account lock, transfer) | Exclusive — blocks all other reads and writes of locked rows |
| `FOR UPDATE` | `transactionService.js:116` (deposit account lock) | Exclusive account lock before crediting |
| `FOR UPDATE` | `transactionService.js:142` (withdraw account lock) | Exclusive account lock before debiting |
| `FOR UPDATE` | `transactionService.js:171` (reverse: original txn) | Prevents concurrent reversal of same transaction |
| `FOR UPDATE` | `transactionService.js:184` (reverse: accounts) | Exclusive lock for balance movement |
| `FOR UPDATE` | `transactionService.js:230` (approve: transaction) | Prevents concurrent approval |
| `FOR UPDATE` | `transactionService.js:239` (approve: accounts) | Exclusive lock for balance movement |

### Optimistic Locking (version column)

```sql
-- transactionService.js lines 70–74
UPDATE accounts
SET balance = balance - ?, version = version + 1
WHERE id = ? AND version = ?
-- affectedRows = 0 → concurrent modification → ROLLBACK + HTTP 409
```

### Deadlock Prevention Strategy

```
-- transactionService.js line 28 (transfer) and line 183 (reversal)
const lockOrder = [fromAccountId, toAccountId].sort((a, b) => a - b);
```

Always acquire row locks in ascending `account_id` order. Two concurrent threads competing for the same two accounts always request locks in the same order — making a circular wait structurally impossible.

```
Thread A: acc_id=3 → acc_id=7   Thread B: acc_id=7 → acc_id=3
WITHOUT ordering → DEADLOCK      WITH ascending order → B waits for 3, no deadlock ✓
```

---

## 25. Index Usage Summary

| Index Name | Table | Columns | Used By (file:line) |
|---|---|---|---|
| `PRIMARY` | `customers` | `id` | `customerController.js:9`, `auth middleware` |
| `idx_customers_email` | `customers` | `email` | `authController.js:19`, `authController.js:55` |
| `PRIMARY` | `accounts` | `id` | Every `FOR UPDATE` lock in `transactionService.js` |
| `idx_accounts_customer_id` | `accounts` | `customer_id` | `accountController.js:53`, `beneficiaryController.js:40` |
| `idx_accounts_account_number` | `accounts` | `account_number` | `accountController.js:136` |
| `idx_accounts_status` | `accounts` | `status` | `adminRoutes.js:22`, `adminRoutes.js:26` |
| `PRIMARY` | `transactions` | `id` | `transactionService.js:171`, `transactionService.js:230` |
| `idx_txn_idempotency_key` | `transactions` | `idempotency_key` | `transactionService.js:18`, `transactionService.js:113`, `transactionService.js:139` |
| `idx_txn_from_account_id` | `transactions` | `from_account_id, created_at` | `transactionController.js:175,177` |
| `idx_txn_to_account_id` | `transactions` | `to_account_id, created_at` | `transactionController.js:175,177` |
| `idx_txn_status` | `transactions` | `status` | `adminRoutes.js:24`, `adminController.js:91` |
| `idx_txn_created_at` | `transactions` | `created_at` | `transactionController.js:202`, `adminController.js:113` |
| `idx_audit_transaction_id` | `audit_logs` | `transaction_id` | All audit INSERTs |
| `idx_audit_event` | `audit_logs` | `event` | Event filtering |
| `idx_audit_created_at` | `audit_logs` | `created_at` | Chronological listing |
| `idx_bene_customer_id` | `beneficiaries` | `customer_id` | `beneficiaryController.js:40` |
| `uq_bene_customer_account` | `beneficiaries` | `customer_id, account_id` | `beneficiaryController.js:18` (duplicate prevention) |

---

*End of QUERIES_DOC.md*
