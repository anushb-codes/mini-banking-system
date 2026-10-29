# Mini Banking System — Setup Instructions

> **For Antigravity users:** Give this exact prompt to set up the entire system automatically:
>
> ```
> Please read the INSTRUCTIONS.md file in the root of this project and follow every step exactly to set up and run the Mini Banking System on my machine. My MySQL root password is: [YOUR_MYSQL_ROOT_PASSWORD]
> ```

---

## What This Project Is

A full-stack banking web application featuring:
- **Backend**: Node.js + Express (REST API, JWT auth, atomic transactions)
- **Frontend**: React + Vite (dark-mode UI, real-time account lookup)
- **Database**: MySQL 8.0 (InnoDB, ACID transactions, deadlock-safe locking)
- **Features**: Deposits, withdrawals, transfers, OTP verification for high-value transfers, admin panel (flag/unflag transactions, block accounts, approve high-value transfers), customer search, transaction history

---

## Prerequisites

Before starting, ensure the following are installed:

| Tool | Version | Check |
|---|---|---|
| Node.js | ≥ 18 | `node --version` |
| npm | ≥ 9 | `npm --version` |
| MySQL Server | 8.0 | `mysql --version` |
| Python | ≥ 3.9 | `python --version` |
| Git | any | `git --version` |

---

## Step 1 — Clone the Repository

```bash
git clone https://github.com/anushb-codes/mini-banking-system.git
cd mini-banking-system
```

---

## Step 2 — Set Up the Database

### 2a. Create the schema

```bash
# Replace YOUR_PASSWORD with your MySQL root password
mysql -u root -pYOUR_PASSWORD < database/schema.sql
```

### 2b. Apply the admin migration (adds flagging, OTP, approval columns)

```bash
mysql -u root -pYOUR_PASSWORD mini_banking < database/migration_admin.sql
```

### 2c. Load the base seed data (4 customers, 5 accounts, sample transactions)

```bash
mysql -u root -pYOUR_PASSWORD mini_banking < database/seed.sql
```

> **Optional — Realistic PaySim Dataset (201 customers, 200 accounts, 186 transactions)**
>
> If you have the PaySim dataset CSV, follow Step 6 below to generate and load it instead.

---

## Step 3 — Configure the Backend

### 3a. Install dependencies

```bash
cd backend
npm install
```

### 3b. Create the environment file

Create `backend/.env` with the following content (adjust values to match your setup):

```env
PORT=5000
DB_HOST=localhost
DB_PORT=3306
DB_NAME=mini_banking
DB_USER=root
DB_PASSWORD=YOUR_MYSQL_ROOT_PASSWORD
JWT_SECRET=super_secret_jwt_key_change_in_production
JWT_EXPIRES_IN=7d
```

> ⚠️ Never commit `.env` to git — it is already in `.gitignore`.

---

## Step 4 — Configure the Frontend

```bash
cd ../frontend
npm install
```

The frontend proxies API calls to `http://localhost:5000` via `vite.config.js` — no `.env` needed.

---

## Step 5 — Run the Application

Open **two terminal windows** from the project root:

**Terminal 1 — Backend:**
```bash
cd backend
npm run dev
# Should print: 🚀 Mini Banking API listening on http://localhost:5000
```

**Terminal 2 — Frontend:**
```bash
cd frontend
npm run dev
# Should print: Local: http://localhost:5173/
```

Open **http://localhost:5173** in your browser.

---

## Step 6 — (Optional) Load Realistic PaySim Dataset

This step generates realistic transaction data from the PaySim financial fraud simulation dataset.

### 6a. Download the dataset

Download from Kaggle: https://www.kaggle.com/datasets/ealaxi/paysim1

Place the CSV file (any of these names work) in:
```
database/raw_data/paysim.csv
```

### 6b. Set up Python virtual environment

```bash
cd database
python -m venv venv

# Windows:
venv\Scripts\activate

# macOS / Linux:
source venv/bin/activate

pip install pandas bcrypt
```

