# Mini Banking System — Evaluator Demo Guide

> **Total time**: ~10 minutes | **5 scenarios**
>
> **Prerequisites**: Backend running on `http://localhost:5000` · Frontend on `http://localhost:5173`
>
> **Start servers** (two terminals from project root):
> ```bash
> cd backend  && npm run dev   # Terminal 1
> cd frontend && npm run dev   # Terminal 2
> ```

---

## Quick Reference — Real Accounts from Database

> All values below are live from the seeded `mini_banking` database.

| Role | Email | Password | Account No. | Balance |
|---|---|---|---|---|
| **Admin** | `admin@minibank.com` | `admin123` | — | — |
| **Sender (S1)** | `user_c1012785532@paysim.test` | `password123` | `ACC1000000386` | ₹1,93,608.10 |
| **Receiver (R1)** | `user_c1011433682@paysim.test` | `password123` | `ACC1000000342` | ₹1,88,745.27 |
| **Low-Balance (L1)** | `user_c1054913783@paysim.test` | `password123` | `ACC1000001597` | ₹444.73 |

---

## Scenario 1 — Standard Transfer & Balance Check (< ₹25,000)

**Goal**: Show that an immediate transfer debits/credits both accounts atomically and writes an audit log entry.

---

### Step 1 — Login as Sender

Navigate to `http://localhost:5173/login`

- **Email**: `user_c1012785532@paysim.test`
- **Password**: `password123`

---

### Step 2 — Perform the Transfer (UI)

1. Click **Transactions** in the sidebar
2. Select the **Transfer** tab
3. Fill in:
   - **From Account**: `ACC1000000386`
   - **To Account Number**: `ACC1000000342` ← type this in the lookup field
   - **Amount**: `5000`
4. Click **Transfer Now**

✅ **Expected UI**: Green success toast — *"Transfer successful"*

---

### Step 3 — Verify Balances in DB

```sql
SELECT id, account_number, balance, version
FROM accounts
WHERE id IN (386, 342);
```

**Expected result** (before → after):

| account_number | Before | After | Change |
|---|---|---|---|
| `ACC1000000386` (Sender) | ₹1,93,608.10 | ₹1,88,608.10 | **−₹5,000** |
| `ACC1000000342` (Receiver) | ₹1,88,745.27 | ₹1,93,745.27 | **+₹5,000** |

Notice `version` increments by 1 on the sender — this is the **optimistic lock** counter.

---

### Step 4 — Verify Audit Log

```sql
SELECT id, transaction_id, event, metadata, created_at
FROM audit_logs
ORDER BY id DESC
LIMIT 1;
```

**Expected output**:
```
+------+----------------+------------------+------------------------------------------------------------+---------------------+
| id   | transaction_id | event            | metadata                                                   | created_at          |
+------+----------------+------------------+------------------------------------------------------------+---------------------+
| 1668 |           1668 | TRANSFER_SUCCESS | {"from":"ACC1000000386","to":"ACC1000000342","amount":5000} | 2026-10-30 ...      |
+------+----------------+------------------+------------------------------------------------------------+---------------------+
```

> **DB guarantee demonstrated**: **Atomicity** — both balance updates and the audit log commit in a single `BEGIN...COMMIT` block. If any step fails, all are rolled back.

---

---

## Scenario 2 — High-Amount OTP Flow (≥ ₹25,000)

**Goal**: Show OTP verification for large transfers, the `otp_verifications` record, and the resulting `PENDING_APPROVAL` state.

---

### Step 1 — Attempt a ₹30,000 Transfer (UI)

Still logged in as **Sender** (`user_c1012785532@paysim.test`):

1. Click **Transactions** → **Transfer** tab
2. Fill in:
   - **From Account**: `ACC1000000386`
   - **To Account**: `ACC1000000342`
   - **Amount**: `30000`
3. Click **Transfer Now**

✅ **Expected UI**: OTP modal appears — *"A transfer of ₹30,000 requires OTP verification"*. The OTP code is displayed in the modal for demo purposes.

