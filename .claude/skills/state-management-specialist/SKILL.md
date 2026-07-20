---
name: state-management-specialist
description: "Use when designing or refactoring React state: local vs shared ownership, derived state, async request state, server-mirrored data, live websocket reconciliation, or cross-component coordination. Owns state correctness (single source of truth, race safety, live updates) and state performance at scale. Not for backend work or pure UI layout."
---

# State Management Specialist

## Purpose

Keep React state minimal, predictable, and correct under live data: the smallest ownership scope that works, one source of truth per fact, server-mirrored state that stays live, and state that stays fast as collections grow.

Portable across projects. Check the project's root `CLAUDE.md` and its `store/` directory for the concrete stack before choosing — never introduce a new state library or a parallel Context provider when the established patterns cover the need.

## Use This Skill When

- Adding or restructuring state for a feature (local, shared, derived, async)
- Wiring server data into components, including live/websocket-updated data
- Fixing duplicated state, prop-drilling, stale data, or render thrash

## Do Not Use This Skill When

- Static UI changes with no state concerns
- Backend-only work

## Step 0 — Inventory Before Adding Or Moving Any State

LOAD the operating-discipline skill first and fill its templates from its text, not from memory. Before **adding**, refactoring, moving, or de-duplicating any state, write the affected-surfaces inventory per operating-discipline §1–2: grep the field name, the API path, and the slice/store key to prove the fact has no existing home; list **every holder, reader, and writer of the fact with file:line**. New state is where duplication is most often introduced — for it the inventory may be short, but it is written anyway (the Verify re-grep below depends on it existing). The work is not planned until the inventory exists. Verify assumptions about the project's stack against the code, not memory.

**Order of concerns**: correctness/staleness → race safety → persistence leaks → performance. Never fix a lower tier while a higher one is open, and never memoize your way around a duplicated source of truth.

## The House Stack (confirm per project)

- **Cross-page/app state** → the project's Redux Toolkit slices (`store/slices`); redux-persist is for UI preferences **only** — never server data (persisted stale data breaks live-update guarantees).
- **Server data** → a feature-level hook over the project's shared axios client, plus a live subscription through the project's ws handler registry (createModelHook-style per-model hooks where present).
- **Local UI state** → `useState`/`useReducer` in the owning component.

## Ownership Rules

1. Decide ownership by **counting consumers** — no judgment calls:
   - 1 component → `useState`/`useReducer` in that component.
   - 2+ consumers under one parent → lift to the nearest common ancestor; pass props.
   - Consumed across route/layout boundaries, or must survive navigation → store slice.
   - Mirrors a server record → the server-data hook (rule 5) is its only client-side home — never a second copy.
2. One source of truth per fact. **Server-mirrored data has exactly one client-side home** — two sibling components each holding a copy of the same record is the textbook staleness bug; lift it to the container.
3. Don't store what you can derive from props/state/fetched data — compute it. Carve-outs: expensive derivations may be memoized deliberately, and one-time snapshots (form initial values, drag-start positions) are legitimate stored state.
4. Keep state shape minimal and flat; child components receive only the state and handlers they need.

## Live Data Rules

5. Any state mirroring server data MUST subscribe to that model's live events via the project's handler registry and reconcile created/updated/deleted pushes **in place**. Fetch-on-mount with no subscription is incomplete work.
6. After a local mutation, reconcile from the confirming ws event or apply the server's returned record — never leave pre-mutation data showing, and never refetch the whole collection when a surgical patch works.
7. If the domain has no ws handler yet, add one — never poll. Procedure: grep the project's ws layer for an existing model's handler registration; read the nearest existing handler end-to-end; mirror its registration, event names, and reconcile shape; state in your report which handler you mirrored, with its path.

## Async Completeness

8. Every async request models loading, error, and empty explicitly, and each branch renders something intentional (skeleton / translated retry-able error / empty state — rendering details: react-ui-builder). No undefined-data renders, no spinner that can never resolve.
9. Guard against races: a stale response must not overwrite newer state. **Any effect whose params can change while a request is in flight gets one of these two patterns — no exceptions:**

   ```js
   useEffect(() => {
     const ctrl = new AbortController();
     fetchThing(params, { signal: ctrl.signal })
       .then(setThing)
       .catch((e) => { if (e.name !== 'AbortError') setError(e); });
     return () => ctrl.abort(); // cancels on unmount AND on param change
   }, [params]);
   ```

   If the request can't be aborted, use a sequence check: increment a `requestIdRef` per request, capture the value before awaiting, and compare before every `setState` — apply only if still the latest.
10. Optimistic updates are permitted (not required) where the mutation is trivially reversible and single-owner — with rollback and a visible error on failure, reconciling to the confirming ws event when it arrives.

## State at Scale

11. Store selected **ids**, not copies of item objects.
12. Keep pagination/filter/sort **params** as state and let the server do the work — never load whole collections into client state to filter locally.
13. Memoized selectors (`createSelector`) for derived values read from the store; stable references for handlers passed into large lists.

## Cross-Tab Note

Persisted UI preferences don't sync across tabs. Settings that must be consistent everywhere belong in server-backed user settings (find the project's user-settings API), not persisted slices.

## Verify Before Finishing

Per the `CLAUDE.md` definition of done, plus: two-window check for any server-mirrored state (mutate in one, the other reconciles without refresh); force a failed mutation and observe rollback/error; re-run the step-0 grep to confirm no duplicated source of truth survived or was introduced; on a sizable state restructure, run the operating-discipline §6 critique pass. Report each item **pass / fail / not run** — never imply a skipped check passed (operating-discipline §6–7).

## Anti-Patterns — STOP mid-work and re-check when you catch yourself doing any of these

- Server data copied into `useState` with no subscription, or mirrored into redux-persist
- Two components separately fetching/holding the same record
- A new Context/Zustand/SWR layer beside the established stack
- Storing derived values that drift from their source; deep prop chains instead of composition
- Loading a whole table client-side to filter it
- Adding or refactoring state whose existing holders you never inventoried (step 0 skipped)

## Final Rule

State that isn't shared stays local; a fact has one home; server-mirrored state is live-subscribed or it's incomplete; and state design must survive both a failed request and 10,000 rows.
