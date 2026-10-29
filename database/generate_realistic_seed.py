#!/usr/bin/env python3
"""
generate_realistic_seed.py
===========================
Reads the PaySim financial fraud dataset (first 5,000 rows) from
  database/raw_data/PS_20174392719_1491204439457_log.csv
and generates a realistic_seed.sql file that populates the
mini_banking schema WITHOUT changing schema.sql.

Requirements:
  pip install pandas bcrypt

Usage (from project root):
  cd "database"
  python generate_realistic_seed.py

Output:
  database/realistic_seed.sql
"""

import os
import sys
import uuid
import random
import hashlib
import datetime
import pandas as pd

# â”€â”€ Try to import bcrypt â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
try:
    import bcrypt
except ImportError:
    print("ERROR: 'bcrypt' is not installed.")
    print("Run:  pip install bcrypt")
    sys.exit(1)

# â”€â”€ Configuration â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
SCRIPT_DIR   = os.path.dirname(os.path.abspath(__file__))
# Auto-detect CSV filename in raw_data/
_RAW_DIR = os.path.join(SCRIPT_DIR, "raw_data")
_CANDIDATES = [
    "PS_20174392719_1491204439457_log.csv",
    "paysim.csv",
    "paysim1.csv",
    "PaySim.csv",
]
CSV_PATH = None
for _c in _CANDIDATES:
    _p = os.path.join(_RAW_DIR, _c)
    if os.path.exists(_p):
        CSV_PATH = _p
        break
# Fallback: first .csv found in raw_data/
if CSV_PATH is None and os.path.isdir(_RAW_DIR):
    for _f in os.listdir(_RAW_DIR):
        if _f.lower().endswith(".csv"):
            CSV_PATH = os.path.join(_RAW_DIR, _f)
            break
OUTPUT_PATH  = os.path.join(SCRIPT_DIR, "realistic_seed.sql")
MAX_ROWS     = 5000          # Process at most this many CSV rows
MAX_CUSTOMERS = 200          # Cap on distinct customers extracted

ADMIN_EMAIL    = "admin@minibank.com"
ADMIN_PASSWORD = "admin123"
CUST_PASSWORD  = "password123"

# PaySim type â†’ our ENUM mapping
TYPE_MAP = {
    "CASH_IN":   "DEPOSIT",
    "CASH_OUT":  "WITHDRAWAL",
    "DEBIT":     "WITHDRAWAL",
    "PAYMENT":   "WITHDRAWAL",
    "TRANSFER":  "TRANSFER",
}

# â”€â”€ Password hashing â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
def hash_password(plain: str) -> str:
    return bcrypt.hashpw(plain.encode("utf-8"), bcrypt.gensalt(rounds=10)).decode("utf-8")

# â”€â”€ SQL escaping â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
def esc(s):
    if s is None:
        return "NULL"
    return "'" + str(s).replace("\\", "\\\\").replace("'", "\\'") + "'"

# â”€â”€ Account number generator â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
def make_account_number(idx: int) -> str:
    return f"ACC{1000000000 + idx:010d}"

# â”€â”€ Phone number generator (dummy) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
def make_phone(idx: int) -> str:
    return f"+91{9000000000 + idx}"

