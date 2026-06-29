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
  - [Submit A Request](#1-submit-a-request-)
  - [Status Board](#2-status-board-public)
  - [Admin Login](#3-admin-login-adminlogin)
  - [Admin Dashboard](#4-admin-dashboard-admin)
  - [Admin Metadata Manager](#5-admin-metadata-manager-adminmetadata)
- [Core Features](#core-features)
  - [Submission Lifecycle](#submission-lifecycle)
  - [Cleanup Task Workflow](#cleanup-task-workflow)
  - [EasyVista Integration](#easyvista-integration)
  - [Excel Import](#excel-import)
  - [Excel Export](#excel-export)
  - [Real-Time Updates](#real-time-updates-socketio)
  - [Collaborative Editing & Conflict Safety](#collaborative-editing--conflict-safety)
  - [File Attachments](#file-attachments)
  - [Data Provenance & Auditing](#data-provenance--auditing)
- [Admin Dashboard Deep Dive](#admin-dashboard-deep-dive)
  - [New Submissions Alert](#new-submissions-alert)
  - [Customize View](#customize-view-per-admin-columns--filters)
  - [Filtering](#filtering-16-controls)
  - [Sorting](#sorting)
  - [Inline Table Editing](#inline-table-editing)
  - [Detail Modal](#detail-modal)
  - [Stat Tiles](#stat-tiles)
  - [Toast Notifications](#toast-notifications)
  - [Dark Mode](#dark-mode)
- [API Reference](#api-reference)
- [Database Schema](#database-schema)
- [UI Component Library (BitsizeUI)](#ui-component-library-bitsizeui)
- [Styling & Theming](#styling--theming)
- [Deployment](#deployment)
- [Configuration Reference](#configuration-reference)

---

## Problem Statement

The **Product Owners team** manages a constant stream of billing system defects and enhancement requests from field representatives. They are responsible for triaging, prioritizing, and deciding which issues get escalated to **Tier 2 GTS** (who work the actual tickets in EasyVista). Before this application, the Product Owners team had no centralized system:

- **Defect reports got lost** in email threads, chat messages and spreadsheets with no audit trail and duplicates were difficult to track
- **Enhancement requests had no structured intake** — details were incomplete, duplicates proliferated and there was no easy way or user friendly way to keep track of them
- **Product Owners had no unified queue** to triage, prioritize, and track status across requests
- **Historical data locked in Excel files** could not be searched, filtered, or tracked
- **Escalating to EasyVista** required manual copy-paste of details for Tier 2 GTS
- **Field reps had no visibility** into the status of their submitted requests or any way to see what was previously submitted and the status of any already triaged or worked items, resulting in duplicat submissions work
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
- Personalize the queue — choose which table columns and filters appear (and reorder columns), saved per-admin so it follows you across devices
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

> **Production note:** when `NODE_ENV=production`, the server also runs this
> schema sync automatically on boot (so Render deploys that add tables/columns
> don't need a manual `npm run migrate`). It's idempotent and non-fatal — the
> server still starts if the sync fails, logging the error to the deploy logs.

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

The application is built around **three main pages** plus supporting admin pages:

1. **Submit A Request** (`/`) — Rep-facing submission form
2. **Status Board** (`/public`) — Public transparency view
3. **Admin** (`/admin`) — Product Owners queue and management dashboard

---

### 1. Submit A Request (`/`)

This page is visible to **all users** — no login required. It is the entry point for field representatives to report defects or suggest enhancements.

A **type toggle** at the top switches between two form layouts: **Defect** and **Enhancement**. The fields available on each form are designed to **match the fields on the EasyVista portal identically** — the same field names, the same structure — so that when a Product Owner later submits the request to EasyVista, the data maps cleanly.

#### Defect Form

| Field | Required in This App | Required in EasyVista | Notes |
|-------|---------------------|----------------------|-------|
| Requester Name | ★ Yes | Yes | |
| Policy Number | No | No | |
| Account Number | No | No | |
| Transaction Number | No | No | |
| Application | Auto-set | Yes | Pre-set to "Billing Center" |
| Screen Title | ★ Yes | Yes | |
| Date of Error | ★ Yes | Yes | |
| Time of Error | No | Yes (in EV) | **If left blank, auto-fills with midnight (00:00)** on the selected date |
| Summary of Issue | ★ Yes | Yes | |
| Steps to Reproduce | No | Yes (in EV) | **If left blank, auto-fills with `"-"`** so the field is never empty when sent to EasyVista |
| What Happened (Exact Details) | ★ Yes | Yes | |
| Screenshots (1–3 images) | ★ At least 1 | No | Required here because in most cases, GTS needs to review screenshots at the time of error. EasyVista does not require screenshots, but this app does for defects. Max 3 files. |

**Key differences from EasyVista:**
- **Screenshots are required here but not in EasyVista** — enforced because GTS typically needs them during investigation
- **Time of Error and Steps to Reproduce are required in EasyVista but not here** — if the rep doesn't fill them in, the system fills them automatically (midnight for time, `"-"` for steps) so the EasyVista submission is never incomplete

#### Enhancement Form

| Field | Required in This App | Required in EasyVista | Notes |
|-------|---------------------|----------------------|-------|
| Requester Name | ★ Yes | Yes | |
| Application | Auto-set | Yes | Pre-set to "Billing Center" |
| Summary of Request | ★ Yes | Yes | |
| Request Details | ★ Yes | Yes | |
| Attachments (up to 3 images) | No | No | Optional for enhancements |

**Key difference from EasyVista:** EasyVista requires additional fields for enhancements (**Impact Details** and **Enhancement Request Type**), but reps don't need to provide these. Product Owners fill in those additional fields on the admin side before submitting to EasyVista.

#### After Submission

When the user has filled in all required fields and clicks **"Submit Request"**:
1. A confirmation card appears with a ✓ checkmark, the heading **"Request Submitted"**, and the text: *"Your request has been logged. Reference ID: #XX"*
2. A **"Submit Another Request"** button allows the rep to return to a blank form and submit again

> **Important:** Submitting a request does **NOT** automatically submit it to EasyVista. The request appears in the Admin Queue as a new item awaiting review. Only after a Product Owner reviews the submission and clicks "Submit to EasyVista" will it actually be sent to EasyVista via the API.

---

### 2. Status Board (`/public`)

This page provides **transparency and visibility** to the reps on the items that have been submitted. All users can see this page — no login required.

**What appears on this page:** Only submissions that a Product Owner has explicitly **marked as public** will appear here. Not all items show up — this is a curated view controlled from the admin dashboard.

**Default view:** The page defaults to showing **non-retired items only**. However, the user can change the filter to view Retired Only, Non-Retired Only, or All items.

**Card layout:** The page displays a list of **collapsed item cards**. Each collapsed card shows:
- Summary of the issue
- Item ID
- Type badge (`defect` or `enhancement`)
- Status badge (e.g., New, Approved, Submitted, Deployed)
- Retired badge (if applicable)
- Reported date
- Most recent status update date

**Expanding a card** reveals additional details:
- Full description (prefixed with the requester's name: *"{Name} submitted the following: ..."*)
- Policy number and account number
- Requester name
- Application
- EasyVista ticket number
- JIRA card number
- Tags applied to the item (cleanup, defect, and/or enhancement)

**Filters and controls:**
- **Keyword search** — search across item text
- **Type filter** — Defect / Enhancement
- **Status filter** — Multi-select dropdown
- **Retired filter** — Non-Retired Only (default) / Retired Only / Show All
- **Sort order** — Configurable
- **Pagination** — 50 / 75 / 100 / All per page

**Real-time updates:** The page automatically refreshes when Product Owners update public submissions. A **"● Live update received"** indicator appears when new data arrives via WebSocket.

**Filter persistence:** All filter selections are saved to `localStorage` and restored when the user returns.

---

### 3. Admin Login (`/admin/login`)

Username + password form. On success, redirects to the admin dashboard. Already-authenticated Product Owners are auto-redirected past the login page.

---

### 4. Admin Dashboard (`/admin`)

This page **requires admin login** to view. This is the primary workspace for the Product Owners team — see [Admin Dashboard Deep Dive](#admin-dashboard-deep-dive) for the full breakdown.

When a Product Owner signs in, they see the **Admin Queue** — a list of all cards: Defects, Enhancements, and Cleanups.

**Default view:** The queue defaults to showing **Non-Retired items only**. The user can change this to view Retired Only, Non-Retired Only, or All items.

**Why retire?** The retired status exists so Product Owners can **hide items from view** once they no longer need to see them — for example, older cards that are already deployed, no longer under consideration, or otherwise resolved. This prevents a cluttered queue and keeps the focus on active items. Retired items are never deleted — they can always be unretired and brought back into view.

**At a glance, the admin dashboard provides:**
- Submissions table with 16+ filter controls and 12 sortable columns
- Inline editing of status, cleanup status, public visibility, and JIRA card number directly in the table
- Full detail modal with every submission field, status timeline, impact analysis, frequency tracking, and attachment management
- "As Submitted to EasyVista" preview showing the exact payload sent to EasyVista
- Clickable stat tiles showing non-retired status totals and filtered financial impact totals
- New submission alert banner with count and browser notifications
- Import from Excel, export to Excel
- Create backdated tickets and cleanup tasks
- Submit/resubmit to EasyVista
- Retire/unretire items
- Dark mode toggle

---

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

Product Owners escalate issues to **Tier 2 GTS** by submitting tickets to the EasyVista external ticketing system directly from the dashboard.

> **Key context:** When a request is submitted to EasyVista, the "requester" that EasyVista receives is the name of the **Product Owner (admin) who clicked "Submit to EasyVista"** — not the original field rep. To preserve who actually reported the issue, the description sent to EasyVista is **prefixed with the requester's name**: *"{Requester Name} submitted the following:"* followed by the details. This ensures the original reporter's identity is always visible in the EasyVista ticket.

| Flow | Behavior |
|------|----------|
| **First-time submit** | Constructs a detailed payload from submission fields, prefixes the description with the original requester's name, POSTs to EasyVista API, stores the returned ticket ID, updates status to "Submitted" |
| **Resubmission** | Creates a new linked submission in **Submitted** status (maintaining the chain), copies attachments, preserves the original↔resubmit relationship with IDs |
| **Stub mode** | When `EASYVISTA_BASE_URL` is not configured, generates fake `EV-XXXXX` ticket IDs for development |

**Type-specific validation before submit:**
- **Defects** require: Summary, Screen Title, Description (What Happened)
- **Enhancements** require: Impact Details, Enhancement Request Type (these are the additional fields that reps don't fill in — Product Owners must add them before submitting)
- **Cleanup-only** items must be re-tagged as defect or enhancement before EasyVista submission

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
| `submission:updated` | Admins | Any submission field change (payload includes `updatedBy`) |
| `ticket:presence` | Admins | A ticket was opened/closed/edited (presence soft-lock; see below) |
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

### Collaborative Editing & Conflict Safety

Multiple Product Owners can work the queue at the same time, so the detail modal guards against two people overwriting each other. Everything here is **advisory** — viewing is never blocked, and any warning can be overridden on purpose.

**Presence soft-lock.** Opening a ticket's detail modal claims it (broadcast over Socket.IO via `ticket:enter` / `ticket:activity` / `ticket:leave`). If another admin opens a ticket someone already has open, their modal shows a banner — *"{name} is working on this item · opened 2 min ago · last active just now"* — and the form is **read-only** until they click **Edit anyway**. Presence is in-memory and **auto-releases** when the holder closes the modal or their connection drops (covers "forgot to close the tab"). After **30 minutes** with no activity the banner adds *"· may have stepped away"* and turns amber.

**Optimistic concurrency.** The modal remembers the version (`updated_at`) it loaded and sends it on save. If the record changed in the meantime, the server returns **409 Conflict** instead of overwriting — a hard backstop so nothing is silently clobbered even if a real-time event was missed. The `submission:updated` event also carries `updatedBy`, so an admin with the ticket open is warned the moment someone else saves it. (Inline table quick-edits don't send a base version, so they're unaffected.)

**Conflict review (3-way merge).** When a conflict is detected, a review panel lists **only the fields that overlap**, comparing three versions — the one you opened, your draft, and the now-current saved version. Each field is tagged **Your change / Their change / Both changed**, with **Use current** / **Keep mine** per field. Fields nobody touched don't appear, and pure viewers with no unsaved edits are not interrupted.

**Local draft recovery.** In-progress edits autosave to `localStorage` (per admin + ticket, debounced). If the page reloads, crashes, or is accidentally closed, reopening the ticket offers **Restore** / **Discard** of the recovered draft. Drafts clear automatically on a successful save.

### File Attachments

- **Rep form**: Up to **3** image files per submission. Required for defects (at least 1), optional for enhancements.
- **Admin detail modal**: Up to **10** files per submission, 10 MB per file
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

### New Submissions Alert

At the top of the admin dashboard, a **blue alert banner** appears when there are new, unreviewed rep submissions:
- Displays a count badge: *"X new form submissions are awaiting review"* (or singular for 1)
- A **"View New Submissions"** button applies filters to show only `Status: New`, `Created Via: rep_form`, `Non-Retired` items
- The banner is hidden when there are no new submissions
- Count updates in real-time via Socket.IO

### Customize View (Per-Admin Columns & Filters)

Each admin can tailor the queue to their own workflow. The **"Customize View"** button in the filters bar opens an editor with two sections:

- **Columns** — check which of the table columns appear, and use the **↑ / ↓** arrows to reorder them. At least one column must stay visible.
- **Filters** — check which of the filter controls appear in the filters bar. Hiding a filter **clears its current value** so it can't silently constrain the table.

A **"Reset to Default"** button restores the original column set/order and shows every filter.

**Persistence:** preferences are saved **per admin on the server** (keyed to the user account), so a customized view follows the admin across browsers and **survives clearing `localStorage`**. A local copy is also cached for instant first paint, but the server is the source of truth — on load, the saved view is fetched and applied. (This is separate from **filter *values***, which are still cached in `localStorage` per the [Filtering](#filtering-16-controls) section.)

> New columns or filters added in a future release default to **hidden** for admins who already have a saved view — open *Customize View* (or *Reset to Default*) to surface them.

### Filtering (16+ Controls)

| Filter | Type | Description |
|--------|------|-------------|
| Defect/Enhancement Status | Multi-select dropdown | Filter by one or more statuses |
| Retired | Select | **Non-Retired Only** (default) / Retired Only / Show All |
| Type | Multi-select | Defect / Enhancement / Cleanup Only |
| Cleanup Required | Select | Yes / No / All |
| Cleanup Status | Multi-select dropdown | Not Started / In Progress / Completed |
| Search | Text | By ID, policy #, account #, or keyword |
| Requester | Text | Filter by requester name |
| Submitted by (EV) | Text | Filter by which Product Owner submitted to EasyVista |
| Created Via | Select | rep_form, admin_backdated, admin_cleanup, etc. |
| Year | Text | Filter by submission year (YYYY) |
| In JIRA | Select | Yes / No / All |
| EasyVista # | Text | Search by EasyVista ticket number |
| JIRA # | Text | Search by JIRA card number |
| Release # | Text | Search by release version |
| New Submissions Mode | Toggle | View only unreviewed rep_form submissions |
| Customize View | Button | Open the per-admin view editor — choose/reorder columns and choose which filters appear (see [Customize View](#customize-view-per-admin-columns--filters)) |
| Reset Saved Filters | Button | Restore all filter **values** to defaults |

All filter selections persist in `localStorage` and restore on page reload. *Which* filters are shown is a separate, server-saved per-admin setting (see [Customize View](#customize-view-per-admin-columns--filters)); a filter that is hidden has its value cleared so it never silently constrains results.

**How status matching works:** The status filter selects rows by the status they are *displayed* as — an item with no status shows under "New", and cleanup-only items appear under the **Cleanup Only** option rather than their underlying status. Selecting every status (the default/reset state) applies no status whitelist, so a non-retired item is never hidden just because its status was later retired.

### Sorting

12 sortable columns — click any column header to sort. The default sort is **Status Update (most recent first)**.

| Column | Sort Keys | First Click Direction |
|--------|-----------|----------------------|
| Reported Date | `created_asc` / `created_desc` | Ascending |
| Status Update | `updated_asc` / `updated_desc` | Ascending |
| Type | `type_asc` / `type_desc` | Ascending |
| Summary | `summary_asc` / `summary_desc` | Ascending |
| D/E Status | `status_asc` / `status_desc` | Ascending |
| Public | `public_asc` / `public_desc` | Ascending |
| EasyVista | `easyvista_asc` / `easyvista_desc` | Ascending |
| JIRA Card # | `jira_number_asc` / `jira_number_desc` | Ascending |
| Policy Premium ($) | `policy_premium_impact_asc` / `_desc` | **Descending** |
| Direct Impact ($) | `direct_dollar_impact_asc` / `_desc` | **Descending** |
| Policies Impacted | `policies_affected_count_asc` / `_desc` | **Descending** |
| Frequency | `frequency_asc` / `frequency_desc` | Ascending |

**Note:** Numeric/financial columns (Policy Premium, Direct Impact, Policies Impacted) default to **descending** on first click (highest values first), while all other columns default to ascending. Clicking the same column header again toggles the direction. Sorting is performed server-side on the full dataset. Column visibility and order are controlled per-admin via [Customize View](#customize-view-per-admin-columns--filters); a sortable column that is currently hidden simply isn't shown.

### Inline Table Editing

Four fields are editable directly in the table row without opening the detail modal:

| Field | Control | Behavior |
|-------|---------|----------|
| D/E Status | Dropdown | Changes status immediately, logs the change to the status timeline |
| Cleanup Status | Dropdown | Updates cleanup status |
| Public | Dropdown (Yes/No) | Toggles public visibility, triggers a real-time refresh on the Status Board |
| JIRA Card # | Text input | Saves on Enter or blur |

### Detail Modal

The full submission editor — opens when clicking a table row. Contains the following sections:

#### 1. Triage
The primary decision-making section:
- **Type** — Defect / Enhancement
- **D/E Status** — Dropdown of all statuses. When the item is retired, this dropdown is **disabled** and an info notice reads: *"This item is retired."*
- **Cleanup Task** toggle — Mark as cleanup work
- **Cleanup Status** — Not Started / In Progress / Completed (only if cleanup is enabled)
- **Reviewer** — Who is reviewing this item
- **Duplicate Reference** — Link to the original if this is a duplicate
- **EasyVista Ticket** — The EV ticket ID (populated after EasyVista submission)
- **JIRA Number** — JIRA card reference
- **Created Via** — Shows origin: rep_form, admin_backdated, admin_cleanup, etc.
- **Submitted to EV By** — Which Product Owner submitted to EasyVista

#### 2. Triage / Release Info *(collapsible)*
- **Decision Notes** — Free-text notes on the triage decision
- **Release Number** — Which release this is targeted for
- **Release Notes** — Notes about the release

#### 3. Submission Details
- **Summary** — The issue or request summary
- **Reported Date** — When the item was submitted
- **Requester Name** — Who reported it
- **Email** — Requester's email

#### 4. More Submission Details *(collapsible)*
- **Date/Time of Error** — When the error occurred
- **What Happened (Exact Details)** — Full description
- **Steps to Reproduce** — Steps to reproduce the issue
- **Application** — Billing Center, Policy Center, etc.
- **Policy / Account / Transaction Numbers** — Reference numbers
- **Fingerprint** — Unique signature
- **Screen Title** — Where the error occurred

#### 5. As Submitted to EasyVista *(collapsible)*

This section appears when the submission has already been submitted to EasyVista. It shows a **formatted, read-only preview** of the exact payload that was sent to EasyVista — the same structured text that lives in the EasyVista ticket. This includes:

```
Type: defect
Application: Billing Center
Created By: John Smith (jsmith@company.com)
Policy #: 1234567
Account #: 1234567890
Transaction #: N/A
Screen Title: Payment Summary
Date/Time of Error: 2026-03-15T00:00:00.000Z
Desired Completion Date: N/A
Enhancement Request Type: N/A
Priority Level: N/A
JIRA Number: N/A

Summary:
Payment not applying correctly to policy

Steps to Reproduce:
1. Navigate to Payment Summary...

What Happened (Exact Details):
John Smith submitted the following:
The payment of $500 was applied to the wrong...

Request:
...

Impact Details:
N/A
```

This is useful for Product Owners to verify exactly what EasyVista/GTS sees, and to confirm the requester name prefix is present in the details.

#### 6. Status Timeline
A **chronological history** of every status change — each entry shows:
- The status value (e.g., "New" → "Approved" → "Submitted")
- Who made the change
- When the change occurred

This provides a complete audit trail of the submission's lifecycle.

#### 7. Impact Analysis
Financial impact tracking fields:
- **Policy Premium Impact ($)** — Dollar amount of premium affected
- **Direct Dollar Impact ($)** — Direct financial impact
- **Policies Affected (#)** — Number of policies impacted

#### 8. Frequency
Tracks how often the issue occurs. Three input fields work together:
- **# of Occurrences** — How many times the issue happens (e.g., `10`)
- **Per How Many** — The count of time periods (e.g., `1`, `3`)
- **Time Frame** — The unit of time: Day, Week, Month, Quarter, or Year

**Example:** "10 occurrences per 1 week" or "25 occurrences per 3 months"

**How frequency is calculated for sorting:** The system normalizes all frequency inputs to a **rate per month** for consistent comparison. The formula is:

$$\text{Rate per month} = \frac{\text{occurrences}}{\text{timeframe count} \times \text{days per unit}} \times 30.44$$

Where days per unit: Day = 1, Week = 7, Month = 30.44, Quarter = 91.31, Year = 365.25.

This normalized rate is stored as `occurrence_rate` and used for sorting the Frequency column, so items occurring "10 per week" correctly sort higher than "5 per month."

**Table display:** The frequency column shows a human-readable format: `"10 per week"`, `"25 per 3 months"`, etc.

#### 9. Impact Notes *(collapsible)*
Free-text field for describing the broader impact of the issue.

#### 10. Enhancement Fields *(if applicable)*
Only shown for enhancement-type submissions:
- **Impact Details** — Required before submitting to EasyVista
- **Enhancement Request Type** — Required before submitting to EasyVista (dropdown from metadata)
- **Priority Level** — 1-Urgent through 4-Low
- **Desired Completion Date** — Target date for the enhancement

#### 11. Public Visibility
Toggle to control whether this item appears on the public Status Board, with explanation text.

#### 12. Attachments
- Upload new files (up to 10 per submission, 10 MB each)
- Preview existing image attachments as thumbnails, click to enlarge in a modal
- Delete attachments with an undo capability (pending delete indicators)

#### Modal Footer Actions

| Button | Behavior |
|--------|----------|
| **Save Changes** | Only enabled when fields have been modified (change detection compares current state to loaded state) |
| **Retire Item** | Soft-archives the submission — hides it from the default queue view. The item is NOT deleted. A "Retired" status event is logged to the timeline. When retired, the D/E Status dropdown becomes disabled. |
| **Unretire Item** | Reverses a retire — brings the item back into the active queue. An "Unretired" status event is logged to the timeline. |
| **Submit to EasyVista** | Validates required fields (type-specific), constructs the payload with requester name prefix, submits to EasyVista API, stores the returned ticket ID, updates status to "Submitted" |
| **Re-submit to EasyVista** | Creates a new linked submission (in **Submitted** status), copies attachments, preserves the resubmission chain, and submits the updated version |

### Stat Tiles

Two rows of metric tiles displayed above the submissions table:

**Row 1 — status totals (clickable).** Shows a **Total** count plus a per-status breakdown (New, Approved, Submitted, Deployed) across **all non-retired items, independent of the active filters**. Each tile is a quick filter: clicking **Total** shows every non-retired item, and clicking a status tile filters the table to that status — so the table matches the number on the tile. Counts are keyed off each item's **displayed** status (an item with no status shows as "New", and cleanup-only items are counted under "Cleanup Only", not their underlying status). When the Retired filter includes retired items, a small *"Active totals — excludes retired items"* caption clarifies that Row 1 is always non-retired.

**Row 2 — filtered totals.** Reflects the **current filtered result set**:
- **Filtered Items** — Count of rows matching the active filters
- **Policy Premium Impact ($)** — Sum of policy premium impact across filtered rows
- **Direct Dollar Impact ($)** — Sum of direct dollar impact across filtered rows
- **Policies Impacted** — Sum of policies affected across filtered rows

### Toast Notifications

Real-time in-app toasts appear in the bottom-right corner when:
- A new submission arrives from the rep form
- Submissions are updated by other Product Owners
- Attachments are added or removed
- EasyVista tickets are submitted
- Bulk imports complete

Each toast auto-dismisses after 8 seconds. When the browser tab is backgrounded:
- An **unread count** appears in the tab title: `(3) Admin Queue | ...`
- An **OS desktop notification** is triggered (if the user has granted browser notification permission)

### Dark Mode

A **theme toggle button** is located in the application header bar (next to the navigation links):
- Click **🌙 Dark** to switch to dark mode
- Click **☀️ Light** to switch back to light mode
- The preference is **persisted to `localStorage`** (key: `bc-theme`) and restored on return visits
- If no preference has been saved, the app respects the **OS-level preference** (`prefers-color-scheme: dark` media query)
- Dark mode applies a full dark theme via the `[data-theme='dark']` CSS scope across the entire application

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

### View Preferences

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `GET` | `/api/admin/view-preferences` | Admin | Current admin's saved view (`{ columns, filters }`; `null` arrays = use defaults) |
| `PUT` | `/api/admin/view-preferences` | Admin | Save visible/ordered column keys + visible filter keys (validated against an allow-list) |
| `DELETE` | `/api/admin/view-preferences` | Admin | Reset to default (removes the saved row) |

Identity comes from the session (`req.session.user.id`), never the request body.

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
| `admin_view_preferences` | Per-admin dashboard view (visible/ordered columns + visible filters) | `id`, `user_id` (unique), `columns_json`, `filters_json`, `updated_at` |
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
- **Dark mode**: Full dark theme via `[data-theme='dark']` CSS scope, toggled via the header button, persisted to `localStorage`, with OS preference detection as fallback (see [Dark Mode](#dark-mode) for details)
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
