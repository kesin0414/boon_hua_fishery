"""Render monthly sales reports via JasperReports (JasperStarter CLI or JasperReports Server REST)."""

from __future__ import annotations

import base64
import json
import os
import shutil
import subprocess
import tempfile
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

REPORTS_DIR = Path(__file__).resolve().parent / "reports"
MAIN_TEMPLATE = REPORTS_DIR / "sales_report.jrxml"
BUYERS_TEMPLATE = REPORTS_DIR / "buyers_subreport.jrxml"
DEFAULT_JASPERSTARTER = Path(__file__).resolve().parent / "tools" / "jasperstarter.jar"

FORMAT_EXT = {
    "pdf": ("pdf", "application/pdf"),
    "xlsx": ("xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
    "csv": ("csv", "text/csv; charset=utf-8"),
}


class JasperReportsNotConfiguredError(RuntimeError):
    """Raised when neither JasperStarter nor JasperReports Server is available."""


def _jasperstarter_path() -> Path | None:
    configured = os.getenv("JASPERSTARTER_JAR", "").strip()
    if configured:
        path = Path(configured)
        return path if path.is_file() else None
    return DEFAULT_JASPERSTARTER if DEFAULT_JASPERSTARTER.is_file() else None


def _java_available() -> bool:
    return shutil.which("java") is not None


def _normalize_payload(payload: dict[str, Any]) -> tuple[dict[str, Any], dict[str, str]]:
    summary = payload.get("summary") or {}
    buyer_rows = []
    for row in payload.get("buyerSummary") or []:
        buyer_rows.append(
            {
                "name": row.get("name") or "—",
                "buyerTypeLabel": row.get("buyerTypeLabel") or row.get("buyerType") or "—",
                "bills": int(row.get("bills") or 0),
                "total": float(row.get("total") or 0),
                "paid": float(row.get("paid") or 0),
                "owing": float(row.get("owing") or 0),
            }
        )

    ledger_rows = []
    for row in payload.get("ledgerRows") or []:
        ledger_rows.append(
            {
                "ref": row.get("ref") or "—",
                "date": row.get("date") or "—",
                "buyer": row.get("buyer") or "—",
                "phone": row.get("phone") or "—",
                "item": row.get("item") or "—",
                "qtyKg": str(row.get("qtyKg") if row.get("qtyKg") is not None else "—"),
                "total": float(row.get("total") or 0),
                "paid": float(row.get("paid") or 0),
                "owing": float(row.get("owing") or 0),
                "status": row.get("status") or "—",
            }
        )

    data = {"buyers": buyer_rows, "ledger": ledger_rows}
    params = {
        "storeName": str(payload.get("storeName") or "Boon Hua Fishery"),
        "periodLabel": str(payload.get("periodLabel") or ""),
        "dateFrom": str(payload.get("dateFrom") or ""),
        "dateTo": str(payload.get("dateTo") or ""),
        "generatedAt": str(payload.get("generatedAt") or ""),
        "totalSales": str(float(summary.get("totalSales") or 0)),
        "collected": str(float(summary.get("collected") or 0)),
        "owing": str(float(summary.get("owing") or 0)),
        "txCount": str(int(summary.get("count") or 0)),
        "paidCount": str(int(summary.get("paidCount") or 0)),
        "unpaidCount": str(int(summary.get("unpaidCount") or 0)),
        "buyerCount": str(len(buyer_rows)),
        "SUBREPORT_DIR": str(REPORTS_DIR).replace("\\", "/") + "/",
    }
    return data, params


def _safe_filename_part(value: str) -> str:
    return "".join(ch if ch.isalnum() or ch in "._-" else "_" for ch in value)[:80]


def _output_filename(payload: dict[str, Any], fmt: str) -> str:
    stamp = _safe_filename_part(f"{payload.get('dateFrom', '')}_{payload.get('dateTo', '')}")
    ext, _ = FORMAT_EXT[fmt]
    return f"boonhua_sales_report_{stamp}.{ext}"


def _render_with_jasperstarter(payload: dict[str, Any], fmt: str) -> bytes:
    jar = _jasperstarter_path()
    if jar is None or not _java_available():
        raise JasperReportsNotConfiguredError(
            "JasperStarter is not configured. Install Java 17+, download jasperstarter.jar "
            "to boon_hua_backend/tools/, or set JASPERSTARTER_JAR. See tools/JASPER_SETUP.md."
        )
    if not MAIN_TEMPLATE.is_file() or not BUYERS_TEMPLATE.is_file():
        raise FileNotFoundError(f"Missing Jasper templates in {REPORTS_DIR}")

    data, params = _normalize_payload(payload)
    ext, _ = FORMAT_EXT[fmt]

    with tempfile.TemporaryDirectory(prefix="bh_jasper_") as tmp:
        tmp_path = Path(tmp)
        data_file = tmp_path / "report_data.json"
        data_file.write_text(json.dumps(data), encoding="utf-8")
        output_base = tmp_path / "sales_report"

        compile_cmd = ["java", "-jar", str(jar), "compile", str(BUYERS_TEMPLATE)]
        compile_result = subprocess.run(
            compile_cmd,
            capture_output=True,
            text=True,
            timeout=60,
            check=False,
        )
        if compile_result.returncode != 0:
            detail = (compile_result.stderr or compile_result.stdout or "Subreport compile failed").strip()
            raise RuntimeError(detail)

        cmd = [
            "java",
            "-jar",
            str(jar),
            "process",
            str(MAIN_TEMPLATE),
            "-o",
            str(output_base),
            "-f",
            ext,
            "-t",
            "json",
            "--data-file",
            str(data_file),
        ]
        for key, value in params.items():
            cmd.extend(["-P", f"{key}={value}"])

        completed = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=int(os.getenv("JASPER_TIMEOUT_SECONDS", "120")),
            check=False,
        )
        if completed.returncode != 0:
            detail = (completed.stderr or completed.stdout or "JasperStarter failed").strip()
            raise RuntimeError(detail)

        output_file = Path(f"{output_base}.{ext}")
        if not output_file.is_file():
            raise RuntimeError(f"JasperStarter did not produce {output_file.name}")

        content = output_file.read_bytes()
        if fmt == "csv":
            # UTF-8 BOM helps Excel open CSV with Malaysian characters correctly.
            if not content.startswith(b"\xef\xbb\xbf"):
                content = b"\xef\xbb\xbf" + content
        return content


