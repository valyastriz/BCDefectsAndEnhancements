---
name: new-project-creation
description: "Use when the task is a NEW project — trigger phrases: 'new project', 'scaffold', 'bootstrap', 'green-field repo' — creating a Node or React project around a copied database-manager.js and generate-migrations.js with PostgreSQL + Sequelize, plus optional (ask-first) Redis auto invalidation, ws-based live data, and react-intl multi-language support. Scaffolds the house patterns (structure, env, startup, CLAUDE.md + plan.md project contracts, locale check scripts) and verifies the project boots before finishing. Not for adding features or layers to an existing project."
---

# New Project Creation

## Purpose

Use this skill when building a new project that should adopt the existing database-manager workflow instead of inventing a new migration system.

This skill makes the agent scaffold the support files, environment, startup flow, and validation steps required for a fresh project to run with a copied `database-manager.js` and `generate-migrations.js`. It also provides optional, user-confirmed paths for Redis-based cache invalidation, `ws`-based live data, and multi-language support for both static UI text and translated dynamic content. When building the database backend, use Sequelize models, associations, and ORM access patterns rather than hardcoded SQL queries.

## Use This Skill When

- Creating a brand new Node backend that should use the existing `database-manager.js`
- Bootstrapping a new Sequelize + PostgreSQL project from scratch
- Reusing the migration and auto-sync system in another repository
- Setting up a fresh project where the only supplied files are or will be (ask the user if they want to provide them) `database-manager.js` and `generate-migrations.js`
- Creating a new project that may optionally include Redis auto invalidation, `ws`-based live data, and/or multi-language UI with translated dynamic content
- Building a project that must match the current migration, cache, and live update architecture instead of replacing it

## Do Not Use This Skill When

- The project does not want Sequelize or PostgreSQL
- The project wants manual migration authoring instead of `database-manager`
- The project wants a different migration architecture unrelated to the copied files
- The project explicitly wants Socket.IO as the primary live-data transport rather than the current `ws` implementation

## Behavior

When this skill is active, follow these rules. They are numbered sequentially and grouped: scope and detection (1–7), ask-first gates (8–12), hard security and data rules (13–22), finish-line checks (23–24). LOAD the operating-discipline skill before starting and fill its templates from its text, not from memory.

### Scope and detection

1. Assume the only guaranteed source files are `database-manager.js` and `generate-migrations.js` unless the user provides more.
2. Detect whether those files already exist in the target project before creating support files around them.
3. If the two files are not yet present, scaffold the surrounding structure first so they can be copied in without path breakage.
4. Do not redesign `database-manager`; build the project around its existing import and runtime expectations.
5. Always create the minimum compatible support files before trying to run migrations.
6. Never manually author schema migrations when `database-manager` is the intended migration system. Change models and let the manager detect and generate migrations.
7. Layout decision: use a `backend/` folder for a fullstack project. Choose a flat root ONLY if the repo already has server code at its root or the user explicitly asks for it; record the choice with a one-line reason (operating-discipline section 5).

### Ask-first gates

8. Ask the user before adding Redis support.
9. Ask the user before adding live data support.
10. Ask the user before adding multi-language support.
11. If the user chooses live data (rule 9 governs — always ask first), implement the current `ws` pattern, not Socket.IO, unless they explicitly ask for a Socket.IO adaptation; build the frontend on the WebSocketContext and wsManager patterns from the start, and keep the frontend PWA-compatible so live data can expand later without a breaking refactor.
12. If the user chooses multi-language support, implement the current `react-intl` frontend pattern and backend user-language resolution pattern rather than inventing a different i18n stack.

### Hard security and data rules

13. Scaffold backend code around the shared logger in `backend/functions/logger.js` and make new backend modules use that logger instead of raw console statements.
14. Any backend code you create must include meaningful structured logs for startup, important background work, guard-path exits, successful mutations, and caught failures.
15. Keep generated logs safe and useful: include identifiers and outcome context, but do not log secrets, credentials, tokens, or full sensitive payloads.
16. Never authenticate with `jwt.decode` anywhere — websocket and HTTP auth use `jwt.verify` with explicit algorithms, audience, and issuer.
17. Never cache an authenticated response under a tenant-blind key: cache keys include tenant scope and the query string, and invalidation uses tenant-scoped patterns.
18. Money is never FLOAT/DOUBLE: any currency-amount column is `DECIMAL` with explicit precision. Relations join on ids, never on name strings — a rename must never silently unlink data.
19. Scaffold every list route paginated by default (`page`/`limit` clamps, `{ rows, total }` response) — fetch-all list endpoints must not be the starter pattern.
20. Build the database layer around Sequelize models, associations, scopes, and ORM methods instead of hardcoded SQL strings.
21. Raw SQL is allowed only where Sequelize cannot cover the need cleanly — canonical cases: a recursive CTE, window functions over large sets, bulk upsert with `ON CONFLICT` arithmetic — and each such query lives behind one named data-access function, never scattered through controllers or services.
22. Treat destructive database options as opt-in only and keep them disabled until verification passes.

### Finish-line checks

23. Snippets in this skill are starting points, not literal truth: before finishing, confirm every import in generated files resolves to a file you scaffolded, every referenced function exists, and no placeholder invalidation, stubbed handler, or unwired `res.locals` contract remains.
24. Also scaffold the project's contracts layer: a root `CLAUDE.md` and a root `plan.md` (see the sections below) and the frontend locale check scripts with their npm aliases.

### STOP — mid-scaffold red flags

Halt and fix (operating-discipline section 9) the moment you catch yourself:

