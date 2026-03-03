---
name: modular-code
description: Apply best-practice modular architecture to ALL new and existing code. Enforce reusable components, clean separation of concerns, modern UI patterns, and multi-file structure (no monolithic files).
---

## Purpose

This skill must be applied **by default to all new code** and **whenever modifying existing code**.  
The agent should proactively design and generate code that is **modular, reusable, scalable, and maintainable**, even when not explicitly asked to refactor.

## Keywords / When to use

default, new code, refactor, modular, reusable, clean architecture, separation of concerns, component-based, scalable, maintainable, UI components, design system, DRY, SOLID, best practices

## Mandatory rules (apply to all new code)

1. **Never generate monolithic files**

- Do not place all logic, UI, and data access into one file.
- If a feature grows beyond trivial size, split it immediately.

2. **Entry files stay minimal**

- `index.tsx`, `main.tsx`, `App.tsx`, or server entry files must only bootstrap the app.
- No business logic, complex UI, or data access in entry files.

3. **File & folder organization**
   Use a scalable, component-driven structure:

- src/
  - main.tsx / index.tsx
  - App.tsx
  - components/
    - ui/ # reusable primitives (Button, Input, Modal, Table, Badge)
    - layout/ # page shells, headers, sidebars
  - features/
    - <feature>/
      - pages/
      - components/
      - hooks/
      - services/
      - types.ts
  - services/ # shared API / clients
  - utils/
  - constants/
  - types/

4. **Reusable-first mindset**

- Extract shared UI and logic immediately.
- If something is used twice, it becomes reusable.
- Prefer composition over duplication.

5. **Separation of concerns**

- UI components: rendering only
- Hooks: state + behavior
- Services: API / data access
- Utils: pure helpers
- Types: explicit interfaces/types

6. **Modern, sleek design**

- Clean layouts with spacing and hierarchy
- Card-based UI where appropriate
- Minimal visual noise
- Consistent typography, colors, and spacing
- Avoid inline styling unless trivial

7. **Naming & exports**

- Files match their primary export
- Clear, descriptive names
- Prefer named exports for shared modules
- Keep components small and focused

8. **Future-proofing**

- Code should be easy to extend without rewriting
- Avoid hardcoding assumptions
- Structure code so new features slot in naturally

## Refactor guidance

When touching existing code:

- Proactively split large files
- Extract reusable components, hooks, and services
- Improve structure even if not explicitly requested

## Output expectations

When this skill is active, the agent should:

- Automatically design modular architecture
- Generate multiple well-named files
- Avoid large single-file implementations
- Produce clean, readable, maintainable code
- Favor long-term maintainability over quick hacks