### 6c. Run the pipeline

```bash
python generate_realistic_seed.py
```

Expected output:
```
[1/6] Reading CSV (first 5000 rows)...
[2/6] Extracting unique actors...
[3/6] Mapping transactions...
[4/6] Hashing passwords...
[5/6] Computing account balances...
[6/6] Writing SQL file...
✅ Done! Written to: database/realistic_seed.sql
   Customers: 201 | Accounts: 200 | Transactions: 186
```

### 6d. Load into MySQL

**Windows (PowerShell):**
```powershell
Get-Content "database\realistic_seed.sql" | & "C:\Program Files\MySQL\MySQL Server 8.0\bin\mysql.exe" -u root -pYOUR_PASSWORD mini_banking
```

**macOS / Linux:**
```bash
mysql -u root -pYOUR_PASSWORD mini_banking < database/realistic_seed.sql
```

> ⚠️ This **replaces** all existing data. The base seed (Step 2c) is no longer needed if you run this.

---

## Default Login Credentials

### After base seed (Step 2c):

| Role | Email | Password |
|---|---|---|
| Admin | `admin@minibank.com` | `admin123` |
| Customer | `ananya@example.com` | `password123` |
| Customer | `rohit@example.com` | `password123` |

### After realistic seed (Step 6):

| Role | Email | Password |
|---|---|---|
| Admin | `admin@minibank.com` | `admin123` |
| Any customer | `user_c1000182@paysim.test` | `password123` |
| Any customer | `user_c1000600@paysim.test` | `password123` |

> All realistic-seed customers follow the pattern `user_<paySimId>@paysim.test` with password `password123`.
> You can find any customer's email via the **Customer Search** page in the app.

---

## Project Structure

```
mini-banking-system/
├── backend/                    # Node.js Express API
│   ├── src/
│   │   ├── app.js              # Express app entry point
│   │   ├── config/db.js        # MySQL connection pool
│   │   ├── controllers/        # Route handlers
│   │   │   ├── authController.js
│   │   │   ├── accountController.js
│   │   │   ├── transactionController.js
│   │   │   ├── adminController.js
│   │   │   ├── customerController.js
│   │   │   └── beneficiaryController.js
│   │   ├── middleware/auth.js   # JWT verify + role guard
│   │   ├── routes/             # Express routers
│   │   └── services/           # Business logic
│   │       ├── transactionService.js   # Atomic transfer logic
│   │       └── otpService.js           # OTP generation/verify
│   ├── .env                    # ← YOU CREATE THIS (not in git)
│   └── package.json
│
├── frontend/                   # React + Vite SPA
│   ├── src/
│   │   ├── App.jsx             # Routes
│   │   ├── pages/
│   │   │   ├── Dashboard.jsx
│   │   │   ├── Accounts.jsx
│   │   │   ├── Transactions.jsx    # Deposit/Withdraw/Transfer + OTP modal
│   │   │   ├── Customers.jsx       # Customer search
│   │   │   ├── Beneficiaries.jsx
│   │   │   └── AdminPanel.jsx      # Admin management panel
│   │   ├── components/
│   │   │   ├── Sidebar.jsx
│   │   │   └── ui.jsx
│   │   ├── context/AuthContext.jsx
│   │   ├── api/client.js       # Axios instance
│   │   └── index.css           # Design system tokens
│   └── package.json
│
├── database/
│   ├── schema.sql              # ← Run first: creates all tables
│   ├── migration_admin.sql     # ← Run second: adds admin columns
│   ├── seed.sql                # ← Run third: base sample data
│   ├── generate_realistic_seed.py  # PaySim data pipeline
│   ├── DATABASE.md             # DB design docs + ER diagram
│   └── QUERIES_DOC.md          # All SQL queries documented
│
├── INSTRUCTIONS.md             # ← You are here
├── README.md
└── .gitignore
```

---

