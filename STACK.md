# STACK.md — declare your project's stack

The pipelines reference your stack by **role**, not by product name. Fill in the right
column for your project once; the loop's prose points here instead of hardcoding tool
names. Delete the example values and put your own.

| Role (how pipelines refer to it) | This project (fill in) | Example |
|---|---|---|
| Language / framework | | Next.js 15 (React, TypeScript) · Django · Go |
| Database | | Postgres · MySQL · SQLite · Mongo |
| Data layer / ORM | | Drizzle · Prisma · SQLAlchemy · GORM |
| Services layer (data access) | | `lib/services/*` · `app/repositories/` |
| Schema directory | | `lib/db/schema/` · `models/` |
| Shared types directory | | `lib/data/types/` · `types/` |
| Server-actions / handlers dir | | `app/actions/` · `api/` |
| Input validation | | Zod · Pydantic · valibot |
| Auth provider | | Clerk · Auth.js · Supabase Auth |
| Seed script / command | | `npm run seed` · `python manage.py seed` |
| Migrate command | | `npm run db:migrate` · `alembic upgrade` |
| Conventions doc | | `CLAUDE.md` · `AGENTS.md` · `CONTRIBUTING.md` |
| Dev-data safety rule | | dev database only; never touch prod; no destructive reset |

## How the pipelines use this

Pipeline prose says things like "validate every input at the trust boundary (see
STACK.md)" or "add the row through the services layer, never a raw query." When you run a
pipeline, read STACK.md's row for that role to know the concrete tool/path in **this**
project. New project → change this one file, not 50 pipeline files.

## Safety default

Every pipeline that touches data assumes a **disposable dev database**, never production,
and no destructive resets of seed data. If your project's safety rule differs, state it in
the table above — the pipelines defer to it.
