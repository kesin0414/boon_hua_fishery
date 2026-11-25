"""Reference seafood catalog — Malaysian wet-market species with guide prices (RM/kg)."""

from __future__ import annotations

from typing import TypedDict


class SeafoodEntry(TypedDict):
    name: str
    keywords: list[str]
    price_per_kg: float
    icon_key: str


SEAFOOD_CATALOG: list[SeafoodEntry] = [
    {"name": "Peeled Tiger Prawn XL (大虎虾)", "keywords": ["tiger prawn", "prawn", "udang", "shrimp"], "price_per_kg": 116.0, "icon_key": "prawn"},
    {"name": "Local Chinese Pomfret (上斗鲳)", "keywords": ["pomfret", "chinese pomfret", "dou chang"], "price_per_kg": 125.0, "icon_key": "fish"},
    {"name": "Tiger Prawn XL (大虎虾)", "keywords": ["tiger prawn", "prawn", "udang", "shrimp"], "price_per_kg": 62.0, "icon_key": "prawn"},
    {"name": "Giant Black Pomfret (大黑鲳)", "keywords": ["pomfret", "black pomfret"], "price_per_kg": 45.0, "icon_key": "fish"},
    {"name": "Dragon Tiger Grouper (龙虎班)", "keywords": ["grouper", "dragon tiger", "long hu ban"], "price_per_kg": 88.0, "icon_key": "fish"},
    {"name": "Blue-spotted Sting Ray (蒲鱼)", "keywords": ["stingray", "sting ray", "pari", "ikan pari"], "price_per_kg": 18.0, "icon_key": "fish"},
    {"name": "Chinese Herring / Ikan Beliak Mata", "keywords": ["herring", "beliak", "mata"], "price_per_kg": 28.0, "icon_key": "fish"},
    {"name": "Deep Sea Snapper (上红皂)", "keywords": ["snapper", "deep sea"], "price_per_kg": 75.0, "icon_key": "fish"},
    {"name": "Dragon Tiger Grouper Fillet (龙虎班)", "keywords": ["grouper", "fillet", "dragon tiger"], "price_per_kg": 145.0, "icon_key": "fish"},
    {"name": "Duskytail Grouper / Kerapu (石斑魚)", "keywords": ["grouper", "kerapu", "seabass"], "price_per_kg": 75.0, "icon_key": "fish"},
    {"name": "Fourfinger Threadfin Medium (Senangin)", "keywords": ["threadfin", "senangin", "ma yau"], "price_per_kg": 29.0, "icon_key": "fish"},
    {"name": "Fourfinger Threadfin Small (Senangin)", "keywords": ["threadfin", "senangin", "ma yau"], "price_per_kg": 20.0, "icon_key": "fish"},
    {"name": "Fourfinger Threadfin (上午)", "keywords": ["threadfin", "senangin", "ma yau"], "price_per_kg": 45.0, "icon_key": "fish"},
    {"name": "Giant Dragon Tiger Grouper (大龙虎班)", "keywords": ["grouper", "dragon tiger"], "price_per_kg": 75.0, "icon_key": "fish"},
    {"name": "Golden Pomfret (銀鲳)", "keywords": ["pomfret", "golden pomfret"], "price_per_kg": 48.0, "icon_key": "fish"},
    {"name": "Golden Snapper (红皂)", "keywords": ["snapper", "golden snapper"], "price_per_kg": 48.0, "icon_key": "fish"},
    {"name": "Golden Snapper Fillet", "keywords": ["snapper", "fillet"], "price_per_kg": 98.0, "icon_key": "fish"},
    {"name": "Hardtail Scad / Cencaru", "keywords": ["scad", "cencaru", "ikan kembung"], "price_per_kg": 12.0, "icon_key": "fish"},
    {"name": "Indian Threadfin / Kurau (順丰)", "keywords": ["threadfin", "kurau", "senangin"], "price_per_kg": 95.0, "icon_key": "fish"},
    {"name": "Baby Cuttlefish / Sotong Katak (目仔)", "keywords": ["cuttlefish", "sotong katak", "baby cuttlefish"], "price_per_kg": 19.0, "icon_key": "squid"},
    {"name": "Bamboo Razor Clams (竹滩)", "keywords": ["razor clam", "bamboo clam", "clam"], "price_per_kg": 21.0, "icon_key": "shellfish"},
    {"name": "Cuttlefish / Sotong Katak (大目)", "keywords": ["cuttlefish", "sotong katak", "sotong"], "price_per_kg": 39.0, "icon_key": "squid"},
    {"name": "Female Flower Crab (女花蟹)", "keywords": ["flower crab", "crab", "ketam"], "price_per_kg": 45.0, "icon_key": "crab"},
    {"name": "Flower Crab (大市)", "keywords": ["flower crab", "crab", "ketam"], "price_per_kg": 49.0, "icon_key": "crab"},
    {"name": "LIVE Blood Cockle / Siham", "keywords": ["cockle", "siham", "blood cockle", "shellfish"], "price_per_kg": 27.0, "icon_key": "shellfish"},
    {"name": "LIVE Hard Shell Clams / Kepah", "keywords": ["clam", "kepah", "hard shell", "shellfish"], "price_per_kg": 21.0, "icon_key": "shellfish"},
    {"name": "LIVE Local Mud Crab L (螃蟹)", "keywords": ["mud crab", "crab", "ketam"], "price_per_kg": 95.0, "icon_key": "crab"},
    {"name": "Rainbow Prawns", "keywords": ["rainbow prawn", "prawn", "udang", "shrimp"], "price_per_kg": 32.0, "icon_key": "prawn"},
    {"name": "Red Big Prawn L (红大虾)", "keywords": ["red prawn", "prawn", "udang", "shrimp"], "price_per_kg": 68.0, "icon_key": "prawn"},
    {"name": "Red Big Prawn XL (红大虾)", "keywords": ["red prawn", "prawn", "udang", "shrimp"], "price_per_kg": 75.0, "icon_key": "prawn"},
    {"name": "Squid M / Sotong Putih (沙中)", "keywords": ["squid", "sotong putih", "sotong"], "price_per_kg": 49.0, "icon_key": "squid"},
    {"name": "Super Big Red Prawn (特大虾)", "keywords": ["red prawn", "prawn", "udang", "shrimp"], "price_per_kg": 90.0, "icon_key": "prawn"},
    {"name": "[FROZEN] Dragon Tiger Grouper (龙虎班)", "keywords": ["grouper", "dragon tiger", "frozen"], "price_per_kg": 78.0, "icon_key": "fish"},
    {"name": "Octopus", "keywords": ["octopus", "sotong kurak"], "price_per_kg": 20.0, "icon_key": "squid"},
    {"name": "Stingray", "keywords": ["stingray", "pari"], "price_per_kg": 18.0, "icon_key": "fish"},
    {"name": "Salmon", "keywords": ["salmon"], "price_per_kg": 85.0, "icon_key": "fish"},
    {"name": "Tilapia", "keywords": ["tilapia", "ikan"], "price_per_kg": 15.0, "icon_key": "fish"},
    {"name": "Mackerel / Kembung", "keywords": ["mackerel", "kembung", "selar"], "price_per_kg": 14.0, "icon_key": "fish"},
    {"name": "Squid / Sotong", "keywords": ["squid", "sotong", "cuttlefish"], "price_per_kg": 28.0, "icon_key": "squid"},
    {"name": "Crab / Ketam", "keywords": ["crab", "ketam"], "price_per_kg": 55.0, "icon_key": "crab"},
    {"name": "Clam / Lala", "keywords": ["clam", "lala", "mussel", "shellfish"], "price_per_kg": 18.0, "icon_key": "shellfish"},
]


def catalog_ocr_hints() -> list[str]:
    hints: set[str] = set()
    for entry in SEAFOOD_CATALOG:
        hints.update(entry["keywords"])
        for part in entry["name"].lower().split():
            cleaned = "".join(ch for ch in part if ch.isalpha())
            if len(cleaned) > 2:
                hints.add(cleaned)
    return sorted(hints)


def find_catalog_entry(species: str) -> SeafoodEntry | None:
    key = (species or "").strip().lower()
    for entry in SEAFOOD_CATALOG:
        if entry["name"].lower() == key:
            return entry
    return None