1. Authenticating a websocket or route with `jwt.decode` instead of `jwt.verify`.
2. Writing a cache key without tenant scope or the query string.
3. Scaffolding an unbounded `findAll` list route.
4. Typing FLOAT/DOUBLE for a money column, or joining on a name string where an id exists.
5. Copying a snippet from this skill without confirming it matches the source project's current file — the source project wins; surface any divergence as a headline (see the premise check in Inspect First).

## Delegation

Per context-lean-orchestrator, scaffolding a project is a job for one strong subagent, not inline orchestrator work. The Required Questions below are answered with the user BEFORE dispatch. The orchestrator writes a brief file in the scratchpad using operating-discipline section 8's BRIEF template, with these fields filled concretely:

- Constraints (VERBATIM): the user's answer to every Required Question, quoted — the subagent never guesses about Redis, live data, or multi-language support.
- Chosen layers: each optional layer marked add / do NOT add — an unchosen layer is explicitly forbidden, not merely omitted.
- You own: the new project's tree. You must NOT touch: the source project (read-only reference) or anything outside the new tree.
- Checklist: the scaffold steps, prune/rename lists, and the End-of-Scaffold Boot Checklist — to be executed, not described.
- Return exactly: operating-discipline's REPORT, plus the boot checklist item-by-item with the command run and observed result, and an explicit "not run:" list.

The orchestrator reviews the returned report against the brief before accepting the work.

## Workflow

### 1. Inspect First

Before writing code, inspect the target project and identify:

- whether the project uses `backend/` or a flat root
- whether `scripts/database-manager.js` already exists
- whether `scripts/generate-migrations.js` already exists
- whether Sequelize is already configured
- whether there is already a `models/index.js`
- whether data access is expected to go through Sequelize models and associations rather than raw queries
- whether there is already a logging bridge compatible with `initializeBackendLogging()`
- whether nearby backend modules already define structured logging patterns worth reusing
- whether frontend live data is needed or backend-only notifications are enough

Record these findings with file references as the Knowns of your INTAKE block (operating-discipline section 1) — inspection that stays in your head is not inspection.

**Premise check (operating-discipline section 2):** before scaffolding any pattern this skill calls "current" or "house", open the source project the user is copying from and confirm the pattern still exists there in that shape. Where a snippet in this skill diverges from the source project's current files, the source project wins — surface the divergence as a headline in your report; never silently scaffold the stale version. This applies especially to the legacy `modelCacheHooks` template below: some source projects have retired model-hook invalidation in favor of explicit invalidation in mutation paths. If the source project cannot be inspected (files pasted, no repo access), the default is NO `modelCacheHooks` — invalidate explicitly in mutation paths; scaffold the legacy file only on positive confirmation that the source still uses it.

### 2. Ask The Required Questions

Before adding optional systems, ask the user these concrete questions:

- Do you want Redis support for response caching and automatic invalidation?
- Do you want live data support using the current `ws`-based WebSocket pattern?
- Do you want multi-language support using the current `react-intl` frontend pattern and backend translation helpers?

Recommended Redis choices:

- no Redis
- Redis cache only
- Redis cache plus background invalidation queue workers

Recommended live-data choices:

- no live data
- backend-only websocket notifications
- full websocket live data with frontend manager and provider

Recommended multi-language choices:

- no multi-language support
- static UI translations only
- UI translations plus persisted user language preference
- full multi-language support with UI translations and backend dynamic-content translation

Record each answer and each structural choice (layout, chosen layers) as a one-line DECISION with its reason (operating-discipline section 5) — in the delegation brief when delegated, in your working notes when inline. A layer the user did NOT choose is recorded as forbidden ("do NOT add"), not merely left unchosen.

### 3. Scaffold Base Migration Support

Create the minimum files required to support the copied migration system:

- `backend/scripts/database-manager.js`
- `backend/scripts/generate-migrations.js`
- `backend/models/index.js`
- `backend/config/config.js`
- `backend/config/dependencyOrder.js`
- `backend/functions/logger.js`
- `backend/migrations/`
- `backend/package.json` scripts or root `package.json` scripts
- `backend/start.sh` or equivalent startup hook

### 4. Wire Startup In The Correct Order

The base startup order should be:

1. initialize logging
2. load environment
3. initialize Sequelize
4. run `database-manager`
5. start the HTTP server
6. optionally initialize Redis
7. optionally start queue workers
8. optionally attach websocket server and listeners

The HTTP server is guarded from the first route: scaffold `middleware/authMiddleware.js` (verify JWTs with `jwt.verify` + JWKS, explicit algorithms/audience/issuer — the same options as the websocket auth snippet, NEVER `jwt.decode`) mounted on all `/api` routes, and `middleware/permissionMiddleware.js` exporting a `requirePermission("<resource>", "<action>")` stub that every route registers (or a `// public: <reason>` comment). Scaffold both BEFORE the first route file so later routes inherit the guard — a project whose REST routes ship open fails the boot checklist.

### 5. Scaffold the Project Contracts (CLAUDE.md + plan.md)

Every new project gets a root `CLAUDE.md` so the shared skills have their per-project grounding layer. Model it on the source project's `CLAUDE.md`, filled in with the new project's concrete names:

- Definition of Done (runnable verification checklist with this project's commands and ports)
- Live-update contract (this project's ws helper and frontend subscription layer, tenant filter requirement)
- Migration workflow (this project's commands; whether migrations auto-run on boot)
- Backend + frontend conventions (layout, permission middleware, pagination default, logger, theme, snackbar/dialog components)
- Localization workflow (locale set, `locales:check`/`locales:clean`)
- Docs & guided-tour upkeep: if/when the project has an in-app help-docs module or guided tours, keeping them current for a changed feature is part of the Definition of Done (see guided-onboarding-walkthroughs)
- AI usage guidance (match model/effort to task complexity)

Also scaffold a root `plan.md` from the project-plan-maintenance skill's skeleton: overview, architecture, chosen optional layers, and each Required-Question decision with its one-line reason. The scaffolded CLAUDE.md and plan.md carry the durable decisions; the brief or working notes carry the rest.

### 6. Verify Before Expanding

Before enabling destructive flags or optional features:

- run the manager in safe diff mode
- verify DB connection and model loading
- confirm `SequelizeMeta` can be created
- confirm migration output is written to `migrations/`
- confirm checksum and schema diff behavior works
- if multi-language support is enabled, verify locale fallback to English, saved user language hydration, and translation-aware response serialization

### 7. End-of-Scaffold Boot Checklist (all required)

The scaffold is not done until each of these was actually executed:

- `npm install` completes cleanly in every scaffolded package
- every import in generated files resolves; no placeholder invalidation or stubbed handler remains
- `database-manager.js` runs clean and the backend boots without require errors
- an unauthenticated request to a protected route returns 401, and a request with a valid token succeeds — executed, not assumed
- if live data: the websocket authenticate round-trip succeeds with a real verified JWT, and a second client receives a mutation event without refresh
- if Redis: observe cache MISS → HIT → invalidate on a real endpoint, and confirm the app degrades gracefully with Redis stopped
- if multi-language: `locales:check` and `locales:clean` run clean

Then run the operating-discipline §6 critique pass on the scaffolded tree before reporting. Report the checklist item-by-item per operating-discipline §6–7 — the command run and the observed result; items that could not run (e.g., Docker unavailable) go under an explicit "not run:" heading with the reason; never summarize as "all checks pass".

## Preferred Structure

Prefer this structure for a new fullstack project:

```text
project-root/
    backend/
        package.json
        .env
        start.sh
        server.js
        config/
            config.js
            dependencyOrder.js
            redisConfig.js
            queueConfig.js
        functions/
            logger.js
            cacheUtils.js
            appLanguages.js
            chatTranslation.js
            modelCacheHooks.js   # legacy — only if the source project still uses it
            queueWorkers.js
            webSocketUtils.js
        middleware/
            authMiddleware.js        # HTTP jwt.verify (JWKS) — mounted on all /api routes
            permissionMiddleware.js  # requirePermission("<resource>", "<action>")
            cacheMiddleware.js
        models/
            index.js
            User.js
            ...
        migrations/
        scripts/
            database-manager.js
            generate-migrations.js
    frontend/
        src/
            layout/
                UserSettingsLoader.jsx
            utils/
                locales/
                wsManager.js
            contexts/
                ConfigContext.jsx
                WebSocketContext.jsx
            ui-component/
                Locales.jsx
```

If the project uses a flat root instead of `backend/`, preserve the same relative import relationships expected by the copied files.

## Base Blueprint

These files are the minimum compatibility layer for `database-manager`.

### `config/config.js`

This file must configure Sequelize for PostgreSQL and support both a single connection URL and discrete DB credentials.

```js
require("dotenv").config();

const useDatabaseUrl = process.env.USE_DATABASE_URL === "true";

const baseConfig = useDatabaseUrl
    ? {
          use_env_variable: "DATABASE_URL",
          dialect: "postgres",
          dialectOptions:
              process.env.NODE_ENV === "production"
                  ? { ssl: { require: true, rejectUnauthorized: false } }
                  : {},
      }
    : {
          username: process.env.DB_USER,
          password: process.env.DB_PASSWORD,
          database: process.env.DB_NAME,
          host: process.env.DB_HOST || "localhost",
          port: parseInt(process.env.DB_PORT || "5432", 10),
          dialect: "postgres",
      };

module.exports = {
    development: baseConfig,
    test: baseConfig,
    production: baseConfig,
};
```

### `functions/logger.js`

This file must expose `initializeBackendLogging()` because the copied scripts call it at startup.

```js
let loggingInitialized = false;

const logMessage = (message, level = 3) => {
    const currentLevel = parseInt(process.env.LOG_MODE || "3", 10);
    if (level <= currentLevel) {
        console.log(message);
    }
};

const logCriticalError = (...args) => {
    console.error(...args);
};

const logStructuredMessage = (...args) => {
    console.log(...args);
};

const initializeBackendLogging = () => {
    if (loggingInitialized) {
        return;
    }

    loggingInitialized = true;
};

module.exports = {
    initializeBackendLogging,
    logMessage,
    logCriticalError,
    logStructuredMessage,
};
```

### `config/dependencyOrder.js`

This file must exist even if it starts empty.

```js
module.exports = [];
```

### `models/index.js`

This file must load all models and export both the Sequelize instance and the model registry.

```js
const fs = require("fs");
const path = require("path");
const { Sequelize, DataTypes } = require("sequelize");
const env = process.env.NODE_ENV || "development";
const config = require("../config/config")[env];

const sequelize = config.use_env_variable
    ? new Sequelize(process.env[config.use_env_variable], config)
    : new Sequelize(config.database, config.username, config.password, config);

const db = {};
const basename = path.basename(__filename);

fs.readdirSync(__dirname)
    .filter((file) => file !== basename && file.endsWith(".js"))
    .forEach((file) => {
        const defineModel = require(path.join(__dirname, file));
        const model = defineModel(sequelize, DataTypes);
        db[model.name] = model;
    });

Object.values(db).forEach((model) => {
    if (typeof model.associate === "function") {
        model.associate(db);
    }
});

db.sequelize = sequelize;
db.Sequelize = Sequelize;

module.exports = db;
```

### `package.json` Scripts

At minimum, add these scripts:

```json
{
    "scripts": {
        "start": "node server.js",
        "dev": "nodemon server.js",
        "db:migrate": "sequelize-cli db:migrate",
        "db:migrate:undo": "sequelize-cli db:migrate:undo",
        "db:migrate:status": "sequelize-cli db:migrate:status",
        "migration:create": "node scripts/generate-migrations.js",
        "migration:run": "node scripts/database-manager.js"
    }
}
```

Add `"migration:health": "node scripts/health-check.js"` only if you also copy `scripts/health-check.js` from the source project — do not map `migration:health` to `database-manager.js` (they are different tools in the source repo).

### `start.sh`

Run the manager before starting the server when migrations are enabled.

```sh
#!/bin/sh
set -e

if [ "$RUN_MIGRATIONS" != "false" ]; then
  node scripts/database-manager.js
fi

node server.js
```

## Environment

### Base Database Variables

- `DATABASE_URL`
- `USE_DATABASE_URL`
- `DB_HOST`
- `DB_PORT`
- `DB_NAME`
- `DB_USER`
- `DB_PASSWORD`
- `NODE_ENV`
- `RUN_MIGRATIONS`
- `USE_INTERNAL_MIGRATOR`

### Migration Strategy Variables

- `AUTO_MIGRATION_STRATEGY`
- `DB_MIGRATION_PRESET`
- `DB_SCHEMA_DIFF`
- `DB_SCHEMA_DIFF_DRY_RUN`
- `DB_SCHEMA_DIFF_DIR`
- `DB_INDEX_DEBUG`
- `DB_INDEX_CLEANUP`
- `DB_DROP_EXTRA`
- `DB_DROP_TABLES`
- `DB_ORPHAN_NULLIFY`
- `MIGRATION_DROP_EXTRA_COLUMNS`
- `LOG_MODE`

### Legacy Compatibility Aliases

If porting older environment files, the manager also recognizes these names as fallbacks:

- `SCHEMA_DIFF`
- `SCHEMA_DIFF_DRY_RUN`
- `AUTO_REDUNDANT_INDEX_CLEANUP`
- `AUTO_DROP_EXTRA_COLUMNS`
- `AUTO_ORPHAN_NULLIFY`
- `DEBUG_INDEX_CLEANUP`

### Recommended Safe Defaults

```env
USE_DATABASE_URL=false
DB_HOST=localhost
DB_PORT=5432
DB_NAME=app_db
DB_USER=postgres
DB_PASSWORD=postgres
RUN_MIGRATIONS=true
USE_INTERNAL_MIGRATOR=false
AUTO_MIGRATION_STRATEGY=inplace
DB_MIGRATION_PRESET=dev
DB_SCHEMA_DIFF=true
DB_SCHEMA_DIFF_DRY_RUN=true
DB_INDEX_CLEANUP=true
DB_DROP_EXTRA=false
DB_DROP_TABLES=false
DB_ORPHAN_NULLIFY=false
LOG_MODE=3
```

## Optional Multi-Language Support

Only add this section after the user confirms they want multi-language support.

The house pattern has two layers:

- static UI translations in the frontend using `react-intl`
- dynamic content translation in the backend using user language preferences and provider-backed translation helpers

The backend translation files below (`appLanguages.js`, `chatTranslation.js`) are **new-file templates this skill creates** — they are not files copied from an existing project. Do not replace this stack with a different i18n approach unless the user explicitly asks for one.

### Supported Languages

Ask the user which languages the app needs (their market decides the list); only if they defer, use this default set:

- `en`
- `es`
- `fr`
- `ro`
- `ru`
- `uk`
- `zh`

### What To Build

For static UI translations, create:

- `backend/functions/appLanguages.js`
- `frontend/src/utils/locales/en.json`
- `frontend/src/utils/locales/es.json`
- `frontend/src/utils/locales/fr.json`
- `frontend/src/utils/locales/ro.json`
- `frontend/src/utils/locales/ru.json`
- `frontend/src/utils/locales/uk.json`
- `frontend/src/utils/locales/zh.json`
- `frontend/src/ui-component/Locales.jsx`
- `frontend/src/contexts/ConfigContext.jsx`
- `frontend/src/layout/UserSettingsLoader.jsx`
- `frontend/src/layout/MainLayout/Header/LocalizationSection/index.jsx` or an equivalent language selector
- the support files the snippets import: `frontend/src/config.js`, `frontend/src/hooks/useConfig.js`, `frontend/src/hooks/useLocalStorage.js`, `frontend/src/api/userSettings.js` (every import in a scaffolded file must resolve)
- `frontend/scripts/check-missing-locale-keys.js` and `frontend/scripts/dedupe-locales.js` (copy from the source project), wired as npm aliases: `"locales:check": "node scripts/check-missing-locale-keys.js"`, `"locales:clean": "node scripts/dedupe-locales.js"`

For persisted user language preferences, also add:

- a `User_Settings` model or equivalent table storing `name=language` and `value=<code>`
- API endpoints to fetch and bulk save the current user's settings

For dynamic translated content, also add:

- `backend/functions/chatTranslation.js`
- provider manager support for one of `grok`, `openai`, or `anthropic`
- translation-aware model fields such as `original_message_text`, `translated_texts`, `sender_language`, and `translation_status` on translated message-like records

### Multi-Language Variables

Frontend and persistence support does not require special env vars beyond the normal app config.

If dynamic provider-backed translation is enabled, support provider keys such as:

- `GROK_API_KEY`
- `OPENAI_API_KEY`
- `ANTHROPIC_API_KEY`

The exact names must match what the scaffolded (or copied) provider manager actually reads — verify against its code, never against this list alone. At least one provider must be configured when dynamic translation is requested.

### Multi-Language Dependencies

For the frontend locale layer, install:

- `react-intl`

For dynamic backend translation, keep or add:

- a provider manager abstraction
- whichever AI SDKs are required by the chosen providers

### Multi-Language Implementation Steps

1. Ask the user whether they want UI locale support only, persisted user language preferences, or full dynamic content translation.
2. Create `backend/functions/appLanguages.js` with the shared supported language list.
3. Set frontend config default `i18n` to `en`.
4. Create `frontend/src/contexts/ConfigContext.jsx` backed by local storage so language selection persists in the browser.
5. Create `frontend/src/ui-component/Locales.jsx` with `IntlProvider` and merge the active locale dictionary over English defaults.
6. Add locale JSON files under `frontend/src/utils/locales/` using flat translation keys.
7. If user preference persistence is requested, add `UserSettingsLoader.jsx` to fetch the saved `language` preference after login and apply it to ConfigContext.
8. Add a language selector UI that updates the local config immediately and persists `[{ name: "language", value: lng }]` to the backend when the user is authenticated.
9. If dynamic translated content is requested, add `backend/functions/chatTranslation.js` with `normalizeLanguage()`, `getUserLanguage()`, `getUsersLanguages()`, and `translateTextToLanguages()`.
10. For translated dynamic records, store both the original source text and a `translated_texts` map keyed by normalized language code.
11. Resolve outgoing content per user by loading their saved language and selecting the best translation before sending the response.
12. Use English as the default fallback language everywhere.

### Crucial Multi-Language Code

`backend/functions/appLanguages.js`

```js
const SUPPORTED_APP_LANGUAGES = ["en", "es", "fr", "ro", "ru", "uk", "zh"];

function getSupportedAppLanguages() {
    return [...SUPPORTED_APP_LANGUAGES];
}

module.exports = {
    SUPPORTED_APP_LANGUAGES,
    getSupportedAppLanguages,
};
```

`frontend/src/ui-component/Locales.jsx`

```jsx
import { useMemo } from "react";
import { IntlProvider } from "react-intl";
import useConfig from "hooks/useConfig";
import enMessages from "utils/locales/en.json";
import esMessages from "utils/locales/es.json";

const localeMessageMap = {
    en: enMessages,
    es: esMessages,
};

function getLocaleMessages(locale) {
    return {
        ...enMessages,
        ...(localeMessageMap[locale] || enMessages),
    };
}

export default function Locales({ children }) {
    const {
        state: { i18n },
    } = useConfig();

    const messages = useMemo(() => getLocaleMessages(i18n), [i18n]);

    return (
        <IntlProvider locale={i18n} defaultLocale="en" messages={messages}>
            {children}
        </IntlProvider>
    );
}
```

`frontend/src/contexts/ConfigContext.jsx`

```jsx
import config from "config";
import { createContext, useMemo } from "react";
import { useLocalStorage } from "hooks/useLocalStorage";

export const ConfigContext = createContext(undefined);

export function ConfigProvider({ children }) {
    const { state, setField } = useLocalStorage("app-config", config);
    const value = useMemo(() => ({ state, setField }), [state, setField]);
    return (
        <ConfigContext.Provider value={value}>
            {children}
        </ConfigContext.Provider>
    );
}
```

`frontend/src/layout/UserSettingsLoader.jsx`

```jsx
import { useEffect } from "react";
import useAuth from "hooks/useAuth";
import useConfig from "hooks/useConfig";
import { getMyUserSettings } from "api/userSettings";

export default function UserSettingsLoader() {
    const { isLoggedIn } = useAuth();
    const { setField } = useConfig();

    useEffect(() => {
        if (!isLoggedIn) return;

        getMyUserSettings().then((rows) => {
            const language = rows.find((row) => row.name === "language")?.value;
            if (language) {
                setField("i18n", language);
            }
        });
    }, [isLoggedIn, setField]);

    return null;
}
```

`backend/functions/chatTranslation.js`

```js
const db = require("../models");

const LANGUAGE_SETTING_NAME = "language";
const DEFAULT_LANGUAGE = "en";

function normalizeLanguage(language) {
    return String(language || DEFAULT_LANGUAGE)
        .trim()
        .toLowerCase()
        .split("-")[0];
}

async function getUserLanguage(userId) {
    if (!userId) {
        return DEFAULT_LANGUAGE;
    }

    const row = await db.User_Settings.findOne({
        where: { user_id: userId, name: LANGUAGE_SETTING_NAME, retired: false },
        attributes: ["value"],
    });

    return normalizeLanguage(row?.value);
}

module.exports = {
    DEFAULT_LANGUAGE,
    normalizeLanguage,
    getUserLanguage,
};
```

Translation-aware response serialization example:

```js
const preferredLanguage = await getUserLanguage(req.user?.id);
const translatedMessageText =
    record.translated_texts?.[preferredLanguage] || null;

return {
    ...record.toJSON(),
    message_text:
        translatedMessageText ||
        record.original_message_text ||
        record.message_text,
    original_message_text: record.original_message_text,
    translated_texts: record.translated_texts || {},
    translated_to_language: translatedMessageText ? preferredLanguage : null,
    has_translation: Boolean(translatedMessageText),
};
```

Recommended provider wrapper rule:

```js
const TRANSLATION_PROVIDER_CANDIDATES = ["grok", "openai", "anthropic"];
```

Try providers in order and require at least one configured API key when dynamic translation is enabled.

## Optional Redis

Only add this section after the user confirms they want Redis support.

### What To Build

When Redis is requested, create:

- `config/redisConfig.js`
- `functions/cacheUtils.js`
- `middleware/cacheMiddleware.js`
- `functions/modelCacheHooks.js` — legacy: scaffold only if the source project still uses model-hook invalidation (verify per the premise check in Inspect First); otherwise invalidate explicitly in mutation paths

If the user also wants queued invalidation workers, create:

- `config/queueConfig.js`
- `functions/queueWorkers.js`

### Redis Variables

- `REDIS_ENABLED`
- `REDIS_HOST`
- `REDIS_PORT`
- `REDIS_PASSWORD`
- `REDIS_DB`
- `REDIS_QUEUE_DB`
- `REDIS_CACHE_ENABLED`

Recommended defaults:

```env
REDIS_ENABLED=true
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=
REDIS_DB=0
REDIS_QUEUE_DB=1
REDIS_CACHE_ENABLED=true
```

### Redis Implementation Steps

1. Install `ioredis`.
2. If queue workers are requested, install `bullmq`.
3. Create `config/redisConfig.js` with singleton client creation, connection verification, graceful disable, and close handling.
4. Create `functions/cacheUtils.js` with `get`, `set`, `del`, `invalidatePattern`, `invalidatePatterns`, `clearAll`, and `isAvailable`.
5. Create `middleware/cacheMiddleware.js` that caches successful `GET` responses and invalidates patterns after successful mutations.
6. Only if the source project still uses model-hook invalidation (check its current files first — some have retired it): create `functions/modelCacheHooks.js` that attaches Sequelize lifecycle hooks for automatic invalidation.
7. If queue workers are enabled, push invalidation jobs to a `CACHE_INVALIDATION` queue and process them asynchronously.
8. Initialize Redis during server startup, but degrade gracefully if Redis is unavailable.

### Crucial Redis Code

`config/redisConfig.js`

```js
const Redis = require("ioredis");

let redisClient = null;
let redisDisabled = process.env.REDIS_ENABLED === "false";

const createRedisClient = () => {
    if (redisDisabled) return null;
    if (redisClient) return redisClient;

    redisClient = new Redis({
        host: process.env.REDIS_HOST || "localhost",
        port: parseInt(process.env.REDIS_PORT || "6379", 10),
        password: process.env.REDIS_PASSWORD || undefined,
        db: parseInt(process.env.REDIS_DB || "0", 10),
    });

    return redisClient;
};

const verifyRedisConnection = async () => {
    const client = createRedisClient();
    if (!client) return false;

    try {
        await client.ping();
        return true;
    } catch (error) {
        redisDisabled = true;
        return false;
    }
};

const getRedisClient = () => (redisDisabled ? null : createRedisClient());

module.exports = { createRedisClient, getRedisClient, verifyRedisConnection };
```

`functions/cacheUtils.js`

```js
const { getRedisClient } = require("../config/redisConfig");

class CacheManager {
    constructor() {
        this.defaultTTL = 300;
    }

    async get(key) {
        const redis = getRedisClient();
        if (!redis) return null;
        const value = await redis.get(key);
        return value ? JSON.parse(value) : null;
    }

    async set(key, value, ttl = this.defaultTTL) {
        const redis = getRedisClient();
        if (!redis) return false;
        await redis.setex(key, ttl, JSON.stringify(value));
        return true;
    }

    // scanStream, not redis.keys(): KEYS is O(N) and blocks Redis as key count grows
    async invalidatePattern(pattern) {
        const redis = getRedisClient();
        if (!redis) return 0;

        let removed = 0;
        const stream = redis.scanStream({ match: pattern, count: 200 });

        for await (const keys of stream) {
            if (keys.length) {
                await redis.del(...keys);
                removed += keys.length;
            }
        }

        return removed;
    }

    async invalidatePatterns(patterns = []) {
        let removed = 0;
        for (const pattern of patterns) {
            removed += await this.invalidatePattern(pattern);
        }
        return removed;
    }

    isAvailable() {
        return Boolean(getRedisClient());
    }
}

module.exports = new CacheManager();
```

`middleware/cacheMiddleware.js`

```js
const cacheManager = require("../functions/cacheUtils");

// Cache keys MUST include tenant scope AND the query string. A tenant-blind key
// serves company A's cached response to company B, and ignoring the query string
// returns cached page 1 for ?page=2.
const buildCacheKey = (req) => {
    const companyId = req.user?.company_id ?? "public";
    const locationId = req.user?.location_id ?? "-";
    const query = new URLSearchParams(req.query).toString();
    return [req.baseUrl, req.path, companyId, locationId, query].join(":");
};

const tenantScope = (req) =>
    `${req.baseUrl}*:${req.user?.company_id ?? "public"}:*`;

const autoCacheMiddleware =
    (ttl = 300) =>
    async (req, res, next) => {
        if (req.method !== "GET") {
            const originalJson = res.json.bind(res);
            res.json = (payload) => {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    const patterns = res.locals.cacheInvalidationPatterns || [
                        tenantScope(req),
                    ];
                    cacheManager.invalidatePatterns(patterns).catch(() => {});
                }
                return originalJson(payload);
            };
            return next();
        }

        const cacheKey = buildCacheKey(req);
        const cached = await cacheManager.get(cacheKey);
        if (cached) {
            return res.status(200).json(cached);
        }

        const originalJson = res.json.bind(res);
        res.json = (payload) => {
            if (res.statusCode >= 200 && res.statusCode < 300) {
                cacheManager.set(cacheKey, payload, ttl).catch(() => {});
            }
            return originalJson(payload);
        };

        next();
    };

module.exports = { autoCacheMiddleware };
```

`functions/modelCacheHooks.js` (legacy — scaffold only if the source project still uses model-hook invalidation)

```js
const cacheManager = require("./cacheUtils");

const setupAutoCacheInvalidation = (db) => {
    Object.values(db).forEach((model) => {
        if (!model?.addHook || !model?.rawAttributes) {
            return;
        }

        const invalidate = async () => {
            await cacheManager
                .invalidatePattern(`*${model.tableName || model.name}*`)
                .catch(() => {});
        };

        model.addHook("afterCreate", invalidate);
        model.addHook("afterUpdate", invalidate);
        model.addHook("afterDestroy", invalidate);
        model.addHook("afterBulkCreate", invalidate);
        model.addHook("afterBulkUpdate", invalidate);
        model.addHook("afterBulkDestroy", invalidate);
    });
};

module.exports = { setupAutoCacheInvalidation };
```

Server bootstrap snippet (the `modelCacheHooks` lines apply only if you scaffolded that legacy file — otherwise omit them and invalidate explicitly in mutation paths):

```js
const {
    createRedisClient,
    verifyRedisConnection,
} = require("./config/redisConfig");
const { autoCacheMiddleware } = require("./middleware/cacheMiddleware");
const { setupAutoCacheInvalidation } = require("./functions/modelCacheHooks");

app.use("/api", autoCacheMiddleware());

createRedisClient();
const redisAvailable = await verifyRedisConnection();

if (redisAvailable) {
    setupAutoCacheInvalidation(db);
}
```

## Optional Live Data

Only add this section after the user confirms they want live data support.

The current implementation pattern uses the `ws` package. Do not silently replace it with Socket.IO.

### What To Build

For backend-only live data, create:

- `functions/webSocketUtils.js`
- server bootstrap wiring for WebSocket upgrade handling and authentication

For full frontend live data, also create:

- `frontend/src/utils/wsManager.js`
- `frontend/src/contexts/WebSocketContext.jsx`

### Live Data Variables

- `NEXT_PUBLIC_WEBSOCKET` — the `NEXT_PUBLIC_` prefix reaches the client bundle only in Next.js; on another frontend framework use its public-env convention (e.g. `VITE_WEBSOCKET`)
- `AUTH0_DOMAIN` / `AUTH0_AUDIENCE` — Auth0-specific; with a different JWT issuer, substitute its issuer/audience/JWKS config (the `jwt.verify` pattern below is unchanged)

The websocket shares the HTTP server's port via `server.on("upgrade", ...)` (the server snippet below) — there is no separate socket listener. Point `NEXT_PUBLIC_WEBSOCKET` at the backend HTTP port:

```env
NEXT_PUBLIC_WEBSOCKET=ws://localhost:<backend HTTP port>
```

Add a `SOCKET_PORT` and a standalone listener only if the user explicitly asks for a separate socket server — never scaffold both patterns.

### Live Data Implementation Steps

1. Install `ws` on the backend.
2. Create `functions/webSocketUtils.js` exposing `setWebSocketServer`, `notifyClients`, `notifyUser`, and `notifyUsers`.
3. Create a `WebSocket.Server` with `{ noServer: true }` in the backend server.
4. Attach `server.on("upgrade", ...)` and forward upgrades to the websocket server.
5. Require clients to send an `authenticate` message with a JWT.
6. Verify the JWT, load the user record, and store `socket.user`, `socket.company_id`, and `socket.isAuthenticated`.
7. Broadcast tenant-scoped updates using `company_id` filtering.
8. Send explicit `session-expired` or `invalid-token` messages before closing sockets on auth failure.
9. If frontend support is requested, create a websocket manager with capped reconnect backoff, a `disconnect()` called in effect cleanup, and a provider that reconnects on login.
10. When live data is enabled, EVERY create/update/delete endpoint emits a tenant-filtered `notifyClients` event as the default controller pattern — a scaffolded mutation with no broadcast is incomplete.
11. The frontend reconciles state from received events (patch the affected record/list in place) — never scaffold fetch-once views that require refresh.
12. Verify with two clients: mutate from one, observe the other receive the event and update without refresh.

### Crucial Live Data Code

`functions/webSocketUtils.js`

```js
const WebSocket = require("ws");
let wss;

const setWebSocketServer = (server) => {
    wss = server;
};

const notifyClients = async (messageType, data, filters = {}) => {
    const payload = JSON.stringify({ type: messageType, data });

    wss.clients.forEach((client) => {
        if (client.readyState !== WebSocket.OPEN || !client.isAuthenticated) {
            return;
        }

        if (
            filters.company_id !== undefined &&
            String(client.user.company_id) !== String(filters.company_id)
        ) {
            return;
        }

        client.send(payload);
    });
};

module.exports = { setWebSocketServer, notifyClients };
```

Backend server snippet (auth uses `jwt.verify` with JWKS — NEVER `jwt.decode`, which performs no signature check and lets any client forge any identity):

```js
const WebSocket = require("ws");
const jwt = require("jsonwebtoken");
const jwksClient = require("jwks-rsa");
const { promisify } = require("util");
const { setWebSocketServer } = require("./functions/webSocketUtils");

const jwks = jwksClient({
    jwksUri: `https://${process.env.AUTH0_DOMAIN}/.well-known/jwks.json`,
});

const getKey = (header, callback) => {
    jwks.getSigningKey(header.kid, (err, key) => {
        callback(err, key?.getPublicKey());
    });
};

const verifyAsync = promisify(jwt.verify);

const wss = new WebSocket.Server({ noServer: true });
setWebSocketServer(wss);

wss.on("connection", (socket) => {
    socket.isAuthenticated = false;

    socket.on("message", async (rawMessage) => {
        const message = JSON.parse(rawMessage);

        if (message.type !== "authenticate") {
            return;
        }

        let decoded;
        try {
            decoded = await verifyAsync(message.token, getKey, {
                audience: process.env.AUTH0_AUDIENCE,
                issuer: `https://${process.env.AUTH0_DOMAIN}/`,
                algorithms: ["RS256"],
            });
        } catch (error) {
            socket.send(JSON.stringify({ type: "invalid-token" }));
            socket.close();
            return;
        }

        const user = await db.User.findOne({ where: { auth_id: decoded.sub } });
        if (!user) {
            socket.send(JSON.stringify({ type: "invalid-token" }));
            socket.close();
            return;
        }

        socket.user = user.toJSON();
        socket.company_id = user.company_id;
        socket.isAuthenticated = true;

        socket.send(
            JSON.stringify({
                type: "authenticated",
                data: { id: socket.user.id, company_id: socket.company_id },
            }),
        );
    });
});

server.on("upgrade", (req, socket, head) => {
    wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit("connection", ws, req);
    });
});
```

Controller emission example:

```js
const { notifyClients } = require("../functions/webSocketUtils");