def _render_with_jasper_server(payload: dict[str, Any], fmt: str) -> bytes:
    base_url = os.getenv("JASPER_SERVER_URL", "").rstrip("/")
    report_uri = os.getenv("JASPER_REPORT_URI", "/reports/BoonHua/sales_report")
    if not base_url:
        raise JasperReportsNotConfiguredError("JASPER_SERVER_URL is not set.")

    server_format = {"pdf": "pdf", "xlsx": "xlsx", "csv": "csv"}[fmt]
    data, params = _normalize_payload(payload)
    query = urllib.parse.urlencode(
        {
            "outputFormat": server_format,
            **{f"reportParameter/{key}": value for key, value in params.items()},
        }
    )
    url = f"{base_url}/rest_v2/reports{report_uri}.{server_format}?{query}"

    request = urllib.request.Request(
        url,
        data=json.dumps(data).encode("utf-8"),
        headers={"Content-Type": "application/json", "Accept": "application/octet-stream"},
        method="POST",
    )
    user = os.getenv("JASPER_SERVER_USER", "").strip()
    password = os.getenv("JASPER_SERVER_PASSWORD", "").strip()
    if user:
        token = base64.b64encode(f"{user}:{password}".encode("utf-8")).decode("ascii")
        request.add_header("Authorization", f"Basic {token}")

    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            return response.read()
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"JasperReports Server error {exc.code}: {body}") from exc


def render_sales_report(payload: dict[str, Any], fmt: str) -> tuple[bytes, str, str]:
    """Return (file_bytes, mime_type, download_filename)."""
    if fmt not in FORMAT_EXT:
        raise ValueError(f"Unsupported format: {fmt}")

    if not payload.get("ledgerRows"):
        raise ValueError("No sales in the selected period to export.")

    if os.getenv("JASPER_SERVER_URL", "").strip():
        content = _render_with_jasper_server(payload, fmt)
    else:
        content = _render_with_jasperstarter(payload, fmt)

    _, mime = FORMAT_EXT[fmt]
    return content, mime, _output_filename(payload, fmt)
