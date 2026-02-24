# BC Defects & Enhancements (Localhost App)

Full-stack local app for rep submissions and admin triage with SQLite, file attachments, role-based access, modal detail editing, EasyVista submit/resubmit, and live Socket.IO notifications.

## Stack

- Frontend: React + Vite + React Router
- Backend: Node.js + Express + express-session + Socket.IO
- Database: SQLite (file-based)
- Uploads: stored on disk in `server/uploads/<submissionId>/...`

## Project Structure

- `server` - API, auth, SQLite schema, uploads, EasyVista integration stub
- `client` - Rep form, public updates, admin login/dashboard UI

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

- `GET /api/admin/submissions?status=&type=&search=`
- `GET /api/admin/submissions/:id`
- `PUT /api/admin/submissions/:id`
- `POST /api/admin/submissions/:id/attachments`
- `DELETE /api/admin/attachments/:id`
- `POST /api/admin/submissions/:id/submit-easyvista`

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
