# Mini Banking System

> A full-stack banking application built with **React + Node.js + MySQL** focused on ACID transactions, concurrency control, deadlock prevention, and financial correctness.

---

## Tech Stack

| Layer      | Technology              |
|------------|------------------------|
| Frontend   | React 19 + Vite         |
| Backend    | Node.js + Express       |
| Database   | MySQL 8.x (InnoDB)      |
| Auth       | JWT + bcrypt            |
| HTTP Client| Axios                   |

---

## Project Structure

```
Banking System/
├── backend/                 # Node.js Express API
│   ├── src/
│   │   ├── config/          # db.js, jwt.js
│   │   ├── controllers/     # auth, account, transaction, beneficiary
│   │   ├── middleware/      # auth.js, errorHandler.js
│   │   ├── routes/          # all Express routers
│   │   ├── services/        # transactionService.js (ACID logic)
│   │   └── app.js
│   ├── .env                 # Configure your MySQL password here!
│   └── package.json
├── frontend/                # React + Vite app
│   ├── src/
│   │   ├── api/client.js    # Axios with JWT interceptor
│   │   ├── context/AuthContext.jsx
│   │   ├── components/      # Sidebar, UI helpers
│   │   ├── pages/           # Dashboard, Accounts, Transactions, etc.
│   │   └── App.jsx
│   └── package.json
└── database/
    ├── schema.sql           # All DDL + indexes
    ├── seed.sql             # Sample data
    └── DATABASE.md          # ER diagram, queries, latency docs
```

---

## Setup Instructions

### 1. Database Setup

```sql
-- In MySQL client:
SOURCE database/schema.sql;
SOURCE database/seed.sql;
```

### 2. Backend Setup

```bash
cd backend

# Copy env file and fill in your MySQL password
copy .env.example .env
# Edit .env: set DB_PASSWORD=your_mysql_password

npm install
npm run dev     # Runs on http://localhost:5000
```

### 3. Frontend Setup

```bash
cd frontend
npm install
npm run dev     # Runs on http://localhost:5173
```

---

## API Endpoints

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| POST | /api/auth/register | Register new customer | None |
| POST | /api/auth/login | Login, get JWT | None |
| GET | /api/customers/me | Get profile | JWT |
| PUT | /api/customers/me | Update profile | JWT |
| POST | /api/accounts | Create account | JWT |
| GET | /api/accounts | List my accounts | JWT |
| GET | /api/accounts/:id | Account details | JWT |
| PUT | /api/accounts/:id/status | Change status | Admin |
| POST | /api/transactions/deposit | Deposit | JWT |
| POST | /api/transactions/withdraw | Withdraw | JWT |
| POST | /api/transactions/transfer | Transfer (atomic) | JWT |
| GET | /api/accounts/:id/transactions | Transaction history | JWT |
| POST | /api/beneficiaries | Add beneficiary | JWT |
| GET | /api/beneficiaries | List beneficiaries | JWT |
| DELETE | /api/beneficiaries/:id | Remove beneficiary | JWT |
| GET | /api/admin/dashboard | Admin stats | Admin |
| GET | /api/admin/customers | All customers | Admin |
| GET | /api/admin/transactions | All transactions | Admin |

---

## Key Features

- **Atomic Money Transfers** — `BEGIN TRANSACTION … COMMIT` wrapping all steps
- **Deadlock Prevention** — Locks accounts in ascending ID order
- **Optimistic Locking** — `version` column prevents lost updates under concurrency
- **Idempotency** — UUID-keyed requests; retries never double-charge
- **Audit Log** — Every operation logged with metadata
- **JWT Auth** — Role-based access: CUSTOMER and ADMIN
- **Paginated History** — `LIMIT/OFFSET` with composite indexes

---

## Database Documentation

See **[database/DATABASE.md](database/DATABASE.md)** for:
- Full ER diagram
- All SQL queries
- Index strategy
- Latency benchmarks per query
- ACID & concurrency explanation

---

## Demo Credentials (after running seed.sql)

```
Admin:    admin@minibank.com  / admin123
Customer: ananya@example.com  / password123
```
