# Service Requests Portal

A submission and triage portal for **Billing Center** and **Policy Center**. Field
representatives file defects, enhancement requests and requests for reports and
dashboards; the Customer Interactions team triages them; approved defects and
enhancements are escalated to Tier 2 GTS in EasyVista, and report requests are built
in-house. Everything is visible to the person who reported it on a live status board.

**Status: working prototype.** It runs, it holds test data, and it is the reference
for a rebuild on the organisation's own stack — not the thing that ships long-term.

---

## Start here

| If you want to… | Read |
|---|---|
| **Use the portal** — file a request, or work the queue | **[`docs/USER_MANUAL.md`](docs/USER_MANUAL.md)** — every feature, with current screenshots and the test logins |
| **Rebuild it** — or understand any decision in it | **[`docs/DEVELOPER_HANDOFF.md`](docs/DEVELOPER_HANDOFF.md)** — the how *and* the why, in one document: architecture, data model, API, deployment, the full decision record, and the acceptance checklist |
| **Know what happens next** | **[`docs/NEXT_STEPS.md`](docs/NEXT_STEPS.md)** — the Citizen Developers outcome (**Rebuild**), what is being asked of the Customer Interactions team, and who owns the product |

> These three replace the two overlapping READMEs this repo used to have. The old
> `docs/handoff/README.md` is gone; its content is in `docs/DEVELOPER_HANDOFF.md`.
> `docs/handoff/` holds the screenshots, their manifest, and the PDFs.

**To send one to somebody:** all three are in [`docs/handoff/pdf/`](docs/handoff/pdf/) —
[`DEVELOPER_HANDOFF.pdf`](docs/handoff/pdf/DEVELOPER_HANDOFF.pdf),
[`USER_MANUAL.pdf`](docs/handoff/pdf/USER_MANUAL.pdf),
[`NEXT_STEPS.pdf`](docs/handoff/pdf/NEXT_STEPS.pdf) — with the contents list and every
cross-reference inside each document clickable. They are exported by hand with the
VS Code extension **Markdown PDF** (`yzane.markdown-pdf`), so **re-export after
editing a document**; see
[the handoff](docs/DEVELOPER_HANDOFF.md#the-pdfs) for the three limits of that route.

Also: [`plan.md`](plan.md) is the running project record ·
[`CLAUDE.md`](CLAUDE.md) is the conventions file for AI-assisted work in this repo ·
[`server/docs/`](server/docs/) has the AI-search and EasyVista payload references.

---

## Quick start

```bash
# Server
cd server
npm install
cp .env.example .env          # edit it — see the handoff, §19
npm run migrate               # create tables + seed lookup data
npm run seed:admin            # create the admin account
npm run seed:team-accounts -- --apply     # the eight working accounts + grants
npm run seed:other-application -- --apply
npm run dev                   # http://localhost:4000

# Client (separate terminal)
cd client
npm install
npm run dev                   # http://localhost:5173
```

Then sign in at `/admin/login`. Accounts and passwords:
[the manual's appendix](docs/USER_MANUAL.md#appendix-test-accounts).

> ### ⚠️ Check `server/.env` before you run anything
>
> The database is selected by `DB_PROVIDER` / `DB_MODE`. With
> `DB_PROVIDER=postgres` you are connected to the **live shared database**, and
> every maintenance script writes to whatever the environment points at.
>
> To force a sandboxed local run without editing the file — `dotenv` does not
> override real environment variables, so these win:
>
> ```bash
> DB_MODE=local DB_PROVIDER=sqljs DATABASE_URL= npm run dev
> ```
>
> `[keepAlive] Supabase heartbeat OK` in the log does **not** mean you are on hosted
> data. That ping runs regardless of provider.

### Demonstration data

`npm run seed:realistic` writes 39 requests covering all four kinds of work, three
applications, every status, both report-request branches, and three months of logged
analyst hours — enough for every screen to draw something real.

---

## Verifying

```bash
cd server && npm test          # 378 tests (node:test)
cd client && npm run lint      # ESLint incl. react-compiler rules — must stay green
cd client && npm run build     # production build
```

With the server on `:4000` and Vite on `:5173` already running:

```bash
cd client
node scripts/verify-submit-form.mjs          # and six more verify-*.mjs
node scripts/capture-screenshots.mjs         # 62 shots + the manifest
```

The browser harness is what proves the things unit tests cannot — per-container
overflow, field counts, live behaviour, and the four traps that make browser probes
wrong more often than the code is. See
[the handoff, Part VII](docs/DEVELOPER_HANDOFF.md#part-vii--running-and-verifying).

**Do not pipe a verify script through `head`** — SIGPIPE kills the run before its
cleanup and strands fixtures in the shared database. Redirect to a file.

---

## Tech stack, in one table

| Layer | Choice |
|---|---|
| Frontend | React 19, React Router 7, Vite 5 |
| UI | **Custom design system** (`client/src/components/bite-size/`) + vanilla CSS. No MUI, Tailwind or Bootstrap. |
| Backend | Node, Express 5, Sequelize 6 |
| Database | PostgreSQL, or SQLite (`sql.js`) locally |
| Real-time | Socket.IO |
| Sessions | `express-session` + `connect-pg-simple` |
| Excel | `xlsx` (SheetJS) |
| AI search | Claude **or** OpenAI for summaries; in-process, OpenAI or Voyage for embeddings. **Optional and self-disabling.** |

Architecture, data model, API surface and configuration are all in the handoff.

---

## License

Proprietary internal tooling. All rights reserved.
