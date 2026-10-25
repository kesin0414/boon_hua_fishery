"""Extract seafood line items from a handwritten / printed receipt photo (Gemini vision).

Used when on-device ML Kit OCR cannot reliably read wet-market notepad handwriting.
"""

from __future__ import annotations

import json
import os
import re
import time
import urllib.error
import urllib.request
from datetime import date, datetime
from typing import Any

from ai_recipe_service import (
    _gemini_error_message,
    _valid_gemini_key,
    ai_provider_name,
)
from seafood_identify_service import _models_to_try

_CATALOG_HINTS = (
    "Octopus, Stingray/Pari, Crab/Ketam, Tiger Prawn, Kerisi, Ikan Bara Merah, "
    "Squid/Sotong, Seabass/Siakap, Pomfret/Bawal, Grouper/Kerapu, Mackerel/Kembung"
)


def _system_prompt() -> str:
    return (
        "You are an expert at reading messy Malaysian wet-market handwritten notes "
        "and printed seafood invoices from phone photos. "
        "Handwriting is often ugly, slanted, faint, or half-illegible — still make your "
        "best reconstruction of every seafood purchase line. "
        "Return ONLY JSON with keys: "
        "purchaseDate (string YYYY-MM-DD or empty), "
        "rawText (string: cleaned full transcription), "
        "items (array of {species, quantityKg, totalPrice, pricePerKg, confidence}). "
        "Rules: "
        "1) Extract every seafood line: item name, weight, and RM price. "
        "2) Convert weights to kilograms (700g→0.7, 1kg→1, 1,5kg→1.5). "
        "   Units may look like kg, kgs, kilo, g, gram, or OCR mistakes q/9 for g. "
        "3) Prices use RM / MYR. Cents may look like .00, -Oo, .O0, or comma decimals. "
        "   totalPrice is the line total in RM. If only RM/kg is written, "
        "   totalPrice = unit × quantityKg. "
        "4) Date, name, weight, and price can appear in ANY order or on separate lines — "
        "   find each by keyword (species name, kg/g, RM), not by reading order. "
        "5) Fix common OCR/handwriting confusions: O/o→0, l/I→1, S/s→5 or 6 in years, "
        "   q→g for grams, 2O→20, J202s→2026 after a day/month. "
        "6) Prefer catalog-like species names when close: "
        f"{_CATALOG_HINTS}. "
        "7) Ignore shop letterheads, bank details, and grand-total-only lines. "
        "8) Never invent seafood that is not on the note. If truly unreadable, items=[]. "
        "9) confidence is 0-1 for THAT item only: how clearly you can read name+weight+RM "
        "(1.0 crisp, ~0.7 messy but likely, ~0.4 guessed from faint marks). "
        "Do not use the same confidence for every item."
    )


def extract_receipt_from_image(
    *,
    image_base64: str,
    mime_type: str = "image/jpeg",
    ml_kit_hint: str | None = None,
) -> dict[str, Any]:
    raw = (image_base64 or "").strip()
    if raw.startswith("data:") and "," in raw:
        raw = raw.split(",", 1)[1]
    raw = re.sub(r"\s+", "", raw)
    if len(raw) < 50:
        raise RuntimeError("Image payload is empty or too small")

    mime = (mime_type or "image/jpeg").strip().lower()
    if mime not in {"image/jpeg", "image/jpg", "image/png", "image/webp"}:
        mime = "image/jpeg"
    if mime == "image/jpg":
        mime = "image/jpeg"

    gemini_key = (os.getenv("GEMINI_API_KEY") or "").strip()
    if not _valid_gemini_key(gemini_key):
        raise RuntimeError(
            "GEMINI_API_KEY is not set on the server. "
            "Handwritten receipt AI OCR needs Gemini."
        )

    hint = (ml_kit_hint or "").strip()
    parsed = _extract_with_gemini(
        image_b64=raw,
        mime=mime,
        api_key=gemini_key,
        ml_kit_hint=hint,
    )
    parsed["provider"] = "gemini"
    parsed["aiProvider"] = ai_provider_name()
    return parsed


