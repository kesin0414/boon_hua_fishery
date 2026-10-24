"""Identify seafood from a photo (OpenAI vision or Gemini) and suggest simple dishes.

MVP / preview feature — not guaranteed accurate. Prefer a single clear subject.
"""

from __future__ import annotations

import json
import os
import time
import urllib.error
import urllib.request
from typing import Any

from ai_recipe_service import (
    GEMINI_MODEL,
    GEMINI_MODEL_FALLBACKS,
    OPENAI_MODEL,
    _gemini_error_message,
    _valid_gemini_key,
    ai_provider_name,
    ai_recipes_enabled,
)

# Common Malaysian wet-market names to nudge the model toward the shop catalog.
_CATALOG_HINTS = [
    "Ikan Bara Merah",
    "Kerisi",
    "Golden Snapper",
    "Red Snapper",
    "Pomfret / Bawal",
    "Grouper / Kerapu",
    "Stingray / Pari",
    "Threadfin / Senangin / Kurau",
    "Mackerel / Kembung",
    "Tilapia",
    "Salmon",
    "Seabass / Siakap",
    "Tiger Prawn / Udang Harimau",
    "White Prawn / Udang",
    "Flower Crab / Ketam Bunga",
    "Mud Crab / Ketam",
    "Squid / Sotong",
    "Cuttlefish / Sotong Katak",
    "Octopus",
    "Clam / Lala / Kepah",
    "Cockle / Siham",
    "Mussel",
]


def _identify_system_prompt() -> str:
    catalog = ", ".join(_CATALOG_HINTS)
    return (
        "You are a seafood identification assistant for a Malaysian wet-market fishery app. "
        "Look at the photo and identify the main seafood shown. "
        "Always make your best species guess when any seafood is visible — do not reply "
        "Unknown seafood just because the photo is imperfect. "
        "Return ONLY JSON with keys: "
        "species (string, prefer Malaysian market / Malay name when known), "
        "commonName (string, English name), "
        "confidence (number 0-1), "
        "category (one of Fish, Shellfish, Prawn, Crab, Squid, Unknown), "
        "photoQuality (one of good, mixed_pile, ice_glare, blurry, unclear), "
        "qualityNote (short string; empty if photo is fine), "
        "dishIdeas (array of 3-5 short Malaysian-friendly dish names), "
        "disclaimer (short string reminding results are not 100% accurate). "
        "Rules: "
        "1) Identify the dominant seafood even if partly cut, on ice, or slightly blurry. "
        "2) Use photoQuality for warnings, but still return a species guess when possible. "
        "3) Use species 'Unknown seafood' ONLY if the image clearly has no seafood. "
        "4) Prefer catalog-like names when close: "
        f"{catalog}."
    )


def _models_to_try(api_key: str | None = None) -> list[str]:
    """Return a short list of Gemini models to try (max 3) for photo ID."""
    discovered: list[str] = []
    if api_key:
        discovered = _discover_gemini_flash_models(api_key)

    preferred = [
        GEMINI_MODEL,
        *GEMINI_MODEL_FALLBACKS,
        "gemini-2.0-flash",
        "gemini-2.0-flash-lite",
        "gemini-2.5-flash-lite",
        "gemini-2.5-flash",
        "gemini-flash-latest",
    ]
    ordered: list[str] = []
    for name in [*discovered, *preferred]:
        n = (name or "").strip()
        if not n or n.startswith("gemini-1.5"):
            continue
        if n not in ordered:
            ordered.append(n)
        if len(ordered) >= 3:
            break
    return ordered


def _discover_gemini_flash_models(api_key: str) -> list[str]:
    """Ask Google which generateContent models this key can use."""
    url = "https://generativelanguage.googleapis.com/v1beta/models?pageSize=100"
    request = urllib.request.Request(
        url,
        headers={"x-goog-api-key": api_key},
        method="GET",
    )
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            data = json.loads(response.read().decode("utf-8"))
    except Exception as exc:
        print(f"WARN: could not list Gemini models: {exc}")
        return []

    found: list[str] = []
    for item in data.get("models") or []:
        full = str(item.get("name") or "")
        short = full.split("/")[-1].strip()
        methods = item.get("supportedGenerationMethods") or []
        if not short or "generateContent" not in methods:
            continue
        lower = short.lower()
        if "flash" not in lower and "pro" not in lower:
            continue
        if short.startswith("gemini-1.5"):
            continue
        found.append(short)

    # Prefer flash / lite first for speed + free-tier friendliness.
    found.sort(
        key=lambda n: (
            0 if "flash-lite" in n else 1 if "flash" in n else 2,
            n,
        )
    )
    return found[:8]


