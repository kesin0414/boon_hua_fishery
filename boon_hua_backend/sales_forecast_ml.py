"""
Sales revenue forecasting with scikit-learn (Gradient Boosting).
Trains on daily RM totals; predicts the next 7 calendar days.
"""

from __future__ import annotations

from datetime import date, timedelta
from typing import List, Optional, Sequence, Tuple

import numpy as np
from sklearn.ensemble import GradientBoostingRegressor

FORECAST_DAYS = 7
MIN_SALE_DAYS = 3
MIN_TRAIN_ROWS = 18
LAG_DAYS = (1, 2, 3, 7, 14)


def _parse_date(key: str) -> date:
    y, m, d = str(key).split("-")
    return date(int(y), int(m), int(d))


def _day_label(iso: str) -> str:
    d = _parse_date(iso)
    return f"{d.strftime('%a')} {d.day} {d.strftime('%b')}"


def _build_row(series: np.ndarray, idx: int, dow: int, month: int) -> np.ndarray:
    def lag(k: int) -> float:
        j = idx - k
        if j < 0:
            return float(series[0])
        return float(series[j])

    window7 = series[max(0, idx - 6) : idx + 1]
    window14 = series[max(0, idx - 13) : idx + 1]
    return np.array(
        [
            lag(1),
            lag(2),
            lag(3),
            lag(7),
            lag(14),
            float(np.mean(window7)),
            float(np.mean(window14)),
            float(np.std(window7)) if len(window7) > 1 else 0.0,
            dow / 6.0,
            (month - 1) / 11.0,
            idx / max(len(series) - 1, 1),
        ],
        dtype=np.float64,
    )


def _train_model(X: np.ndarray, y: np.ndarray) -> GradientBoostingRegressor:
    model = GradientBoostingRegressor(
        n_estimators=120,
        max_depth=4,
        learning_rate=0.06,
        min_samples_leaf=2,
        subsample=0.85,
        random_state=42,
    )
    model.fit(X, y)
    return model


