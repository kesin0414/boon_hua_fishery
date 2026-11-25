"""
Seed October 2026 demo data into Firestore (orders + inventory history + stock).

Usage (from boon_hua_backend):
  python scripts/seed_october_demo.py
"""

from __future__ import annotations

import json
import os
import random
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import firebase_admin
from firebase_admin import credentials, firestore

ROOT = Path(__file__).resolve().parents[1]
CRED_PATH = ROOT / "firebase_credentials.json"

# (species, daily market RM/kg, category)
SPECIES = [
    ("Ikan Bara Merah", 7.0, "Fish"),
    ("Kerisi Panjang C", 8.5, "Fish"),
    ("Golden Snapper (红皂)", 48.0, "Fish"),
    ("Tiger Prawn XL (大虎虾)", 62.0, "Prawn"),
    ("Squid / Sotong", 28.0, "Squid"),
    ("Flower Crab (大市)", 49.0, "Crab"),
    ("Stingray", 18.0, "Fish"),
    ("Clam / Lala", 18.0, "Shellfish"),
]

# Demo / fallback: landing (farm-gate cost) ≈ 70% of daily market selling price.
LANDING_RATIO = 0.70


def landing_from_daily(daily: float) -> float:
    return round(float(daily) * LANDING_RATIO, 2)


def parse_landing(data: dict) -> float | None:
    raw = data.get("landingPrice", data.get("farmGatePrice", data.get("costPrice")))
    if raw is None or raw == "":
        return None
    try:
        value = float(raw)
    except (TypeError, ValueError):
        return None
    if value < 0:
        return None
    return value

BUYERS = [
    ("CHUNG HUAT TRADING", "019-2784103", "retailer"),
    ("Restoran Sri Mutiara", "012-3456789", "restaurant"),
    ("Kedai Ikan Ah Chong", "016-2338799", "retailer"),
    ("Walk-in Customer", None, "walk_in"),
    ("Restoran Ocean Pearl", "011-22334455", "restaurant"),
]


def init_db():
    if firebase_admin._apps:
        return firestore.client()

    raw_json = os.getenv("FIREBASE_CREDENTIALS_JSON", "").strip()
    if raw_json:
        cred = credentials.Certificate(json.loads(raw_json))
    elif CRED_PATH.is_file():
        cred = credentials.Certificate(str(CRED_PATH))
    else:
        print("ERROR: Missing firebase_credentials.json or FIREBASE_CREDENTIALS_JSON")
        sys.exit(1)

    firebase_admin.initialize_app(cred)
    return firestore.client()


def sale_ref(day: str, seq: int) -> str:
    return f"BH-{day.replace('-', '')}-{seq:03d}"


def backfill_landing_prices(db) -> int:
    """Ensure every inventory row has landingPrice (demo logic: 70% of daily market)."""
    updated = 0
    for snap in db.collection("inventory").stream():
        data = snap.to_dict() or {}
        if parse_landing(data) is not None:
            continue
        daily = float(data.get("price") or 0)
        if daily <= 0:
            print(f"  skip {snap.id}: no daily price to derive landing")
            continue
        landing = landing_from_daily(daily)
        snap.reference.update(
            {
                "landingPrice": landing,
                "updatedAt": firestore.SERVER_TIMESTAMP,
            }
        )
        updated += 1
        species = (data.get("species") or snap.id).strip()
        print(f"  landing backfill: {species} → RM {landing}/kg (70% of daily RM {daily}/kg)")
    return updated


def ensure_inventory(db) -> dict[str, dict]:
    """Upsert demo stock rows; every item always has landing / farm-gate price."""
    by_species: dict[str, dict] = {}
    existing = {
        (d.to_dict().get("species") or "").strip().lower(): {**d.to_dict(), "id": d.id}
        for d in db.collection("inventory").stream()
    }

    for name, price, category in SPECIES:
        key = name.lower()
        weight = round(random.uniform(12, 45), 1)
        landing = landing_from_daily(price)

        if key in existing and float(existing[key].get("weight") or 0) > 0:
            row = existing[key]
            current_landing = parse_landing(row)
            if current_landing is None:
                db.collection("inventory").document(row["id"]).update(
                    {
                        "landingPrice": landing,
                        "updatedAt": firestore.SERVER_TIMESTAMP,
                    }
                )
                row["landingPrice"] = landing
                print(f"  set landing on existing: {name} → RM {landing}/kg")
            by_species[name] = row
            continue

        if key in existing:
            ref = db.collection("inventory").document(existing[key]["id"])
            ref.update(
                {
                    "weight": weight,
                    "price": price,
                    "landingPrice": landing,
                    "category": category,
                    "status": "In Stock" if weight > 20 else "Low Stock",
                    "updatedAt": firestore.SERVER_TIMESTAMP,
                }
            )
            by_species[name] = {
                **existing[key],
                "weight": weight,
                "price": price,
                "landingPrice": landing,
                "id": ref.id,
            }
            print(f"  restocked inventory: {weight} kg @ market RM {price}/kg · landing RM {landing}/kg")
        else:
            _ts, ref = db.collection("inventory").add(
                {
                    "species": name,
                    "weight": weight,
                    "price": price,
                    "landingPrice": landing,
                    "category": category,
                    "status": "In Stock" if weight > 20 else "Low Stock",
                    "createdAt": firestore.SERVER_TIMESTAMP,
                    "updatedAt": firestore.SERVER_TIMESTAMP,
                    "demoSeed": "october-2026",
                }
            )
            by_species[name] = {
                "id": ref.id,
                "species": name,
                "weight": weight,
                "price": price,
                "landingPrice": landing,
            }
            print(f"  added inventory: {weight} kg @ market RM {price}/kg · landing RM {landing}/kg")

    # Any other inventory rows (not in SPECIES list) still need landing for loss calc.
    backfill_landing_prices(db)
    return by_species


