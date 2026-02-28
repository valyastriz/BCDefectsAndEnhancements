# BC Defects & Enhancements (Localhost App)

Full-stack app for rep submissions and admin triage with local DB support, attachments, role-based access, EasyVista submit/resubmit, Excel backfill import, and live Socket.IO notifications.

## Live Site

- https://bc-defects-and-enhancements.vercel.app/

## Stack

- Frontend: React + Vite + React Router
- Backend: Node.js + Express + express-session + Socket.IO
- Database: SQL.js/SQLite (local) with optional Postgres adapter
- Uploads: stored on disk in `server/uploads/<submissionId>/...`

## Project Structure

- `server` - API, auth, DB schema/migrations, uploads, EasyVista integration
- `client` - Rep form, public updates, admin login/dashboard/import UI

## Key Functionality Implemented

- Rep submission form with attachments and validation
- Admin queue with advanced filtering, sorting, modal editing, and timeline/status events
- Retired handling separated from status filters (`non_retired`, `retired_only`, `all`)
- Expanded statuses:
  - `Redirected`
  - `Backlog - Monitoring Impact`
  - `Future Consideration`
  - `Deferred – Not in Current Scope`
- Cleanup workflows (`cleanup_only`, `defect+cleanup`, `enhancement+cleanup`)
- EasyVista submit + resubmit flow with ticket linkage
- Excel import flow for historical/backdated records:
  - Analyze file first (`.xlsx`/`.xls`)
  - Column mapping UI (header → DB field)
  - Unknown status value mapping prompts
  - Required application fallback prompt when file has no app column
  - Per-row fault tolerance (skip bad row, continue others)
  - Import run persistence and review history in modal
- Submission provenance/source tagging via `created_via` (rep form, backdated, cleanup, excel import, resubmission)
- Admin source filter (`Created Via`) for auditing/import verification

## 1) Install

```bash
cd server && npm install
cd ../client && npm install
```

## 2) Environment

Server:

```bash
cd server
cp .env.example .env
```

Client:

```bash
cd client
cp .env.example .env
```

## 3) Seed Admin User

```bash
cd server
npm run seed:admin
```

Defaults if not overridden:

- usernames: `admin` (or from `ADMIN_LOGINS`, comma-separated)
- password: `admin123`

Use `ADMIN_LOGINS` and `SEED_ADMIN_PASSWORD` in `server/.env` to change this.

## 4) Run Locally

In one terminal:

```bash
cd server
npm run dev
```

In another terminal:

```bash
cd client
npm run dev
```

Open `http://localhost:5173`.

## Ports

- Frontend: `5173`
- Backend API/Socket.IO: `4000`

## SQLite Location

Default DB file:

- `server/data/app.db`

Override via `SQLITE_PATH` in `server/.env`.

## Auth & Roles

- `rep`: no login required; can submit and view public updates
- `admin`: login required (`/admin/login`); can view/edit all submissions, manage attachments, and submit/resubmit to EasyVista

## API Overview

Auth:

- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/auth/me`

Rep/Public:

- `POST /api/submissions` (multipart with `attachments`)
- `GET /api/public/submissions`
- `GET /api/public/submissions/:id`

Admin:

- `GET /api/admin/submissions?statuses=&type=&search=&retiredFilter=&createdVia=&sort=`
- `GET /api/admin/submissions/:id`
- `PUT /api/admin/submissions/:id`
- `POST /api/admin/submissions` (admin create/backdated/cleanup)
- `POST /api/admin/submissions/:id/attachments`
- `DELETE /api/admin/attachments/:id`
- `POST /api/admin/submissions/:id/submit-easyvista`
- `POST /api/admin/submissions/import-xlsx/analyze`
- `POST /api/admin/submissions/import-xlsx`
- `GET /api/admin/submissions/import-xlsx/history?limit=5`

## Excel Import Notes

- Upload type is required: `defect`, `enhancement`, or `cleanup`
- Mapping supports fields like:
  - Status, application, policy/account/combined identifiers
  - JIRA/release fields
  - EasyVista fields (`EASYVISTA Number`, `EasyVista Submitted By`)
  - Date fields (`Created At`, `Updated At`, `Closed Date`)
- `Closed Date` is used as the final update/close timestamp when provided
- Blank status defaults to `New`
- Unknown statuses must be explicitly mapped in the modal before import
- If no application column is detected, admin must choose a default application in modal
- Text fields can be auto-filled with `-` where applicable; dropdown/enum-like required fields follow configured defaults/rules
- Import history is saved in DB (`excel_import_runs`) and surfaced in the modal (recent runs)

## Data Provenance / Auditing

Submissions are tagged with `created_via` for traceability:

- `rep_form`
- `admin_backdated`
- `admin_cleanup`
- `admin_excel_import`
- `admin_manual`
- `admin_easyvista_resubmission`

## EasyVista Integration

`server/src/easyvista.js` exposes `submitToEasyVista(submission)`:

- If `EASYVISTA_BASE_URL` or `EASYVISTA_API_KEY` is missing, returns stub ticket IDs like `EV-12345`
- When vars are set, posts a structured payload to EasyVista and stores returned ticket ID in `easyvista_ticket_id`

## Live Updates (Socket.IO)

- Admin clients receive `admin:notification` for:
  - new submission
  - submission updated
  - attachment added/removed
  - EasyVista submitted/resubmitted
- Public page receives `public:update` when public-visible items change

## Notes

- Session cookie name: `bc_sid`
- Uploads are file paths in SQLite (no blob storage)
- Initial public list may be empty until admins mark items as public
