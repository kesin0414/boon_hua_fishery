from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from typing import Optional, List
import json
import os

import firebase_admin
from firebase_admin import credentials, firestore

# 1. Initialize FastAPI
app = FastAPI(title="Boon Hua Fishery API")

# 2. Set up CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], 
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 3. Initialize Firebase Connection (optional for /recipes/suggest; required for /inventory)
db = None


def _init_firebase():
    global db
    cred = None
    raw_json = os.getenv("FIREBASE_CREDENTIALS_JSON", "").strip()
    if raw_json:
        cred = credentials.Certificate(json.loads(raw_json))
    elif os.path.isfile("firebase_credentials.json"):
        cred = credentials.Certificate("firebase_credentials.json")

    if cred is None:
        print("WARN: No Firebase credentials — inventory API disabled; recipes still work.")
        return

    if not firebase_admin._apps:
        firebase_admin.initialize_app(cred)
    db = firestore.client()
    print("SUCCESS: Connected to Firebase Firestore!")


try:
    _init_firebase()
except Exception as e:
    print(f"ERROR: Could not connect to Firebase. {e}")
    db = None


def _require_db():
    if db is None:
        raise HTTPException(
            status_code=503,
            detail="Firebase is not configured on this server. Set FIREBASE_CREDENTIALS_JSON in Render.",
        )

# 4. Define the Data Model for a Seafood Item
class SeafoodItem(BaseModel):
    species: str = Field(..., examples=["Red Snapper"])
    category: Optional[str] = Field(default="Seafood", examples=["Fish"])
    price: float = Field(..., examples=[28.5])
    weight: float = Field(..., examples=[12.0])
    status: Optional[str] = "In Stock"
    image_url: Optional[str] = ""

    @classmethod
    def from_legacy_payload(cls, payload: dict):
        return cls(
            species=payload.get("species") or payload.get("name"),
            category=payload.get("category", "Seafood"),
            price=payload.get("price") or payload.get("price_per_kg"),
            weight=payload.get("weight") or payload.get("stock_kg"),
            status=payload.get("status", "In Stock"),
            image_url=payload.get("image_url", ""),
        )


INVENTORY_COLLECTION = "inventory"


class FreezerRecipeItem(BaseModel):
    species: str
    stockKg: float
    daysRemaining: int


class RecipeRequest(BaseModel):
    items: List[FreezerRecipeItem]


class ChatMessage(BaseModel):
    role: str = Field(..., examples=["user"])
    content: str


class RecipeChatRequest(BaseModel):
    message: str = Field(..., min_length=1, max_length=2000)
    items: List[FreezerRecipeItem] = []
    history: List[ChatMessage] = []

# --- API ROUTES ---

@app.get("/")
def read_root():
    from ai_recipe_service import ai_recipes_enabled

    return {
        "status": "Online",
        "message": "Boon Hua Fishery API is running",
        "firebase": db is not None,
        "aiRecipes": ai_recipes_enabled(),
        "aiStatus": "/recipes/ai-status",
        "docs": "/docs",
    }


@app.get("/health")
def health():
    return {"ok": True, "firebase": db is not None}

# CREATE: Add a new seafood item
@app.post("/inventory")
def add_item(payload: dict):
    _require_db()
    try:
        item = SeafoodItem.from_legacy_payload(payload)
        doc_ref = db.collection(INVENTORY_COLLECTION).document()
        doc_ref.set(item.model_dump())
        return {"message": f"Successfully added {item.species}", "id": doc_ref.id}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# READ: Get all seafood items
@app.get("/inventory")
def get_inventory():
    _require_db()
    try:
        items = []
        docs = db.collection(INVENTORY_COLLECTION).stream()
        for doc in docs:
            data = doc.to_dict()
            data["id"] = doc.id # Include the Firestore document ID
            items.append(data)
        return {"inventory": items}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# UPDATE: Change price or stock
