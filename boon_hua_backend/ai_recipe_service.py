"""AI recipe suggestions and chat via Google Gemini or OpenAI (server-side keys only)."""

from __future__ import annotations

import json
import os
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, List, Optional

GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-2.0-flash-lite").strip()
GEMINI_MODEL_FALLBACKS = (
    "gemini-2.0-flash-lite",
    "gemini-2.0-flash",
    "gemini-1.5-flash",
)
OPENAI_MODEL = os.getenv("OPENAI_MODEL", "gpt-4o-mini").strip()


def ai_recipes_enabled() -> bool:
    gemini = os.getenv("GEMINI_API_KEY", "").strip()
    openai = os.getenv("OPENAI_API_KEY", "").strip()
    return bool(gemini or openai)


def _is_rate_limit_message(message: str) -> bool:
    lower = message.lower()
    return (
        "429" in lower
        or "too many requests" in lower
        or "rate-limited" in lower
        or "quota" in lower
    )


def _valid_gemini_key(key: str) -> bool:
    """AI Studio may issue legacy AIza… or newer AQ.… keys — both are valid."""
    k = key.strip()
    return k.startswith("AIza") or k.startswith("AQ.")


def _freezer_context(items: list[Any]) -> str:
    if not items:
        return "The user has no items in their virtual freezer yet."
    lines = []
    for item in sorted(items, key=lambda x: x.daysRemaining):
        urgency = "use soon" if item.daysRemaining <= 3 else "fresh"
        lines.append(
            f"- {item.species}: {item.stockKg:.1f} kg, expires in {item.daysRemaining} day(s) ({urgency})"
        )
    return "Virtual freezer inventory:\n" + "\n".join(lines)


def _system_prompt() -> str:
    return (
        "You are Boon Hua Fishery's AI cooking assistant for a Malaysian seafood retailer app. "
        "You ONLY help with recipes, cooking methods, ingredient substitutions, food storage, and "
        "meal ideas using the user's virtual freezer seafood. "
        "Do not answer politics, homework, coding, medical, or general chat. "
        "If asked off-topic, politely say you only help with cooking and seafood meals. "
        "Use mainly seafood they actually have in their freezer list; label any extra pantry items clearly. "
        "Prioritise items expiring soon. Prefer Malaysian/Southeast Asian flavours when appropriate. "
        "Be concise and remind users to cook seafood thoroughly. "
        "Always respond with valid JSON only, no markdown fences."
    )


def _suggest_user_prompt(items: list[Any], max_recipes: int) -> str:
    return (
        f"{_freezer_context(items)}\n\n"
        f"Generate up to {max_recipes} recipe recommendations using mainly their freezer seafood. "
        "Prioritise items with fewer days remaining.\n"
        "Return JSON exactly in this shape:\n"
        '{"recipes":[{"id":"ai-1","basedOn":"species name","title":"Recipe title",'
        '"minutes":25,"difficulty":"Easy|Medium|Hard","ingredients":["..."],'
        '"steps":["step 1","step 2"],"tips":"optional short tip","imageTag":"fish|prawn|crab|squid|shellfish"}]}'
    )


def _chat_user_prompt(message: str, items: list[Any], history: list[dict[str, str]]) -> str:
    hist = ""
    if history:
        hist = "Recent conversation:\n" + "\n".join(
            f"{m['role']}: {m['content']}" for m in history[-8:]
        )
    return (
        f"{_freezer_context(items)}\n\n"
        f"{hist}\n\n"
        f"User question: {message}\n\n"
        "Answer only about cooking, recipes, ingredients, substitutions, cooking time, or seafood storage. "
        "Every recipe must use seafood from their freezer list as the main protein. "
        "If you suggest a complete recipe, include it in the recipes array.\n"
        "Return JSON exactly:\n"
        '{"reply":"your answer in plain text","recipes":[]}\n'
        "recipes array uses the same objects as suggest (id, basedOn, title, minutes, difficulty, "
        "ingredients, steps, tips optional, imageTag). Use empty recipes array if not giving a full recipe."
    )