def identify_seafood_from_image(
    *,
    image_base64: str,
    mime_type: str = "image/jpeg",
) -> dict[str, Any]:
    if not ai_recipes_enabled():
        raise RuntimeError(
            "AI is not configured. Set OPENAI_API_KEY or GEMINI_API_KEY on the server "
            "to enable seafood photo ID."
        )

    raw = image_base64.strip()
    if "," in raw and raw.lower().startswith("data:"):
        raw = raw.split(",", 1)[1]
    raw = "".join(raw.split())
    if len(raw) < 100:
        raise RuntimeError("Image data is too small or missing.")

    mime = (mime_type or "image/jpeg").strip().lower()
    if mime in ("image/jpg",):
        mime = "image/jpeg"
    if mime not in ("image/jpeg", "image/png", "image/webp"):
        mime = "image/jpeg"

    choice = os.getenv("AI_PROVIDER", "auto").strip().lower()
    openai_key = os.getenv("OPENAI_API_KEY", "").strip()
    gemini_key = os.getenv("GEMINI_API_KEY", "").strip()

    errors: list[str] = []

    def try_openai() -> dict[str, Any]:
        return _identify_with_openai(image_b64=raw, mime=mime, api_key=openai_key)

    def try_gemini() -> dict[str, Any]:
        if not gemini_key:
            raise RuntimeError("GEMINI_API_KEY not set")
        if not _valid_gemini_key(gemini_key):
            raise RuntimeError(
                "GEMINI_API_KEY does not look like a Google AI Studio key (expected AIza… or AQ.…)."
            )
        return _identify_with_gemini(image_b64=raw, mime=mime, api_key=gemini_key)

    # Photo ID: prefer Gemini when available (cheaper free tier, avoids OpenAI quota 429s).
    ordered: list[tuple[str, Any]] = []
    if choice == "openai":
        if openai_key:
            ordered.append(("openai", try_openai))
        if gemini_key:
            ordered.append(("gemini", try_gemini))
    elif choice == "gemini":
        if gemini_key:
            ordered.append(("gemini", try_gemini))
        if openai_key:
            ordered.append(("openai", try_openai))
    else:
        if gemini_key:
            ordered.append(("gemini", try_gemini))
        if openai_key:
            ordered.append(("openai", try_openai))

    if not ordered:
        raise RuntimeError(
            "No AI API key configured. Set OPENAI_API_KEY or GEMINI_API_KEY on the server."
        )

    for name, runner in ordered:
        try:
            result = runner()
            result["provider"] = name
            return result
        except Exception as exc:
            print(f"WARN: seafood identify via {name} failed: {exc}")
            errors.append(f"{name}: {exc}")

    raise RuntimeError("; ".join(errors) if errors else "Seafood identify request failed")


def _openai_error_payload(body_text: str) -> dict[str, Any]:
    try:
        parsed = json.loads(body_text or "{}")
    except json.JSONDecodeError:
        return {}
    err = parsed.get("error")
    return err if isinstance(err, dict) else {}


