# Requirements Traceability — Boon Hua Fishery

Maps **Table 2 (Functional)** and **Table 3 (Non-Functional)** to implementation in `boon_hua_fishery`.

## Table 2 — Functional Requirements

| Module | Requirement | Status | Implementation |
|--------|-------------|--------|----------------|
| **Account** | Register & login (email/password) | ✅ Met | Mobile `AuthScreen` — Firebase Auth register/login |
| **Account** | Route users to Admin vs Consumer | ✅ Met | Web: `resolveWebAdminSession` in `utils/adminSession.js` (auto-bootstrap admin on first web login; blocks consumer-only). Mobile: `ConsumerAccountGate` in `main.dart` |
| **Account** | Admin activate/deactivate consumers | ✅ Met | Web **Users** page — Active/Suspended + Activate/Deactivate buttons |
| **Inventory & Pricing** | CRUD inventory in kg | ✅ Met | Web **Inventory** — add/edit/delete, stock ledger |
| **Inventory & Pricing** | Manual daily market pricing | ✅ Met | Web inventory `price` (RM/kg); mobile **Market** tab reads live `inventory` |
| **Sales Analytics** | Interactive charts (revenue, trends, popular items) | ✅ Met | Web **Overview** — `RevenueTrendChart`, `PopularItemsChart`, top-selling list |
| **Sales Analytics** | Export charts to printable PDF | ✅ Met | Overview **Export charts PDF** → `window.print()` + `bh-print-report` CSS |
| **Sales Analytics** | Monthly report export | ✅ Met | **Monthly Report** — CSV, Excel, PDF |
| **Price Normalizer** | RM/kg calculation | ✅ Met | Mobile **Compare** tab — `PriceNormalizer` |
| **Price Normalizer** | Save to personal history | ✅ Met | **Price History** in Firestore per user |
| **OCR** | Extract species, qty, price, date | ✅ Met | `ReceiptScanner` + Google ML Kit + `ReceiptParser` |
| **OCR** | Forward data to Virtual Freezer | ✅ Met | `_applyReceipt()` saves freezer + price history |
| **Virtual Freezer** | Real-time personal stock | ✅ Met | Firestore stream `users/{uid}/freezer` |
| **Virtual Freezer** | Best-before from preservation guidelines | ✅ Met | `FreezerService.defaultShelfLifeDays` (30 days) + manual expiry |
| **Freshness Alerts** | Monitor best-before dates | ✅ Met | Home expiring count; `NotificationService.syncFreezerReminders` |
| **Freshness Alerts** | Push notifications | ✅ Met | `flutter_local_notifications` — scheduled expiry reminders |
| **Recipe Suggester** | Inventory context to Gen AI | ✅ Met | `POST /recipes/suggest` and `/recipes/chat` with freezer items |
| **Recipe Suggester** | Meal ideas to reduce waste | ✅ Met | **Recipes** tab — filtered meal ideas + AI chef |

## Table 3 — Non-Functional Requirements

| # | Requirement | Status | Notes |
|---|-------------|--------|-------|
| 1 | Performance (&lt;3s) | ⚡ Partial | Firebase/React/Flutter tuned; OCR depends on device & network |
| 2 | Security (encrypted passwords, admin protection) | ✅ Met | Firebase Auth (hashed passwords); web admin `adminProfiles` check |
| 3 | Usability | ✅ Met | Bottom nav, clear labels, mobile-first UI |
| 4 | Availability | ⚡ Partial | Firebase + Render; depends on hosting uptime |
| 5 | Scalability | ⚡ Partial | Firestore + stateless FastAPI; suitable for SME scale |
| 6 | OCR accuracy ≥85% | ⚡ Partial | ML Kit + parser; review screen shows **confidence %**; UAT should measure on sample receipts |
| 7 | Maintainability (modular code) | ✅ Met | Web: `domain/`, `services/`, `utils/`. Mobile: `models/`, `data/`, `services/` |
| 8 | Compatibility (browsers, Android/iOS) | ✅ Met | React (Chrome/Edge/Firefox); Flutter cross-platform |

## Testing checklist (UAT)

- [ ] Consumer registers on mobile → appears in admin **Users**
- [ ] Admin deactivates account → consumer cannot sign in
- [ ] Admin updates inventory price → **Market** tab updates on mobile
- [ ] Scan receipt → edit lines → save → freezer + Compare prefill
- [ ] Expiry notification fires (Settings → test notification)
- [ ] Overview **Export charts PDF** prints revenue + popular items
- [ ] Meal ideas match freezer stock only

## Admin setup

1. Create Firebase Auth user for admin.
2. First web sign-in auto-creates `adminProfiles/{uid}` (bootstrap). Or save **Settings → Profile** to update name/phone.
3. Set `inventory` documents with `species`, `weight` (kg), `price` (RM/kg).