@app.put("/inventory/{item_id}")
def update_item(item_id: str, payload: dict):
    _require_db()
    try:
        item = SeafoodItem.from_legacy_payload(payload)
        doc_ref = db.collection(INVENTORY_COLLECTION).document(item_id)
        if not doc_ref.get().exists:
            raise HTTPException(status_code=404, detail="Item not found")
        
        doc_ref.update(item.model_dump())
        return {"message": f"Successfully updated {item.species}"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# DELETE: Remove an item
@app.delete("/inventory/{item_id}")
def delete_item(item_id: str):
    _require_db()
    try:
        doc_ref = db.collection(INVENTORY_COLLECTION).document(item_id)
        if not doc_ref.get().exists:
            raise HTTPException(status_code=404, detail="Item not found")
            
        doc_ref.delete()
        return {"message": "Item deleted successfully"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/recipes/ai-status")
def recipe_ai_status():
    from ai_recipe_service import ai_recipes_enabled

    return {
        "enabled": ai_recipes_enabled(),
        "provider": _ai_provider_label(),
    }


def _ai_provider_label() -> str:
    if os.getenv("GEMINI_API_KEY", "").strip():
        return "gemini"
    if os.getenv("OPENAI_API_KEY", "").strip():
        return "openai"
    return "none"


@app.post("/recipes/suggest")
def suggest_recipes(request: RecipeRequest):
    try:
        if not request.items:
            return {"recipes": [], "source": "none"}

        recipes, source = _suggest_recipes_combined(request.items)
        return {"recipes": recipes, "source": source}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/recipes/chat")
def recipe_chat(request: RecipeChatRequest):
    from ai_recipe_service import chat_recipes_with_ai, ai_recipes_enabled

    if not ai_recipes_enabled():
        raise HTTPException(
            status_code=503,
            detail="AI recipe assistant is not configured. Set GEMINI_API_KEY or OPENAI_API_KEY on the server.",
        )
    try:
        history = [
            {"role": m.role, "content": m.content}
            for m in request.history
            if m.role in ("user", "assistant") and m.content.strip()
        ]
        result = chat_recipes_with_ai(request.message, request.items, history)
        return result
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


def _suggest_recipes_combined(items: List[FreezerRecipeItem]):
    from ai_recipe_service import suggest_recipes_with_ai, ai_recipes_enabled
    from themealdb_service import suggest_meals_for_freezer_items

    if ai_recipes_enabled():
        ai_recipes = suggest_recipes_with_ai(items, max_recipes=6)
        if ai_recipes:
            return ai_recipes, "ai"

    themealdb_recipes = suggest_meals_for_freezer_items(items, max_recipes=8)
    if themealdb_recipes:
        return themealdb_recipes, "themealdb"

    local_recipes = _suggest_recipes_locally(items)
    for recipe in local_recipes:
        recipe["source"] = "local"
    return local_recipes, "local"


@app.get("/recipes/database")
def list_recipe_database():
    """Expose the built-in recipe catalog for clients."""
    from recipes_data import RECIPE_CATALOG

    return {"recipes": RECIPE_CATALOG}


def _match_catalog_recipes(species: str, days_remaining: int):
    from recipes_data import RECIPE_CATALOG

    name = species.lower()
    matched = []
    for recipe in RECIPE_CATALOG:
        if any(keyword in name for keyword in recipe["keywords"]):
            prefix = "Use soon: " if days_remaining <= 3 else ""
            matched.append({
                "id": recipe["id"],
                "basedOn": species,
                "title": f"{prefix}{recipe['title']}",
                "minutes": recipe["minutes"],
                "difficulty": recipe["difficulty"],
                "imageTag": recipe.get("image_tag", "fish"),
                "imageUrl": None,
                "source": "local",
                "ingredients": recipe.get("ingredients", []),
                "steps": recipe["steps"],
            })
    return matched


def _suggest_recipes_locally(items: List[FreezerRecipeItem]):
    if not items:
        return []

    seen_ids = set()
    recipes = []
    sorted_items = sorted(items, key=lambda x: x.daysRemaining)

    for item in sorted_items:
        for recipe in _match_catalog_recipes(item.species, item.daysRemaining):
            recipe_id = recipe["id"]
            if recipe_id in seen_ids:
                continue
            seen_ids.add(recipe_id)
            recipes.append(recipe)
            if len(recipes) >= 6:
                return recipes

    if recipes:
        return recipes

    item = sorted_items[0]
    urgency = "Use-Soon" if item.daysRemaining <= 3 else "Fresh"
    return [{
        "id": "fallback-seafood",
        "basedOn": item.species,
        "title": f"{urgency} {item.species} with Garlic Ginger Sauce",
        "minutes": 15 if item.daysRemaining <= 3 else 25,
        "difficulty": "Easy",
        "imageTag": "fish",
        "imageUrl": None,
        "source": "local",
        "ingredients": [
            item.species,
            "Garlic (minced)",
            "Fresh ginger",
            "Light soy sauce",
            "Cooking oil",
            "Salt & white pepper",
        ],
        "steps": [
            f"Pat {item.species} dry and season lightly.",
            "Pan-fry with garlic, ginger, soy sauce, and a little oil.",
            "Serve hot with rice or vegetables.",
        ],
    }]