def _gemini_error_message(exc: urllib.error.HTTPError) -> str:
    body = ""
    try:
        body = exc.read().decode("utf-8", errors="replace")
    except Exception:
        pass
    if exc.code == 429:
        return (
            "AI is temporarily rate-limited (too many requests). "
            "Wait about a minute and try again. On the free Gemini plan, "
            "daily or per-minute quotas are shared across all app users."
        )
    if exc.code in (401, 403):
        return "Gemini API key was rejected. Check GEMINI_API_KEY on the server."
    snippet = body[:180].strip() if body else exc.reason or "unknown error"
    return f"Gemini HTTP {exc.code}: {snippet}"


def _extract_json(text: str) -> dict[str, Any]:
    cleaned = text.strip()
    if cleaned.startswith("```"):
        cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned)
        cleaned = re.sub(r"\s*```$", "", cleaned)
    start = cleaned.find("{")
    end = cleaned.rfind("}")
    if start >= 0 and end > start:
        cleaned = cleaned[start : end + 1]
    return json.loads(cleaned)


def _gemini_models_to_try() -> list[str]:
    ordered: list[str] = []
    for name in (GEMINI_MODEL, *GEMINI_MODEL_FALLBACKS):
        n = name.strip()
        if n and n not in ordered:
            ordered.append(n)
    return ordered


def _call_gemini(prompt: str) -> str:
    api_key = os.getenv("GEMINI_API_KEY", "").strip()
    if not api_key:
        raise RuntimeError("GEMINI_API_KEY not set")
    if not _valid_gemini_key(api_key):
        raise RuntimeError(
            "GEMINI_API_KEY does not look like a Google AI Studio key (expected AIza… or AQ.…)."
        )

    body = {
        "systemInstruction": {"parts": [{"text": _system_prompt()}]},
        "contents": [{"role": "user", "parts": [{"text": prompt}]}],
        "generationConfig": {
            "temperature": 0.65,
            "responseMimeType": "application/json",
        },
    }
    payload = json.dumps(body).encode("utf-8")
    headers = {
        "Content-Type": "application/json",
        "x-goog-api-key": api_key,
    }
    last_error: RuntimeError | None = None

    for model in _gemini_models_to_try():
        url = (
            f"https://generativelanguage.googleapis.com/v1beta/models/"
            f"{model}:generateContent"
        )
        last_http: urllib.error.HTTPError | None = None
        for attempt in range(3):
            request = urllib.request.Request(url, data=payload, headers=headers, method="POST")
            try:
                with urllib.request.urlopen(request, timeout=45) as response:
                    data = json.loads(response.read().decode("utf-8"))
                candidates = data.get("candidates") or []
                if not candidates:
                    raise RuntimeError("Gemini returned no candidates")
                parts = candidates[0].get("content", {}).get("parts") or []
                if not parts:
                    raise RuntimeError("Gemini returned empty content")
                return parts[0].get("text") or ""
            except urllib.error.HTTPError as exc:
                last_http = exc
                if exc.code == 429 and attempt < 2:
                    time.sleep(2 * (attempt + 1))
                    continue
                if exc.code in (404, 400):
                    last_error = RuntimeError(_gemini_error_message(exc))
                    break
                raise RuntimeError(_gemini_error_message(exc)) from exc

        if last_http is not None and last_http.code in (404, 400):
            continue
        if last_http is not None:
            raise RuntimeError(_gemini_error_message(last_http))

    if last_error is not None:
        raise last_error
    raise RuntimeError("Gemini request failed")


def _call_openai(prompt: str) -> str:
    api_key = os.getenv("OPENAI_API_KEY", "").strip()
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY not set")

    url = "https://api.openai.com/v1/chat/completions"
    body = {
        "model": OPENAI_MODEL,
        "temperature": 0.65,
        "response_format": {"type": "json_object"},
        "messages": [
            {"role": "system", "content": _system_prompt()},
            {"role": "user", "content": prompt},
        ],
    }
    request = urllib.request.Request(
        url,
        data=json.dumps(body).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_key}",
        },
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=45) as response:
        data = json.loads(response.read().decode("utf-8"))

    choices = data.get("choices") or []
    if not choices:
        raise RuntimeError("OpenAI returned no choices")
    return choices[0].get("message", {}).get("content") or ""


def ai_provider_name() -> str:
    """Active provider label for /recipes/ai-status."""
    choice = os.getenv("AI_PROVIDER", "auto").strip().lower()
    gemini_key = os.getenv("GEMINI_API_KEY", "").strip()
    openai_key = os.getenv("OPENAI_API_KEY", "").strip()
    if choice == "openai" and openai_key:
        return "openai"
    if choice == "gemini" and gemini_key:
        return "gemini"
    if openai_key:
        return "openai"
    if gemini_key:
        return "gemini"
    return "none"