---

### Step 2 — Inspect otp_verifications (DB)

Before entering the OTP, run:

```sql
SELECT id, customer_id, otp_code, context, expires_at, used
FROM otp_verifications
WHERE customer_id = 387
ORDER BY id DESC
LIMIT 1;
```

**Expected output**:
```
+----+-------------+----------+--------------------------------------------------------------+---------------------+------+
| id | customer_id | otp_code | context                                                      | expires_at          | used |
+----+-------------+----------+--------------------------------------------------------------+---------------------+------+
|  1 |         387 | 847291   | {"from_account_id":386,"to_account_id":342,"amount":"30000"} | 2026-10-30 HH:MM:SS | 0    |
+----+-------------+----------+--------------------------------------------------------------+---------------------+------+
```

Key fields:
- `context` — JSON stores the full transfer payload so it survives a page refresh
- `expires_at` — exactly 5 minutes from request time
- `used = 0` — not yet consumed

---

### Step 3 — Complete Verification

Enter the OTP shown in the modal → Click **Verify & Transfer**

```sql
-- Check transaction state immediately after
SELECT id, amount, transaction_type, status, requires_approval
FROM transactions
ORDER BY id DESC
LIMIT 1;
```

**Expected output**:
```
+------+----------+------------------+------------------+------------------+
| id   | amount   | transaction_type | status           | requires_approval|
+------+----------+------------------+------------------+------------------+
| 1669 | 30000.00 | TRANSFER         | PENDING_APPROVAL |                1 |
+------+----------+------------------+------------------+------------------+
```

```sql
-- Confirm OTP is now marked used
SELECT id, otp_code, used FROM otp_verifications WHERE customer_id = 387 ORDER BY id DESC LIMIT 1;
-- used = 1  ← consumed, cannot be replayed
```

> **DB guarantee demonstrated**: High-value transfers are held in `PENDING_APPROVAL` — funds are **validated but not moved** until an admin approves. The OTP record is single-use.

---

---

## Scenario 3 — Rollback on Insufficient Balance

**Goal**: Demonstrate Atomicity — a transfer that exceeds the source balance is aborted cleanly with no side effects.

---

### Step 1 — Login as Low-Balance Customer

- **Email**: `user_c1054913783@paysim.test`
- **Password**: `password123`
- **Account**: `ACC1000001597` — Balance: **₹444.73**

---

### Step 2 — Record Current State (DB)

```sql
SELECT account_number, balance, version
FROM accounts WHERE id = 1597;
```

```
+----------------+---------+---------+
| account_number | balance | version |
+----------------+---------+---------+
| ACC1000001597  |  444.73 |       0 |
+----------------+---------+---------+
```

---

### Step 3 — Attempt an Overdraft Transfer (UI or cURL)

**Via UI**: Transfer → From `ACC1000001597` → To `ACC1000000342` → Amount: `10000`

**Via cURL** (after logging in to get a token):
```bash
# 1. Login to get token
curl -s -X POST http://localhost:5000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"user_c1054913783@paysim.test","password":"password123"}' \
  | jq '.token'

# 2. Attempt overdraft transfer (replace TOKEN)
curl -s -X POST http://localhost:5000/api/transactions/transfer \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer TOKEN" \
  -d '{
    "from_account_id": 1597,
    "to_account_id": 342,
    "amount": 10000,
    "idempotency_key": "demo-overdraft-001"
  }'
```

**Expected API response**:
```json
{
  "error": "Insufficient balance. Available: 444.73, Requested: 10000"
}
```

HTTP status: **400 Bad Request**

---

### Step 4 — Confirm No State Change (DB)

```sql
SELECT account_number, balance, version FROM accounts WHERE id IN (1597, 342);
```

```
+----------------+-----------+---------+
| account_number | balance   | version |
+----------------+-----------+---------+
| ACC1000001597  |    444.73 |       0 |  ← UNCHANGED
| ACC1000000342  | 193745.27 |       1 |  ← UNCHANGED
+----------------+-----------+---------+
```

