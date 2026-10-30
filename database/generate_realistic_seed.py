#!/usr/bin/env python3
"""
generate_realistic_seed.py
==========================
Reads the PaySim financial fraud dataset from database/raw_data/
and generates realistic_seed.sql.

Changes vs previous version:
  - Processes exactly 50,000 rows (MAX_ROWS = 50000)
  - Pre-computes ONE bcrypt hash per password and reuses it for all
    customers (avoids running bcrypt thousands of times)
  - Raises MAX_CUSTOMERS cap to 2000
  - All other logic (schema mapping, balance calc, idempotency UUIDs)
    is unchanged.

Requirements:
  pip install pandas bcrypt

Usage (from database/ directory):
  python generate_realistic_seed.py
"""

import os
import sys
import uuid
import random
import datetime
import pandas as pd

try:
    import bcrypt
except ImportError:
    print("ERROR: 'bcrypt' not installed.  Run:  pip install bcrypt")
    sys.exit(1)

# ── Configuration ──────────────────────────────────────────────────────────────
SCRIPT_DIR    = os.path.dirname(os.path.abspath(__file__))
OUTPUT_PATH   = os.path.join(SCRIPT_DIR, "realistic_seed.sql")
MAX_ROWS      = 50_000       # CSV rows to read
MAX_CUSTOMERS = 2_000        # Unique actors to materialise as customers

ADMIN_EMAIL    = "admin@minibank.com"
ADMIN_PASSWORD = "admin123"
CUST_PASSWORD  = "password123"

# PaySim type  ->  our ENUM
TYPE_MAP = {
    "CASH_IN":   "DEPOSIT",
    "CASH_OUT":  "WITHDRAWAL",
    "DEBIT":     "WITHDRAWAL",
    "PAYMENT":   "WITHDRAWAL",
    "TRANSFER":  "TRANSFER",
}

# ── Auto-detect CSV ────────────────────────────────────────────────────────────
_RAW_DIR    = os.path.join(SCRIPT_DIR, "raw_data")
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
if CSV_PATH is None and os.path.isdir(_RAW_DIR):
    for _f in os.listdir(_RAW_DIR):
        if _f.lower().endswith(".csv"):
            CSV_PATH = os.path.join(_RAW_DIR, _f)
            break

# ── Helpers ────────────────────────────────────────────────────────────────────
def esc(s):
    """MySQL-safe single-quoted string, or NULL."""
    if s is None:
        return "NULL"
    return "'" + str(s).replace("\\", "\\\\").replace("'", "\\'") + "'"

def make_account_number(idx: int) -> str:
    return f"ACC{1000000000 + idx:010d}"

def make_phone(idx: int) -> str:
    return f"+91{9000000000 + idx}"

def make_email(name: str) -> str:
    return f"user_{name.lower()}@paysim.test"

def make_display_name(name: str) -> str:
    return f"Customer {name}"