# â”€â”€ Main â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
def main():
    # â”€â”€ 1. Load CSV â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    if not CSV_PATH or not os.path.exists(CSV_PATH):
        print(f"\n  ERROR: No PaySim CSV found in:\n    {_RAW_DIR}\n")
        print("  Please download the PaySim dataset and place it in:\n    database/raw_data/")
        print("  Dataset: https://www.kaggle.com/datasets/ealaxi/paysim1\n")
        sys.exit(1)
    print(f"      Using CSV: {os.path.basename(CSV_PATH)}  ({os.path.getsize(CSV_PATH)/1024/1024:.1f} MB)")

    print(f"[1/6] Reading CSV (first {MAX_ROWS} rows)â€¦")
    df = pd.read_csv(CSV_PATH, nrows=MAX_ROWS)
    print(f"      Loaded {len(df):,} rows. Columns: {list(df.columns)}")

    # â”€â”€ 2. Normalize column names â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    df.columns = [c.strip().lower() for c in df.columns]

    # Detect originator / destination column names (PaySim uses nameOrig / nameDest)
    orig_col = next((c for c in df.columns if "nameorig" in c or "orig" in c), None)
    dest_col = next((c for c in df.columns if "namedest" in c or "dest" in c), None)
    type_col = next((c for c in df.columns if c == "type"), None)
    amt_col  = next((c for c in df.columns if "amount" in c), None)
    bal_orig_col = next((c for c in df.columns if "newbalanceorig" in c), None)

    if not all([orig_col, dest_col, type_col, amt_col]):
        print(f"ERROR: Could not identify required columns. Found: {list(df.columns)}")
        sys.exit(1)

    print(f"      Columns mapped â†’ type={type_col}, orig={orig_col}, dest={dest_col}, amount={amt_col}")

    # â”€â”€ 3. Build unique customer/account sets â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    print("[2/6] Extracting unique actorsâ€¦")
    # Only keep rows with mappable types
    df_mapped = df[df[type_col].isin(TYPE_MAP.keys())].copy()
    df_mapped["our_type"] = df_mapped[type_col].map(TYPE_MAP)

    # Gather unique actor names
    all_actors = set(df_mapped[orig_col].dropna().unique()) | set(df_mapped[dest_col].dropna().unique())
    # Keep only those that look like accounts (C... or M...)
    all_actors = {a for a in all_actors if str(a).startswith(("C", "M"))}
    actors = sorted(all_actors)[:MAX_CUSTOMERS]
    print(f"      Found {len(all_actors):,} unique actors, using first {len(actors)}.")

    # â”€â”€ 4. Build lookup dicts â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    # actor_name â†’ customer_id (1-based, admin is id=1)
    actor_to_cid  = {name: idx + 2 for idx, name in enumerate(actors)}  # admin gets id=1
    actor_to_aid  = {name: idx + 1 for idx, name in enumerate(actors)}  # account_id 1-based

    # â”€â”€ 5. Gather transaction rows â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    print("[3/6] Mapping transactionsâ€¦")
    txn_rows = []
    used_keys = set()
    txn_id = 1

    for _, row in df_mapped.iterrows():
        orig = str(row[orig_col])
        dest = str(row[dest_col])
        our_type = row["our_type"]
        amount = round(float(row[amt_col]), 2)
        if amount <= 0:
            continue

        orig_aid = actor_to_aid.get(orig)
        dest_aid = actor_to_aid.get(dest)

        if our_type == "DEPOSIT":
            if dest_aid is None:
                continue
            from_aid, to_aid = None, dest_aid
        elif our_type == "WITHDRAWAL":
            if orig_aid is None:
                continue
            from_aid, to_aid = orig_aid, None
        elif our_type == "TRANSFER":
            if orig_aid is None or dest_aid is None:
                continue
            if orig_aid == dest_aid:
                continue
            from_aid, to_aid = orig_aid, dest_aid
        else:
            continue

        ikey = str(uuid.uuid4())
        while ikey in used_keys:
            ikey = str(uuid.uuid4())
        used_keys.add(ikey)

        # Random created_at in last 12 months
        days_ago = random.randint(1, 365)
        created_at = (datetime.datetime.now() - datetime.timedelta(days=days_ago)).strftime("%Y-%m-%d %H:%M:%S")

        txn_rows.append((from_aid, to_aid, amount, our_type, ikey, created_at, txn_id))
        txn_id += 1

    print(f"      Mapped {len(txn_rows):,} valid transactions.")

    # â”€â”€ 6. Hash passwords â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    print("[4/6] Hashing passwords (this takes a few seconds)â€¦")
    admin_hash = hash_password(ADMIN_PASSWORD)
    cust_hash  = hash_password(CUST_PASSWORD)
    print("      Passwords hashed.")

    # â”€â”€ 7. Compute approximate balances â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    print("[5/6] Computing account balancesâ€¦")
    balance = {}  # aid â†’ running balance
    for aid in actor_to_aid.values():
        balance[aid] = round(random.uniform(5000, 100000), 2)  # Starting balance

    for (from_aid, to_aid, amount, our_type, ikey, created_at, txn_id_) in txn_rows:
        if our_type == "DEPOSIT" and to_aid:
            balance[to_aid] = balance.get(to_aid, 0) + amount
        elif our_type == "WITHDRAWAL" and from_aid:
            bal = balance.get(from_aid, amount)
            balance[from_aid] = max(0, bal - amount)
        elif our_type == "TRANSFER" and from_aid and to_aid:
            bal = balance.get(from_aid, amount)
            balance[from_aid] = max(0, bal - amount)
            balance[to_aid] = balance.get(to_aid, 0) + amount

    # â”€â”€ 8. Write SQL â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    print("[6/6] Writing SQL fileâ€¦")
    lines = []

    lines.append("-- ============================================================")
    lines.append("-- realistic_seed.sql  â€” Generated from PaySim dataset")
    lines.append(f"-- Generated at: {datetime.datetime.now().isoformat()}")
    lines.append(f"-- Source rows processed: {len(df):,} (capped at {MAX_ROWS})")
    lines.append(f"-- Customers: {len(actors) + 1}  Accounts: {len(actors)}  Transactions: {len(txn_rows):,}")
    lines.append("-- ============================================================")
    lines.append("")
    lines.append("USE mini_banking;")
    lines.append("")
    lines.append("-- â”€â”€ Clear existing data â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€")
    lines.append("SET FOREIGN_KEY_CHECKS = 0;")
    lines.append("TRUNCATE TABLE audit_logs;")
    lines.append("TRUNCATE TABLE otp_verifications;")
    lines.append("TRUNCATE TABLE beneficiaries;")
    lines.append("TRUNCATE TABLE transactions;")
    lines.append("TRUNCATE TABLE accounts;")
    lines.append("TRUNCATE TABLE customers;")
    lines.append("SET FOREIGN_KEY_CHECKS = 1;")
    lines.append("")

    # â”€â”€ Customers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    lines.append("-- â”€â”€ Customers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€")
    BATCH = 200

    cust_values = []
    # Admin
    cust_values.append(
        f"(1, 'System Admin', {esc(ADMIN_EMAIL)}, '+919999999999', {esc(admin_hash)}, 'ADMIN', NOW())"
    )
    # Customers
    for name, cid in actor_to_cid.items():
        display_name = f"Customer {name[:8]}"
        email = f"user_{name[:8].lower()}@paysim.test"
        phone = make_phone(cid)
        cust_values.append(
            f"({cid}, {esc(display_name)}, {esc(email)}, {esc(phone)}, {esc(cust_hash)}, 'CUSTOMER', NOW())"
        )

    for i in range(0, len(cust_values), BATCH):
        batch = cust_values[i:i+BATCH]
        lines.append("INSERT INTO customers (id, name, email, phone, password_hash, role, created_at) VALUES")
        lines.append("  " + ",\n  ".join(batch) + ";")
        lines.append("")

    # â”€â”€ Accounts â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    lines.append("-- â”€â”€ Accounts â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€")
    acc_values = []
    for name, aid in actor_to_aid.items():
        cid = actor_to_cid[name]
        acc_num = make_account_number(aid)
        acc_type = random.choice(["SAVINGS", "SAVINGS", "CURRENT"])  # 2:1 savings
        bal = round(max(0, balance.get(aid, 10000)), 2)
        acc_values.append(
            f"({aid}, {cid}, {esc(acc_num)}, '{acc_type}', {bal}, 'ACTIVE', 0, NOW())"
        )

    for i in range(0, len(acc_values), BATCH):
        batch = acc_values[i:i+BATCH]
        lines.append("INSERT INTO accounts (id, customer_id, account_number, account_type, balance, status, version, created_at) VALUES")
        lines.append("  " + ",\n  ".join(batch) + ";")
        lines.append("")

    # â”€â”€ Transactions â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    lines.append("-- â”€â”€ Transactions â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€")
    txn_values = []
    audit_values = []

    for (from_aid, to_aid, amount, our_type, ikey, created_at, txn_id_val) in txn_rows:
        fa = esc(from_aid) if from_aid else "NULL"
        ta = esc(to_aid)   if to_aid   else "NULL"
        txn_values.append(
            f"({txn_id_val}, {fa}, {ta}, {amount}, '{our_type}', 'SUCCESS', {esc(ikey)}, '{created_at}')"
        )
        event = "DEPOSIT_SUCCESS" if our_type == "DEPOSIT" else ("WITHDRAWAL_SUCCESS" if our_type == "WITHDRAWAL" else "TRANSFER_SUCCESS")
        meta = f'{{"amount": {amount}, "type": "{our_type}"}}'
        audit_values.append(
            f"({txn_id_val}, {txn_id_val}, '{event}', '{meta}', '{created_at}')"
        )

    TXN_BATCH = 500
    for i in range(0, len(txn_values), TXN_BATCH):
        batch = txn_values[i:i+TXN_BATCH]
        lines.append("INSERT INTO transactions (id, from_account_id, to_account_id, amount, transaction_type, status, idempotency_key, created_at) VALUES")
        lines.append("  " + ",\n  ".join(batch) + ";")
        lines.append("")

    # â”€â”€ Audit logs â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    lines.append("-- â”€â”€ Audit Logs â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€")
    for i in range(0, len(audit_values), TXN_BATCH):
        batch = audit_values[i:i+TXN_BATCH]
        lines.append("INSERT INTO audit_logs (id, transaction_id, event, metadata, created_at) VALUES")
        lines.append("  " + ",\n  ".join(batch) + ";")
        lines.append("")

    lines.append("-- â”€â”€ Done â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€")
    lines.append(f"-- Inserted: {len(cust_values)} customers, {len(acc_values)} accounts,")
    lines.append(f"--           {len(txn_values)} transactions, {len(audit_values)} audit logs.")
    lines.append("")

    sql_content = "\n".join(lines)
    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        f.write(sql_content)

    size_kb = os.path.getsize(OUTPUT_PATH) / 1024
    print(f"\nâœ... Done! Written to: {OUTPUT_PATH}")
    print(f"   File size: {size_kb:.1f} KB")
    print(f"   Customers: {len(cust_values)}")
    print(f"   Accounts:  {len(acc_values)}")
    print(f"   Transactions: {len(txn_values):,}")
    print(f"   Audit logs:   {len(audit_values):,}")
    print(f"\nRun with MySQL:")
    print(f'  mysql -u root -p mini_banking < "{OUTPUT_PATH}"')


if __name__ == "__main__":
    main()

