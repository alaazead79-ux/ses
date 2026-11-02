# Project memory

## Product intent & audience

- Desktop farm management application built with Electron + Vite/React; local SQLite database (`farm.db`) for offline-first operation.
- Browser version continues to work separately, likely using Supabase as its data layer.
- Local/offline storage is a hard requirement for desktop — no cloud database for the desktop app.

## Brand personality & voice

- (Not yet inferred from design work.)

## Visual design & UX direction

- (Not yet inferred from design work.)

## Decisions, constraints & rationale

- **Stack:** Vite + React + JSX, Tailwind CSS, Lucide React icons, Electron main process with native SQLite module. Use `@/` path alias for imports.
- **Database:** `farm.db` created in app data folder; backups in separate folder; numbered migrations applied at startup; migrations must be idempotent (second run is no-op).
- **Core tables implemented:** users, roles, permissions, audit_log, settings, activities, fiscal_periods, document_numbering.
- **Not yet migrated to desktop:** accounting, sales, inventory, payroll, and other domain tables — still browser-only, need conversion next.
- **Auth state:** default `admin` / `admin123` login still present; per-user permissions and real sign-in not yet built.
- **Restore feature:** removed intentionally — old implementation was a stub/fake; will be rebuilt properly later.
- **Windows installer:** not yet built/tested; requires a Windows machine.
- Browser build and type check both still pass after desktop DB work.

## Open questions & assumptions

- Does the browser app call the Electron desktop bridge, or are they fully separate entry points?
- Which remaining domain tables (accounting, sales, inventory, payroll, etc.) should be migrated next, and in what order?
- What is the target schema for per-user permissions and real sign-in on desktop?
- When/where will the Windows installer be built and tested?
- Is Supabase still the intended data layer for the browser version, or should it eventually be replaced too?