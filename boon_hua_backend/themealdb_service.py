"""TheMealDB integration — https://www.themealdb.com/api/json/v1/1/"""

from __future__ import annotations

import json
import re
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, List, Optional

THEMEALDB_BASE = "https://www.themealdb.com/api/json/v1/1"

# Map freezer species text to TheMealDB ingredient filter terms.
INGREDIENT_ALIASES: dict[str, list[str]] = {
    "salmon": ["salmon"],
    "tuna": ["tuna"],
    "prawn": ["prawn", "shrimp"],
    "shrimp": ["prawn", "shrimp"],
    "udang": ["prawn", "shrimp"],
    "crab": ["crab"],
    "ketam": ["crab"],
    "squid": ["squid"],
    "sotong": ["squid"],
    "fish": ["fish", "cod", "bass"],
    "cod": ["cod"],
    "bass": ["bass"],
    "mackerel": ["mackerel", "fish"],
    "tilapia": ["fish"],
    "ikan": ["fish"],
    "clam": ["clam"],
    "mussel": ["mussel"],
    "lobster": ["lobster"],
    "scallop": ["scallop"],
    "anchovy": ["anchovy"],
}


def _get_json(path: str) -> dict[str, Any]:
    url = f"{THEMEALDB_BASE}/{path}"
    request = urllib.request.Request(url, headers={"User-Agent": "BoonHuaFishery/1.0"})
    with urllib.request.urlopen(request, timeout=12) as response:
        return json.loads(response.read().decode("utf-8"))


def extract_ingredient_terms(species: str) -> list[str]:
    """Return ingredient search terms for a freezer item label."""
    lower = species.lower()
    terms: list[str] = []

    for ingredient, keywords in INGREDIENT_ALIASES.items():
        if any(keyword in lower for keyword in keywords):
            if ingredient not in terms:
                terms.append(ingredient)

    if not terms:
        words = re.findall(r"[a-z]{4,}", lower)
        skip = {"fresh", "frozen", "large", "small", "whole", "fillet", "piece"}
        for word in reversed(words):
            if word not in skip:
                terms.append(word)
                break

    return terms[:2]


def _extract_meal_ingredients(meal: dict[str, Any]) -> list[str]:
    """TheMealDB stores up to 20 ingredients with optional measures."""
    items: list[str] = []
    for index in range(1, 21):
        ingredient = (meal.get(f"strIngredient{index}") or "").strip()
        if not ingredient:
            continue
        measure = (meal.get(f"strMeasure{index}") or "").strip()
        if measure:
            items.append(f"{measure} {ingredient}")
        else:
            items.append(ingredient)
    return items


def _instructions_to_steps(instructions: str) -> list[str]:
    if not instructions:
        return ["Follow the recipe instructions on TheMealDB."]

    lines = [line.strip() for line in re.split(r"[\r\n]+", instructions) if line.strip()]
    if len(lines) >= 2:
        return lines[:12]

    sentences = [s.strip() for s in re.split(r"(?<=[.!?])\s+", instructions) if s.strip()]
    return sentences[:10] if sentences else [instructions.strip()]


def _lookup_meal(meal_id: str) -> Optional[dict[str, Any]]:
    try:
        data = _get_json(f"lookup.php?i={urllib.parse.quote(meal_id)}")
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError):
        return None

    meals = data.get("meals")
    if not meals:
        return None
    return meals[0]


def _search_by_ingredient(ingredient: str, limit: int = 3) -> list[dict[str, Any]]:
    try:
        data = _get_json(f"filter.php?i={urllib.parse.quote(ingredient)}")
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError):
        return []

    meals = data.get("meals") or []
    return meals[:limit]


def _search_by_name(keyword: str, limit: int = 2) -> list[dict[str, Any]]:
    try:
        data = _get_json(f"search.php?s={urllib.parse.quote(keyword)}")
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError):
        return []

    meals = data.get("meals") or []
    return meals[:limit]


def _meal_to_recipe(meal: dict[str, Any], based_on: str, ingredient_term: str) -> dict[str, Any]:
    meal_id = meal.get("idMeal", "")
    detail = _lookup_meal(meal_id) if meal_id else None
    source = detail or meal

    instructions = source.get("strInstructions") or ""
    category = source.get("strCategory") or "Meal"
    area = source.get("strArea") or ""

    return {
        "id": f"themealdb-{meal_id}",
        "basedOn": based_on,
        "searchKeyword": ingredient_term,
        "title": source.get("strMeal") or meal.get("strMeal") or "Seafood recipe",
        "minutes": 30,
        "difficulty": "Medium",
        "imageTag": _image_tag_for_term(ingredient_term),
        "imageUrl": source.get("strMealThumb") or meal.get("strMealThumb"),
        "category": category,
        "area": area,
        "source": "themealdb",
        "ingredients": _extract_meal_ingredients(source),
        "steps": _instructions_to_steps(instructions),
    }


def _image_tag_for_term(term: str) -> str:
    term = term.lower()
    if term in {"prawn", "shrimp"}:
        return "prawn"
    if term == "crab":
        return "crab"
    if term == "squid":
        return "squid"
    if term in {"clam", "mussel", "scallop"}:
        return "shellfish"
    return "fish"


def suggest_meals_for_freezer_items(items: list[Any], max_recipes: int = 8) -> list[dict[str, Any]]:
    """
    items: objects with .species and .daysRemaining (FreezerRecipeItem from main.py)
    """
    if not items:
        return []

    sorted_items = sorted(items, key=lambda item: item.daysRemaining)
    seen_ids: set[str] = set()
    recipes: list[dict[str, Any]] = []

    for item in sorted_items:
        terms = extract_ingredient_terms(item.species)
        if not terms:
            continue

        for term in terms:
            summary_meals = _search_by_ingredient(term, limit=5)
            if not summary_meals:
                summary_meals = _search_by_name(term, limit=3)

            for summary in summary_meals:
                meal_id = summary.get("idMeal")
                if not meal_id or meal_id in seen_ids:
                    continue

                recipe = _meal_to_recipe(summary, item.species, term)
                seen_ids.add(meal_id)
                recipes.append(recipe)

                if len(recipes) >= max_recipes:
                    return recipes

    return recipes