```sql
-- Confirm no failed transaction record was written either
SELECT id, status, amount FROM transactions
WHERE from_account_id = 1597 AND idempotency_key = 'demo-overdraft-001';
-- 0 rows returned
```

> **DB guarantee demonstrated**: **Atomicity** — the balance check happens inside `BEGIN...FOR UPDATE`. Failure causes an immediate `ROLLBACK`; neither account is touched, no transaction record is written.

---

---

## Scenario 4 — Idempotency & Race Condition Defense

**Goal**: Prove that sending the same request twice (simulating a network retry or double-click) results in only one debit.

---

### Step 1 — Send First Transfer (cURL)

Use the **Sender** account. Replace `TOKEN` with the login token for `user_c1012785532@paysim.test`.

```bash
# Login
curl -s -X POST http://localhost:5000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"user_c1012785532@paysim.test","password":"password123"}' \
  | jq -r '.token'
```

```bash
# First request — note the fixed idempotency_key
curl -s -X POST http://localhost:5000/api/transactions/transfer \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer TOKEN" \
  -d '{
    "from_account_id": 386,
    "to_account_id": 342,
    "amount": 2000,
    "idempotency_key": "demo-idempotency-key-xyz-001"
  }'
```

**Expected response**:
```json
{
  "status": "success",
  "transaction": { "id": 1670, "amount": 2000, "status": "SUCCESS" }
}
```

---

### Step 2 — Send Identical Request Again

```bash
# Second request — same idempotency_key, same body
curl -s -X POST http://localhost:5000/api/transactions/transfer \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer TOKEN" \
  -d '{
    "from_account_id": 386,
    "to_account_id": 342,
    "amount": 2000,
    "idempotency_key": "demo-idempotency-key-xyz-001"
  }'
```

**Expected response** (identical transaction object, no new debit):
```json
{
  "status": "idempotent",
  "transaction": { "id": 1670, "amount": 2000, "status": "SUCCESS" }
}
```

---

### Step 3 — Verify Only One Debit Occurred (DB)

```sql
SELECT id, amount, status, idempotency_key, created_at
FROM transactions
WHERE idempotency_key = 'demo-idempotency-key-xyz-001';
```

```
+------+--------+---------+-----------------------------+---------------------+
| id   | amount | status  | idempotency_key             | created_at          |
+------+--------+---------+-----------------------------+---------------------+
| 1670 | 2000   | SUCCESS | demo-idempotency-key-xyz-001| 2026-10-30 ...      |
+------+--------+---------+-----------------------------+---------------------+
-- Only ONE row — second request returned the cached result
```

```sql
-- Balance reduced by exactly ₹2,000 (not ₹4,000)
SELECT account_number, balance FROM accounts WHERE id = 386;
-- balance = 186608.10  (was 188608.10 after Scenario 1)
```

> **DB guarantee demonstrated**: The idempotency check uses `FOR SHARE` inside the transaction. The unique index on `idempotency_key` ensures a concurrent duplicate INSERT would fail at the DB level even if two requests arrived simultaneously.

---

---

## Scenario 5 — Admin Transaction Reversal

**Goal**: Show that an admin can atomically reverse a completed transfer — funds return to source, original record changes to `REVERSED`, a new reversal record is created, and an audit entry is written.

---

### Step 1 — Find a Reversible Transaction (DB)

```sql
SELECT t.id, t.from_account_id, t.to_account_id, t.amount, t.status,
       fa.account_number AS from_acc, ta.account_number AS to_acc
FROM transactions t
JOIN accounts fa ON fa.id = t.from_account_id
JOIN accounts ta ON ta.id = t.to_account_id
WHERE t.transaction_type = 'TRANSFER'
  AND t.status = 'SUCCESS'
ORDER BY t.id DESC
LIMIT 3;
```

Pick any `id` from the result — for this demo we'll use **txn id `91`** (a ₹1,45,515.24 transfer from `ACC1000001199` → `ACC1000001988`).

---