def _extract_with_gemini(
    *,
    image_b64: str,
    mime: str,
    api_key: str,
    ml_kit_hint: str = "",
) -> dict[str, Any]:
    user_text = (
        "Read this seafood purchase note / receipt photo carefully, even if the "
        "handwriting is messy or faint. "
        "Extract purchase date, each seafood item, weight (as kg), and RM price. "
        "Return JSON only."
    )
    if ml_kit_hint:
        # On-device OCR is often wrong on handwriting — treat as a noisy clue only.
        clipped = ml_kit_hint[:1200]
        user_text += (
            "\n\nNoisy on-device OCR hint (may be wrong — trust the image more):\n"
            f"{clipped}"
        )

    body = {
        "systemInstruction": {"parts": [{"text": _system_prompt()}]},
        "contents": [
            {
                "role": "user",
                "parts": [
                    {"inline_data": {"mime_type": mime, "data": image_b64}},
                    {"text": user_text},
                ],
            }
        ],
        "generationConfig": {
            "temperature": 0.05,
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
                with urllib.request.urlopen(request, timeout=55) as response:
                    data = json.loads(response.read().decode("utf-8"))
                candidates = data.get("candidates") or []
                if not candidates:
                    prompt_feedback = data.get("promptFeedback") or {}
                    block = prompt_feedback.get("blockReason")
                    if block:
                        raise RuntimeError(
                            f"Photo was blocked by the AI safety filter ({block}). "
                            "Try another clearer photo of the note."
                        )
                    raise RuntimeError("Gemini returned no candidates")
                parts = candidates[0].get("content", {}).get("parts") or []
                if not parts:
                    raise RuntimeError("Gemini returned empty content")
                text = parts[0].get("text") or ""
                return _normalize_receipt_result(text)
            except TimeoutError as exc:
                last_error = RuntimeError(
                    "Gemini timed out reading the receipt. Try a tighter crop."
                )
                print(f"WARN: receipt OCR timeout on {model}: {exc}")
                break
            except urllib.error.HTTPError as exc:
                last_http = exc
                if exc.code == 429 and attempt < 2:
                    time.sleep(2 * (attempt + 1))
                    continue
                if exc.code in (404, 400):
                    last_error = RuntimeError(_gemini_error_message(exc))
                    break
                raise RuntimeError(_gemini_error_message(exc)) from exc
            except urllib.error.URLError as exc:
                reason = str(getattr(exc, "reason", exc))
                if "timed out" in reason.lower():
                    last_error = RuntimeError(
                        "Gemini timed out reading the receipt. Try a tighter crop."
                    )
                    break
                raise RuntimeError(f"Gemini network error: {exc}") from exc

        if last_http is not None and last_http.code in (404, 400):
            continue
        if last_http is not None:
            raise RuntimeError(_gemini_error_message(last_http))
        if last_error is not None:
            continue

    if last_error is not None:
        raise last_error
    raise RuntimeError("Receipt OCR request failed")


def _normalize_receipt_result(text: str) -> dict[str, Any]:
    cleaned = (text or "").strip()
    if cleaned.startswith("```"):
        cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned)
        cleaned = re.sub(r"\s*```$", "", cleaned)
    try:
        data = json.loads(cleaned)
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"AI returned invalid JSON: {exc}") from exc
    if not isinstance(data, dict):
        raise RuntimeError("AI returned unexpected JSON shape")

    raw_text = str(data.get("rawText") or "").strip()
    purchase = _parse_purchase_date(data.get("purchaseDate"))
    items_out: list[dict[str, Any]] = []
    for row in data.get("items") or []:
        if not isinstance(row, dict):
            continue
        species = str(row.get("species") or "").strip()
        if len(species) < 2:
            continue
        try:
            qty = float(row.get("quantityKg") or 0)
        except (TypeError, ValueError):
            qty = 0.0
        try:
            total = float(row.get("totalPrice") or 0)
        except (TypeError, ValueError):
            total = 0.0
        try:
            ppk = float(row.get("pricePerKg") or 0)
        except (TypeError, ValueError):
            ppk = 0.0
        try:
            conf = float(row.get("confidence") or 0)
        except (TypeError, ValueError):
            conf = 0.0
        if qty <= 0 and total <= 0:
            continue
        if qty <= 0:
            qty = 1.0
        if ppk <= 0 and qty > 0:
            ppk = total / qty
        if total <= 0 and ppk > 0:
            total = ppk * qty
        # Derive a floor confidence from field completeness when model omits it.
        if conf <= 0:
            conf = 0.35
            if species:
                conf += 0.15
            if qty > 0:
                conf += 0.15
            if total > 0:
                conf += 0.15
            if ppk > 0 and qty > 0 and abs(ppk * qty - total) <= max(0.05, total * 0.05):
                conf += 0.15
        items_out.append(
            {
                "species": species,
                "quantityKg": round(qty, 4),
                "totalPrice": round(total, 2),
                "pricePerKg": round(ppk, 2),
                "confidence": round(min(1.0, max(0.0, conf)), 3),
            }
        )

    return {
        "purchaseDate": purchase.isoformat(),
        "rawText": raw_text,
        "items": items_out,
    }


def _parse_purchase_date(value: Any) -> date:
    today = datetime.now().date()
    if value is None:
        return today
    text = str(value).strip()
    if not text:
        return today
    for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y", "%d.%m.%Y"):
        try:
            return datetime.strptime(text[:10], fmt).date()
        except ValueError:
            continue
    return today