// event naming: <model>-created|updated|deleted for YOUR models (e.g. order-updated)
await notifyClients("order-updated", order.toJSON(), {
    company_id: order.company_id,
});
```

`frontend/src/utils/wsManager.js`

```js
export class WebSocketManager {
    constructor(url) {
        this.url = url;
        this.ws = null;
        this.listeners = new Set();
        this.baseDelay = 1000;
        this.maxDelay = 30000;
        this.attempts = 0;
        this.closedByClient = false;
        this.reconnectTimer = null;
    }

    connect(token) {
        this.closedByClient = false;
        this.ws = new WebSocket(this.url);

        this.ws.onopen = () => {
            this.attempts = 0;
            this.ws.send(JSON.stringify({ type: "authenticate", token }));
        };

        this.ws.onmessage = ({ data }) => {
            const message = JSON.parse(data);
            this.listeners.forEach((listener) => listener(message));
        };

        // capped exponential backoff; never reconnect after a deliberate disconnect
        this.ws.onclose = () => {
            if (this.closedByClient) return;
            const delay = Math.min(
                this.baseDelay * 2 ** this.attempts,
                this.maxDelay,
            );
            this.attempts += 1;
            this.reconnectTimer = setTimeout(() => this.connect(token), delay);
        };
    }

    disconnect() {
        this.closedByClient = true;
        clearTimeout(this.reconnectTimer);
        this.ws?.close();
        this.ws = null;
    }