def _identify_with_openai(*, image_b64: str, mime: str, api_key: str) -> dict[str, Any]:
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY not set")

    # Vision-capable chat models; fall back from configured text model if needed.
    models: list[str] = []
    for name in ("gpt-4o-mini", OPENAI_MODEL, "gpt-4o"):
        n = (name or "").strip()
        if n and n not in models:
            models.append(n)

    data_url = f"data:{mime};base64,{image_b64}"
    user_text = (
        "Identify the main seafood in this photo. "
        "Give your best species guess even if the photo is imperfect. "
        "Return JSON only."
    )
    last_error: RuntimeError | None = None

    for model in models:
        body = {
            "model": model,
            "temperature": 0.2,
            "response_format": {"type": "json_object"},
            "messages": [
                {"role": "system", "content": _identify_system_prompt()},
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": user_text},
                        {
                            "type": "image_url",
                            # "low" uses fewer tokens — helps free-tier rate/quota limits.
                            "image_url": {"url": data_url, "detail": "low"},
                        },
                    ],
                },
            ],
        }
        request = urllib.request.Request(
            "https://api.openai.com/v1/chat/completions",
            data=json.dumps(body).encode("utf-8"),
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {api_key}",
            },
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=70) as response:
                data = json.loads(response.read().decode("utf-8"))
            choices = data.get("choices") or []
            if not choices:
                raise RuntimeError("OpenAI returned no choices")
            text = choices[0].get("message", {}).get("content") or ""
            return _normalize_identify_result(text)
        except urllib.error.HTTPError as exc:
            body_text = ""
            try:
                body_text = exc.read().decode("utf-8", errors="replace")
            except Exception:
                pass
            err = _openai_error_payload(body_text)
            err_code = str(err.get("code") or "").lower()
            err_type = str(err.get("type") or "").lower()
            err_msg = str(err.get("message") or body_text[:180] or exc.reason or "").strip()

            if exc.code in (401, 403):
                raise RuntimeError(
                    "OpenAI API key was rejected. Check OPENAI_API_KEY on the server."
                ) from exc

            # Billing / spend / prepaid credits exhausted — retrying will not help.
            if exc.code == 429 and (
                err_code in {
                    "insufficient_quota",
                    "credit_balance_exhausted",
                    "organization_usage_limit_exceeded",
                    "organization_spend_limit_exceeded",
                    "project_spend_limit_exceeded",
                }
                or "insufficient_quota" in err_type
                or "quota" in err_msg.lower()
                or "billing" in err_msg.lower()
                or "credit" in err_msg.lower()
            ):
                raise RuntimeError(
                    "OpenAI billing/quota is empty for this API key. "
                    "Add credits at platform.openai.com/account/billing, "
                    "or set GEMINI_API_KEY on Render for free photo ID."
                ) from exc

            if exc.code == 429:
                retry_after = exc.headers.get("Retry-After") if exc.headers else None
                wait_s = 2
                if retry_after:
                    try:
                        wait_s = max(1, min(20, int(retry_after)))
                    except ValueError:
                        wait_s = 2
                time.sleep(wait_s)
                # One more attempt on the same model after a short pause.
                try:
                    retry_req = urllib.request.Request(
                        "https://api.openai.com/v1/chat/completions",
                        data=json.dumps(body).encode("utf-8"),
                        headers={
                            "Content-Type": "application/json",
                            "Authorization": f"Bearer {api_key}",
                        },
                        method="POST",
                    )
                    with urllib.request.urlopen(retry_req, timeout=70) as response:
                        data = json.loads(response.read().decode("utf-8"))
                    choices = data.get("choices") or []
                    if not choices:
                        raise RuntimeError("OpenAI returned no choices")
                    text = choices[0].get("message", {}).get("content") or ""
                    return _normalize_identify_result(text)
                except urllib.error.HTTPError as retry_exc:
                    raise RuntimeError(
                        "AI is temporarily rate-limited (too many requests). "
                        "Wait about a minute and try again."
                    ) from retry_exc

            snippet = err_msg or "unknown error"
            last_error = RuntimeError(f"OpenAI HTTP {exc.code}: {snippet}")
            # Try next vision model on 400/404.
            if exc.code in (400, 404):
                continue
            raise last_error from exc

    if last_error is not None:
        raise last_error
    raise RuntimeError("OpenAI seafood identify request failed")