# ── Main ───────────────────────────────────────────────────────────────────────
def main():
    # 1. Validate CSV
    if not CSV_PATH or not os.path.exists(CSV_PATH):
        print(f"\n  ERROR: No PaySim CSV found in: {_RAW_DIR}")
        print("  Download from https://www.kaggle.com/datasets/ealaxi/paysim1")
        sys.exit(1)
    print(f"[1/7] CSV detected: {os.path.basename(CSV_PATH)}  "
          f"({os.path.getsize(CSV_PATH)/1024/1024:.1f} MB)")

    # 2. Read CSV
    print(f"[2/7] Reading first {MAX_ROWS:,} rows ...")
    df = pd.read_csv(CSV_PATH, nrows=MAX_ROWS)
    df.columns = [c.strip().lower() for c in df.columns]
    print(f"      Loaded {len(df):,} rows | columns: {list(df.columns)}")

    # Identify columns
    orig_col = next((c for c in df.columns if "nameorig" in c or c == "nameorig"), None)
    dest_col = next((c for c in df.columns if "namedest" in c or c == "namedest"), None)
    type_col = next((c for c in df.columns if c == "type"), None)
    amt_col  = next((c for c in df.columns if "amount" in c), None)
    if not all([orig_col, dest_col, type_col, amt_col]):
        print(f"ERROR: Could not find required columns. Found: {list(df.columns)}")
        sys.exit(1)
    print(f"      Mapped -> type={type_col}, orig={orig_col}, "
          f"dest={dest_col}, amount={amt_col}")

    # 3. Extract actors
    print("[3/7] Extracting unique actors ...")
    df_mapped = df[df[type_col].isin(TYPE_MAP.keys())].copy()
    df_mapped["our_type"] = df_mapped[type_col].map(TYPE_MAP)

    all_actors = (
        set(df_mapped[orig_col].dropna().unique()) |
        set(df_mapped[dest_col].dropna().unique())
    )
    all_actors = {a for a in all_actors if str(a).startswith(("C", "M"))}
    actors = sorted(all_actors)[:MAX_CUSTOMERS]
    print(f"      Total unique actors: {len(all_actors):,} | using first {len(actors):,}")

    actor_to_cid = {name: idx + 2 for idx, name in enumerate(actors)}  # admin = 1
    actor_to_aid = {name: idx + 1 for idx, name in enumerate(actors)}

    # 4. Map transactions
    print("[4/7] Mapping transactions ...")
    txn_rows   = []
    used_keys  = set()
    txn_id_seq = 1

    for _, row in df_mapped.iterrows():
        orig     = str(row[orig_col])
        dest     = str(row[dest_col])
        our_type = row["our_type"]
        amount   = round(float(row[amt_col]), 2)
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
            if orig_aid is None or dest_aid is None or orig_aid == dest_aid:
                continue
            from_aid, to_aid = orig_aid, dest_aid
        else:
            continue

        ikey = str(uuid.uuid4())
        while ikey in used_keys:
            ikey = str(uuid.uuid4())
        used_keys.add(ikey)

        days_ago   = random.randint(1, 365)
        created_at = (
            datetime.datetime.now() - datetime.timedelta(days=days_ago)
        ).strftime("%Y-%m-%d %H:%M:%S")

        txn_rows.append((from_aid, to_aid, amount, our_type, ikey, created_at, txn_id_seq))
        txn_id_seq += 1

    print(f"      Mapped {len(txn_rows):,} valid transactions.")

    # 5. Hash passwords — compute ONCE, reuse for all inserts
    print("[5/7] Hashing passwords (computed once, reused for all customers) ...")
    admin_hash = bcrypt.hashpw(ADMIN_PASSWORD.encode(), bcrypt.gensalt(rounds=10)).decode()
    cust_hash  = bcrypt.hashpw(CUST_PASSWORD.encode(),  bcrypt.gensalt(rounds=10)).decode()
    print("      Passwords hashed.")

    # 6. Compute balances
    print("[6/7] Computing running account balances ...")
    balance = {aid: round(random.uniform(5_000, 100_000), 2) for aid in actor_to_aid.values()}
    for (from_aid, to_aid, amount, our_type, *_) in txn_rows:
        if our_type == "DEPOSIT" and to_aid:
            balance[to_aid] = balance.get(to_aid, 0) + amount
        elif our_type == "WITHDRAWAL" and from_aid:
            balance[from_aid] = max(0, balance.get(from_aid, amount) - amount)
        elif our_type == "TRANSFER" and from_aid and to_aid:
            balance[from_aid] = max(0, balance.get(from_aid, amount) - amount)
            balance[to_aid]   = balance.get(to_aid, 0) + amount

    # 7. Write SQL
    print("[7/7] Writing SQL file ...")
    lines = []
    ts = datetime.datetime.now().isoformat()

    lines += [
        "-- ============================================================",
        "-- realistic_seed.sql  --  Generated from PaySim dataset",
        f"-- Generated at : {ts}",
        f"-- CSV rows read: {MAX_ROWS:,}",
        f"-- Customers    : {len(actors) + 1}  (1 admin + {len(actors)} customers)",
        f"-- Accounts     : {len(actors)}",
        f"-- Transactions : {len(txn_rows):,}",
        "-- ============================================================",
        "",
        "USE mini_banking;",
        "",
        "-- Clear existing data",
        "SET FOREIGN_KEY_CHECKS = 0;",
        "TRUNCATE TABLE audit_logs;",
        "TRUNCATE TABLE otp_verifications;",
        "TRUNCATE TABLE beneficiaries;",
        "TRUNCATE TABLE transactions;",
        "TRUNCATE TABLE accounts;",
        "TRUNCATE TABLE customers;",
        "SET FOREIGN_KEY_CHECKS = 1;",
        "",
    ]

    # ── Customers ──────────────────────────────────────────────────────────────
    lines.append("-- Customers")
    BATCH = 500

    cust_vals = [
        f"(1, 'System Admin', {esc(ADMIN_EMAIL)}, '+919999999999', "
        f"{esc(admin_hash)}, 'ADMIN', NOW())"
    ]
    for name, cid in actor_to_cid.items():
        cust_vals.append(
            f"({cid}, {esc(make_display_name(name))}, {esc(make_email(name))}, "
            f"{esc(make_phone(cid))}, {esc(cust_hash)}, 'CUSTOMER', NOW())"
        )

    for i in range(0, len(cust_vals), BATCH):
        batch = cust_vals[i : i + BATCH]
        lines.append(
            "INSERT INTO customers "
            "(id, name, email, phone, password_hash, role, created_at) VALUES"
        )
        lines.append("  " + ",\n  ".join(batch) + ";")
        lines.append("")

    # ── Accounts ──────────────────────────────────────────────────────────────
    lines.append("-- Accounts")
    acc_vals = []
    for name, aid in actor_to_aid.items():
        cid      = actor_to_cid[name]
        acc_num  = make_account_number(aid)
        acc_type = random.choice(["SAVINGS", "SAVINGS", "CURRENT"])
        bal      = round(max(0, balance.get(aid, 10_000)), 2)
        acc_vals.append(
            f"({aid}, {cid}, {esc(acc_num)}, '{acc_type}', {bal}, "
            f"'ACTIVE', 0, NOW())"
        )

    for i in range(0, len(acc_vals), BATCH):
        batch = acc_vals[i : i + BATCH]
        lines.append(
            "INSERT INTO accounts "
            "(id, customer_id, account_number, account_type, balance, "
            "status, version, created_at) VALUES"
        )
        lines.append("  " + ",\n  ".join(batch) + ";")
        lines.append("")

    # ── Transactions ──────────────────────────────────────────────────────────
    lines.append("-- Transactions")
    TXN_BATCH = 1_000
    txn_vals   = []
    audit_vals = []

    for (from_aid, to_aid, amount, our_type, ikey, created_at, tid) in txn_rows:
        fa = str(from_aid) if from_aid is not None else "NULL"
        ta = str(to_aid)   if to_aid   is not None else "NULL"
        txn_vals.append(
            f"({tid}, {fa}, {ta}, {amount}, '{our_type}', 'SUCCESS', "
            f"{esc(ikey)}, '{created_at}')"
        )
        event = {
            "DEPOSIT":    "DEPOSIT_SUCCESS",
            "WITHDRAWAL": "WITHDRAWAL_SUCCESS",
            "TRANSFER":   "TRANSFER_SUCCESS",
        }[our_type]
        meta = esc(f'{{"amount": {amount}, "type": "{our_type}"}}')
        audit_vals.append(f"({tid}, {tid}, '{event}', {meta}, '{created_at}')")

    for i in range(0, len(txn_vals), TXN_BATCH):
        batch = txn_vals[i : i + TXN_BATCH]
        lines.append(
            "INSERT INTO transactions "
            "(id, from_account_id, to_account_id, amount, transaction_type, "
            "status, idempotency_key, created_at) VALUES"
        )
        lines.append("  " + ",\n  ".join(batch) + ";")
        lines.append("")

    # ── Audit logs ────────────────────────────────────────────────────────────
    lines.append("-- Audit Logs")
    for i in range(0, len(audit_vals), TXN_BATCH):
        batch = audit_vals[i : i + TXN_BATCH]
        lines.append(
            "INSERT INTO audit_logs "
            "(id, transaction_id, event, metadata, created_at) VALUES"
        )
        lines.append("  " + ",\n  ".join(batch) + ";")
        lines.append("")

    lines += [
        "-- Done",
        f"-- Customers  : {len(cust_vals):,}",
        f"-- Accounts   : {len(acc_vals):,}",
        f"-- Transactions: {len(txn_vals):,}",
        f"-- Audit logs : {len(audit_vals):,}",
        "",
    ]

    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))

    size_mb = os.path.getsize(OUTPUT_PATH) / 1024 / 1024
    print(f"\nDone!  Written to: {OUTPUT_PATH}")
    print(f"   File size    : {size_mb:.1f} MB")
    print(f"   Customers    : {len(cust_vals):,}")
    print(f"   Accounts     : {len(acc_vals):,}")
    print(f"   Transactions : {len(txn_vals):,}")
    print(f"   Audit logs   : {len(audit_vals):,}")
    print(f"\nLoad into MySQL (Windows PowerShell):")
    print(f'   Get-Content "{OUTPUT_PATH}" | '
          f'& "C:\\Program Files\\MySQL\\MySQL Server 8.0\\bin\\mysql.exe" '
          f'-u root -pYOUR_PASSWORD mini_banking')
    print(f"\nLoad into MySQL (macOS / Linux):")
    print(f'   mysql -u root -pYOUR_PASSWORD mini_banking < "{OUTPUT_PATH}"')


if __name__ == "__main__":
    main()