def _llm_complete(prompt: str) -> str:
    choice = os.getenv("AI_PROVIDER", "auto").strip().lower()
    gemini_key = os.getenv("GEMINI_API_KEY", "").strip()
    openai_key = os.getenv("OPENAI_API_KEY", "").strip()

    if choice == "openai":
        if not openai_key:
            raise RuntimeError("AI_PROVIDER=openai but OPENAI_API_KEY is not set on the server.")
        return _call_openai(prompt)
    if choice == "gemini":
        if not gemini_key:
            raise RuntimeError("AI_PROVIDER=gemini but GEMINI_API_KEY is not set on the server.")
        return _call_gemini(prompt)

    errors: list[str] = []
    if openai_key:
        try:
            return _call_openai(prompt)
        except Exception as exc:
            errors.append(f"OpenAI: {exc}")
    if gemini_key:
        try:
            return _call_gemini(prompt)
        except Exception as exc:
            msg = str(exc)
            errors.append(msg if msg.startswith("AI is temporarily") else f"Gemini: {msg}")

    if not gemini_key and not openai_key:
        raise RuntimeError(
            "No AI API key configured. Set GEMINI_API_KEY or OPENAI_API_KEY on the server."
        )
    raise RuntimeError("; ".join(errors))


_COOKING_TOPIC_WORDS = (
    "cook",
    "recipe",
    "meal",
    "ingredient",
    "fry",
    "steam",
    "bake",
    "grill",
    "boil",
    "stir",
    "sambal",
    "freezer",
    "seafood",
    "fish",
    "prawn",
    "shrimp",
    "crab",
    "squid",
    "salmon",
    "tuna",
    "substitut",
    "marinat",
    "defrost",
    "thaw",
    "expir",
    "store",
    "keep",
    "fresh",
    "eat",
    "dinner",
    "lunch",
    "breakfast",
    "menu",
    "dish",
    "sauce",
    "spice",
    "ikan",
    "udang",
    "ketam",
    "sotong",
)


def _is_cooking_related(message: str) -> bool:
    msg = message.strip().lower()
    if not msg:
        return False
    return any(word in msg for word in _COOKING_TOPIC_WORDS)


def _normalize_recipe(raw: dict[str, Any], index: int) -> dict[str, Any]:
    ingredients = raw.get("ingredients") or []
    steps = raw.get("steps") or []
    if isinstance(ingredients, str):
        ingredients = [ingredients]
    if isinstance(steps, str):
        steps = [steps]

    return {
        "id": raw.get("id") or f"ai-{index + 1}",
        "basedOn": raw.get("basedOn") or "Freezer stock",
        "title": raw.get("title") or "AI Seafood Recipe",
        "minutes": int(raw.get("minutes") or 25),
        "difficulty": raw.get("difficulty") or "Easy",
        "imageTag": raw.get("imageTag") or "fish",
        "imageUrl": raw.get("imageUrl"),
        "source": "ai",
        "ingredients": [str(i).strip() for i in ingredients if str(i).strip()],
        "steps": [str(s).strip() for s in steps if str(s).strip()],
        "tips": raw.get("tips"),
        "searchKeyword": raw.get("searchKeyword"),
    }


def suggest_recipes_with_ai(items: list[Any], max_recipes: int = 6) -> Optional[list[dict[str, Any]]]:
    if not items or not ai_recipes_enabled():
        return None

    try:
        raw_text = _llm_complete(_suggest_user_prompt(items, max_recipes))
        parsed = _extract_json(raw_text)
        recipes_raw = parsed.get("recipes") or []
        if not isinstance(recipes_raw, list):
            return None
        recipes = [
            _normalize_recipe(r, i)
            for i, r in enumerate(recipes_raw[:max_recipes])
            if isinstance(r, dict)
        ]
        return recipes or None
    except (urllib.error.URLError, json.JSONDecodeError, RuntimeError, KeyError, ValueError) as exc:
        print(f"WARN: AI recipe suggest failed: {exc}")
        return None


