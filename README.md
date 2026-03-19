# BC Defects & Enhancements Portal

A full-stack internal operations tool for the **Product Owners team** to track, triage, and manage insurance billing system defects and enhancement requests in one centralized location. The Product Owners team sits between field representatives (who report issues) and Tier 2 GTS support (who work tickets in EasyVista). This application gives Product Owners the structured workflow they previously lacked — connecting intake from reps, through triage and prioritization, to escalation via EasyVista.

> **Live Site:** https://bc-defects-and-enhancements.vercel.app/

---

## Table of Contents

- [Problem Statement](#problem-statement)
- [What This Application Does](#what-this-application-does)
- [Architecture Overview](#architecture-overview)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Getting Started](#getting-started)
  - [Prerequisites](#prerequisites)
  - [Installation](#installation)
  - [Environment Variables](#environment-variables)
  - [Database Setup & Seeding](#database-setup--seeding)
  - [Running Locally](#running-locally)
- [User Roles & Access](#user-roles--access)
- [Application Pages](#application-pages)
  - [Rep Submission Form](#1-rep-submission-form--)
  - [Public Status Board](#2-public-status-board--public)
  - [Admin Login](#3-admin-login--adminlogin)
  - [Admin Dashboard](#4-admin-dashboard--admin)
  - [Admin Metadata Manager](#5-admin-metadata-manager--adminmetadata)
- [Core Features](#core-features)
  - [Submission Lifecycle](#submission-lifecycle)
  - [Cleanup Task Workflow](#cleanup-task-workflow)
  - [EasyVista Integration](#easyvista-integration)
  - [Excel Import](#excel-import)
  - [Excel Export](#excel-export)
  - [Real-Time Updates](#real-time-updates-socketio)
  - [File Attachments](#file-attachments)
  - [Data Provenance & Auditing](#data-provenance--auditing)
- [Admin Dashboard Deep Dive](#admin-dashboard-deep-dive)
  - [Filtering](#filtering-16-controls)
  - [Sorting](#sorting)
  - [Inline Table Editing](#inline-table-editing)
  - [Detail Modal](#detail-modal)
  - [Stat Tiles](#stat-tiles)
  - [Toast Notifications](#toast-notifications)
- [API Reference](#api-reference)
- [Database Schema](#database-schema)
- [UI Component Library (BitsizeUI)](#ui-component-library-bitsizeui)
- [Styling & Theming](#styling--theming)
- [Deployment](#deployment)
- [Configuration Reference](#configuration-reference)

---

## Problem Statement

The **Product Owners team** manages a constant stream of billing system defects and enhancement requests from field representatives. They are responsible for triaging, prioritizing, and deciding which issues get escalated to **Tier 2 GTS** (who work the actual tickets in EasyVista). Before this application, the Product Owners team had no centralized system:

- **Defect reports got lost** in email threads and spreadsheets with no audit trail
- **Enhancement requests had no structured intake** — details were incomplete, duplicates proliferated
- **Product Owners had no unified queue** to triage, prioritize, and track status across requests
- **Historical data locked in Excel files** could not be searched, filtered, or tracked
- **Escalating to EasyVista** required manual copy-paste of details for Tier 2 GTS
- **Field reps had no visibility** into the status of their submitted requests
- **No real-time awareness** when new submissions arrived or existing ones changed

This application solves all of these problems with a purpose-built workflow that connects intake from reps, through Product Owner triage and decision-making, to escalation via EasyVista — end-to-end.

---

## What This Application Does

### For Field Representatives
- Submit defect reports with structured fields (affected policy, account, screen title, steps to reproduce, screenshots)
- Submit enhancement requests with impact details and justification
- View a live public status board showing which requests have been acknowledged and their current status

### For Product Owners (Admins)
- Review incoming submissions from a filterable, sortable queue
- Triage requests: assign status, mark type, flag duplicates, add decision notes
- Track cleanup tasks alongside defects and enhancements
- Escalate to Tier 2 GTS by submitting tickets to EasyVista directly from the app
- Re-submit updated tickets when requirements change, maintaining a linkage chain
- Import historical records from Excel spreadsheets with intelligent column mapping
- Export filtered data to Excel for reporting and audits
- Manage all dropdown options (statuses, types, priority levels, etc.) from a metadata page
- Receive real-time browser notifications when new submissions arrive
- Control which submissions are publicly visible on the status board
- Track financial impact (policy premium, direct dollar, policies affected)
- Retire old submissions without deleting them

---

## Architecture Overview

```
┌─────────────────────┐        ┌──────────────────────┐
│   React SPA Client  │◄──────►│  Express API Server   │
│   (Vite + React 19) │  REST  │  (Node.js + Express 5)│
│                     │  +     │                       │
│   Vercel (prod)     │ WS     │   Render (prod)       │
└─────────────────────┘        └───────────┬───────────┘
                                           │
                     ┌─────────────────────┬┴──────────────────┐
                     │                     │                   │
              ┌──────▼──────┐    ┌────────▼────────┐  ┌──────▼──────┐
              │  SQLite/    │    │  File Storage   │  │  EasyVista  │
              │  PostgreSQL │    │  (Local/Supabase)│  │  REST API   │
              │  (Sequelize)│    │                 │  │  (External) │
              └─────────────┘    └─────────────────┘  └─────────────┘
```

- **Client ↔ Server**: RESTful JSON API + Socket.IO WebSocket for real-time events
- **Database**: Dual-provider — SQLite for local development, PostgreSQL for production
- **File Storage**: Local filesystem (dev) or Supabase Cloud Storage (prod)
- **External**: EasyVista ticket submission API (optional — stubs in dev mode)

---

## Tech Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| **Frontend** | React | 19.2.0 |
| **Routing** | React Router | 7.13.1 |
| **Build Tool** | Vite | 5.4.11 |
| **Backend** | Express | 5.2.1 |
| **ORM** | Sequelize | 6.37.7 |
| **Database** | PostgreSQL / SQLite (sql.js) | pg 8.16.3 / sql.js 1.13.0 |
| **Real-Time** | Socket.IO | 4.8.1 (server) / 4.8.3 (client) |
| **Auth** | express-session + bcrypt | 1.19.0 / 6.0.0 |
| **File Upload** | multer | 2.0.2 |
| **Excel I/O** | xlsx (SheetJS) | 0.18.5 |
| **UI Components** | BitsizeUI (custom) | — |
| **Styling** | Vanilla CSS design system | — |
| **Client Hosting** | Vercel | — |
| **Server Hosting** | Render | — |

No third-party UI frameworks (no Material UI, no Tailwind, no Bootstrap). The entire UI is a custom-built design system.

---

## Project Structure

```
BCDefectsAndEnhancements/
├── client/                          # React SPA
│   ├── public/                      # Static assets
│   ├── src/
│   │   ├── components/
│   │   │   ├── admin/               # 12 admin sub-components + barrel index
│   │   │   │   ├── AdminHeader.jsx
│   │   │   │   ├── BackdatedTicketModal.jsx
│   │   │   │   ├── CleanupTaskModal.jsx
│   │   │   │   ├── DetailModal.jsx
│   │   │   │   ├── ExportModal.jsx
│   │   │   │   ├── FiltersBar.jsx
│   │   │   │   ├── ImportModal.jsx
│   │   │   │   ├── NewSubmissionsAlert.jsx
│   │   │   │   ├── PreviewModals.jsx
│   │   │   │   ├── StatTiles.jsx
│   │   │   │   ├── SubmissionsTable.jsx
│   │   │   │   ├── ToastOverlay.jsx
│   │   │   │   └── index.js
│   │   │   ├── public/              # Public page components
│   │   │   │   ├── PublicFiltersBar.jsx
│   │   │   │   └── PublicItemCard.jsx
│   │   │   └── bite-size/           # BitsizeUI component library
│   │   │       ├── BitsizeUI.jsx
│   │   │       └── Layout.jsx
│   │   ├── constants/               # Shared constants
│   │   │   ├── adminConstants.js
│   │   │   └── publicConstants.js
│   │   ├── hooks/                   # Custom React hooks
│   │   │   ├── useAdminMeta.js
│   │   │   ├── useAdminNotifications.js
│   │   │   ├── useBackdatedModal.js
│   │   │   ├── useCleanupModal.js
│   │   │   ├── useDetailModal.js
│   │   │   ├── useExportModal.js
│   │   │   └── useImportModal.js
│   │   ├── lib/                     # API client & socket singleton
│   │   │   ├── api.js
│   │   │   └── socket.js
│   │   ├── pages/                   # Route-level page components
│   │   │   ├── AdminDashboardPage.jsx
│   │   │   ├── AdminLoginPage.jsx
│   │   │   ├── AdminMetadataPage.jsx
│   │   │   ├── PublicUpdatesPage.jsx
│   │   │   └── RepSubmitPage.jsx
│   │   ├── utils/                   # Utility modules
│   │   │   ├── filterUtils.js
│   │   │   ├── formDefaults.js
│   │   │   ├── formatUtils.js
│   │   │   ├── mappers.js
│   │   │   ├── metaUtils.js
│   │   │   └── publicFilterUtils.js
│   │   ├── App.jsx                  # Router setup
│   │   ├── App.css
│   │   ├── index.css                # Full CSS design system (~1,400 lines)
│   │   └── main.jsx                 # Entry point
│   ├── index.html
│   ├── package.json
│   ├── vite.config.js
│   └── vercel.json                  # Vercel proxy + SPA config
│
├── server/                          # Express API
│   ├── db/
│   │   ├── index.js                 # DB abstraction layer
│   │   ├── schema.js                # (Legacy) raw SQL schema
│   │   ├── sequelize.js             # Sequelize provider factory
│   │   ├── postgres.js              # Raw pg.Pool adapter
│   │   ├── sqljs.js                 # Raw sql.js adapter
│   │   └── models/
│   │       └── index.js             # 14 Sequelize models + lookup seeding
│   ├── scripts/
│   │   └── migrate.js               # DB sync + seed script
│   ├── src/
│   │   ├── index.js                 # Server entry point
│   │   ├── auth.js                  # Session auth middleware
│   │   ├── config.js                # Environment config loader
│   │   ├── constants.js             # Server-side constants
│   │   ├── easyvista.js             # EasyVista API client
│   │   ├── seedAdmin.js             # Admin user seeder
│   │   ├── seedSampleData.js        # Sample data seeder
│   │   ├── socket.js                # Socket.IO setup & event emitters
│   │   ├── helpers/
│   │   │   ├── db.js                # DB query helpers
│   │   │   ├── export.js            # XLSX export field definitions (48 columns)
│   │   │   ├── importUtils.js       # Excel column mapping & parsing
│   │   │   ├── lookups.js           # FK resolution & hydration
│   │   │   ├── mappers.js           # DB row → API response mappers
│   │   │   ├── storage.js           # File storage (local + Supabase)
│   │   │   ├── timeline.js          # Status event timeline builder
│   │   │   └── utils.js             # General utilities
│   │   ├── middleware/
│   │   │   ├── cors.js              # Dynamic CORS origin validation
│   │   │   ├── errorHandler.js      # Global error handler
│   │   │   ├── session.js           # express-session config
│   │   │   └── upload.js            # Multer file upload config
│   │   ├── routes/
│   │   │   ├── adminSubmissionRoutes.js
│   │   │   ├── attachmentRoutes.js
│   │   │   ├── authRoutes.js
│   │   │   ├── easyvistaRoutes.js
│   │   │   ├── importRoutes.js
│   │   │   ├── metaRoutes.js
│   │   │   ├── publicRoutes.js
│   │   │   └── submissionRoutes.js
│   │   └── services/
│   │       └── submissionService.js  # Query builder + business logic
│   ├── uploads/                      # Local file storage root
│   ├── data/                         # SQLite database files
│   └── package.json
│
└── README.md
```

**Codebase size:** ~81 source files, ~13,000 lines of JavaScript/JSX.

---

## Getting Started

### Prerequisites

- **Node.js** 18+ (LTS recommended)
- **npm** 9+
- **PostgreSQL** 14+ (production only — SQLite is used for local development with zero setup)

### Installation

```bash
# Clone the repository
git clone https://github.com/valyastriz/BCDefectsAndEnhancements.git
cd BCDefectsAndEnhancements

# Install server dependencies
cd server && npm install

# Install client dependencies
cd ../client && npm install
```

### Environment Variables

Create a `.env` file in `server/`:

```bash
cd server
cp env .env    # Copy the template
```

**Minimal local config** (works out of the box with SQLite):

```env
PORT=4000
SESSION_SECRET=change-me-to-something-random
DB_MODE=local
```

See [Configuration Reference](#configuration-reference) for the full list of variables.

### Database Setup & Seeding

```bash
cd server

# Run migrations (creates all tables + seeds lookup data)
npm run migrate

# Create admin user(s)
npm run seed:admin

# (Optional) Insert sample submissions for testing
npm run seed:sample
```

**Default admin credentials:**
| Username | Password |
|----------|----------|
| `admin` | `admin123` |

Override with `ADMIN_LOGINS` (comma-separated usernames) and `SEED_ADMIN_PASSWORD` in `.env`.

### Running Locally

**Terminal 1 — Server:**
```bash
cd server
npm run dev        # Uses nodemon for auto-reload
```

**Terminal 2 — Client:**
```bash
cd client
npm run dev        # Vite dev server with HMR
```

Open **http://localhost:5173** in your browser.

| Service | Port | URL |
|---------|------|-----|
| Client (Vite dev server) | 5173 | http://localhost:5173 |
| Server (Express + Socket.IO) | 4000 | http://localhost:4000 |

The Vite dev server automatically proxies `/api`, `/uploads`, and `/socket.io` requests to the backend.

---

## User Roles & Access

| Role | Login Required | Who | Capabilities |
|------|---------------|-----|-------------|
| **Representative** | No | Field reps who encounter issues | Submit defects/enhancements (`/`), view public status board (`/public`) |
| **Product Owner (Admin)** | Yes | Product Owners team members | Full dashboard (`/admin`), metadata management (`/admin/metadata`), all CRUD operations, EasyVista escalation to Tier 2 GTS, import/export |

- Representatives never need an account — the submission form and status board are fully public
- Product Owner routes are protected by a `RequireAdmin` guard that checks session authentication via `api.me()`
- Authentication uses session-based cookies (`bc_sid`, HTTP-only, 8-hour TTL)

---

## Application Pages

### 1. Rep Submission Form (`/`)

The entry point for field representatives to report issues or request changes.

A **type toggle** switches between two form layouts:

#### Defect Report (required fields marked with ★)
| Field | Required |
|-------|----------|
| Requester Name | ★ |
| Policy Number | |
| Account Number | |
| Transaction Number | |
| Application | Auto-set to "Billing Center" |
| Screen Title | ★ |
| Date and Time of Error | ★ |
| Summary of Issue | ★ |
| Steps to Reproduce | |
| What Happened (Exact Details) | ★ |
| Screenshots (1–3 image uploads) | ★ At least 1 |

#### Enhancement Request (required fields marked with ★)
| Field | Required |
|-------|----------|
| Requester Name | ★ |
| Application | Auto-set to "Billing Center" |
| Summary of Request | ★ |
| Request Details | ★ |
| Attachments (up to 3 files) | |

After successful submission, a confirmation card displays the reference ID. The form resets for another submission. Image thumbnails can be previewed and enlarged in a modal before submitting.

### 2. Public Status Board (`/public`)

A live, read-only view of submissions that admins have marked as publicly visible.

- **Card-based layout**: Each submission shows summary, type badge, status badge, reported date, and most recent update
- **Expandable details**: Click a card to reveal policy/account numbers, requester, application, EasyVista ticket, JIRA card, and full description
- **Filters**: Keyword search, type, status (multi-select), retired filter, sort order
- **Pagination**: 50 / 75 / 100 / All per page
- **Real-time**: Automatically refreshes when admins update public submissions — shows a "● Live update received" indicator
- **Filter persistence**: All selections saved to `localStorage` and restored on return visits

### 3. Admin Login (`/admin/login`)

Username + password form. On success, redirects to the admin dashboard. Already-authenticated admins are auto-redirected past the login page.

### 4. Admin Dashboard (`/admin`)

The primary Product Owners workspace — see [Admin Dashboard Deep Dive](#admin-dashboard-deep-dive) for details.

**At a glance:**
- Submissions table with 16+ filter controls and 13 sortable columns
- Inline editing of status, cleanup status, public visibility, and JIRA card number
- Full detail modal with every submission field, status timeline, impact analysis, and attachment management
- Stat tiles showing status distribution and financial impact totals
- New submission alert with browser notifications
- Import from Excel, export to Excel
- Create backdated tickets and cleanup tasks
- Submit/resubmit to EasyVista

### 5. Admin Metadata Manager (`/admin/metadata`)

Manage all configurable dropdown options used throughout the application:

| Category | Examples | Notes |
|----------|---------|-------|
| Defect/Enhancement Statuses | New, Approved, Submitted, Deployed, Retired… | Supports "retired" flag; disabled statuses stay in filters for historical lookups |
| Submission Types | defect, enhancement | |
| Cleanup Statuses | Not Started, In Progress, Completed | |
| Cleanup Tag Types | defect, enhancement, cleanup_only | |
| Applications | Billing Center, Policy Center | |
| Enhancement Request Types | Build-PPM Funded Project, Run-Compliance/Regulatory… | |
| Priority Levels | 1 - Urgent through 4 - Low | |
| Submission Sources | rep_form, admin_manual, admin_excel_import… | **Read-only** (system-managed) |

Each category supports: **add** new values, **rename** (inline edit), **enable/disable**, **reorder** (up/down arrows), and **save**.

---

## Core Features

### Submission Lifecycle

```
Rep submits form  ──►  Status: "New"
                            │
                  Admin reviews in queue
                            │
              ┌─────────────┼─────────────────┐
              ▼             ▼                  ▼
          Approved      Rejected          Redirected
              │          Duplicate         Future Consideration
              │          Deferred          Backlog - Monitoring
              │
         Submit to EasyVista ──► Status: "Submitted"
              │
         Work completed ──► Status: "Deployed"
              │
         (Optional) ──► Status: "Retired"
```

Every status change is logged to a **status timeline** with who changed it and when. The full timeline is visible in the admin detail modal and summarized on the public status board.

### Cleanup Task Workflow

Submissions can be flagged as cleanup tasks — work items that may not originate from rep reports but need tracking:

| Tag Type | Description |
|----------|-------------|
| `cleanup_only` | Standalone cleanup work (no defect/enhancement linkage) |
| `defect` + cleanup | A defect that also requires cleanup |
| `enhancement` + cleanup | An enhancement that also requires cleanup |

Cleanup tasks have their own independent status track (**Not Started → In Progress → Completed**) that operates alongside the defect/enhancement status.

### EasyVista Integration

Product Owners escalate issues to **Tier 2 GTS** by submitting tickets to the EasyVista external ticketing system directly from the dashboard:

| Flow | Behavior |
|------|----------|
| **First-time submit** | Constructs a detailed payload from submission fields, POSTs to EasyVista API, stores the returned ticket ID, updates status to "Submitted" |
| **Resubmission** | Creates a new linked submission (maintaining the chain), copies attachments, preserves the original↔resubmit relationship with IDs |
| **Stub mode** | When `EASYVISTA_BASE_URL` is not configured, generates fake `EV-XXXXX` ticket IDs for development |

**Type-specific validation before submit:**
- **Defects** require: Summary, Screen Title, Description
- **Enhancements** require: Impact Details, Request Type
- **Cleanup-only** items must be re-tagged before EasyVista submission

### Excel Import

Bulk-import historical records from `.xlsx` / `.xls` files:

1. **Upload & Analyze** — Server reads headers, auto-suggests column mappings using alias matching against 30+ target fields
2. **Column Mapping UI** — Admin reviews/adjusts which spreadsheet columns map to which database fields
3. **Status Value Mapping** — Unknown status values are flagged and must be mapped to valid statuses before import
4. **Application Fallback** — If no application column exists, admin selects a default
5. **Import Modes** — `defect`, `enhancement`, or `cleanup` (determines type tag)
6. **Dry-Run** — Preview what would be imported without committing
7. **Commit** — Import with per-row fault tolerance (bad rows skipped, valid rows proceed)
8. **Import History** — Every run recorded in `excel_import_runs` with stats and viewable in the modal

**Smart parsing features:**
- Combined policy/account columns auto-split (7-digit → policy, 10-digit → account)
- Date fields parsed flexibly across formats
- Blank statuses default to "New"
- Text fields auto-filled with `-` where required but absent

### Excel Export

Export filtered submissions as `.xlsx`:

- Respects the current admin filter selections
- **48 available export columns** organized by category
- Field picker UI with search, select all/clear, category grouping
- Downloads directly to browser as a file

### Real-Time Updates (Socket.IO)

| Event | Audience | Trigger |
|-------|----------|---------|
| `submission:new` | Admins | New rep form submission |
| `submission:updated` | Admins | Any submission field change |
| `submission:submitted-easyvista` | Admins | EasyVista ticket created |
| `submission:resubmitted-easyvista` | Admins | EasyVista ticket resubmitted |
| `submissions:bulk-imported` | Admins | Excel import completed |
| `attachment:added` | Admins | File attached to submission |
| `attachment:removed` | Admins | Attachment deleted |
| `public:update` | All users | Public-visible submission changed |

**Admin notification behavior:**
| Scenario | Action |
|----------|--------|
| Tab visible | In-app toast notification (auto-dismiss 8s) |
| Tab hidden | Unread count in tab title `(3) Admin Queue…` + OS desktop notification |
| Always | Requests browser notification permission on first admin page load |

### File Attachments

- **Upload limits**: Up to 10 files per submission, 10 MB per file
- **Storage backends** (auto-detected):
  - **Local filesystem** (default): `server/uploads/<submissionId>/`
  - **Supabase Cloud Storage**: When `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` are configured
- **UI features**: Image thumbnail previews, modal enlarge, pending upload/delete indicators with discard/undo

### Data Provenance & Auditing

Every submission is tagged with `created_via` to identify its origin:

| Source Tag | Meaning |
|-----------|---------|
| `rep_form` | Submitted by a field representative through the public form |
| `admin_backdated` | Created by an admin as a historical/backdated entry |
| `admin_cleanup` | Created as a cleanup task |
| `admin_excel_import` | Imported from an Excel spreadsheet |
| `admin_manual` | Manually created by an admin |
| `admin_easyvista_resubmission` | Created as a linked resubmission of an existing ticket |

Admins can filter the queue by `Created Via` to audit import batches, distinguish rep-submitted items from backfilled records, and trace resubmission chains.

---

## Admin Dashboard Deep Dive

### Filtering (16+ Controls)

| Filter | Type | Description |
|--------|------|-------------|
| Defect/Enhancement Status | Multi-select dropdown | Filter by one or more statuses |
| Retired | Select | Non-Retired Only / Retired Only / Show All |
| Type | Multi-select | Defect / Enhancement / Cleanup Only |
| Cleanup Required | Select | Yes / No / All |
| Cleanup Status | Multi-select dropdown | Not Started / In Progress / Completed |
| Search | Text | By ID, policy #, account #, or keyword |
| Requester | Text | Filter by requester name |
| Submitted by (EV) | Text | Filter by which admin submitted to EasyVista |
| Created Via | Select | rep_form, admin_backdated, admin_cleanup, etc. |
| Year | Text | Filter by submission year (YYYY) |
| In JIRA | Select | Yes / No / All |
| EasyVista # | Text | Search by EasyVista ticket number |
| JIRA # | Text | Search by JIRA card number |
| Release # | Text | Search by release version |
| New Submissions Mode | Toggle | View only unreviewed rep_form submissions |
| Reset Saved Filters | Button | Restore all filters to defaults |

All filter selections persist in `localStorage` and restore on page reload.

### Sorting

13 sortable columns — click column headers to toggle ascending/descending:

> Reported Date · Status Update · Type · Requester · Summary · Status · Public · In JIRA · JIRA Card # · Release # · Policy Premium · Direct Impact · Policies Impacted · Frequency · EasyVista · Submitted By

### Inline Table Editing

Four fields editable directly in the table row without opening the detail modal:

| Field | Control | Behavior |
|-------|---------|----------|
| D/E Status | Dropdown | Changes status immediately, logs to timeline |
| Cleanup Status | Dropdown | Updates cleanup status |
| Public | Dropdown (Yes/No) | Toggles public visibility, triggers status board refresh |
| JIRA Card # | Text input | Saves on Enter or blur |

### Detail Modal

The full submission editor — opens when clicking a table row. Contains these sections:

1. **Triage** — Type, D/E Status, Cleanup Task toggle, Cleanup Status, Reviewer, Duplicate Reference, EasyVista Ticket, JIRA Number, Created Via, Submitted to EV By
2. **Triage / Release Info** *(collapsible)* — Decision Notes, Release Number, Release Notes
3. **Submission Details** — Summary, Reported Date, Requester Name, Email
4. **More Submission Details** *(collapsible)* — Date/Time of Error, Exact Details, Steps to Reproduce, Application, Policy/Account/Transaction, Fingerprint, Screen Title
5. **As Submitted to EasyVista** *(collapsible)* — Formatted preview of the payload sent to EasyVista
6. **Status Timeline** — Chronological history of all status changes with actor and timestamp
7. **Impact Analysis** — Policy Premium Impact ($), Direct Dollar Impact ($), Policies Affected (#)
8. **Frequency** — Occurrences count, per-period, timeframe dropdown
9. **Impact Notes** *(collapsible)* — Free-text impact description
10. **Enhancement Fields** *(if applicable)* — Impact Details, Request Type, Priority Level
11. **Public Visibility** — Toggle with explanation text
12. **Attachments** — Upload new files, preview existing, delete with undo capability

**Modal actions:**
- **Save Changes** — Only enabled when fields differ from the loaded state (change detection)
- **Retire / Unretire** — Soft-archive without deleting
- **Submit to EasyVista** / **Re-submit to EasyVista** — With field-level validation

### Stat Tiles

Aggregated metrics displayed above the submissions table:
- Status distribution counts (how many submissions in each status)
- Total Policy Premium Impact ($)
- Total Direct Dollar Impact ($)
- Total Policies Affected

### Toast Notifications

Real-time in-app toasts appear in the bottom-right corner when:
- A new submission arrives from the rep form
- Submissions are updated by other admins
- Attachments are added or removed
- EasyVista tickets are submitted
- Bulk imports complete

Each toast auto-dismisses after 8 seconds. When the browser tab is backgrounded, an unread count badge appears in the tab title.

---

## API Reference

### Authentication

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `POST` | `/api/auth/login` | Public | Admin login (bcrypt password verify) |
| `POST` | `/api/auth/logout` | Public | Destroy session, clear cookie |
| `GET` | `/api/auth/me` | Public | Return current session user or 401 |

### Metadata

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `GET` | `/api/meta/options` | Public | Active lookup values for form dropdowns |
| `GET` | `/api/admin/meta/options` | Admin | Full metadata with IDs, sort order, active/retired flags |
| `POST` | `/api/admin/meta/:category` | Admin | Add new lookup value |
| `PUT` | `/api/admin/meta/:category/:id` | Admin | Update lookup value |
| `POST` | `/api/admin/meta/:category/reorder` | Admin | Reorder lookup values |

### Submissions — Public / Rep

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `POST` | `/api/submissions` | Public | Submit from rep form (multipart with attachments) |
| `GET` | `/api/public/submissions` | Public | List public-visible submissions |
| `GET` | `/api/public/submissions/:id` | Public | Single public submission detail |

### Submissions — Admin

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `GET` | `/api/admin/submissions` | Admin | List all with filtering + sorting (16+ query params) |
| `GET` | `/api/admin/submissions/:id` | Admin | Full detail with timeline + attachments |
| `POST` | `/api/admin/submissions` | Admin | Create (backdated, manual, cleanup) |
| `PUT` | `/api/admin/submissions/:id` | Admin | Update fields, log status changes |

### Attachments

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `POST` | `/api/admin/submissions/:id/attachments` | Admin | Upload up to 10 files |
| `DELETE` | `/api/admin/attachments/:id` | Admin | Delete an attachment |

### Import / Export

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `POST` | `/api/admin/submissions/import-xlsx/analyze` | Admin | Analyze uploaded Excel file |
| `POST` | `/api/admin/submissions/import-xlsx` | Admin | Import rows (supports dry-run) |
| `GET` | `/api/admin/submissions/import-xlsx/history` | Admin | Recent import runs |
| `GET` | `/api/admin/submissions/export-xlsx` | Admin | Download filtered .xlsx |
| `GET` | `/api/admin/submissions/export-fields` | Admin | Available export columns |

### EasyVista

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `POST` | `/api/admin/submissions/:id/submit-easyvista` | Admin | Submit or resubmit to EasyVista |

### Health

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `GET` | `/api/health` | Public | Returns `{ ok: true }` |

---

## Database Schema

### Core Tables

| Table | Purpose | Key Fields |
|-------|---------|------------|
| `users` | Admin accounts | `id`, `username`, `password_hash`, `role` |
| `submissions` | Central entity (~40 columns) | `id`, `summary_of_issue`, `status_id`, `type_id`, `application_id`, `is_cleanup`, `is_public`, `is_retired`, `created_by`, `created_via`, `easyvista_ticket_id`, financial impact fields, occurrence tracking, resubmission chain fields |
| `attachments` | File references | `id`, `submission_id`, `filename`, `mime_type`, `file_path`, `uploaded_by_role` |
| `submission_status_events` | Status audit trail | `id`, `submission_id`, `status`, `changed_at`, `changed_by` |
| `excel_import_runs` | Import history log | `id`, `file_name`, `import_mode`, `total_rows`, `inserted_rows`, `status`, `errors_json` |

### Lookup Tables

All share the structure: `id`, `name`, `sort_order`, `is_active`

| Table | Default Values |
|-------|---------------|
| `defect_enhancement_statuses` | New, Approved, Redirected, Backlog - Monitoring Impact, Future Consideration, Deferred – Not in Current Scope, Rejected, Duplicate, Submitted, Deployed, Retired |
| `submission_types` | defect, enhancement |
| `cleanup_statuses` | Not Started, In Progress, Completed |
| `cleanup_tag_types` | defect, enhancement, cleanup_only |
| `applications` | Billing Center, Policy Center |
| `enhancement_request_types` | Build-PPM Funded Project, Build-Small Enhancement, Build-Small Project (Not PPM Funded), Run-Compliance/Regulatory/Rate Revision, Run-Other Operational Work |
| `priority_levels` | 1 - Urgent, 2 - High, 3 - Medium, 4 - Low |
| `submission_sources` | rep_form, admin_backdated, admin_cleanup, admin_excel_import, admin_manual, admin_easyvista_resubmission |
| `occurrence_timeframes` | Day (1), Week (7), Month (30.44), Quarter (91.31), Year (365.25) |

---

## UI Component Library (BitsizeUI)

The application uses a hand-built component library — no external UI dependencies:

| Component | Description |
|-----------|-------------|
| `Card` | Section container with optional title, subtitle, and header action slot |
| `Input` | Labeled text input with optional required indicator |
| `Select` | Labeled dropdown with custom caret styling |
| `MultiSelectDropdown` | Custom multi-select with checkbox list, Select All / Clear All controls |
| `Textarea` | Labeled textarea with optional required indicator |
| `Button` | Styled button — variants: `primary`, `secondary`, `ghost`, `danger` |
| `Badge` | Color-coded status/type pill (auto-colors by value name) |
| `Modal` | Overlay dialog with Escape-to-close, scrollable body, title bar |
| `Notice` | Alert banner — variants: `error`, `success`, `info` |
| `AppShell` | Top-level layout with responsive nav, hamburger menu, dark/light theme toggle |

---

## Styling & Theming

- **Design system**: ~1,400 lines of vanilla CSS with CSS custom properties (design tokens)
- **Color palette**: Slate gray (50–900) + Blue brand (50–900) scales
- **Status colors**: Each status has dedicated foreground/background tokens
  - New = blue, Approved = green, Rejected = red, Duplicate = orange, Submitted = purple, Deployed = teal
- **Dark mode**: Full dark theme via `[data-theme='dark']` CSS scope, toggled via the UI switch in the header, persisted to `localStorage`
- **Responsive**: Mobile hamburger menu, horizontal-scroll tables, stacked filter controls on small screens
- **No preprocessors**: Pure CSS with BEM-inspired naming (`bs-` prefix for BitsizeUI components)

---

## Deployment

### Production Architecture

| Component | Host | Notes |
|-----------|------|-------|
| Client (React SPA) | **Vercel** | Static build, SPA fallback |
| Server (Express API) | **Render** | Node.js web service |
| Database | **PostgreSQL** | Render Postgres, Supabase, or any provider |
| File Storage | **Supabase Storage** | Or local filesystem for single-server setups |

### Vercel Configuration

`client/vercel.json` rewrites:
- `/api/*` → proxied to Render backend
- `/socket.io/*` → proxied to Render backend (WebSocket support)
- `/*` → `/index.html` (SPA catch-all)

### Build Commands

```bash
# Client production build
cd client && npm run build    # Output: client/dist/

# Server — no build step, runs directly
cd server && node src/index.js
```

---

## Configuration Reference

All environment variables for `server/.env`:

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PORT` | No | `4000` | Server listening port |
| `NODE_ENV` | No | `development` | `development` or `production` |
| `CLIENT_ORIGIN` | No | `http://localhost:5173` | Comma-separated allowed CORS origins |
| `SESSION_SECRET` | **Yes (prod)** | `local-dev-secret-change-me` | Express session encryption secret |
| `SESSION_COOKIE_SAME_SITE` | No | `none` (prod) / `lax` (dev) | Cookie SameSite policy |
| `SESSION_COOKIE_SECURE` | No | `true` (prod) / `false` (dev) | Cookie Secure flag |
| `SESSION_COOKIE_DOMAIN` | No | — | Cookie domain for cross-origin setups |
| `DB_MODE` | No | `local` | `local` (SQLite) or `hosted` (PostgreSQL) |
| `DB_PROVIDER` | No | auto from DB_MODE | `postgres` or `sqljs` |
| `DATABASE_URL` | If postgres | — | PostgreSQL connection string |
| `SQLITE_PATH` | No | `./data/dev.sqlite` | SQLite file location |
| `SUPABASE_URL` | No | — | Supabase project URL (enables cloud storage) |
| `SUPABASE_SERVICE_ROLE_KEY` | No | — | Supabase service role key |
| `SUPABASE_STORAGE_BUCKET` | No | `attachments` | Supabase storage bucket name |
| `ADMIN_LOGINS` | No | `admin` | Comma-separated admin usernames to seed |
| `SEED_ADMIN_PASSWORD` | No | `admin123` | Password for seeded admin accounts |
| `EASYVISTA_BASE_URL` | No | — | EasyVista API URL (blank = stub mode) |
| `EASYVISTA_API_KEY` | No | — | EasyVista API bearer token |

---

## License

This project is proprietary internal tooling. All rights reserved.
