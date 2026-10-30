#!/usr/bin/env python3
"""
generate_beneficiaries.py
=========================
Reads existing customers and accounts from mini_banking,
then generates 3-4 beneficiaries per customer as a SQL file.

Each customer gets 3-4 *other* accounts saved as beneficiaries
with realistic nicknames. A UNIQUE constraint on (customer_id, account_id)
means we must never repeat the same pair.

Usage (from the database/ directory):
  python generate_beneficiaries.py
Then load:
  mysql -u root -pYOUR_PASSWORD mini_banking < beneficiaries_seed.sql
"""

import os
import sys
import random
import datetime

# ── DB connection (uses env vars if set, else prompts) ─────────────────────────
try:
    import mysql.connector
except ImportError:
    print("ERROR: mysql-connector-python not installed.")
    print("  Run: pip install mysql-connector-python")
    sys.exit(1)

SCRIPT_DIR  = os.path.dirname(os.path.abspath(__file__))
OUTPUT_PATH = os.path.join(SCRIPT_DIR, "beneficiaries_seed.sql")

DB_CONFIG = {
    "host":     os.environ.get("DB_HOST",     "localhost"),
    "port":     int(os.environ.get("DB_PORT", 3306)),
    "user":     os.environ.get("DB_USER",     "root"),
    "password": os.environ.get("DB_PASSWORD", "Anu@1234"),
    "database": os.environ.get("DB_NAME",     "mini_banking"),
}

# Realistic nickname pool
NICKNAMES = [
    "Savings Account", "Emergency Fund", "Business Account",
    "Mom's Account",   "Dad's Account",   "Spouse Account",
    "Friend's Transfer","Rent Payment",   "Salary Account",
    "Investment Fund",  "Side Income",    "Joint Account",
    "Travel Fund",      "Medical Reserve","Education Fund",
    "Vendor Payment",   "Office Expenses","Family Account",
    "Backup Account",   "Daily Expenses",
]

BATCH = 1000  # rows per INSERT statement

def main():
    print("[1/4] Connecting to MySQL ...")
    try:
        conn   = mysql.connector.connect(**DB_CONFIG)
        cursor = conn.cursor()
    except Exception as e:
        print(f"ERROR: Could not connect to MySQL: {e}")
        print("  Set DB_USER / DB_PASSWORD / DB_HOST env vars if needed.")
        sys.exit(1)

    print("[2/4] Loading customers and accounts ...")
    cursor.execute(
        "SELECT id, customer_id FROM accounts WHERE status = 'ACTIVE' ORDER BY id"
    )
    account_rows = cursor.fetchall()          # [(acc_id, cust_id), ...]
    cursor.close()
    conn.close()

    # Build lookup maps
    # customer -> their own account id(s)
    cust_to_acc = {}                          # cust_id -> [acc_id, ...]
    all_acc_ids = []
    for acc_id, cust_id in account_rows:
        cust_to_acc.setdefault(cust_id, []).append(acc_id)
        all_acc_ids.append(acc_id)

    customers = list(cust_to_acc.keys())
    random.seed(42)                           # reproducible output
    random.shuffle(all_acc_ids)              # shuffle pool once

    print(f"      {len(customers):,} customers | {len(all_acc_ids):,} accounts")

    # ── Generate beneficiary pairs ─────────────────────────────────────────────
    print("[3/4] Generating 3-4 beneficiaries per customer ...")
    rows      = []          # (customer_id, account_id, nickname, created_at)
    seen      = set()       # (customer_id, account_id) already used

    for cust_id in customers:
        own_accs  = set(cust_to_acc[cust_id])
        # candidate accounts: not owned by this customer
        candidates = [a for a in all_acc_ids if a not in own_accs]
        n_benes    = random.randint(3, 4)
        chosen     = random.sample(candidates, min(n_benes, len(candidates)))

        used_nicks = []
        for acc_id in chosen:
            pair = (cust_id, acc_id)
            if pair in seen:
                continue
            seen.add(pair)

            nick = random.choice([n for n in NICKNAMES if n not in used_nicks] or NICKNAMES)
            used_nicks.append(nick)

            days_ago = random.randint(1, 180)
            created  = (datetime.datetime.now() - datetime.timedelta(days=days_ago)).strftime(
                "%Y-%m-%d %H:%M:%S"
            )
            rows.append((cust_id, acc_id, nick, created))

    print(f"      Generated {len(rows):,} beneficiary pairs.")

    # ── Write SQL ──────────────────────────────────────────────────────────────
    print("[4/4] Writing SQL file ...")
    ts = datetime.datetime.now().isoformat()

    lines = [
        "-- ============================================================",
        "-- beneficiaries_seed.sql",
        f"-- Generated at : {ts}",
        f"-- Total rows   : {len(rows):,}",
        "-- ============================================================",
        "",
        "USE mini_banking;",
        "",
        "-- Clear existing beneficiaries (safe re-run)",
        "TRUNCATE TABLE beneficiaries;",
        "",
    ]

    for i in range(0, len(rows), BATCH):
        batch = rows[i : i + BATCH]
        vals  = []
        for cust_id, acc_id, nick, created in batch:
            safe_nick = nick.replace("'", "\\'")
            vals.append(f"({cust_id}, {acc_id}, '{safe_nick}', '{created}')")
        lines.append(
            "INSERT INTO beneficiaries (customer_id, account_id, nickname, created_at) VALUES"
        )
        lines.append("  " + ",\n  ".join(vals) + ";")
        lines.append("")

    lines += [
        f"-- Done: {len(rows):,} beneficiaries across {len(customers):,} customers.",
        "",
    ]

    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))

    size_kb = os.path.getsize(OUTPUT_PATH) / 1024
    print(f"\n  Done!  Written to: {OUTPUT_PATH}")
    print(f"  File size: {size_kb:.1f} KB")
    print(f"  Total beneficiaries: {len(rows):,}")
    print(f"\n  Load into MySQL:")
    print(f'    mysql -u root -pYOUR_PASSWORD mini_banking < "{OUTPUT_PATH}"')


if __name__ == "__main__":
    main()