def chat_recipes_fallback(message: str, items: list[Any]) -> dict[str, Any]:
    """Rule-based chef when LLM quota is exhausted — keeps the app usable."""
    msg = message.strip().lower()
    urgent = sorted(items, key=lambda x: x.daysRemaining) if items else []
    top = urgent[0] if urgent else None

    if not items:
        reply = (
            "Add seafood to your freezer first — then I can suggest meals based on "
            "what you have and what expires soon."
        )
        return {"reply": reply, "recipes": [], "source": "fallback"}

    species_list = ", ".join(f"{i.species} ({i.stockKg:.1f} kg)" for i in urgent[:4])
    use_soon = [i for i in urgent if i.daysRemaining <= 3]
    focus = use_soon[0] if use_soon else top
    focus_name = focus.species if focus else top.species

    if any(w in msg for w in ("substitut", "replace", "instead")):
        reply = (
            f"You have: {species_list}.\n\n"
            f"For {focus_name}, try ginger–soy stir-fry, assam-style stew, or grill with sambal. "
            "Missing an ingredient? Use lime + salt for seafood, or garlic + oyster sauce for depth."
        )
    elif any(w in msg for w in ("quick", "fast", "easy", "tonight", "simple")):
        reply = (
            f"Fast idea using {focus_name} ({focus.stockKg:.1f} kg, "
            f"{focus.daysRemaining} day(s) left): pat dry, pan-fry 3–4 min per side, "
            "finish with soy sauce, ginger, and spring onion. Serve with rice.\n\n"
            f"Also in your freezer: {species_list}."
        )
    else:
        reply = (
            f"Based on your freezer ({species_list}), cook {focus_name} soon "
            f"({focus.daysRemaining} day(s) remaining).\n\n"
            "Suggested approach: marinate 10 min (soy, ginger, white pepper), then stir-fry or "
            "steam until opaque. Use items marked ≤3 days first to reduce waste."
        )

    recipes: list[dict[str, Any]] = []
    if focus and not any(w in msg for w in ("substitut", "replace")):
        recipes.append(
            _normalize_recipe(
                {
                    "id": "fallback-1",
                    "basedOn": focus.species,
                    "title": f"Quick {focus.species} with ginger soy",
                    "minutes": 20,
                    "difficulty": "Easy",
                    "ingredients": [
                        focus.species,
                        "Garlic & ginger",
                        "Light soy sauce",
                        "Cooking oil",
                        "Rice (optional)",
                    ],
                    "steps": [
                        f"Prep {focus.species} — clean and pat dry.",
                        "Stir-fry garlic and ginger, add seafood, cook through.",
                        "Add soy sauce, toss, serve hot.",
                    ],
                    "tips": "Cook seafood until opaque in the thickest part.",
                    "imageTag": "fish",
                },
                0,
            )
        )

    return {"reply": reply, "recipes": recipes, "source": "fallback"}


def chat_recipes_with_ai(
    message: str,
    items: list[Any],
    history: Optional[list[dict[str, str]]] = None,
) -> dict[str, Any]:
    if not ai_recipes_enabled():
        raise RuntimeError(
            "AI recipe assistant is not configured. Set GEMINI_API_KEY or OPENAI_API_KEY on the server."
        )

    cleaned = message.strip()
    if not _is_cooking_related(cleaned):
        return {
            "reply": (
                "I can only help with recipes and cooking — especially seafood from your virtual freezer. "
                "Try asking what to cook tonight, how to prepare an item, or ingredient substitutions."
            ),
            "recipes": [],
            "source": "policy",
        }

    prompt = _chat_user_prompt(cleaned, items, history or [])
    try:
        raw_text = _llm_complete(prompt)
    except RuntimeError as exc:
        if _is_rate_limit_message(str(exc)):
            print(f"WARN: LLM rate-limited, using fallback chef: {exc}")
            return chat_recipes_fallback(message, items)
        raise

    try:
        parsed = _extract_json(raw_text)
    except (json.JSONDecodeError, ValueError) as exc:
        print(f"WARN: AI JSON parse failed, using fallback: {exc}")
        return chat_recipes_fallback(message, items)

    reply = str(parsed.get("reply") or "").strip()
    if not reply:
        reply = "I could not generate a response. Please try asking again."

    recipes_raw = parsed.get("recipes") or []
    recipes: list[dict[str, Any]] = []
    if isinstance(recipes_raw, list):
        recipes = [
            _normalize_recipe(r, i)
            for i, r in enumerate(recipes_raw[:4])
            if isinstance(r, dict)
        ]

    return {"reply": reply, "recipes": recipes, "source": "ai"}
