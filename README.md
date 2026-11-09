*This project has been created as part of the 42 curriculum by vkhvosto, dbilenko, lkramer, gansari.*

# Poolaki

Poolaki is a personal expense tracker developed as the final team project of the 42 curriculum.

## Description

| Topic | Description |
|---|---|
| Goal | Help users understand their finances through an independent personal ledger. |
| Core features | Accounts, categorized income and expenses, transfers, balances and per-currency analytics. |
| Account management | Email/password and optional Google sign-in, profiles and avatars. |
| Data tools | Transaction search, JSON import, CSV export and interactive charts. |
| Interface | Responsive UI, light/dark themes, English, German, Persian (RTL) and Ukrainian, with accessibility checks. |

## Table of Contents

- [Description](#description)
- [Team Information](#team-information)
- [Project Management](#project-management)
- [Technical Stack](#technical-stack)
- [Instructions](#instructions)
  - [Prerequisites](#prerequisites)
  - [Docker setup](#docker-setup)
  - [Environment Setup](#environment-setup)
  - [Running Without Docker](#running-without-docker)
  - [Testing and CI](#testing-and-ci)
- [Database Schema](#database-schema)
- [Features List](#features-list)
- [Modules](#modules)
- [Resources](#resources)
- [Individual Contributions](#individual-contributions)

## Team Information

| 42 login | Assigned roles | Responsibilities |
|---|---|---|
| vkhvosto | Technical Lead / Architect, Developer | Architecture, technology choices, code quality and critical reviews. |
| dbilenko | Developer | Shared developer responsibilities below. |
| lkramer | Scrum Master, Developer | Team coordination, meetings, progress tracking, communication and blockers. |
| gansari | Product Owner, Developer | Product vision, backlog priorities and validation of completed work. |

All four members contribute to implementation, code reviews, testing and documentation.

## Project Management

| Area | Organization |
|---|---|
| Work tracking | GitHub Kanban board. |
| Tasks | GitHub Issues grouped into milestones. |
| Assignment | Each team member assigned themselves to issues. |
| Meetings and coordination | A weekly remote meeting with actions to discuss. |
| Communication | Telegram and Google. |
| Reviews and completion | Changes were submitted through GitHub pull requests and reviewed by another team member, issues were marked complete once acceptance criteria were met, checks passed and changes were merged. |

## Technical Stack

Major technologies and their purpose are listed below; exact dependency versions are committed in each application's lockfile.

| Area | Technologies | Rationale |
|---|---|---|
| Runtime and language | Node.js 22, TypeScript 5 | Shared language and static checking across both applications. |
| Frontend | Next.js 16.3.0, React 19.2.8 | Server-rendered pages, App Router and server actions for authenticated data flows. |
| UI and localization | Tailwind CSS 4, Lucide, next-intl 4 | Reusable themed components, responsive layouts, translations and Persian RTL. |
| Backend | Express 5.2.x | Explicit HTTP routing and middleware for validation, authentication and ownership. |
| Database | PostgreSQL 17, Drizzle ORM 0.45.2 | Relational ownership, constraints, atomic ledger writes, SQL aggregation and typed migrations. |
| Authentication and validation | bcryptjs, session cookies, Google OAuth 2.0, authenticator-app TOTP (2FA), Zod and backend validators | Password hashing, Google sign-in, an additional verification step for password and Google logins, and validation at both input boundaries. |
| Visualization | Recharts 3 | Interactive financial charts with table alternatives. |
| Development and verification | Docker Compose v2, Make, GitHub Actions, Vitest, Bruno, Playwright/axe, ESLint and Prettier | Repeatable services and automated code, API and browser checks. |
| Monitoring | prom-client, Prometheus, Grafana, Alertmanager and Telegram | Collect metrics, visualize service health and send operational alerts to Telegram. |

## Instructions

Run commands from the repository root unless stated otherwise; frontend and backend are independent npm projects.

### Prerequisites

- Git.
- Docker Engine or Docker Desktop, installed and running.
- Docker Compose v2.
- GNU Make 3.81 or newer.
- Node.js 22 and npm for host development or local checks; provided by Docker otherwise.
- PostgreSQL 17 for host development; provided by Docker Compose otherwise.

Keep ports 3000 (frontend), 3001 (backend), 3002 (Grafana) and 5432 (database) available.

### Docker setup

1. Clone the repository and enter its directory:

   ```bash
   git clone https://github.com/LaraKraemer/transcendence.git
   cd transcendence
   ```

2. Create the root `.env` if it does not already exist, then replace the monitoring password and Grafana placeholders:

   ```bash
   cp .env.example .env
   ```

3. Start the services; this builds missing images and starts the application, backups and monitoring. Compose creates the restricted monitoring database user automatically:

   ```bash
   make up
   ```

4. Check the containers and wait for the application services to become healthy:

   ```bash
   docker compose ps
   ```

5. Verify database readiness and operational status:

   ```bash
   curl -fsS http://localhost:3001/health
   curl -fsS http://localhost:3001/status
   ```

6. Open http://localhost:3000; Grafana is at http://localhost:3002 (login required).

If a service does not become healthy, run `make logs` to inspect startup errors.
The root `.env` is required for monitoring; Google sign-in, 2FA and Telegram delivery use the optional settings below.

### Environment Setup

Environment variables tell the backend how to connect to PostgreSQL and tell the frontend where to send API requests.

#### Docker development

Set these values in the root `.env` before `make up`:

```env
POSTGRES_EXPORTER_PASSWORD=<monitoring-database-password>
GRAFANA_ADMIN_USER=<grafana-admin-username>
GRAFANA_ADMIN_PASSWORD=<grafana-admin-password>
```

Generate passwords with `openssl rand -hex 24`. Compose initializes the monitoring database user automatically; no manual SQL setup is needed.
Compose supplies the application database and API URLs: PostgreSQL at `db:5432`, the backend at `http://backend:3001` for Next.js, and `http://localhost:3001` for the browser.

For Telegram alerts, create `.secrets/telegram_bot_token` and `.secrets/telegram_chat_id`, then enable the Telegram Compose override as described in the [monitoring setup](docs/monitoring.md#1-initial-setup-once-per-installation).
Never commit `.env` or `.secrets/`.

#### Host development

1. Create `backend/.env`:

   ```env
   DATABASE_URL=postgres://expense:expense@localhost:5432/expense_tracker
   FRONTEND_ORIGIN=http://localhost:3000
   AVATAR_DIR=./avatars
   ```

   `DATABASE_URL` connects the backend to PostgreSQL, `FRONTEND_ORIGIN` allows requests from the frontend, and `AVATAR_DIR` selects a writable folder for uploaded avatars.

2. Copy `frontend/.env.example` to `frontend/.env.local`:

   ```bash
   cp frontend/.env.example frontend/.env.local
   ```

   The example sets `NEXT_PUBLIC_API_URL` and `API_URL` to `http://localhost:3001`.
   `NEXT_PUBLIC_API_URL` is used by the browser; `API_URL` is used by Next.js on the server, so it uses the internal hostname `backend` when running in Docker.

#### Google sign-in (optional)

To enable Google sign-in, add `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` to the root `.env` for Docker development.
For host development, put both in `backend/.env` and only `GOOGLE_CLIENT_ID` in `frontend/.env.local`.
Register `http://localhost:3000/auth/google` as the exact redirect URI; follow the [Google setup guide](docs/development.md#google-sign-in-setup) for the Console steps.

#### Two-factor authentication (optional)

Generate an encryption key with `openssl rand -base64 32` and set `TOTP_ENCRYPTION_KEY` in root `.env` for Docker, or `backend/.env` for host development.
Without a key, 2FA setup is disabled; the backend refuses to start if any user already has 2FA enabled. Keep the key safe: losing or changing it requires affected users to use recovery codes and set up 2FA again.
Enable it under Profile → Two-factor authentication, scan the QR code, enter a code and save the ten recovery codes shown once; password and Google sign-ins then require a second step.

Keep secrets out of Git and never expose a client secret through a `NEXT_PUBLIC_*` variable.
Compose forwards only explicitly configured variables from the root `.env`; change service environment settings in `docker-compose.yml` for custom addresses.
The supplied Compose setup uses local HTTP; subject v21.1 requires HTTPS for external backend connections, which this setup does not provide.

### Application URLs

| Service | URL | Verification |
|---|---|---|
| Frontend | http://localhost:3000 | Open in the browser. |
| Backend readiness | http://localhost:3001/health | `curl -fsS http://localhost:3001/health` |
| Backend operational status | http://localhost:3001/status | `curl -fsS http://localhost:3001/status` |
| Grafana | http://localhost:3002 | Sign in with the admin credentials from `.env`. |

### Running Without Docker

Use Node.js 22 and PostgreSQL 17, configure `backend/.env` and `frontend/.env.local` with the host values above, then run `npm ci` and `npm run dev` in each application directory using separate terminals; follow the [complete host setup](docs/development.md#running-without-docker) for commands and avatar storage configuration.

### Testing and CI

During development, we added GitHub Actions pipelines to automate backend type checking, linting, formatting, unit and API tests, plus frontend linting, self-checks, builds, and browser accessibility and status-page checks.

| Run inside | Main checks after `npm ci` |
|---|---|
| `backend/` | `npm run typecheck && npm run lint && npm run format:check && npm test` |
| `frontend/` | `npm run lint && npm run check:format && npm run check:import && npm run check:filters && npm run build` |

See the [testing guide](docs/testing.md) for API/browser checks, prerequisites and opt-in database tests.

### Operations

Use `make logs` for diagnostics and `make down` to stop containers while preserving data; see the [development guide](docs/development.md) for rebuilds and troubleshooting, and the [recovery guide](docs/disaster-recovery.md) for backups and restores.

**`make clean` deletes database, avatar and monitoring data volumes; host `./backups` survives.**

## Database Schema

The implemented schema is defined in [schema.ts](backend/srcs/db/schema.ts); the table below summarizes its key fields and relationships.

### Implemented schema diagram

This diagram shows the eight tables in this branch; planned tables are excluded.

```mermaid
erDiagram
    app_user ||--o{ session : "has"
    app_user ||--o{ recovery_code : "has"
    app_user ||--o{ user_identity : "links"
    app_user ||--o{ account : "owns"
    app_user ||--o{ category : "owns"
    app_user ||--o{ transaction : "creates"
    account ||--o{ transaction : "contains"
    category o|--o{ transaction : "labels"

    app_user {
        uuid id PK
        text email
        text password_hash "nullable"
        text totp_secret_encrypted "nullable"
        timestamptz totp_enabled_at "nullable"
    }
    session {
        uuid id PK
        uuid user_id FK
        text token_hash UK
        timestamptz twofa_verified_at "nullable"
    }
    recovery_code {
        uuid id PK
        uuid user_id FK
        text code_hash
        timestamptz used_at "nullable"
    }
    user_identity {
        uuid id PK
        uuid user_id FK
        text provider
        text provider_user_id
    }
    account {
        uuid id PK
        uuid user_id FK
        text currency_code
        bigint opening_balance_minor
    }
    category {
        uuid id PK
        uuid user_id FK
        text name
    }
    transaction {
        uuid id PK
        uuid account_id FK
        uuid category_id FK "nullable"
        uuid created_by_id FK
        bigint amount_minor
        date booked_on
        uuid transfer_group_id "nullable"
    }
    currency {
        text code PK
        text name
        text symbol
        smallint minor_unit
    }
```

A transaction can have no category. Currency is reference data with no foreign keys; transfer entries share a group ID, not a separate table.

### Implemented tables

| Table | Key fields and types | Relationships and constraints |
|---|---|---|
| `app_user` | `id uuid`, `email text`, nullable `password_hash text`, `display_name text`, nullable `avatar_url text`, encrypted TOTP secret, last-used step and verification/2FA/create/update timestamps | Case-insensitive unique email. Avatar field stores an internal file key; API exposes a versioned URL. Google-only users have no password hash. |
| `session` | `id uuid`, `user_id uuid`, `token_hash text`, optional user agent/IP text, expiry/revocation/2FA-verification/create timestamps | Many sessions per user; unique SHA-256 token hash; user deletion cascades. |
| `recovery_code` | `id uuid`, `user_id uuid`, `code_hash text`, nullable `used_at` and creation timestamps | Single-use 2FA recovery codes stored as hashes; unique user/hash pair; user deletion cascades. |
| `user_identity` | `id uuid`, `user_id uuid`, `provider text`, `provider_user_id text`, creation timestamp | Many identities per user; unique provider/external ID and user/provider pairs; user deletion cascades. |
| `account` | `id uuid`, `user_id uuid`, name/type/currency `text`, `opening_balance_minor bigint`, `is_archived boolean`, optional institution/reference text, create/update timestamps | Many accounts per user; user deletion cascades. Currency code has no reference-table FK. |
| `category` | `id uuid`, `user_id uuid`, name/icon/color `text`, `types text[]`, creation timestamp | Many categories per user; name unique per user; user deletion cascades. Types are a nonempty subset of expense/income. |
| `transaction` | `id uuid`, account/category/creator UUIDs, `type text`, `amount_minor bigint`, nullable `transfer_group_id uuid`, `booked_on date`, optional occurrence timestamp and description/notes/merchant text, create/update timestamps | Account and creator deletion cascade; category deletion sets category to NULL. Amount is nonzero and sign must match type. Transfer group is present exactly for transfers. |
| `currency` | `code text` primary key, `name text`, `symbol text`, `minor_unit smallint` | Global reference data; 17 currencies, currently all with two decimal places; no ledger foreign keys. |

### Schema conventions and scope

| Topic | Rule |
|---|---|
| Ownership | A user owns many sessions, recovery codes, identities, accounts, categories and created transactions; each transaction belongs to one account and optionally one category. |
| Types | PostgreSQL-generated UUID keys except currency code; `date` for booking dates, timezone-aware timestamps for events, application-validated text values and SQL transaction constraints. |
| Money and transfers | Safe-integer minor units; transfer legs share a group UUID, not a separate table or foreign key. |
| Implemented scope | Eight tables in this branch; [full](docs/full-db-schema.md) and [MVP](docs/mvp-db-schema.md) design documents also contain planned entities, including budgets and savings goals. |
| Operations | Migrations apply at backend startup; inspection, migration and persistence details are in the [development guide](docs/development.md#database-operations). |

## Features List

Contributors below are identified from implementation and test commits, including co-authored commits; team review can add work not recorded in Git.

| Implemented feature | Availability and behavior | Contributors |
|---|---|---|
| Authentication | UI + API: register, sign in/out, change passwords and manage secure sessions. | lkramer, vkhvosto, gansari |
| Google sign-in | UI + API: Google authentication and protected account linking; requires OAuth credentials. | gansari, vkhvosto |
| Two-factor authentication | UI + API: authenticator-app codes after password or Google login, with single-use recovery codes. | vkhvosto |
| Profiles and avatars | UI + API: display name, photo preview/upload/replace/delete, initials fallback and permanent profile deletion. | vkhvosto, dbilenko, lkramer, gansari |
| Accounts | UI + API: account CRUD, opening balances, currencies, calculated balances, archive/restore and permanent deletion. | lkramer, vkhvosto, dbilenko, gansari |
| Categories | UI + API: CRUD, icon/color, expense/income applicability and linked-transaction counts before deletion. | lkramer, vkhvosto, dbilenko, gansari |
| Transactions | UI + API: income/expenses, categorization, edit/delete and atomic multi-currency transfers; merchant field is API-only. | lkramer, vkhvosto, dbilenko, gansari |
| Search and filtering | UI + API: transaction search, combined filters, sorting, pagination and URL-backed UI filters. | lkramer, gansari |
| Dashboard | UI + API: account balance, recent transactions and monthly category/type summaries. | gansari, lkramer, vkhvosto |
| Analytics | UI + API: per-currency charts and tables, customizable filters and 30-second visible-tab refresh. | vkhvosto, dbilenko |
| Export | UI + API: filtered CSV download; UI also supports browser print/save-as-PDF. | vkhvosto, dbilenko |
| JSON import | UI + API: validated bulk import with preview and existing-category matching. | lkramer |
| Currency catalog | API used by UI: 17 reference currencies; no exchange-rate conversion. | vkhvosto, lkramer |
| Localization and themes | UI: EN/DE/FA/UK, Persian RTL, language switcher, responsive layouts and light/dark themes. | gansari, dbilenko, vkhvosto, lkramer |
| Accessibility and design system | UI: accessible controls, keyboard/screen-reader support and reusable themed components; public `/design-system` catalog. | dbilenko, gansari, lkramer |
| Operations | Public status UI + API, readiness health endpoint, Compose health checks, automated database/avatar backups and documented restore procedure. | lkramer |
| Monitoring | Internal Prometheus metrics, Grafana dashboards and Alertmanager alerts with optional Telegram delivery. | lkramer |
| Legal information | Public `/privacy` and `/terms` pages linked from the application. | gansari |
| Development checks | CI: automated code, API, build and browser regression checks. | vkhvosto, lkramer, dbilenko, gansari |

Detailed endpoint contracts and archived-account restrictions are in the [API reference](docs/api.md); friends/online presence are outside scope.

## Modules

The following selection follows subject v21.1: each Major is worth 2 points, each Minor is worth 1, and 14 points are required; contributors are identified from commit authorship and co-authorship, and evaluation determines credit.

### Major modules

| Category | Module | Points | Status | Justification and implementation | Contributors |
|---|---|---|---|---|---|
| Web | Frameworks for frontend and backend | 2 | Implemented in this branch | Next.js/React and Express structure the UI, server rendering and authenticated API. | lkramer, vkhvosto, gansari, dbilenko |
| Accessibility and Internationalization | Complete WCAG 2.1 AA accessibility | 2 | Implemented in this branch | Accessible components, keyboard navigation, screen-reader support, contrast/reflow checks and axe/browser checks; see the [accessibility audit](docs/accessibility.md). | dbilenko, gansari, lkramer |
| User Management | Standard user management and authentication | 2 | Incomplete; excluded from completed total | Authentication, editable profiles and avatars exist; the required friends system and online status are missing and outside the intended feature scope. | lkramer, vkhvosto, dbilenko, gansari |
| Devops | Monitoring with Prometheus and Grafana | 2 | Implemented in this branch | Prometheus metrics, PostgreSQL exporter/cAdvisor, provisioned Grafana dashboards, alert rules/Alertmanager and authenticated Grafana access. | lkramer |
| Data and Analytics | Advanced analytics dashboard | 2 | Implemented in this branch | Interactive per-currency charts, date/account/category/type filters, CSV and browser PDF printing; data updates through 30-second visible-tab polling. | vkhvosto, dbilenko |

### Minor modules

| Category | Module | Points | Status | Justification and implementation | Contributors |
|---|---|---|---|---|---|
| Web | Database ORM | 1 | Implemented in this branch | Drizzle provides typed PostgreSQL queries, schema definitions and SQL migrations. | lkramer, vkhvosto, dbilenko, gansari |
| Web | Custom design system | 1 | Implemented in this branch | More than ten reusable components with theme colors, typography and icons; public `/design-system` catalog. | gansari, dbilenko, lkramer |
| Web | Advanced search | 1 | Implemented in this branch | Transaction search combines filters, sorting and pagination with URL-backed UI state. | lkramer, gansari |
| Web | File upload and management | 1 | Implemented in this branch | JPEG/PNG avatars provide validation, access-controlled storage, preview, progress and deletion; JSON transaction files support validated preview/import without file retention. | vkhvosto, dbilenko, lkramer |
| Accessibility and Internationalization | Multiple languages | 1 | Implemented in this branch | English, German, Persian and Ukrainian catalogs with a language switcher. | gansari, dbilenko, vkhvosto, lkramer |
| Accessibility and Internationalization | RTL support | 1 | Implemented in this branch | Persian document direction, mirrored layouts and directional controls. | gansari, dbilenko, lkramer |
| User Management | Remote OAuth authentication | 1 | Implemented in this branch | Google sign-in with state/PKCE and protected identity linking; requires OAuth credentials. | gansari, vkhvosto |
| User Management | Two-factor authentication | 1 | Implemented in this branch | TOTP setup/enable/disable, encrypted secrets, single-use recovery codes and rate-limited challenges after password or Google sign-in. | vkhvosto |
| Devops | Health checks, status page, backups and disaster recovery | 1 | Implemented in this branch | Readiness endpoint, public dependency/backup status, retained database/avatar backups and documented restore procedure. | lkramer |

### Point calculation

| Scope | Calculation | Points |
|---|---|---|
| Implemented in this branch | 4 Major × 2 + 9 Minor × 1 | 17 |
| **Implemented project total, subject to evaluation** | **4 Major × 2 + 9 Minor × 1** | **17** |
| Incomplete; excluded | Standard user management Major | 2 |
| Full selection, including incomplete module | 5 Major × 2 + 9 Minor × 1 | 19 |

User Management is a separate subject category from Accessibility and Internationalization; OAuth and application 2FA are independent Minor modules and do not require completing the standard user-management Major.

## Resources

### Documentation and project guides

| Reference | Topic / use |
|---|---|
| [Node.js 22 documentation](https://nodejs.org/docs/latest-v22.x/api/) | runtime and standard library. |
| [Next.js documentation](https://nextjs.org/docs) and [React documentation](https://react.dev/learn) | routing, rendering and UI. |
| [Express documentation](https://expressjs.com/) | HTTP routing and middleware. |
| [PostgreSQL 17 documentation](https://www.postgresql.org/docs/17/) and [Drizzle documentation](https://orm.drizzle.team/docs/overview) | SQL, schema and migrations. |
| [Docker Compose documentation](https://docs.docker.com/compose/) | local container orchestration. |
| [Tailwind CSS documentation](https://tailwindcss.com/docs) and [next-intl documentation](https://next-intl.dev/docs/getting-started) | styling and localization. |
| [Google OpenID Connect documentation](https://developers.google.com/identity/openid-connect/openid-connect) | identity and OAuth integration. |
| [WCAG 2.1](https://www.w3.org/TR/WCAG21/) | accessibility requirements; see the [project audit](docs/accessibility.md) for recorded evidence. |
| [Vitest documentation](https://vitest.dev/guide/) and [Playwright documentation](https://playwright.dev/docs/intro) | unit and browser checks. |
| API guide | [Endpoints, validation and request examples](docs/api.md). |
| Development guide | [Host development, migrations, Docker commands and troubleshooting](docs/development.md). |
| Testing guide | [Local checks, API/browser tests and CI](docs/testing.md). |
| Monitoring guide | [Setup, metrics, alerts and Telegram delivery](docs/monitoring.md). |
| Design system guide | [Tokens and reusable components](docs/design-system.md). |
| Existing project guides | [Bruno API checks](backend/bruno/README.md), [disaster recovery](docs/disaster-recovery.md), [design references](docs/design/README.md). |
| Evaluation subject | Supplied ft_transcendence **v21.1**, chapter IV (modules) and chapter VI (README). PDF not committed to the repository. |

### AI usage

AI was used for concept development, code reviews, debugging, code explanations and suggested implementations in TODO (specific project components), with its output verified through TODO (actual review and testing methods).

## Individual Contributions

| 42 login | Specific features, modules or components contributed | Challenges | How they were resolved |
|---|---|---|---|
| vkhvosto | TODO | TODO | TODO |
| dbilenko | TODO | TODO | TODO |
| lkramer | TODO | TODO | TODO |
| gansari | TODO | TODO | TODO |