### Step 2 — Record State Before Reversal (DB)

```sql
SELECT account_number, balance, version
FROM accounts
WHERE id IN (1199, 1988);
```

Note these balances — they will swap back after reversal.

---

### Step 3 — Perform Reversal (UI)

1. Logout and login as **Admin** (`admin@minibank.com` / `admin123`)
2. Go to **Admin Panel** → **All Transactions** tab
3. Find transaction `#91` (₹1,45,515.24 — TRANSFER — SUCCESS)
4. Click **Reverse**
5. Confirm in the dialog

✅ **Expected UI**: Row updates to show status `REVERSED`

---

### Step 4 — Inspect All Four DB Changes

```sql
-- 1. Original transaction is now REVERSED
SELECT id, status, amount FROM transactions WHERE id = 91;
```
```
+----+----------+------------+
| id | status   | amount     |
+----+----------+------------+
| 91 | REVERSED | 145515.24  |
+----+----------+------------+
```

```sql
-- 2. A new reversal transaction was created (opposite direction, SUCCESS)
SELECT id, from_account_id, to_account_id, amount, status, idempotency_key
FROM transactions
WHERE idempotency_key LIKE 'reverse-91-%';
```
```
+------+-----------------+---------------+------------+---------+-------------------+
| id   | from_account_id | to_account_id | amount     | status  | idempotency_key   |
+------+-----------------+---------------+------------+---------+-------------------+
| 1671 |            1988 |          1199 | 145515.24  | SUCCESS | reverse-91-...    |
+------+-----------------+---------------+------------+---------+-------------------+
-- Note: from/to are SWAPPED — money flows back
```

```sql
-- 3. Balances moved back atomically
SELECT account_number, balance, version FROM accounts WHERE id IN (1199, 1988);
-- version incremented on both accounts
```

```sql
-- 4. Audit trail written
SELECT id, transaction_id, event, metadata, created_at
FROM audit_logs
WHERE event = 'TRANSACTION_REVERSED'
ORDER BY id DESC LIMIT 1;
```
```
+------+----------------+----------------------+----------------------------------------------+---------------------+
| id   | transaction_id | event                | metadata                                     | created_at          |
+------+----------------+----------------------+----------------------------------------------+---------------------+
| 1669 |           1671 | TRANSACTION_REVERSED | {"original_txn_id":91,"reversed_by":1,...}  | 2026-10-30 ...      |
+------+----------------+----------------------+----------------------------------------------+---------------------+
```

> **DB guarantee demonstrated**: Reversal runs inside its own `BEGIN...COMMIT` block. The original record is **never deleted** — it is updated to `REVERSED`. A new transaction record is inserted for the return transfer. Both account balances update in the same atomic commit. If anything fails mid-way, all changes roll back.

---

---

## Summary — Database Guarantees Demonstrated

| Scenario | ACID Property | Mechanism |
|---|---|---|
| 1 — Standard Transfer | **Atomicity** | `BEGIN…COMMIT` wraps balance updates + audit log |
| 2 — OTP High-Amount | **Consistency** | Business rule enforced in DB: no money moves until admin approves |
| 3 — Insufficient Balance | **Atomicity** | `ROLLBACK` on balance check failure — zero side effects |
| 4 — Idempotency | **Isolation** | `FOR SHARE` lock + unique index blocks duplicate debits |
| 5 — Admin Reversal | **Atomicity + Durability** | Atomic 4-step commit; original record preserved forever |

### Additional Guarantees (visible across all scenarios)

- **Deadlock prevention**: Accounts always locked in ascending `id` order (`ORDER BY id ASC FOR UPDATE`)
- **Optimistic locking**: `version` column increments on every balance write — stale concurrent updates are rejected with HTTP 409
- **Immutable audit trail**: `audit_logs` is append-only; every money movement has a corresponding log entry
- **OTP single-use**: `used = 1` is set atomically on verification — OTP replay attacks are impossible

---

*Mini Banking System — Built with Node.js · React · MySQL 8.0*