## API Endpoints Reference

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| POST | `/api/auth/login` | None | Login, get JWT |
| POST | `/api/auth/register` | None | Register customer |
| GET | `/api/accounts` | Customer | List my accounts |
| POST | `/api/accounts` | Customer | Open new account |
| GET | `/api/accounts/lookup?account_number=` | Customer | Recipient lookup |
| GET | `/api/accounts/:id/transactions` | Customer | Paginated history |
| POST | `/api/transactions/deposit` | Customer | Deposit |
| POST | `/api/transactions/withdraw` | Customer | Withdraw |
| POST | `/api/transactions/transfer` | Customer | Transfer (< ₹25k) |
| POST | `/api/transactions/request-otp` | Customer | OTP for ≥ ₹25k |
| POST | `/api/transactions/verify-otp` | Customer | Verify OTP → pending |
| GET | `/api/customers/search?q=` | Customer | Search customers |
| GET | `/api/beneficiaries` | Customer | List beneficiaries |
| POST | `/api/beneficiaries` | Customer | Add beneficiary |
| GET | `/api/admin/dashboard` | Admin | Stats overview |
| GET | `/api/admin/transactions` | Admin | All transactions |
| GET | `/api/admin/transactions/pending` | Admin | Pending approvals |
| GET | `/api/admin/transactions/flagged` | Admin | Flagged transactions |
| PUT | `/api/admin/transactions/:id/flag` | Admin | Flag transaction |
| PUT | `/api/admin/transactions/:id/unflag` | Admin | Remove flag |
| PUT | `/api/admin/transactions/:id/reverse` | Admin | Reverse transfer |
| PUT | `/api/admin/transactions/:id/approve` | Admin | Approve high-value |
| PUT | `/api/admin/transactions/:id/reject` | Admin | Reject pending |
| PUT | `/api/admin/accounts/:id/block` | Admin | Freeze account |
| PUT | `/api/admin/accounts/:id/unblock` | Admin | Unfreeze account |
| GET | `/api/admin/customers` | Admin | All customers |
| GET | `/api/admin/accounts` | Admin | All accounts |

---

## Troubleshooting

### "Can't connect to MySQL"
- Ensure MySQL service is running: `net start MySQL80` (Windows) or `sudo systemctl start mysql` (Linux)
- Verify credentials in `backend/.env`

### "Port 5000 already in use"
```bash
# Windows
netstat -ano | findstr :5000
taskkill /PID <pid> /F

# macOS / Linux
lsof -ti:5000 | xargs kill
```

### "ERROR 1005 (HY000): Can't create table" during migration
- You may have already run the migration. Check: `DESCRIBE transactions;` — if `flagged` column exists, skip `migration_admin.sql`.

### Python script: "No PaySim CSV found"
- Ensure the CSV is in `database/raw_data/` and named `paysim.csv` (or `PS_20174392719_1491204439457_log.csv`)

### Frontend shows blank page
- Check browser console for errors
- Ensure backend is running on port 5000
- Check `frontend/vite.config.js` proxy target

---

## For Antigravity — Automated Setup Prompt

Copy and paste this entire prompt into Antigravity to set up and run the system automatically on any machine:

```
Please read the file INSTRUCTIONS.md in the root of this project carefully and then perform the following setup steps exactly:

1. Check if Node.js (≥18), MySQL 8, and Python (≥3.9) are installed.
2. Set up the MySQL database: run database/schema.sql, then database/migration_admin.sql, then database/seed.sql. My MySQL root password is: [YOUR_MYSQL_ROOT_PASSWORD]
3. Create the backend/.env file with the correct DB credentials and JWT secret.
4. Run npm install in the backend/ directory.
5. Run npm install in the frontend/ directory.
6. If I have placed a PaySim CSV in database/raw_data/, set up the Python venv in database/venv/, install pandas and bcrypt, run generate_realistic_seed.py, and load the output realistic_seed.sql into MySQL.
7. Start the backend server (npm run dev in backend/) and the frontend server (npm run dev in frontend/).
8. Verify everything is working by hitting http://localhost:5000/api/health and opening http://localhost:5173.
```