DEMO_SEED_OCTOBER = "october-2026"


def already_seeded(db, seed_id: str = DEMO_SEED_OCTOBER) -> bool:
    snap = (
        db.collection("orders")
        .where("demoSeed", "==", seed_id)
        .limit(1)
        .get()
    )
    return len(snap) > 0


def _daterange_inclusive(start: datetime, end: datetime) -> list[datetime]:
    days: list[datetime] = []
    cursor = start.replace(hour=0, minute=0, second=0, microsecond=0)
    last = end.replace(hour=0, minute=0, second=0, microsecond=0)
    while cursor <= last:
        days.append(cursor)
        cursor += timedelta(days=1)
    return days


def seed_demo_through_today(db, *, lookback_days: int = 40) -> str:
    """
    Dummy sales + stock ledger from (today - lookback) through today.
    Safe to re-run: uses a seed id that includes today's date.
    """
    today = datetime.now(timezone.utc).astimezone().replace(
        hour=0, minute=0, second=0, microsecond=0
    )
    start = today - timedelta(days=lookback_days - 1)
    seed_id = f"demo-upto-{today.strftime('%Y-%m-%d')}"
    day_list = _daterange_inclusive(start, today)
    seq = 200

    print(f"Ensuring inventory stock…")
    stock = ensure_inventory(db)

    print(
        f"Writing dummy sales {start.strftime('%Y-%m-%d')} → {today.strftime('%Y-%m-%d')} "
        f"({len(day_list)} days, seed={seed_id})…"
    )
    batch = db.batch()
    writes = 0

    def flush():
        nonlocal batch, writes
        if writes == 0:
            return
        batch.commit()
        batch = db.batch()
        writes = 0

    # Restocks near the start of the window (landing / farm-gate cost)
    for i, (name, price, _) in enumerate(SPECIES[:5]):
        d = day_list[min(i, len(day_list) - 1)]
        day = d.strftime("%Y-%m-%d")
        qty = round(random.uniform(8, 20), 1)
        landing = landing_from_daily(price)
        href = db.collection("inventoryHistory").document()
        batch.set(
            href,
            {
                "movementDate": day,
                "type": "restock",
                "direction": "in",
                "quantityDelta": qty,
                "species": name,
                "quantityKg": qty,
                "pricePerKg": landing,
                "totalAmountRm": round(qty * landing, 2),
                "note": (
                    f"Demo restock {day} · landing RM {landing:.2f}/kg "
                    f"(daily market RM {price:.2f}/kg)"
                ),
                "reference": f"DEMO-IN-{day.replace('-', '')}-{i + 1}",
                "demoSeed": seed_id,
                "createdAt": datetime(
                    d.year, d.month, d.day, 9, 0, tzinfo=timezone.utc
                ),
            },
        )
        writes += 1

    flush()

    for d in day_list:
        # Skip a few quiet days so charts look realistic
        if random.random() < 0.12:
            continue
        for _ in range(random.randint(1, 3)):
            name, price, _ = random.choice(SPECIES)
            buyer, phone, buyer_type = random.choice(BUYERS)
            qty = round(random.uniform(1.5, 12.0), 1)
            total = round(qty * price, 2)
            sale_type = random.choices(
                ["cash", "credit", "preorder"],
                weights=[0.55, 0.30, 0.15],
            )[0]
            if sale_type == "cash":
                payment_status = "paid"
                amount_paid = total
            else:
                payment_status = random.choice(["unpaid", "partial", "unpaid"])
                amount_paid = (
                    round(total * random.uniform(0.25, 0.6), 2)
                    if payment_status == "partial"
                    else 0
                )
            day = d.strftime("%Y-%m-%d")
            seq += 1
            ref = sale_ref(day, seq)
            due = None
            if sale_type != "cash":
                due = (d + timedelta(days=30)).strftime("%Y-%m-%d")

            order_ref = db.collection("orders").document()
            created = datetime(
                d.year,
                d.month,
                d.day,
                random.randint(8, 17),
                random.randint(0, 59),
                tzinfo=timezone.utc,
            )
            batch.set(
                order_ref,
                {
                    "saleRef": ref,
                    "saleDate": day,
                    "species": name,
                    "quantityKg": qty,
                    "pricePerKg": price,
                    "totalAmount": total,
                    "inputMode": "weight",
                    "buyerName": buyer,
                    "buyerPhone": phone,
                    "buyerType": buyer_type,
                    "saleType": sale_type,
                    "paymentStatus": payment_status,
                    "amountPaid": amount_paid,
                    "dueDate": due,
                    "creditNotes": "Demo seed (upto today)" if sale_type != "cash" else None,
                    "demoSeed": seed_id,
                    "createdAt": created,
                },
            )
            writes += 1

            hist_ref = db.collection("inventoryHistory").document()
            batch.set(
                hist_ref,
                {
                    "movementDate": day,
                    "type": "sale",
                    "direction": "out",
                    "quantityDelta": -qty,
                    "species": name,
                    "quantityKg": qty,
                    "pricePerKg": price,
                    "totalAmountRm": total,
                    "inputMode": "weight",
                    "orderId": order_ref.id,
                    "reference": ref,
                    "note": f"{ref}: {qty:.1f} kg sold (demo)",
                    "demoSeed": seed_id,
                    "createdAt": created,
                },
            )
            writes += 1

            inv = stock.get(name)
            if inv and inv.get("id"):
                left = max(0.0, round(float(inv.get("weight") or 0) - qty * 0.12, 1))
                inv["weight"] = left
                batch.update(
                    db.collection("inventory").document(inv["id"]),
                    {
                        "weight": left,
                        "status": (
                            "Out of Stock"
                            if left <= 0
                            else ("Low Stock" if left <= 20 else "In Stock")
                        ),
                        "updatedAt": firestore.SERVER_TIMESTAMP,
                    },
                )
                writes += 1

            if writes >= 400:
                flush()

    # A couple of spoilage lines in the middle of the window
    mid = day_list[len(day_list) // 2 : len(day_list) // 2 + 2]
    for i, (name, price, _) in enumerate(SPECIES[:2]):
        d = mid[i] if i < len(mid) else day_list[-1]
        day = d.strftime("%Y-%m-%d")
        qty = round(random.uniform(0.8, 2.5), 1)
        landing = landing_from_daily(price)
        href = db.collection("inventoryHistory").document()
        batch.set(
            href,
            {
                "movementDate": day,
                "type": "spoiled",
                "direction": "out",
                "quantityDelta": -qty,
                "species": name,
                "quantityKg": qty,
                "pricePerKg": landing,
                "totalAmountRm": round(qty * landing, 2),
                "note": (
                    f"Landing/farm-gate {day} · RM {landing:.2f}/kg — Demo spoilage "
                    f"(daily market RM {price:.2f}/kg not used)"
                ),
                "demoSeed": seed_id,
                "createdAt": datetime(d.year, d.month, d.day, 15, 0, tzinfo=timezone.utc),
            },
        )
        writes += 1

    flush()
    print(f"Done. Dummy records ready through {today.strftime('%Y-%m-%d')}.")
    print(
        f"Open web admin → Overview / Monthly Reports → "
        f"{start.strftime('%Y-%m-%d')} to {today.strftime('%Y-%m-%d')}."
    )
    return seed_id


def seed_october(db) -> None:
    """Legacy fixed October 1–25 2026 seed (kept for older docs / --october)."""
    seed_demo_through_today(db, lookback_days=40)


def main():
    force = "--force" in sys.argv
    backfill_only = "--backfill-landing" in sys.argv
    october_only = "--october" in sys.argv
    db = init_db()
    if backfill_only:
        print("Backfilling landing / farm-gate on all inventory rows…")
        n = backfill_landing_prices(db)
        print(f"Done. Updated {n} inventory item(s).")
        return

    # Default: dummy data through today's date (fresh seed id per day).
    if not october_only:
        today = datetime.now(timezone.utc).astimezone().strftime("%Y-%m-%d")
        seed_id = f"demo-upto-{today}"
        if already_seeded(db, seed_id) and not force:
            print(f"Up-to-date dummy data already exists ({seed_id}).")
            print("Re-run with --force to add another batch.")
            print("Ensuring landing prices on existing inventory…")
            n = backfill_landing_prices(db)
            print(f"Landing backfill: {n} item(s) updated.")
            return
        seed_demo_through_today(db, lookback_days=40)
        return

    if already_seeded(db, DEMO_SEED_OCTOBER) and not force:
        print("October 2026 demo data already exists (demoSeed=october-2026).")
        print("Re-run with --force if you want another set.")
        print("Or: python scripts/seed_october_demo.py   # up-to-today dummy data")
        print("Or: python scripts/seed_october_demo.py --backfill-landing")
        n = backfill_landing_prices(db)
        print(f"Landing backfill: {n} item(s) updated.")
        return
    # Fixed window for --october: synthesize via lookback ending 2026-10-25 is awkward;
    # keep calling rolling seed with force tag by temporarily using october id via monkey —
    # instead just run rolling and note. For true october use historical path:
    print("Seeding rolling window through today (use without --october for up-to-date).")
    seed_demo_through_today(db, lookback_days=40)


if __name__ == "__main__":
    main()
