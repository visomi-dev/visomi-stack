# Tech Stack

## Runtime

| Layer             | Technology              | Role                              |
| ----------------- | ----------------------- | --------------------------------- |
| Frontend (public) | Astro 5                 | Marketing / landing pages         |
| Frontend (app)    | Angular 21 + PrimeNG 21 | Product UI, dense interaction     |
| API               | Express 5               | HTTP routes, auth, business logic |
| Gateway           | Custom server           | Route composition, reverse proxy  |
| Worker            | BullMQ 5                | Async job processing              |
| Realtime          | Socket.IO               | WebSocket fanout                  |
| Event bus         | Redis (ioredis)         | Cross-runtime pub/sub             |

## Data

| Concern       | Technology                                      |
| ------------- | ----------------------------------------------- |
| Database      | PostgreSQL                                      |
| ORM           | Drizzle ORM (beta, migrations with drizzle-kit) |
| Session store | PostgreSQL-backed (express-session)             |
| Cache / queue | Redis                                           |

## Languages & Tooling

| Concern          | Technology           |
| ---------------- | -------------------- |
| Language         | TypeScript (strict)  |
| Monorepo         | Nx 22                |
| Package manager  | pnpm 10              |
| Linting          | ESLint (flat config) |
| Formatting       | Prettier             |
| Unit testing     | Jest                 |
| E2E (API/server) | Jest + supertest     |
| E2E (browser)    | Playwright           |
| Commit lint      | Commitlint           |
| Pre-commit       | Husky                |

## Frontend Libraries

| Library                               | Purpose                                                                   |
| ------------------------------------- | ------------------------------------------------------------------------- |
| PrimeNG                               | UI component library (InputText, Password, Button, InputOtp, Toast, etc.) |
| @fontsource/inter                     | Body text                                                                 |
| @fontsource/manrope                   | Display / headings                                                        |
| @fontsource/jetbrains-mono            | Code / mono text                                                          |
| @fontsource/material-symbols-outlined | Iconography                                                               |

## Backend Libraries

| Library                   | Purpose                           |
| ------------------------- | --------------------------------- |
| passport / passport-local | Authentication strategy           |
| express-session           | Session management                |
| helmet                    | Security headers                  |
| morgan                    | HTTP request logging              |
| pino                      | Structured logging                |
| zod                       | Request/data validation           |
| mailgun.js                | Email delivery (verification PIN) |
| dotenv                    | Environment variable loading      |

## Infrastructure

| Concern   | Technology                               |
| --------- | ---------------------------------------- |
| CI        | GitHub Actions                           |
| Container | Docker (production image via Dockerfile) |
| Node.js   | v24                                      |

## Design System

| Concern    | Source                                                 |
| ---------- | ------------------------------------------------------ |
| Tokens     | Themis design system (Slate & Syntax / Night Edition)  |
| CSS        | Tailwind CSS                                           |
| Typography | Manrope (display), Inter (body), JetBrains Mono (mono) |
