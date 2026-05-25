# Jojo's KC Bike Map — Development Guide

## Project Summary
This project is a high-fidelity, community-driven bike map for the Kansas City metro area. It leverages a Cloudflare serverless architecture (Workers, D1, KV, R2) to provide a performant and globally distributed API. The frontend is built with vanilla JavaScript, Leaflet for mapping, and GSAP for animations, ensuring a lightweight yet highly interactive experience.

Key features include:
- **Role-Based Access Control (RBAC):** Magic link authentication with distinct roles (public, user, contributor, moderator, admin) enforcing strict data visibility and mutation rules.
- **Community Field Reports:** Time-decaying reports (e.g., mud, construction) with secure delete tokens for anonymous posters.
- **Regional Data Integration:** Automated pipeline for syncing official MARC regional trails data.
- **Robust Security:** CORS restrictions, pre-flight checks, input validation, and secure HTTP-only cookies for session management.

## Recent Fixes & Improvements (v1.1.0)
The latest iteration resolved several critical bugs and security vulnerabilities:
- **Security:** Removed leaked `.har` session files, restricted `Access-Control-Allow-Origin` to authorized domains, and implemented secure server-side permission gating for GeoJSON bulk imports.
- **Authentication:** Fixed the `GET /auth/verify` magic link route, properly establishing session cookies and preventing token leaks on email failures.
- **Frontend Stability:** Resolved `checkUserAuth` initialization bugs, decoupled `Nominatim` parallel search requests using `AbortController`, and fixed UI state desyncs during login.
- **Data Integrity:** Corrected moderator field restriction logic and fixed SQL alias mismatches (`user_id` vs `id`) that broke user profiles.

---

## Procedural Prompt for Gemini CLI (Fine-Tuning & Iteration)

When initiating a new session with the Gemini CLI for feature development or bug fixing, use the following prompt to establish the correct context and enforce strict regression prevention rules:

```markdown
You are an expert full-stack developer tasked with iterating on the "Jojo's KC Bike Map" project. This is a production-ready application using Cloudflare Workers (TypeScript) on the backend and vanilla JavaScript with Leaflet/GSAP on the frontend.

### Context & Architecture
*   **Backend:** Cloudflare Workers (`src/index.ts`), D1 (Relational SQL), KV (Preferences), R2 (Avatars).
*   **Frontend:** Vanilla JS (`public/js/`), Leaflet map engine, GSAP animations.
*   **Authentication:** Passwordless Magic Links via Cloudflare Email Routing. Sessions use strict HttpOnly cookies.
*   **Permissions:** Strict RBAC. Always verify `hasPermission(role, ...)` on the server side for any mutating endpoint.

### Iteration Rules (Non-Regression Protocol)
1.  **Analyze First:** Before writing code, use read-only tools to examine the relevant files (`src/index.ts`, `public/js/api.js`, `public/js/app.js`). Trace the full data flow from UI -> API -> Database.
2.  **Strict Typing:** Ensure all backend changes pass TypeScript compilation (`npx tsc --noEmit`). Do not introduce `any` types unnecessarily. Use explicit type casting only when mandated by Cloudflare Worker bindings.
3.  **Security First:**
    *   Do not modify the CORS policy (`Access-Control-Allow-Origin`) unless explicitly instructed.
    *   Any new API route MUST include authentication and permission checks (`hasPermission`).
    *   Never log sensitive data (tokens, emails, session IDs) to the console.
4.  **Preserve State:** When modifying frontend vanilla JS, ensure event listeners are not duplicated and variables are not closed over before declaration.
5.  **Test Locally:** If possible, verify changes against the `schema.sql` to ensure database queries match the actual table structures. Pay close attention to column names (e.g., `id` vs `user_id`).

### Your Task
[Insert detailed description of the bug to fix or feature to implement here]

Please outline a clear, step-by-step plan before making any code modifications.
```
