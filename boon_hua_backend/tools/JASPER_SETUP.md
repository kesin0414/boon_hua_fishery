# JasperReports (Jaspersoft) setup

Monthly sales exports (CSV, Excel, PDF) are rendered from `reports/sales_report.jrxml` using **JasperReports**.

## Option A — JasperStarter (recommended for local / thesis demo)

1. Install **Java 17+** (`java -version`).
2. Download **JasperStarter** from [github.com/cenote/jasperstarter/releases](https://github.com/cenote/jasperstarter/releases).
3. Save the JAR as `boon_hua_backend/tools/jasperstarter.jar`.
4. Restart the FastAPI backend.
5. In the web admin, open **Reports** and export CSV / Excel / PDF.

Optional: set `JASPERSTARTER_JAR` to a custom path.

## Option B — JasperReports Server (REST)

1. Deploy JasperReports Server (Docker or Jaspersoft Cloud).
2. Upload `sales_report.jrxml` and `buyers_subreport.jrxml` as a report unit.
3. Set environment variables on the backend:
   - `JASPER_SERVER_URL` — e.g. `https://jasper.example.com/jasperserver`
   - `JASPER_REPORT_URI` — e.g. `/reports/BoonHua/sales_report`
   - `JASPER_SERVER_USER` / `JASPER_SERVER_PASSWORD`

## Templates

| File | Purpose |
|------|---------|
| `reports/sales_report.jrxml` | Main report — summary, buyer subreport, sales ledger |
| `reports/buyers_subreport.jrxml` | Collection-by-buyer table |

All three export formats use the **same** Jasper template; only the output format changes (`pdf`, `xlsx`, `csv`).