def _holdout_quality(series: np.ndarray, keys: List[str]) -> Tuple[Optional[float], str]:
    """MAPE on last up-to-7 days (when enough history). Lower is better."""
    n = len(series)
    if n < MIN_TRAIN_ROWS + 3:
        return None, "low"
    holdout = min(7, max(3, n // 5))
    train_end = n - holdout
    if train_end < MIN_TRAIN_ROWS:
        return None, "low"

    X_train, y_train = [], []
    for idx in range(max(LAG_DAYS), train_end):
        d = _parse_date(keys[idx])
        X_train.append(_build_row(series, idx, d.weekday(), d.month))
        y_train.append(series[idx])

    if len(X_train) < MIN_TRAIN_ROWS:
        return None, "low"

    model = _train_model(np.vstack(X_train), np.array(y_train))
    errors = []
    extended = series[:train_end].copy()
    for idx in range(train_end, n):
        d = _parse_date(keys[idx])
        row = _build_row(extended, len(extended) - 1, d.weekday(), d.month)
        pred = max(0.0, float(model.predict(row.reshape(1, -1))[0]))
        actual = float(series[idx])
        if actual > 0:
            errors.append(abs(actual - pred) / actual)
        extended = np.append(extended, pred)

    if not errors:
        return None, "low"
    mape = float(np.mean(errors))
    if mape <= 0.35:
        return mape, "high"
    if mape <= 0.65:
        return mape, "medium"
    return mape, "low"


def forecast_sales_ml(daily: Sequence[dict]) -> dict:
    """
    daily: [{"date": "YYYY-MM-DD", "revenue": float}, ...] sorted or unsorted.
    """
    if not daily:
        return _empty_result("No daily series provided")

    points = sorted(
        [{"date": str(p["date"]), "revenue": max(0.0, float(p.get("revenue") or 0))} for p in daily],
        key=lambda p: p["date"],
    )
    keys = [p["date"] for p in points]
    series = np.array([p["revenue"] for p in points], dtype=np.float64)
    days_with_sales = int(np.sum(series > 0))

    if days_with_sales < MIN_SALE_DAYS:
        return _empty_result("Not enough sale days")

    today = date.today()
    last_key = keys[-1]
    last_date = _parse_date(last_key)
    # Extend calendar through today if client series ends earlier
    cursor = last_date
    while cursor < today:
        cursor += timedelta(days=1)
        k = cursor.isoformat()
        keys.append(k)
        series = np.append(series, 0.0)

    n = len(series)
    last7 = series[-7:] if n >= 7 else series
    last28 = series[-28:] if n >= 28 else series
    total_last7 = float(np.sum(last7))
    avg7 = total_last7 / max(len(last7), 1)
    avg28 = float(np.mean(last28)) if len(last28) else 0.0
    trend_pct = ((avg7 - avg28) / avg28 * 100) if avg28 > 0 else None

    _, holdout_level = _holdout_quality(series, keys)

    X_all, y_all = [], []
    for idx in range(max(LAG_DAYS), n):
        d = _parse_date(keys[idx])
        X_all.append(_build_row(series, idx, d.weekday(), d.month))
        y_all.append(series[idx])

    if len(X_all) < MIN_TRAIN_ROWS:
        return _baseline_forecast(keys, series, days_with_sales, holdout_level)

    model = _train_model(np.vstack(X_all), np.array(y_all))

    extended = series.copy()
    ext_keys = list(keys)
    next7 = []
    anchor = _parse_date(ext_keys[-1]) if ext_keys else today

    for step in range(1, FORECAST_DAYS + 1):
        future = anchor + timedelta(days=step)
        fk = future.isoformat()
        dow = future.weekday()
        row = _build_row(extended, len(extended) - 1, dow, future.month)
        pred = max(0.0, round(float(model.predict(row.reshape(1, -1))[0]), 2))
        next7.append({"key": fk, "name": _day_label(fk), "revenue": pred, "isForecast": True})
        extended = np.append(extended, pred)
        ext_keys.append(fk)

    next7_total = sum(p["revenue"] for p in next7)
    per_day = next7_total / FORECAST_DAYS

    by_date = dict(zip(keys, series))
    last7_actual = []
    for i in range(6, -1, -1):
        d = today - timedelta(days=i)
        fk = d.isoformat()
        rev = float(by_date.get(fk, 0.0))
        last7_actual.append(
            {"key": fk, "name": _day_label(fk), "revenue": rev, "isForecast": False}
        )

    confidence = holdout_level
    if confidence == "high":
        note = "Matches your recent daily sales patterns well."
    elif confidence == "medium":
        note = "A solid estimate — more sales history will refine it further."
    else:
        note = "Still learning your shop’s pattern — keep logging sales each day."

    return {
        "perDay": per_day,
        "next7Total": next7_total,
        "last7Total": total_last7,
        "avg7": avg7,
        "avg28": avg28,
        "trendPct": trend_pct,
        "confidence": confidence,
        "confidenceNote": note,
        "daysWithSales": days_with_sales,
        "lookbackDays": n,
        "last7Actual": last7_actual,
        "next7Forecast": next7,
        "chartSeries": last7_actual + next7,
        "hasEnoughData": True,
        "modelName": "Smart sales estimate",
        "source": "ml",
    }


def _baseline_forecast(keys: List[str], series: np.ndarray, days_with_sales: int, confidence: str) -> dict:
    """Fallback when series is too short for ML training."""
    n = len(series)
    last7 = series[-7:] if n >= 7 else series
    last28 = series[-28:] if n >= 28 else series
    avg7 = float(np.mean(last7))
    avg28 = float(np.mean(last28)) if len(last28) else avg7
    per_day = max(0.0, avg7 * 0.65 + avg28 * 0.35)
    today = date.today()

    by_date = dict(zip(keys, series))
    last7_actual = []
    for i in range(6, -1, -1):
        d = today - timedelta(days=i)
        fk = d.isoformat()
        rev = float(by_date.get(fk, 0.0))
        last7_actual.append(
            {"key": fk, "name": _day_label(fk), "revenue": rev, "isForecast": False}
        )

    next7 = []
    for step in range(1, FORECAST_DAYS + 1):
        d = today + timedelta(days=step)
        fk = d.isoformat()
        next7.append(
            {
                "key": fk,
                "name": _day_label(fk),
                "revenue": round(per_day, 2),
                "isForecast": True,
            }
        )

    next7_total = per_day * FORECAST_DAYS
    trend_pct = ((avg7 - avg28) / avg28 * 100) if avg28 > 0 else None

    return {
        "perDay": per_day,
        "next7Total": next7_total,
        "last7Total": float(np.sum(last7)),
        "avg7": avg7,
        "avg28": avg28,
        "trendPct": trend_pct,
        "confidence": confidence,
        "confidenceNote": "Keep recording sales daily — predictions improve as history grows.",
        "daysWithSales": days_with_sales,
        "lookbackDays": n,
        "last7Actual": last7_actual,
        "next7Forecast": next7,
        "chartSeries": last7_actual + next7,
        "hasEnoughData": days_with_sales >= MIN_SALE_DAYS,
        "modelName": "Early sales estimate",
        "source": "ml-baseline",
    }


def _empty_result(message: str) -> dict:
    today = date.today()
    last7_actual = []
    for i in range(6, -1, -1):
        d = today - timedelta(days=i)
        fk = d.isoformat()
        last7_actual.append(
            {"key": fk, "name": _day_label(fk), "revenue": 0, "isForecast": False}
        )
    return {
        "perDay": 0,
        "next7Total": 0,
        "last7Total": 0,
        "avg7": 0,
        "avg28": 0,
        "trendPct": None,
        "confidence": "low",
        "confidenceNote": message,
        "daysWithSales": 0,
        "lookbackDays": 0,
        "last7Actual": last7_actual,
        "next7Forecast": [],
        "chartSeries": last7_actual,
        "hasEnoughData": False,
        "modelName": "Smart sales estimate",
        "source": "ml",
    }
