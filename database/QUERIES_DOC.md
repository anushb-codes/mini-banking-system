# Mini Banking System — Comprehensive SQL Query Documentation

> **Schema version**: includes `database/migration_admin.sql` (flagging, OTP, approval columns).
> All queries executed by the Node.js backend via the `mysql2` connection pool.
>
> **Parameter notation**: All `?` placeholders have been replaced with `:namedParam`
> matching the actual variable passed in the corresponding controller or service.
>
> **Source references**: Each query cites the full relative file path and exact line number.

---

## Table of Contents

1. [Authentication](#1-authentication)
2. [Customer Profile](#2-customer-profile)
3. [Customer Search](#3-customer-search)
4. [Accounts](#4-accounts)
5. [Account Lookup](#5-account-lookup)
6. [Beneficiaries](#6-beneficiaries)
7. [Atomic Transfer — Full BEGIN…COMMIT Flow](#7-atomic-transfer)
8. [Deposit](#8-deposit)
9. [Withdrawal](#9-withdrawal)
10. [OTP Verification](#10-otp-verification)
11. [Transaction History](#11-transaction-history)
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
23. [Audit Log Event Catalogue](#23-audit-log-event-catalogue)
24. [Locking Mechanics Deep Dive](#24-locking-mechanics-deep-dive)
25. [Index Usage Summary](#25-index-usage-summary)

---

## 1. Authentication

### 1.1 Register — Duplicate email check

**Endpoint**: `POST /api/auth/register`

```sql
SELECT id
FROM customers
WHERE email = :email
```

> 📄 `backend/src/controllers/authController.js` — **Line 19**

| Parameter | Value |
|---|---|
| `:email` | `req.body.email` |

**Index hit**: `idx_customers_email (email)` — unique index, O(log n).

---

### 1.2 Register — Insert new customer

```sql
INSERT INTO customers (name, email, phone, password_hash, role)
VALUES (:name, :email, :phone, :password_hash, 'CUSTOMER')
```

> 📄 `backend/src/controllers/authController.js` — **Lines 26–29**

| Parameter | Value |
|---|---|
| `:name` | `req.body.name` |
| `:email` | `req.body.email` |
| `:phone` | `req.body.phone \|\| null` |
| `:password_hash` | `await bcrypt.hash(password, 10)` |

---

### 1.3 Login — Find customer by email

**Endpoint**: `POST /api/auth/login`

```sql
SELECT id, name, email, password_hash, role
FROM customers
WHERE email = :email
```

> 📄 `backend/src/controllers/authController.js` — **Lines 55–58**

| Parameter | Value |
|---|---|
| `:email` | `req.body.email` |

**Business logic**: `password_hash` compared via `bcrypt.compare()` in Node.js. JWT issued on success containing `{ id, name, role }`.

---

### 1.4 Auth Middleware

> 📄 `backend/src/middleware/auth.js` — **Lines 12–14**

The `authenticate` middleware decodes the JWT entirely in-memory — **no database query is made**. The decoded payload `{ id, email, role }` is attached to `req.user` and used by all downstream handlers.

---

## 2. Customer Profile

### 2.1 Get my profile

**Endpoint**: `GET /api/customers/me`

```sql
SELECT id, name, email, phone, role, created_at
FROM customers
WHERE id = :req.user.id
```

> 📄 `backend/src/controllers/customerController.js` — **Lines 9–12**

| Parameter | Value |
|---|---|
| `:req.user.id` | Decoded from JWT by auth middleware |

**Index hit**: `PRIMARY KEY (id)` — O(1).

---

### 2.2 Update my profile

**Endpoint**: `PUT /api/customers/me`

```sql
UPDATE customers
SET name  = :name,
    phone = :phone
WHERE id = :req.user.id
```

> 📄 `backend/src/controllers/customerController.js` — **Lines 29–32**

| Parameter | Value |
|---|---|
| `:name` | `req.body.name` |
| `:phone` | `req.body.phone \|\| null` |
| `:req.user.id` | Decoded from JWT |

---

## 3. Customer Search

### 3.1 Browse latest customers (no query param)

**Endpoint**: `GET /api/customers/search`

```sql
SELECT id, name, email, phone, role, created_at
FROM customers
ORDER BY created_at DESC
LIMIT 20
```

> 📄 `backend/src/controllers/customerController.js` — **Lines 64–66**

Triggered when `req.query.q` is empty or absent.

---

### 3.2 Search by name / email / phone

**Endpoint**: `GET /api/customers/search?q=:searchTerm`

```sql
SELECT c.id, c.name, c.email, c.phone, c.role, c.created_at,
       COUNT(a.id) AS account_count
FROM customers c
LEFT JOIN accounts a ON a.customer_id = c.id
WHERE c.name  LIKE :pattern
   OR c.email LIKE :pattern
   OR c.phone LIKE :pattern
GROUP BY c.id
ORDER BY c.name ASC
LIMIT 50
```

> 📄 `backend/src/controllers/customerController.js` — **Lines 71–81**

| Parameter | Value |
|---|---|
| `:pattern` | `'%' + req.query.q.trim() + '%'` |

**Index**: Leading-wildcard `LIKE` (`%term%`) skips index — full table scan. For large datasets, a `FULLTEXT INDEX` on `(name, email, phone)` is recommended.

---

## 4. Accounts

### 4.1 Ownership check (runs before every deposit / withdraw / transfer)

```sql
SELECT customer_id
FROM accounts
WHERE id = :account_id
```

> 📄 `backend/src/controllers/transactionController.js`
> - **Line 17** — before deposit
> - **Line 40** — before withdraw
> - **Line 66** — before OTP request
> - **Line 94** — before OTP verify
> - **Line 136** — before transfer (source account)
> - **Line 162** — before transaction history

| Parameter | Value |
|---|---|
| `:account_id` | `req.body.account_id` or `req.params.id` |

---

### 4.2 Open a new account

**Endpoint**: `POST /api/accounts`

```sql
INSERT INTO accounts (customer_id, account_number, account_type, balance, status)
VALUES (:req.user.id, :account_number, :account_type, 0.00, 'ACTIVE')
```

> 📄 `backend/src/controllers/accountController.js` — **Lines 26–30**

| Parameter | Value |
|---|---|
| `:req.user.id` | Authenticated customer's ID from JWT |
| `:account_number` | `'ACC' + random 10-digit number` (generated at line 11) |
| `:account_type` | `req.body.account_type \|\| 'SAVINGS'` |

---

### 4.3 List my accounts

**Endpoint**: `GET /api/accounts`

```sql
SELECT id, account_number, account_type, balance, status, version, created_at
FROM accounts
WHERE customer_id = :req.user.id
ORDER BY created_at DESC
```

> 📄 `backend/src/controllers/accountController.js` — **Lines 53–57**

**Index hit**: `idx_accounts_customer_id (customer_id)`.

---

### 4.4 Get single account (with customer join)

**Endpoint**: `GET /api/accounts/:id`

```sql
SELECT a.id, a.account_number, a.account_type, a.balance,
       a.status, a.version, a.created_at,
       c.name  AS customer_name,
       c.email AS customer_email
FROM accounts a
JOIN customers c ON a.customer_id = c.id
WHERE a.id = :req.params.id
```

> 📄 `backend/src/controllers/accountController.js` — **Lines 69–75**

---

## 5. Account Lookup

### 5.1 Lookup by account number (transfer recipient verification)

**Endpoint**: `GET /api/accounts/lookup?account_number=:accountNumber`

```sql
SELECT a.id, a.account_number, a.account_type, a.status,
       c.name AS holder_name
FROM accounts a
JOIN customers c ON a.customer_id = c.id
WHERE a.account_number = :account_number
```

> 📄 `backend/src/controllers/accountController.js` — **Lines 136–143**

| Parameter | Value |
|---|---|
| `:account_number` | `req.query.account_number.trim()` |

**Index hit**: `idx_accounts_account_number (account_number)` — unique index, instant O(log n) lookup.

**Business logic**: Triggered by the frontend's live recipient verification input (debounced 500 ms). Returns holder name so the sender can visually confirm the recipient before submitting.

---

## 6. Beneficiaries

### 6.1 Validate account exists before adding

```sql
SELECT id FROM accounts WHERE id = :account_id
```

> 📄 `backend/src/controllers/beneficiaryController.js` — **Line 15**

---

### 6.2 Add beneficiary

**Endpoint**: `POST /api/beneficiaries`

```sql
INSERT INTO beneficiaries (customer_id, account_id, nickname)
VALUES (:req.user.id, :account_id, :nickname)
```

> 📄 `backend/src/controllers/beneficiaryController.js` — **Lines 18–21**

| Parameter | Value |
|---|---|
| `:req.user.id` | Authenticated customer from JWT |
| `:account_id` | `req.body.account_id` |
| `:nickname` | `req.body.nickname \|\| null` |

**Constraint**: `uq_bene_customer_account (customer_id, account_id)` — duplicate raises `ER_DUP_ENTRY` → HTTP 409.

---

### 6.3 List my beneficiaries

**Endpoint**: `GET /api/beneficiaries`

```sql
SELECT b.id, b.nickname, b.created_at,
       a.id AS account_id, a.account_number, a.account_type,
       c.name AS account_holder_name
FROM beneficiaries b
JOIN accounts  a ON b.account_id  = a.id
JOIN customers c ON a.customer_id = c.id
WHERE b.customer_id = :req.user.id
ORDER BY b.created_at DESC
```

> 📄 `backend/src/controllers/beneficiaryController.js` — **Lines 40–50**

**Index hit**: `idx_bene_customer_id (customer_id)`.

---

### 6.4 Delete beneficiary

**Endpoint**: `DELETE /api/beneficiaries/:id`

```sql
DELETE FROM beneficiaries
WHERE id          = :req.params.id
  AND customer_id = :req.user.id
```

> 📄 `backend/src/controllers/beneficiaryController.js` — **Lines 62–65**

---

## 7. Atomic Transfer

**Endpoint**: `POST /api/transactions/transfer` (< ₹25,000) — or approved via admin for high-value.

All queries below execute inside a single `BEGIN … COMMIT` block managed in `transferService`.

---

### Step 1 — Idempotency check (FOR SHARE)

```sql
SELECT id, status
FROM transactions
WHERE idempotency_key = :idempotencyKey
FOR SHARE
```

> 📄 `backend/src/services/transactionService.js` — **Lines 18–21**

| Parameter | Value |
|---|---|
| `:idempotencyKey` | `req.body.idempotency_key \|\| uuidv4()` (passed into `transferService`) |

**Lock**: `FOR SHARE` — allows concurrent reads of the same key, blocks any concurrent INSERT of the same key. If a row is found, the service rolls back and returns the cached result (idempotent replay).

---

### Step 2 — Lock both accounts in ascending ID order

```sql
SELECT id, balance, status, version, account_number
FROM accounts
WHERE id IN (:lowerAccountId, :higherAccountId)
ORDER BY id ASC
FOR UPDATE
```

> 📄 `backend/src/services/transactionService.js` — **Lines 29–33**

| Parameter | Value |
|---|---|
| `:lowerAccountId` | `Math.min(fromAccountId, toAccountId)` |
| `:higherAccountId` | `Math.max(fromAccountId, toAccountId)` |

**Deadlock prevention**: Sort computed at line 28 — `[fromAccountId, toAccountId].sort((a,b)=>a-b)`. Two concurrent threads always acquire locks in the same order, making circular waits structurally impossible.

---

### Step 3 — Insert transaction record

```sql
INSERT INTO transactions
  (from_account_id, to_account_id, amount, transaction_type,
   status, idempotency_key, requires_approval)
VALUES
  (:fromAccountId, :toAccountId, :amount, 'TRANSFER',
   :txnStatus, :idempotencyKey, :requiresApproval)
```

> 📄 `backend/src/services/transactionService.js` — **Lines 60–65**

| Parameter | Value |
|---|---|
| `:txnStatus` | `'PENDING_APPROVAL'` if high-value, else `'PENDING'` |
| `:requiresApproval` | `1` or `0` |

---

### Step 4a — Debit source (optimistic lock)

```sql
UPDATE accounts
SET balance = balance - :amount,
    version = version + 1
WHERE id      = :fromAccountId
  AND version = :fromAcc.version
```

> 📄 `backend/src/services/transactionService.js` — **Lines 70–74**

`affectedRows === 0` → another thread modified the account between SELECT and UPDATE → `ROLLBACK` + HTTP 409 Conflict.

---

### Step 4b — Credit destination

```sql
UPDATE accounts
SET balance = balance + :amount,
    version = version + 1
WHERE id = :toAccountId
```

> 📄 `backend/src/services/transactionService.js` — **Lines 79–82**

---

### Step 4c — Mark transaction SUCCESS

```sql
UPDATE transactions
SET status = 'SUCCESS'
WHERE id = :transactionId
```

> 📄 `backend/src/services/transactionService.js` — **Line 83**

---

### Step 4d — Audit log (immediate transfer)

```sql
INSERT INTO audit_logs (transaction_id, event, metadata)
VALUES (:transactionId, 'TRANSFER_SUCCESS', :metadataJson)
```

> 📄 `backend/src/services/transactionService.js` — **Lines 84–87**

| Parameter | Value |
|---|---|
| `:metadataJson` | `JSON.stringify({ from: fromAcc.account_number, to: toAcc.account_number, amount, initiated_by: userId })` |

---

### Step 4e — Audit log (high-amount pending approval)

```sql
INSERT INTO audit_logs (transaction_id, event, metadata)
VALUES (:transactionId, 'TRANSFER_PENDING_APPROVAL', :metadataJson)
```

> 📄 `backend/src/services/transactionService.js` — **Lines 90–93**

---

## 8. Deposit

**Endpoint**: `POST /api/transactions/deposit` — all inside `BEGIN … COMMIT` in `depositService`.

### 8.1 Idempotency check

```sql
SELECT id, status
FROM transactions
WHERE idempotency_key = :idempotencyKey
```

> 📄 `backend/src/services/transactionService.js` — **Line 113**

---

### 8.2 Lock target account

```sql
SELECT id, status
FROM accounts
WHERE id = :toAccountId
FOR UPDATE
```

> 📄 `backend/src/services/transactionService.js` — **Line 116**

---

### 8.3 Insert deposit transaction

```sql
INSERT INTO transactions
  (from_account_id, to_account_id, amount, transaction_type, status, idempotency_key)
VALUES
  (NULL, :toAccountId, :amount, 'DEPOSIT', 'PENDING', :idempotencyKey)
```

> 📄 `backend/src/services/transactionService.js` — **Lines 120–123**

---

### 8.4 Credit account balance

```sql
UPDATE accounts
SET balance = balance + :amount
WHERE id = :toAccountId
```

> 📄 `backend/src/services/transactionService.js` — **Line 125**

---

### 8.5 Mark SUCCESS + audit

```sql
UPDATE transactions SET status = 'SUCCESS' WHERE id = :transactionId

INSERT INTO audit_logs (transaction_id, event, metadata)
VALUES (:transactionId, 'DEPOSIT_SUCCESS', :metadataJson)
```

> 📄 `backend/src/services/transactionService.js` — **Lines 126–128**

---

## 9. Withdrawal

**Endpoint**: `POST /api/transactions/withdraw` — all inside `BEGIN … COMMIT` in `withdrawService`.

### 9.1 Idempotency check

```sql
SELECT id, status
FROM transactions
WHERE idempotency_key = :idempotencyKey
```

> 📄 `backend/src/services/transactionService.js` — **Line 139**

---

### 9.2 Lock source account

```sql
SELECT id, balance, status
FROM accounts
WHERE id = :fromAccountId
FOR UPDATE
```

> 📄 `backend/src/services/transactionService.js` — **Line 142**

---

### 9.3 Insert withdrawal transaction

```sql
INSERT INTO transactions
  (from_account_id, to_account_id, amount, transaction_type, status, idempotency_key)
VALUES
  (:fromAccountId, NULL, :amount, 'WITHDRAWAL', 'PENDING', :idempotencyKey)
```

> 📄 `backend/src/services/transactionService.js` — **Lines 147–150**

---

### 9.4 Debit, mark SUCCESS, audit

```sql
UPDATE accounts SET balance = balance - :amount WHERE id = :fromAccountId

UPDATE transactions SET status = 'SUCCESS' WHERE id = :transactionId

INSERT INTO audit_logs (transaction_id, event, metadata)
VALUES (:transactionId, 'WITHDRAWAL_SUCCESS', :metadataJson)
```

> 📄 `backend/src/services/transactionService.js` — **Lines 152–155**

---

## 10. OTP Verification

### 10.1 Generate — Invalidate previous unused OTPs

```sql
UPDATE otp_verifications
SET used = TRUE
WHERE customer_id = :req.user.id
  AND used = FALSE
```

> 📄 `backend/src/services/otpService.js` — **Lines 14–16**

---

### 10.2 Generate — Insert new OTP record

```sql
INSERT INTO otp_verifications (customer_id, otp_code, context, expires_at)
VALUES (:customerId, :otpCode, :contextJson, :expiresAt)
```

> 📄 `backend/src/services/otpService.js` — **Lines 19–23**

| Parameter | Value |
|---|---|
| `:customerId` | `req.user.id` |
| `:otpCode` | `String(Math.floor(100000 + Math.random() * 900000))` |
| `:contextJson` | `JSON.stringify({ from_account_id, to_account_id, amount, idempotency_key })` |
| `:expiresAt` | `new Date(Date.now() + 5 * 60 * 1000)` |

---

### 10.3 Verify — Fetch latest unused OTP

```sql
SELECT id, otp_code, context, expires_at, used
FROM otp_verifications
WHERE customer_id = :customerId
  AND used = FALSE
ORDER BY created_at DESC
LIMIT 1
```

> 📄 `backend/src/services/otpService.js` — **Lines 33–38**

---

### 10.4 Verify — Mark OTP as used

```sql
UPDATE otp_verifications
SET used = TRUE
WHERE id = :record.id
```

> 📄 `backend/src/services/otpService.js` — **Line 56**

---

## 11. Transaction History

**Endpoint**: `GET /api/accounts/:id/transactions?page=:page&size=:size&type=:type&status=:status`

### 11.1 Count query (pagination metadata)

```sql
SELECT COUNT(*) AS total
FROM transactions t
WHERE (t.from_account_id = :accountId OR t.to_account_id = :accountId)
  [AND t.transaction_type = :type]
  [AND t.status           = :status]
  [AND t.created_at      >= :from]
  [AND t.created_at      <= :to]
```

> 📄 `backend/src/controllers/transactionController.js` — **Line 175**

---

### 11.2 Paginated data query

```sql
SELECT t.id, t.from_account_id, t.to_account_id, t.amount,
       t.transaction_type, t.status,
       t.flagged, t.flag_reason,
       t.requires_approval, t.idempotency_key, t.created_at,
       fa.account_number AS from_account_number,
       ta.account_number AS to_account_number
FROM transactions t
LEFT JOIN accounts fa ON t.from_account_id = fa.id
LEFT JOIN accounts ta ON t.to_account_id   = ta.id
WHERE (t.from_account_id = :accountId OR t.to_account_id = :accountId)
  [AND filters applied dynamically]
ORDER BY t.created_at DESC
LIMIT :size OFFSET :offset
```

> 📄 `backend/src/controllers/transactionController.js` — **Lines 177–190**

| Parameter | Value |
|---|---|
| `:accountId` | `req.params.id` |
| `:size` | `parseInt(req.query.size \|\| '20')` |
| `:offset` | `page * size` |
| `:type` | `req.query.type` (optional) |
| `:status` | `req.query.status` (optional) |
| `:from` / `:to` | `req.query.from` / `req.query.to` (optional date range) |

**Flag visibility**: `t.flagged` and `t.flag_reason` are returned here. The frontend (`frontend/src/pages/Transactions.jsx`, lines 225–229) filters `rows.filter(t => t.flagged)` and renders a red dismissible banner at the top of the page.

---

## 12. Admin Dashboard

**Endpoint**: `GET /api/admin/dashboard`

Eight sequential queries (no parameters — aggregate counts only):

```sql
-- Line 19
SELECT COUNT(*) AS count FROM customers

-- Line 20
SELECT COUNT(*) AS count FROM accounts

-- Line 21
SELECT COUNT(*) AS count FROM transactions

-- Line 22
SELECT SUM(balance) AS total FROM accounts WHERE status = 'ACTIVE'

-- Line 23
SELECT COUNT(*) AS count FROM audit_logs

-- Line 24
SELECT COUNT(*) AS count FROM transactions WHERE status = 'PENDING_APPROVAL'

-- Line 25
SELECT COUNT(*) AS count FROM transactions WHERE flagged = TRUE

-- Line 26
SELECT COUNT(*) AS count FROM accounts WHERE status = 'FROZEN'
```

> 📄 `backend/src/routes/adminRoutes.js` — **Lines 19–26** (inline handler in `router.get('/dashboard', ...)`)

---

## 13. Admin — All Transactions

**Endpoint**: `GET /api/admin/transactions?page=:page&size=:size`

### 13.1 Data query

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
ORDER BY t.created_at DESC
LIMIT :size OFFSET :offset
```

> 📄 `backend/src/controllers/transactionController.js` — **Lines 202–212**

| Parameter | Value |
|---|---|
| `:size` | `parseInt(req.query.size \|\| '50')` |
| `:offset` | `page * size` |

### 13.2 Total count

```sql
SELECT COUNT(*) AS total FROM transactions
```

> 📄 `backend/src/controllers/transactionController.js` — **Line 213**

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

> 📄 `backend/src/controllers/adminController.js` — **Lines 91–104**

**Business logic**: Sorted ASC (oldest first) for FIFO review — prevents starvation.

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

> 📄 `backend/src/controllers/adminController.js` — **Lines 113–126**

---

## 16. Admin — Flag / Unflag

### 16.1 Flag a transaction

**Endpoint**: `PUT /api/admin/transactions/:id/flag`

```sql
UPDATE transactions
SET flagged     = TRUE,
    flag_reason = :reason
WHERE id = :req.params.id
```

> 📄 `backend/src/controllers/adminController.js` — **Lines 11–14**

```sql
INSERT INTO audit_logs (transaction_id, event, metadata)
VALUES (:req.params.id, 'TRANSACTION_FLAGGED',
        '{"reason": ":reason", "flagged_by": :req.user.id}')
```

> 📄 `backend/src/controllers/adminController.js` — **Lines 17–20**

| Parameter | Value |
|---|---|
| `:reason` | `req.body.reason.trim()` |
| `:req.params.id` | URL path param — the transaction ID |
| `:req.user.id` | Authenticated admin ID from JWT |

**Customer visibility**: `flagged` and `flag_reason` are returned by the transaction history endpoint (§11). The frontend detects them and surfaces a red alert banner.

---

### 16.2 Unflag a transaction

**Endpoint**: `PUT /api/admin/transactions/:id/unflag`

```sql
UPDATE transactions
SET flagged     = FALSE,
    flag_reason = NULL
WHERE id = :req.params.id
```

> 📄 `backend/src/controllers/adminController.js` — **Lines 27–30**

```sql
INSERT INTO audit_logs (transaction_id, event, metadata)
VALUES (:req.params.id, 'TRANSACTION_UNFLAGGED',
        '{"unflagged_by": :req.user.id}')
```

> 📄 `backend/src/controllers/adminController.js` — **Lines 33–36**

---

## 17. Admin — Reverse Transaction

**Endpoint**: `PUT /api/admin/transactions/:id/reverse` — all inside `BEGIN … COMMIT` in `reverseTransactionService`.

### 17.1 Lock original transaction

```sql
SELECT *
FROM transactions
WHERE id = :transactionId
FOR UPDATE
```

> 📄 `backend/src/services/transactionService.js` — **Lines 171–173**

---

### 17.2 Lock both accounts (ascending ID order)

```sql
SELECT id, balance, status, version, account_number
FROM accounts
WHERE id IN (:lowerAccountId, :higherAccountId)
ORDER BY id ASC
FOR UPDATE
```

> 📄 `backend/src/services/transactionService.js` — **Lines 184–187**

| Parameter | Value |
|---|---|
| `:lowerAccountId` | `Math.min(txn.from_account_id, txn.to_account_id)` |
| `:higherAccountId` | `Math.max(txn.from_account_id, txn.to_account_id)` |

---

### 17.3 Mark original as REVERSED

```sql
UPDATE transactions
SET status = 'REVERSED'
WHERE id = :transactionId
```

> 📄 `backend/src/services/transactionService.js` — **Line 197**

---

### 17.4 Insert reversal transaction record

```sql
INSERT INTO transactions
  (from_account_id, to_account_id, amount, transaction_type,
   status, idempotency_key, requires_approval)
VALUES
  (:txn.to_account_id, :txn.from_account_id, :txn.amount,
   'TRANSFER', 'SUCCESS', :reverseKey, 0)
```

> 📄 `backend/src/services/transactionService.js` — **Lines 201–205**

| Parameter | Value |
|---|---|
| `:reverseKey` | `` `reverse-${transactionId}-${Date.now()}` `` |

---

### 17.5 Move money back

```sql
UPDATE accounts
SET balance = balance - :txn.amount,
    version = version + 1
WHERE id = :txn.to_account_id

UPDATE accounts
SET balance = balance + :txn.amount,
    version = version + 1
WHERE id = :txn.from_account_id
```

> 📄 `backend/src/services/transactionService.js` — **Lines 208–209**

---

### 17.6 Audit log

```sql
INSERT INTO audit_logs (transaction_id, event, metadata)
VALUES (:revResult.insertId, 'TRANSACTION_REVERSED',
        '{"original_txn_id": :transactionId, "reversed_by": :adminId, "amount": :txn.amount}')
```

> 📄 `backend/src/services/transactionService.js` — **Lines 212–215**

**Business logic**: Never deletes the original record. Original shows `REVERSED`, new record shows `SUCCESS` with money flowing in the opposite direction — full audit trail preserved.

---

## 18. Admin — Approve Transaction

**Endpoint**: `PUT /api/admin/transactions/:id/approve` — all inside `BEGIN … COMMIT` in `approveTransactionService`.

### 18.1 Lock transaction

```sql
SELECT *
FROM transactions
WHERE id = :transactionId
FOR UPDATE
```

> 📄 `backend/src/services/transactionService.js` — **Line 230**

---

### 18.2 Lock accounts (ascending ID)

```sql
SELECT id, balance, status, version
FROM accounts
WHERE id IN (:lowerAccountId, :higherAccountId)
ORDER BY id ASC
FOR UPDATE
```

> 📄 `backend/src/services/transactionService.js` — **Lines 239–242**

---

### 18.3 Debit source / credit destination

```sql
UPDATE accounts
SET balance = balance - :txn.amount,
    version = version + 1
WHERE id = :txn.from_account_id

UPDATE accounts
SET balance = balance + :txn.amount,
    version = version + 1
WHERE id = :txn.to_account_id
```

> 📄 `backend/src/services/transactionService.js` — **Lines 253–254**

---

### 18.4 Mark approved

```sql
UPDATE transactions
SET status      = 'SUCCESS',
    approved_by = :adminId,
    approved_at = NOW()
WHERE id = :transactionId
```

> 📄 `backend/src/services/transactionService.js` — **Lines 257–260**

---

### 18.5 Audit log

```sql
INSERT INTO audit_logs (transaction_id, event, metadata)
VALUES (:transactionId, 'TRANSFER_APPROVED',
        '{"approved_by": :adminId, "amount": :txn.amount}')
```

> 📄 `backend/src/services/transactionService.js` — **Lines 262–265**

**Note**: Balance is re-validated at approval time (line 249). If the customer spent their balance between submission and admin approval, the approval correctly fails with "Insufficient balance at time of approval."

---

## 19. Admin — Reject Transaction

**Endpoint**: `PUT /api/admin/transactions/:id/reject`

### 19.1 Validate current status

```sql
SELECT status
FROM transactions
WHERE id = :req.params.id
```

> 📄 `backend/src/controllers/adminController.js` — **Lines 68–70**

---

### 19.2 Mark as FAILED

```sql
UPDATE transactions
SET status      = 'FAILED',
    flag_reason = :rejectionReason
WHERE id = :req.params.id
```

> 📄 `backend/src/controllers/adminController.js` — **Lines 75–78**

| Parameter | Value |
|---|---|
| `:rejectionReason` | `` `Rejected by admin: ${req.body.reason}` `` or `'Rejected by admin'` |

---

### 19.3 Audit log

```sql
INSERT INTO audit_logs (transaction_id, event, metadata)
VALUES (:req.params.id, 'TRANSFER_REJECTED',
        '{"rejected_by": :req.user.id, "reason": ":req.body.reason"}')
```

> 📄 `backend/src/controllers/adminController.js` — **Lines 79–82**

**Note**: No funds were held during `PENDING_APPROVAL` — no balance rollback needed on rejection.

---

## 20. Admin — Block / Unblock Account

### 20.1 Block (FREEZE)

**Endpoint**: `PUT /api/admin/accounts/:id/block`

```sql
UPDATE accounts
SET status = 'FROZEN'
WHERE id     = :req.params.id
  AND status != 'CLOSED'
```

> 📄 `backend/src/controllers/adminController.js` — **Lines 136–139**

```sql
INSERT INTO audit_logs (transaction_id, event, metadata)
VALUES (NULL, 'ACCOUNT_BLOCKED',
        '{"account_id": :req.params.id, "reason": ":reason", "blocked_by": :req.user.id}')
```

> 📄 `backend/src/controllers/adminController.js` — **Lines 142–145**

| Parameter | Value |
|---|---|
| `:req.params.id` | URL path param — account ID |
| `:reason` | `req.body.reason \|\| 'Admin action'` |

**Guard**: `AND status != 'CLOSED'` — `affectedRows = 0` means account doesn't exist or is already closed.

---

### 20.2 Unblock (ACTIVE)

**Endpoint**: `PUT /api/admin/accounts/:id/unblock`

```sql
UPDATE accounts
SET status = 'ACTIVE'
WHERE id     = :req.params.id
  AND status = 'FROZEN'
```

> 📄 `backend/src/controllers/adminController.js` — **Lines 152–155**

```sql
INSERT INTO audit_logs (transaction_id, event, metadata)
VALUES (NULL, 'ACCOUNT_UNBLOCKED',
        '{"account_id": :req.params.id, "unblocked_by": :req.user.id}')
```

> 📄 `backend/src/controllers/adminController.js` — **Lines 158–161**

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

> 📄 `backend/src/controllers/adminController.js` — **Lines 169–175**

No parameters — returns all accounts.

---

## 22. Admin — All Customers

**Endpoint**: `GET /api/admin/customers`

```sql
SELECT id, name, email, phone, role, created_at
FROM customers
ORDER BY created_at DESC
```

> 📄 `backend/src/controllers/customerController.js` — **Lines 44–46**

No parameters — returns all customers.

---

## 23. Audit Log Event Catalogue

All audit writes share the same INSERT pattern:

```sql
INSERT INTO audit_logs (transaction_id, event, metadata)
VALUES (:transactionId, ':EVENT_NAME', :metadataJson)
```

`transaction_id` is `NULL` for account-level events (block/unblock).

| Event | Source File | Lines |
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

| Lock Type | Keyword | Used At | Purpose |
|---|---|---|---|
| Shared read lock | `FOR SHARE` | `transactionService.js:18` | Idempotency check — allows concurrent reads, blocks writers |
| Exclusive write lock | `FOR UPDATE` | `transactionService.js:29` | Account balance modification — blocks all concurrent access |
| Exclusive write lock | `FOR UPDATE` | `transactionService.js:116` | Deposit — lock before credit |
| Exclusive write lock | `FOR UPDATE` | `transactionService.js:142` | Withdrawal — lock before debit |
| Exclusive write lock | `FOR UPDATE` | `transactionService.js:171` | Reversal — lock original transaction |
| Exclusive write lock | `FOR UPDATE` | `transactionService.js:184` | Reversal — lock both accounts |
| Exclusive write lock | `FOR UPDATE` | `transactionService.js:230` | Approval — lock pending transaction |
| Exclusive write lock | `FOR UPDATE` | `transactionService.js:239` | Approval — lock both accounts |

### Optimistic Locking (version column)

```sql
-- transactionService.js lines 70–74
UPDATE accounts
SET balance = balance - :amount,
    version = version + 1
WHERE id      = :fromAccountId
  AND version = :fromAcc.version
-- affectedRows = 0  →  concurrent modification  →  ROLLBACK + HTTP 409
```

The `version` column is a safety net on top of `FOR UPDATE`. Even though `FOR UPDATE` prevents simultaneous writes, the version check catches the rare race between connection checkout and actual write execution.

### Deadlock Prevention

```
-- transactionService.js line 28 (transfer) and line 183 (reversal)
const lockOrder = [fromAccountId, toAccountId].sort((a, b) => a - b);
```

**Always acquire locks in ascending `account_id` order.** Two threads competing for the same two accounts will always request the locks in the same sequence — a circular wait becomes structurally impossible.

```
Thread A: acc_id=3 → acc_id=7     Thread B: acc_id=7 → acc_id=3
─────────────────────────────────────────────────────────────────
WITHOUT ordering:   A locks 3, B locks 7 → each waits for the other → DEADLOCK
WITH ordering:      A locks 3, B also tries 3 → B WAITS → A locks 7 → A commits → B proceeds ✓
```

### Transaction Isolation Level

MySQL default: **REPEATABLE READ**. Within a transaction, all reads see the same snapshot taken at transaction start — except rows locked with `FOR UPDATE`/`FOR SHARE`, which always see the latest committed version.

---

## 25. Index Usage Summary

| Index | Table | Columns | Used By |
|---|---|---|---|
| `PRIMARY` | `customers` | `id` | `customerController.js:9` |
| `idx_customers_email` | `customers` | `email` | `authController.js:19`, `authController.js:55` |
| `PRIMARY` | `accounts` | `id` | All `FOR UPDATE` locks in `transactionService.js` |
| `idx_accounts_customer_id` | `accounts` | `customer_id` | `accountController.js:53`, `beneficiaryController.js:40` |
| `idx_accounts_account_number` | `accounts` | `account_number` | `accountController.js:136` |
| `idx_accounts_status` | `accounts` | `status` | `adminRoutes.js:22`, `adminRoutes.js:26` |
| `PRIMARY` | `transactions` | `id` | `transactionService.js:171`, `transactionService.js:230` |
| `idx_txn_idempotency_key` | `transactions` | `idempotency_key` | `transactionService.js:18`, `transactionService.js:113`, `transactionService.js:139` |
| `idx_txn_from_account_id` | `transactions` | `from_account_id, created_at` | `transactionController.js:175,177` |
| `idx_txn_to_account_id` | `transactions` | `to_account_id, created_at` | `transactionController.js:175,177` |
| `idx_txn_status` | `transactions` | `status` | `adminRoutes.js:24`, `adminController.js:91` |
| `idx_txn_created_at` | `transactions` | `created_at` | `transactionController.js:202`, `adminController.js:113` |
| `idx_audit_transaction_id` | `audit_logs` | `transaction_id` | All audit `INSERT`s |
| `idx_audit_event` | `audit_logs` | `event` | Event-type filtering |
| `idx_audit_created_at` | `audit_logs` | `created_at` | Chronological admin listing |
| `idx_bene_customer_id` | `beneficiaries` | `customer_id` | `beneficiaryController.js:40` |
| `uq_bene_customer_account` | `beneficiaries` | `customer_id, account_id` | `beneficiaryController.js:18` (duplicate prevention) |

---

*End of QUERIES_DOC.md*