def _identify_with_gemini(*, image_b64: str, mime: str, api_key: str) -> dict[str, Any]:
    body = {
        "systemInstruction": {"parts": [{"text": _identify_system_prompt()}]},
        "contents": [
            {
                "role": "user",
                "parts": [
                    # Image first — models attend better when media leads.
                    {"inline_data": {"mime_type": mime, "data": image_b64}},
                    {
                        "text": (
                            "Identify the main seafood in this photo. "
                            "Give your best species guess even if the photo is imperfect. "
                            "Return JSON only."
                        )
                    },
                ],
            }
        ],
        "generationConfig": {
            "temperature": 0.2,
            "responseMimeType": "application/json",
        },
    }
    payload = json.dumps(body).encode("utf-8")
    headers = {
        "Content-Type": "application/json",
        "x-goog-api-key": api_key,
    }

    last_error: RuntimeError | None = None
    for model in _models_to_try(api_key):
        url = (
            f"https://generativelanguage.googleapis.com/v1beta/models/"
            f"{model}:generateContent"
        )
        last_http: urllib.error.HTTPError | None = None
        for attempt in range(3):
            request = urllib.request.Request(
                url, data=payload, headers=headers, method="POST"
            )
            try:
                with urllib.request.urlopen(request, timeout=40) as response:
                    data = json.loads(response.read().decode("utf-8"))
                candidates = data.get("candidates") or []
                if not candidates:
                    # Often safety / empty — surface a clear message.
                    prompt_feedback = data.get("promptFeedback") or {}
                    block = prompt_feedback.get("blockReason")
                    if block:
                        raise RuntimeError(
                            f"Photo was blocked by the AI safety filter ({block}). "
                            "Try another photo with a clearer seafood subject."
                        )
                    raise RuntimeError("Gemini returned no candidates")
                candidate = candidates[0]
                finish = str(candidate.get("finishReason") or "").upper()
                if finish in ("SAFETY", "RECITATION", "BLOCKLIST", "PROHIBITED_CONTENT"):
                    raise RuntimeError(
                        "Photo was blocked by the AI safety filter. "
                        "Try another clearer seafood photo."
                    )
                parts = candidate.get("content", {}).get("parts") or []
                if not parts:
                    raise RuntimeError("Gemini returned empty content")
                text = parts[0].get("text") or ""
                return _normalize_identify_result(text)
            except TimeoutError as exc:
                last_error = RuntimeError(
                    "Gemini timed out while reading the photo. Try a smaller cropped photo."
                )
                print(f"WARN: Gemini timeout on {model}: {exc}")
                break
            except urllib.error.URLError as exc:
                reason = str(getattr(exc, "reason", exc))
                if "timed out" in reason.lower():
                    last_error = RuntimeError(
                        "Gemini timed out while reading the photo. Try a smaller cropped photo."
                    )
                    print(f"WARN: Gemini URL timeout on {model}: {exc}")
                    break
                raise RuntimeError(f"Gemini network error: {exc}") from exc
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
        # Timeout on this model — try the next one once.
        if last_error is not None and "timed out" in str(last_error).lower():
            continue

    if last_error is not None:
        raise last_error
    raise RuntimeError("Gemini seafood identify request failed")


def _normalize_identify_result(raw_text: str) -> dict[str, Any]:
    cleaned = raw_text.strip()
    if cleaned.startswith("```"):
        cleaned = cleaned.strip("`")
        if cleaned.lower().startswith("json"):
            cleaned = cleaned[4:].strip()
    # Recover JSON object if model added prose around it.
    start = cleaned.find("{")
    end = cleaned.rfind("}")
    if start >= 0 and end > start:
        cleaned = cleaned[start : end + 1]
    try:
        parsed = json.loads(cleaned)
    except json.JSONDecodeError as exc:
        raise RuntimeError("AI returned invalid JSON for seafood identify.") from exc

    species = str(parsed.get("species") or parsed.get("name") or "Unknown seafood").strip()
    if not species:
        species = "Unknown seafood"
    common = str(parsed.get("commonName") or "").strip()
    try:
        confidence = float(parsed.get("confidence") or 0)
    except (TypeError, ValueError):
        confidence = 0.0
    confidence = max(0.0, min(1.0, confidence))

    category = str(parsed.get("category") or "Unknown").strip() or "Unknown"
    photo_quality = str(parsed.get("photoQuality") or "unclear").strip().lower()
    allowed_quality = {"good", "mixed_pile", "ice_glare", "blurry", "unclear"}
    if photo_quality not in allowed_quality:
        photo_quality = "unclear"
    quality_note = str(parsed.get("qualityNote") or "").strip()
    dishes_raw = parsed.get("dishIdeas") or parsed.get("recipes") or []
    dish_ideas: list[str] = []
    if isinstance(dishes_raw, list):
        for item in dishes_raw:
            text = str(item).strip()
            if text and text not in dish_ideas:
                dish_ideas.append(text)
    dish_ideas = dish_ideas[:5]
    disclaimer = str(
        parsed.get("disclaimer")
        or "This guess is not always 100% accurate. Confirm the seafood yourself before cooking."
    ).strip()

    return {
        "species": species,
        "commonName": common,
        "confidence": round(confidence, 3),
        "category": category,
        "photoQuality": photo_quality,
        "qualityNote": quality_note,
        "dishIdeas": dish_ideas,
        "disclaimer": disclaimer,
        "previewFeature": True,
        "statusNote": (
            "This seafood photo ID feature is not yet fully developed. "
            "Treat results as a helpful hint only."
        ),
        "provider": ai_provider_name(),
    }