    subscribe(listener) {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }
}
```

`frontend/src/contexts/WebSocketContext.jsx`

```jsx
import { createContext, useContext, useEffect, useState } from "react";
import { wsManager } from "../utils/wsManager";

const WebSocketContext = createContext(null);

export const WebSocketProvider = ({ token, children }) => {
    const [socket, setSocket] = useState(null);

    useEffect(() => {
        if (!token) {
            return;
        }

        wsManager.connect(token);
        const unsubscribe = wsManager.subscribe((message) => {
            if (message.type === "authenticated") {
                setSocket(wsManager.ws);
            }
        });

        return () => {
            unsubscribe();
            wsManager.disconnect();
        };
    }, [token]);

    return (
        <WebSocketContext.Provider value={socket}>
            {children}
        </WebSocketContext.Provider>
    );
};

export const useWebSocket = () => useContext(WebSocketContext);
```

## Blueprint Example

Use this sequence when building a brand new project:

1. Create the backend folder structure and `package.json`.
2. Install `sequelize`, `sequelize-cli`, `pg`, and `pg-hstore`.
3. Create `config/config.js`, `models/index.js`, the initial Sequelize models and associations, `functions/logger.js`, `config/dependencyOrder.js`, and `migrations/`.
4. Copy in `scripts/database-manager.js` and `scripts/generate-migrations.js`.
5. Add migration scripts and startup wiring, including `middleware/authMiddleware.js` + `middleware/permissionMiddleware.js` mounted before any route (see "Wire Startup In The Correct Order").
6. Add `.env` values for PostgreSQL and migration behavior.
7. Run `node scripts/database-manager.js` with safe diff settings enabled.
8. If the user wants Redis, add the Redis branch and verify graceful degradation.
9. If the user wants live data, add the `ws` branch and verify authentication and company scoping.
10. If the user wants multi-language support, add the locale files, locale check scripts, provider wiring, user setting persistence, and translation-aware response flow.
11. Scaffold the root `CLAUDE.md` project contracts file and the root `plan.md` (per project-plan-maintenance) with the new project's concrete names and the recorded decisions.
12. Run the End-of-Scaffold Boot Checklist. Only after it passes should you enable destructive flags such as dropping extra columns or tables.

## Output Expectations

Good outcomes from this skill look like:

- a new project that accepts the copied migration files immediately: a PostgreSQL + Sequelize setup matching `database-manager` expectations, data access through Sequelize models and ORM patterns rather than hardcoded SQL, and a minimal logger + startup flow compatible with the copied scripts
- optional Redis, `ws` live data, and multi-language layers added ONLY when the user confirmed them — no parallel migration, cache, realtime, or i18n architecture introduced unnecessarily
- short, concrete code snippets that remove ambiguity for the implementing agent

## Anti-Patterns

Avoid these mistakes:

- rewriting `database-manager` instead of building the project around it
- creating a different migration system alongside the copied one
- manually writing schema migrations when the manager should generate them
- embedding hardcoded SQL queries throughout controllers, services, or routes when Sequelize models would handle the job cleanly
- bypassing model associations and ORM methods for ordinary CRUD flows
- adding Redis, live data, or multi-language support without asking the user first (gates 8–10)
- teaching Socket.IO as if it were the current implementation
- replacing `react-intl` and user-language persistence with a different i18n approach without user direction
- storing only translated text without preserving the original source text for dynamic content
- enabling destructive database flags before validation passes
- omitting `initializeBackendLogging()` support when the scripts require it
- forgetting company-scoped websocket filtering in a multi-tenant app
- any of the STOP-list red flags above (jwt.decode auth, tenant-blind cache keys, unbounded `findAll`, float money / name-string joins)
- shipping snippets whose imports don't resolve or whose invalidation is a console.log stub
- skipping the CLAUDE.md or plan.md contracts scaffold

## Final Rule

Build the new project so the copied `database-manager` works first, keep the database backend centered on Sequelize instead of hardcoded queries, then add Redis, live data, and multilingual support only when the user explicitly wants those layers.
