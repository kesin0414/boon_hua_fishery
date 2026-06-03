"""AI recipe suggestions and chat via Google Gemini or OpenAI (server-side keys only)."""

from __future__ import annotations

import json
import os
import re
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, List, Optional

GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-2.0-flash").strip()
OPENAI_MODEL = os.getenv("OPENAI_MODEL", "gpt-4o-mini").strip()


def ai_recipes_enabled() -> bool:
    return bool(os.getenv("GEMINI_API_KEY", "").strip() or os.getenv("OPENAI_API_KEY", "").strip())


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
        "Users track seafood at home in a virtual freezer. "
        "Recommend practical home-cooked meals using their stock, especially items expiring soon. "
        "Prefer Malaysian/Southeast Asian flavours when appropriate (soy sauce, ginger, sambal, lime). "
        "Be concise, safe (cook seafood thoroughly), and never invent items they do not have unless "
        "you clearly label extra pantry items. "
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
        "Answer helpfully about what to cook, ingredients, substitutions, cooking time, or storage. "
        "If you suggest a complete recipe, include it in the recipes array.\n"
        "Return JSON exactly:\n"
        '{"reply":"your answer in plain text","recipes":[]}\n'
        "recipes array uses the same objects as suggest (id, basedOn, title, minutes, difficulty, "
        "ingredients, steps, tips optional, imageTag). Use empty recipes array if not giving a full recipe."
    )


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


def _call_gemini(prompt: str) -> str:
    api_key = os.getenv("GEMINI_API_KEY", "").strip()
    if not api_key:
        raise RuntimeError("GEMINI_API_KEY not set")

    url = (
        f"https://generativelanguage.googleapis.com/v1beta/models/"
        f"{GEMINI_MODEL}:generateContent?key={api_key}"
    )
    body = {
        "systemInstruction": {"parts": [{"text": _system_prompt()}]},
        "contents": [{"role": "user", "parts": [{"text": prompt}]}],
        "generationConfig": {
            "temperature": 0.65,
            "responseMimeType": "application/json",
        },
    }
    request = urllib.request.Request(
        url,
        data=json.dumps(body).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=45) as response:
        data = json.loads(response.read().decode("utf-8"))

    candidates = data.get("candidates") or []
    if not candidates:
        raise RuntimeError("Gemini returned no candidates")
    parts = candidates[0].get("content", {}).get("parts") or []
    if not parts:
        raise RuntimeError("Gemini returned empty content")
    return parts[0].get("text") or ""


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


def _llm_complete(prompt: str) -> str:
    gemini_key = os.getenv("GEMINI_API_KEY", "").strip()
    openai_key = os.getenv("OPENAI_API_KEY", "").strip()

    errors: list[str] = []
    if gemini_key:
        try:
            return _call_gemini(prompt)
        except Exception as exc:
            errors.append(f"Gemini: {exc}")
    if openai_key:
        try:
            return _call_openai(prompt)
        except Exception as exc:
            errors.append(f"OpenAI: {exc}")

    if not gemini_key and not openai_key:
        raise RuntimeError(
            "No AI API key configured. Set GEMINI_API_KEY or OPENAI_API_KEY on the server."
        )
    raise RuntimeError("; ".join(errors))


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


def chat_recipes_with_ai(
    message: str,
    items: list[Any],
    history: Optional[list[dict[str, str]]] = None,
) -> dict[str, Any]:
    if not ai_recipes_enabled():
        raise RuntimeError(
            "AI recipe assistant is not configured. Set GEMINI_API_KEY or OPENAI_API_KEY on the server."
        )

    prompt = _chat_user_prompt(message.strip(), items, history or [])
    raw_text = _llm_complete(prompt)
    parsed = _extract_json(raw_text)

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
