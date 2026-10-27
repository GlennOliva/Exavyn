# Exavyn — Secure assessment platform

A full-stack, role-based proctored examination platform. Teachers author
50-item MCQ exams, publish them only to approved, enrolled students, and the
exam runs in a focused exam mode (native fullscreen where the device permits it,
an accessible viewport fallback otherwise) with a strict, server-enforced
violation policy:

**1st departure → warning ("Warning 1 of 2"); 2nd distinct departure →
answering locks and the attempt is finalised atomically from the
server-saved answers.** Deadlines are server-authoritative, scores are
calculated server-side, and every final result is immutable.

> **Honest monitoring disclaimer.** Browser monitoring cannot be a guarantee
> against cheating. This application never claims to "prevent" cheating. It
> records a well-documented policy, requests fullscreen when available,
> deduplicates departures, and locks/finalises deterministically. Where the
> Fullscreen API is unavailable (notably iPhone/iPad Safari), it uses a
> viewport-filling focused layout instead of blocking the student, and says so
> honestly. It does not lock a device (browser fullscreen can be exited with
> OS-level keys), does not record screencapture, and cannot police external
> devices. See
> [Browser limitations and future work](#browser-limitations-and-future-work).

---

## Table of contents

- [Roles and route matrix](#roles-and-route-matrix)
- [Monitoring policy](#monitoring-policy)
- [Grading, timing, and finality](#grading-timing-and-finality)
- [Tech stack and structure](#tech-stack-and-structure)
- [Getting started](#getting-started)
- [Booting the first administrator](#booting-the-first-administrator)
- [Demo walkthrough](#demo-walkthrough)
- [Branding and themes](#branding-and-themes)
- [Tests](#tests)
- [Verification and acceptance criteria](#verification-and-acceptance-criteria)
- [Deployment](#deployment)
- [Security decisions](#security-decisions)
- [Browser limitations and future work](#browser-limitations-and-future-work)
- [Completion report](#completion-report)

---

## Roles and route matrix

| Role | Can do | Routes |
| --- | --- | --- |
| Admin | Promote teachers/admins, suspend accounts, view all courses/exams/etc., reports, audit logs, manage all feedback | `/admin`, `/admin/users`, `/admin/courses`, `/admin/exams`, `/admin/reports`, `/admin/audit`, `/feedback` |
| Teacher | Create/edit/archive/delete courses, manage exams and results, and manage feedback associated with owned courses/exams | `/teacher`, `/teacher/courses`, `/teacher/courses/:id`, `/teacher/exams/new`, `/teacher/exams/:id/{edit,results}`, `/teacher/attempts/:id`, `/feedback` |
| Student | Register, join courses, take exams, view released results/reviews, configure profile appearance, and submit/view own feedback | `/student`, `/student/join`, `/student/courses/:id`, `/student/exams/:id`, `/student/exams/:id/take`, `/student/attempts/:id/result`, `/student/attempts/:id/review`, `/student/history`, `/profile`, `/feedback` |
| Public | Login, register, password recovery | `/login`, `/register`, `/forgot-password`, `/update-password`|

Route guards are a UI convenience; the database enforces authorization on
every table and RPC (Row Level Security). A student cannot assign themselves a
role through the UI or any direct API call.

## Monitoring policy

Shown to students on the pre-exam instructions screen and enforced
end-to-end:

- The exam requests **native fullscreen from the start gesture** when the
  document reports that it can. Leaving fullscreen is a departure signal.
- If the request is unsupported or rejected (for example, iPhone/iPad Safari),
  the exam continues in an **accessible fallback** that fills the available
  viewport. The absence of fullscreen is never a violation, never blocks
  recovery, and is labelled "Focused layout · fullscreen unavailable" rather
  than being described as fullscreen or lockdown.
- **Departures** are physical presence losses: window blur (after a 1 s grace,
  which is what an OS app switch — Command+Tab / Alt+Tab — produces), tab hidden
  (visibility change), fullscreen exit, or an attempted navigation away from the
  exam route.
- One physical departure = **one episode** (stable `episode_id`), even when
  the browser fires `blur` + `visibilitychange` + `fullscreenchange`
  together. A long absence does not generate repeated flags.
- Episode 1 → the UI shows **"Warning 1 of 2"** and answering is paused until
  the student acknowledges. The attempt is fully recoverable.
- Episode 2 (a second, distinct departure after full recovery) → answering
  locks immediately and the attempt is **finalised automatically** with
  reason `violation_limit`.
- Duplicate event deliveries — retries, reload replays, offline retries — can
  never double-count an episode. A server unique constraint on
  `(attempt_id, episode_id)` is the backstop.
- The deadline is computed server-side. When it passes while the student is
  away, the timer fires, a scheduled server job (`pg_cron` /
  `finalize-expired-attempts`, migration 0008) finalises it even with no browser
  open, and the attempt ends with reason `time_expired` — changing the computer
  clock changes nothing.
- **One tab/device per attempt.** Resuming requires the controller token the
  session already holds; a second session is rejected until the previous
  lease lapses. Same-browser tabs also announce their controller over a
  `BroadcastChannel` (best-effort UX only, not a security boundary).
- **Results are immutable.** Neither students nor teachers nor admins can
  alter a final score, final answers, the final violation count, or the
  submitted state.

See `src/lib/config.ts` for `VIOLATION_THRESHOLD` (fixed at 2),
`FOCUS_LOSS_GRACE_MS` (1 s), and `DEPARTURE_COALESCE_MS` (1.2 s). The database
enforces the threshold of 2 with a check constraint. Fallback exams keep the
same visibility/focus monitoring where the browser reports it, but the UI
explicitly notes that a web page cannot prevent app switching.

## Grading, timing, and finality

- Correctness lives **only** in `public.answer_keys`. `question_options` has no
  correctness column. Students have no `SELECT` on `exam_questions` /
  `question_options` / `answer_keys`; content reaches them only through the
  security-definer RPC `get_attempt_payload`, which never includes a
  correct answer.
- **Correct answers are released separately from the score.** Each attempt
  snapshots an `answer_review` policy (`immediate` / `scheduled` /
  `after_attempts` / `after_close` / `never`) and a `pass_threshold`. Per-question review is served
  only through the authorized, release-gated RPC `get_attempt_review`, which
  returns `questions: []` until the policy releases and enforces that answer
  review is never earlier than score release. A student must still be
  approved-enrolled; the owner teacher and admins always see the keys.
- Answers are keyed by attempt/question UUID and saved as stable option UUIDs.
  Every logical change uses a new request id and increasing per-question
  revision; the server rejects stale writes. Next, Previous, revisits, and
  manual submission wait for the latest save. Clearing persists a null choice.
- `submit_attempt`, `record_violation` at threshold, and the expiry job all
  call the same `app.finalize_attempt` which grades with `SELECT ... FOR
  UPDATE` on the attempt — exactly one consistent result regardless of
  racing submits.
- Result release (`immediate`, `scheduled`, or `after_close`) is enforced by
  every student result RPC and direct unreleased attempt rows are hidden by RLS.

## Courses, attempts, and result policy

**Course management.** A teacher can edit a course's details, archive/restore
it (archived courses reject new attempts), and delete it **only when it has no
enrollments and no exams** — otherwise the database refuses and points to
archive. Join codes are stored hashed **and** reversibly ciphered (migration
0009, `app.secrets.join_code_key`), so the owner can retrieve the current code
with `get_join_code`; the raw `code_hash`/`code_cipher` columns are never
selectable by clients (column-level `REVOKE`/`GRANT`). Codes created before
0009 are hash-only and report `legacy:true` — regenerate to get a readable code.

**Attempts and result policy.** A teacher sets `max_attempts` (1–20) and a
`result_policy` (`latest` = most recent completed attempt, `highest` = best
score) on both drafts and published exams. Settings on a published exam change
**prospectively only**: questions, choices, and keys stay frozen, and each new
attempt snapshots the result-release policy at creation. Resuming an in-progress
attempt never consumes one; submitted, expired, and violation-finalised attempts
all count; lowering the limit never deletes history or invalidates an active
attempt. `get_my_exam_attempts` reports `used`/`remaining` plus the per-attempt
list, and `get_my_results_page` is the release-guarded, server-paginated student
 history (search + page/page-size in Postgres, fixed 10/25/50 sizes). Direct
 student access to unreleased `exam_attempts` rows is blocked by RLS.

**Tables and result status.** Every authorized list — admin users/courses/exams/
reports/audit, teacher courses/enrollments/exams/results/violations, student
courses/exams/history — uses the same URL-backed pagination control (10/25/50,
Previous/Next, "1–10 of 42"). Search, filters, and sorting are applied before
the page slice; the browser never downloads the whole table and hides rows.
Active-exam question navigation is deliberately excluded. Score badges use the
authoritative unrounded percentage against the snapshotted teacher threshold:
green **Passed** at/above the threshold, yellow **Near passing** inside the
10-point band immediately below it, red **Failed** below that. A missing
threshold, pending attempt, or unreleased result is neutral and never implies
pass/fail.

**Answer review and pass threshold.** A teacher also sets `answer_review` and an
optional `pass_threshold` (0–100) on drafts and published exams. Both are
snapshotted onto each attempt at `start_attempt`, so policy changes are
prospective only, and `get_result` / `get_my_results` report `review_released`,
`review_reason`, `passed`, and the threshold. Release is strictly ordered — the
score always releases first; review then releases per policy — with clear
reasons (`immediate`, `after_attempts`, `after_close`, `never`, `privileged`,
`score_pending`, `awaiting_attempts`, `awaiting_close`, `in_progress`,
`not_found`). `get_attempt_review` returns per-question prompt, points, the
student's choice, the correct choice, correctness, options in shown order, and an
optional authored explanation. Attempts snapshotted before migration 0010 default
to `never` (their keys are never retroactively exposed). The student review page
reads the policy, shows the reason when withheld, and local resume/token state is
cleared on sign-out and on account switch.



React 19 + TypeScript (strict), Vite, React Router, Vitest + Testing Library,
Playwright, Supabase (Postgres, auth, RLS, Edge Functions).

```
src/
  lib/            supabase client, config, types, errors, csv, format, datetime,
                  useAsync, pagination
  features/       auth, courses, exams, attempts, results, admin, monitoring,
                  exam/fullscreen
  components/     ui, guards, layout (AppShell), Pagination, ScoreBadge
  pages/          auth, admin, teacher, student, profile
supabase/
  migrations/     versioned SQL (0000 init -> 0009 teacher features -> 0010 answer
                  review -> 0011/0012 paginated student results)
  functions/      bootstrap-admin, provision-teacher, _shared/cors
  tests/          rls.test.mjs (real-user-token RLS/grant tests)
scripts/
  seed-demo.mjs   idempotent demo data via real RPC sessions
tests/e2e/        Playwright public-surface smoke tests
```

## Getting started

Prerequisites: Node 22+, `npm`, the [Supabase CLI](https://supabase.com/docs/guides/cli),
and a Docker runtime (or a hosted Supabase project).

```bash
npm install

# 1. Start a local Supabase stack
supabase start

# 2. Apply migrations + RLS + functions and seed
supabase db reset

# 3. Configure the browser-facing app
cp .env.example .env.local
#   .env.local:
#     VITE_SUPABASE_URL=http://127.0.0.1:54321
#     VITE_SUPABASE_ANON_KEY=eyJ...
#   (Get URL + anon key from `supabase status`.)

# 3b. Server-side tools (Node suites, seeder, authenticated e2e) read secrets
#     from a SEPARATE, gitignored file. Copy the template and fill it in:
cp .env.server.example .env.server.local
npm run check:env        # confirms presence without printing any value

# 4. Run the app
npm run dev
```

Against a hosted project, run the same steps with
`supabase link --project-ref <ref>` and `supabase db push`, and provide your
project's live URL/anon key (never the service-role key in the frontend).

## Booting the first administrator

Admin promotion is a one-time Edge Function gated by a secret token — the
only path that grants the first admin.

```bash
supabase functions deploy bootstrap-admin --no-verify-jwt
supabase secrets set BOOTSTRAP_ADMIN_TOKEN="$(openssl rand -hex 32)"

# The function URL is printed by `supabase functions deploy`, e.g.
#   https://<project-ref>.functions.supabase.co/bootstrap-admin
curl -X POST "$FUNCTION_URL" \
  -H 'Content-Type: application/json' \
  -d '{"token":"<BOOTSTRAP_ADMIN_TOKEN>","email":"admin@exam.test","password":"...","full_name":"Platform Admin"}'
```

Then rotate/remove `BOOTSTRAP_ADMIN_TOKEN`. Later admins are created by an
existing admin in the UI. Each new user becomes a student automatically via a
database trigger; teachers must be approved by an admin
(`provision-teacher` is available for admins to promote teachers).

## Demo walkthrough

`scripts/seed-demo.mjs` seeds six users (one-time password `ExamDemo!234`),
a course, an approved enrollment, a pending enrollment, and a published
50-item exam through the same RPCs the UI uses:

```bash
# Secrets come from .env.server.local (see .env.server.example), or export them:
npm run check:env     # confirm SUPABASE_SERVICE_ROLE_KEY is present (values hidden)
npm run seed
```

Then, in the browser:

1. **Sign in** as `admin@exam.test`; promote `teacher1@exam.test` to teacher.
2. **Sign in** as `teacher1@exam.test`; confirm the seeded course, the published
   exam, and the pending enrollment from student3.
3. **Sign in** as `student1@exam.test` (approved). Dashboard shows the exam.
   Open it, read the monitoring policy, start the fullscreen attempt.
4. Answer ~30 of 50 questions (scores use 1 point each).
5. Switch tabs/leave and come back — **Warning 1 of 2**, episode counted once.
6. Leave **again** (a second distinct departure) — answering locks and the
   attempt finalises automatically with reason `violation_limit`.
7. View the result: immutable, `30/50 = 60%` if 30 correct, and no answer keys
   are shown to the student.
8. Verify as `teacher1` that the result and violation events are visible and
   that nothing can be edited.

## Branding and themes

The app ships as **Exavyn**. The display name resolves from `appName` in
`src/lib/config.ts` (`'Exavyn'` by default; override with `VITE_APP_NAME` in
`.env.local`). The wordmark lives at `src/assets/logo_exavyn.png` and is reused
as the favicon at `public/logo_exavyn.png`. The old slogan is no longer rendered
beside or below the logo.

**Typography.** Display headings use **Space Grotesk Variable**; body and form
copy use the platform UI stack; technical values, counters, table headers, and
timers use **JetBrains Mono Variable**. Both fonts are self-hosted through
`@fontsource-variable`, so production does not depend on a third-party font CDN.
Azonix was not supplied as a licensed font asset, so Space Grotesk is the
intentional geometric substitute. The supplied wordmark keeps a light backing
on dark surfaces (never inverted).

**Visual system.** The Cyber-Tribal direction uses layered dark surfaces,
restrained cyan/green actions, thin geometric artwork, and softly rounded 8px
controls. The artwork is original local SVG/CSS geometry — no tattoos, sacred
symbols, masks, or remote placeholder imagery. Reference colours (cyan
`#00FFFF`, jungle `#29AB87`, magenta `#FF00FF`, indigo `#4B0082`, orange
`#FF4500`, blacklight purple `#BF00FF`) are decorative accents; functional
tokens use accessible variants. Key functional dark tokens are page `#080B14`,
sidebar/header `#0D1323`, card `#121A2D`, elevated `#1A2440`, border `#2B3652`,
primary text `#E8EEF7`, secondary text `#ADB9CE`, action/link `#40D9D9`,
secondary accent `#38B899`, purple `#A875E8`, magenta `#DC68CC`, orange
`#E88960`, with `#081318` button text. Score tones remain green/yellow/red/
neutral and are independent of branding.

**Public vs authenticated surfaces.**

- Login, registration, recovery, and password-update screens are **fixed dark**
  and expose no appearance controls. `<html data-surface="public">` scopes their
  tokens; the inline script and `ThemeSurface` keep this in sync before paint.
  Public screens never read, change, or persist `exavyn.theme`, so visiting them
  cannot overwrite a signed-in user's saved preference.
- The authenticated app keeps **Light / Dark / System**, with controls only under
  **Profile → Settings → Appearance**. The chosen mode is stored under
  `exavyn.theme`, applied to `<html data-theme>` plus `color-scheme`, and
  **System** follows live `prefers-color-scheme` changes. Active exams stay
  visually quiet and never show appearance controls.

## Tests

| Command | What it runs | Status (this repo) |
| --- | --- | --- |
| `npm run typecheck` | `tsc -b` (strict; note: `npx tsc --noEmit` does **not** check referenced projects) | green |
| `npm run lint` | ESLint (TS + React-Hooks classic rules) | green |
| `npm test` | 138 Vitest unit/component tests | green |
| `npm run build` | production build | green |
| `npm run test:e2e` | Playwright public/auth/branding plus credential-gated exam checks | green: Chromium 28 passed / 1 skipped; Firefox public smoke 12/12 + recovery/search 2/2 |
| `E2E_ANSWER_INTEGRITY=true npx playwright test tests/e2e/answer-integrity.exam.spec.ts --project=chromium --workers=1` | Dedicated shuffled B → C, delayed-save, clear, reload, database/grade/review scenario plus progress counters | green: 1/1 local and production |
| `npx playwright test tests/e2e/sidebar-admin.spec.ts tests/e2e/theme-authenticated.spec.ts tests/e2e/feedback.spec.ts --project=chromium` | Credential-gated sidebar/admin embed, mobile drawer focus, theme persistence, feedback routing/unread | green: 9/9 production |
| `npm run e2e:fixture` | Provision a self-contained authenticated-e2e fixture (teacher + student + published exam) into `.env.server.local` | used for the headed authenticated flow |
| `npm run test:rls` | RLS/grant checks with real user tokens (incl. review-RPC authorization, role-escalation denial, cross-student isolation) | verified 36/36 live (user tokens only) |
| `npm run test:workflow` | Authenticated workflow, answer revisions/clear/review mapping, release policy, bookmarks, pagination | verified 65/65 live |
| `npm run test:concurrency` | Races, episode dedup, controller recovery, expiry | verified 5/5 live |
| `npm run test:finality` | Final-score immutability: idempotent submit, no rewrite/delete by any user role | verified 10/10 live |
| `npm run test:feedback` | Feedback routing, deduplication, unread state, and user/teacher/admin/private-note isolation | verified 18/18 live |
| `npm run test:teacher-search` | Teacher enrollment name/email search, literal wildcards, status/pagination/count, cross-teacher and anonymous denial | verified 12/12 live |
| `npm run test:hosted` | RLS → workflow → concurrency → finality → feedback → teacher search | verified live: 146/146, exit 0 |
| `npm run check:project` | Reachability + table/RPC presence (browser-safe only) | works with `.env.local` alone |
| `npm run check:env` | Server-env presence check (values never printed) | reports READY/BLOCKED per capability |
| `npm run check:auth-redirect -- <test-email>` | Verify hosted Auth honors the production recovery redirect without sending email | currently FAIL: hosted Site URL is still `http://localhost:3000` |
| `npm run users:confirm` | List/confirm pre-existing **unconfirmed** accounts (dry-run default; `--apply`) | read-only by default; never deletes or resets passwords |

Unit/component coverage highlights: the departure deduplication state machine
(single episode for blur+hidden+fullscreen; no rearm until full recovery;
second distinct departure is a new episode; tail signals merge), the
`useExamMonitor` DOM wiring (real `visibilitychange` → `visibility_hidden`,
sustained `blur` → `focus_lost` after the grace window, a quick blur ignored,
`fullscreenchange` → `fullscreen_exit`), the accessible-fallback rules
(no fullscreen violation and no fullscreen requirement for recovery), score
classification boundaries (unrounded threshold, 10-point near band, neutral
no-threshold/unreleased states), pagination maths and PostgREST search escaping,
exam-draft validation, the TXT
questionnaire parser (`src/features/exams/txtImport.test.ts`) and its preview
dialog, CSV formula-injection escaping, formatting, and shared UI behaviour.

Teachers author exams by hand or **import a TXT questionnaire** in the draft
editor: a numbered list of 4-choice questions with one `*`-marked answer is
parsed, previewed (marked answer highlighted, answer key never shown as text),
validated with per-question/per-line errors, and only then replaces the question
list — a malformed file imports nothing.

The Playwright suite covers the **public surface** (routing, auth pages, setup
banner) plus public branding and privacy (title/logo with no slogan, fixed-dark
surface on every public account page, no appearance controls, saved preferences
left untouched, no-flash surface application, and a 390px mobile layout) so it
runs without a backend (12/12 in each of Chromium and Firefox). A
credential-gated spec (`tests/e2e/authenticated.exam.spec.ts`) exercises the
authenticated exam UI — sign-in, instructions policy, answer save, first-departure
warning, second-departure finalize — and **skips** unless `E2E_SUPABASE_CONFIGURED`
plus student credentials are provided. `npm run e2e:fixture` provisions those
credentials (dedicated teacher + student + published exam) into the gitignored
`.env.server.local` without printing the password. Run **headed** in Chromium it
passes 3/3: departures are driven by real `document.exitFullscreen()` calls
(synthetic events cannot change real `document` state), with a wait past
`DEPARTURE_COALESCE_MS` before the second exit so it opens a new episode; where
the environment refuses fullscreen the flow skips rather than fails.

A matching credential-gated spec (`tests/e2e/theme-authenticated.spec.ts`)
verifies that appearance controls live only under Profile → Settings →
Appearance, that the choice persists across reload with no console errors, and
that the chosen authenticated theme carries into the exam instructions page.

OS-level app switches (Command+Tab on macOS, Alt+Tab on Windows) surface to the
app as window `blur` → `focus_lost` (unit tested via a real `blur` event). The OS
switch itself is **not** automated — a genuine app switch cannot be injected
without Accessibility/Screen Recording permission, and synthetic DOM events
deliberately do not register — so it is covered by a **manual checklist** in
`docs/HOSTED_VERIFICATION.md` §5 and reported **UNVERIFIED** until run on that OS.

`tests/e2e/registration.exam.spec.ts` always runs (no credentials): it intercepts
the signup endpoint to prove a rapid double submit issues **exactly one** request
and that a `429 over_email_send_rate_limit` shows a clear cooldown message rather
than the raw error. Email confirmation is disabled, so `src/pages/auth/RegisterPage.test.tsx`
additionally covers the success path (a returned session redirects to `/student`),
the no-session (already-registered) hint, and client-side password validation.
`tests/e2e/admin.exam.spec.ts` signs in with an admin and
asserts the `/admin` route; it is gated on `E2E_ADMIN_EMAIL`/`E2E_ADMIN_PASSWORD`.
`npm run admin:verify -- --browser` (and `admin:provision --browser`) pass those
in via the environment and **require 2 passed / 0 skipped** before reporting
success — a skipped run is treated as failure, not success.

The RLS suite signs in as the seeded accounts with the publishable anon key and
asserts cross-teacher isolation, enrollment gating, answer-key confidentiality,
no-direct-answer-leaks in the attempt payload, attempt immutability, join-code
column confidentiality (`code_hash`/`code_cipher` unselectable), review-RPC
authorization (non-owner student/teacher denied), **privilege-escalation denial**
(a student cannot insert/update `user_roles`, grant a role to another account, or
call `admin_set_role`, and stays a `student`), **cross-student isolation**
(a student cannot read another student's profile, role, or attempts), and admin
breadth — using real user tokens, never the service role. The workflow,
concurrency, and finality suites drive the RPC surface end-to-end (service role
used only for fixture setup) and cover the immutability, race,
deadline-precedence, release-policy, controller-recovery, and final-score
finality guarantees, plus the teacher features: join-code retrieval, course
edit/archive/guarded-delete, published-exam settings edits, multi-attempt
numbering and exhaustion, `highest`-score selection, release-guarded
`get_my_results`, exam duplication, and draft-only deletion. It also covers the
answer-review surface: immediate/`never`/`after_close`/`after_attempts` release
gating (`get_attempt_review` returns `questions: []` with a reason until
released), owner-teacher vs peer-student authorization, no key material in a
withheld payload, and pass-threshold `passed` reporting on both `get_result` and
`get_my_results`. Fixtures are recorded to `supabase/tests/.fixtures/` and
cleaned up best-effort; see the runbook.

**Operator runbook:** `docs/HOSTED_VERIFICATION.md` (setup, environment split,
acceptance matrix, fixture/cleanup policy).

## Verification and acceptance criteria

Local (deterministic) — **pass**:

- `tsc -b`, ESLint, `vitest` (141/141), `vite build` all pass.
- Hosted suites (`npm run test:hosted`, exit 0): RLS 36/36, workflow 65/65,
  concurrency 5/5, finality 10/10, feedback 18/18, teacher search 12/12
  (146/146).
- Playwright public-surface + registration + branding smoke: 12/12 in
  Chromium and 12/12 in Firefox (registration: no duplicate submit; clear 429
  email-limit message; public pages: fixed-dark surface, no appearance controls,
  saved preference untouched, no-flash boot, desktop + 390px mobile).
- Authenticated Chromium suite: 28 passed / 1 skipped (answer-integrity scenario
  runs separately when explicitly enabled).
- Administrator route: `admin@exam.test` signs in and lands on `/admin` (admin e2e 2/2);
  `admin@gmail.com` is provisioned through the token-gated `bootstrap-admin` path
  (`npm run admin:provision`).
- Dedup state machine: one departure = one episode; long absence = one flag;
  recovery requires visible + focused + fullscreen; second distinct departure
  = episode 2; tail-signal/twin `episode_id` retries never double count.
- Exam-draft validation mirrors the server (`app.validate_exam_payload`),
  including the 50-item and exactly-four-choices rules.
- CSV exports escape `= + - @` formula injection and quote delimiters.

Re-verified live against a dedicated hosted test project (project ref
`tddmtdhhckykwnoydvjc`, never production) using **user tokens only** — **pass**:

- RLS with real user tokens (acceptance 1–6, 17 partially) via
  `npm run test:rls` — **36/36** (re-run live), incl. review-RPC authorization,
  role-escalation denial (no `user_roles` insert/update, no `admin_set_role`),
  and cross-student record isolation (profile/role/attempts).
- Live authenticated lifecycle (acceptance 6, 7, 9–12, 14, 17) via a
  user-token-only script — **17/17**: owner publishes; student starts; a second
  session without the controller token is refused; payload carries no answer-key
  material; a stale (lower-revision) save is rejected; the first distinct
  violation is Warning 1 (not finalized); a duplicate episode does not double
  count; the second distinct violation locks answering and finalizes
  `violation_limit`; the result is immutable; post-finalize answer/submit are
  no-ops; and a near-deadline attempt flipped to `submitted:time_expired`
  **unattended in ~55s** (proves the `pg_cron` scheduler, acceptance 25) with no
  client finalize call.
- Deployed Edge Functions probed: `bootstrap-admin` → `403 Invalid bootstrap
  token`; `provision-teacher` → `401 Missing bearer token`, then **403
  Administrator privileges required** (JWT + admin-role gating live).

Re-run live this session with the service role available (`npm run test:hosted`,
exit 0) — **pass**:

- Authenticated workflow via `npm run test:workflow` — **65/65**: admin provisioning, cross-teacher
  isolation, enrollment gating, publish, no-leak payload, controller-gated
  resume, server grading (30/50 = 60%), duplicate/stale/foreign-controller
  saves, one-episode dedup, warning-then-finalize, post-finalize no-ops,
  deadline precedence, `after_close` withholding, plus join-code retrieval,
  course edit/archive/guarded-delete, published-exam settings edits,
  multi-attempt numbering/exhaustion, `highest`-score selection,
  release-guarded `get_my_results`, exam duplication, draft-only deletion, and
  answer review + pass threshold: immediate per-question detail for the owning
  student, owner-teacher access, peer-student denial, `never` withholding all
  key material, `after_close`/`after_attempts` gating with `questions: []`,
  scheduled score/review boundaries, direct-API withholding, stable answer
  changes/clears/out-of-order writes, bookmark persistence, exact review mapping,
  and `passed` reporting above/below the threshold.
- Concurrency (acceptance 13, 16, 19, 20) via `npm run test:concurrency` —
  **5/5**: racing submit/violation/save, duplicate-episode storm, controller
  lease rotation + recovery, clock independence, bulk expiry.
- Final-score immutability (acceptance 14, 17) via `npm run test:finality` —
  **10/10**: idempotent/simultaneous submit, no user-facing rewrite or delete of
  final fields by student/teacher/admin, post-finalize answer/violation no-ops,
  and deadline precedence.
- Authenticated UI e2e (`tests/e2e/authenticated.exam.spec.ts`) — **3/3 pass**
  when run headed in Chromium with inline `E2E_*` and a freshly published exam
  (isolated teacher/student fixture): sign-in/dashboard, instructions policy
  with no answer-key material in the DOM, and the full monitoring flow (start →
  answer saved → real fullscreen-exit departure → "Warning 1 of 2" → recovery →
  second real departure → immutable result). This does **not** cover Firefox;
  headless/offline runs skip (fullscreen unavailable / creds absent).

Not re-run (blocked): the local-vs-hosted **migration history diff** — this
host has no TCP path to Postgres (ports 5432/6543 egress-blocked), so
`npx supabase migration list --linked` cannot connect even with
`SUPABASE_DB_PASSWORD` present. See runbook §10.
- A scripted full lifecycle (start → acquire controller → payload → save →
  first departure → "Warning 1 of 2" → second departure → immutable result) was
  driven end-to-end against the hosted backend and passed.

The re-run above needs only the publishable anon key plus real seeded sessions,
so it is independent of the service-role blocker. The service-role suites
(`test:workflow`, `test:concurrency`, `test:finality`) and the CLI
migration-history diff remain **BLOCKED** until `SUPABASE_SERVICE_ROLE_KEY` and
`SUPABASE_ACCESS_TOKEN` are supplied; a suite that lacks credentials exits with
code 2 (BLOCKED), never a false pass. See runbook §10.

> **Data-router requirement.** The fullscreen exam interface uses
> `useBlocker` to guard in-attempt navigation (SOP req 119 / acceptance 13),
> which only works with a **data router**. `src/App.tsx` therefore builds the
> route tree with `createBrowserRouter` + `<RouterProvider>`. Do not swap it
> back to `<BrowserRouter>`/`<Routes>` — doing so throws at runtime
> (`useBlocker must be used within a data router`) and blank-screens the exam.

## Deployment

Static host (Vercel/Netlify/Cloudflare):

```bash
# VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY only
npm run build && npm run preview
```

Supabase:

```bash
supabase db push              # migrations, RLS, grants
supabase functions deploy bootstrap-admin --no-verify-jwt
supabase functions deploy provision-teacher
supabase secrets set BOOTSTRAP_ADMIN_TOKEN=<random> SUPABASE_SERVICE_ROLE_KEY=<...>
```

`SUPABASE_SERVICE_ROLE_KEY` is consumed only by server-side Edge Functions via
`supabase secrets` — it must never be a `VITE_*` variable.

## Security decisions

- **Keys isolated**: `answer_keys` readable by owner teachers/admins only; no
  correctness column on options; students served content only through
  security-definer RPCs.
- **Least privilege**: RLS on every table; explicit `GRANT`s; no student
  direct access to question/option/key tables; no direct UPDATE on attempts.
- **Account status everywhere**: `require_user()` gates every RPC, and the RLS
  policies also require `app.is_active()`, so a suspended account can read only
  its own profile/role (enough to explain the lockout) and nothing else.
- **Single controller**: resume is controller-gated — the stored token is never
  handed to a second session while a lease is live. Grants, not the client,
  enforce it.
- **Server authority**: deadlines, grading, finalisation, and the violation
  threshold (check-constrained = 2) live in the database; the browser never
  reports a score.
- **Immutability**: attempts finalise through one `FOR UPDATE` path; any
  direct mutation by any role is denied by RLS.
- **CSV safety**: formula injection neutralised for user-supplied text.
- **Secrets**: anon key only in the browser; service-role keys live in Edge
  Function secrets. Browser config is `.env.local`; server-only verification
  secrets live separately in `.env.server.local` (template
  `.env.server.example`) and are never imported by `src/`. Both are gitignored;
  `npm run check:env` reports presence without printing values.

## Browser limitations and future work

- OS fullscreen prompt and exit keys are user-controllable; the app cannot
  hard-lock a device. A managed kiosk / lockdown browser (e.g. Safe Exam
  Browser) is the honest path to device lockdown and is out of scope here.
- No webcam/audio, no screen capture, no network-tab monitoring (the heartbeat
  timer fires in the background; the violation policy is the enforcement).
- Native fullscreen remains browser-dependent. Unsupported iPhone/iPad and
  other browsers continue in a safe-area-aware `100dvh` focused layout while
  retaining observable focus/visibility monitoring.
- Single-controller semantics mean one tab/device per attempt; recovery after
  a crash is lease-based and documented on the blocking screen.

## Production bug fixes (2026-10-26)

**Teacher enrollment search.** The old query embedded a relationship alias
inside PostgREST's logical tree:
`.or('student.full_name.ilike.%q%,student.email.ilike.%q%')`. PostgREST returns
`PGRST100` for that syntax; dropping the alias fails with `42703` because the
embedded student columns are not columns of `enrollments`. Migration
`2026010100026_teacher_enrollment_search.sql` replaces the client-side filter
with the parameterized, `SECURITY DEFINER` RPC
`get_course_enrollments_page(...)`. It verifies course ownership (or admin),
performs literal case-insensitive substring matching over name/email with
`strpos(lower(...), lower(...))`, filters status, counts before pagination, and
orders by `requested_at DESC, id DESC`. `%` and `_` are ordinary characters, and
apostrophes/commas/parentheses never enter a PostgREST filter grammar. Deployed
UI search is debounced by 300 ms, hides stale rows/counts while a query settles,
resets to page 1, and offers a working atomic “Clear search and filters” action.

**Password recovery.** `passwordResetRedirectUrl()` now returns the canonical
`https://exavyn.vercel.app/update-password` unconditionally, and
`resetPasswordForEmail` passes it through `options.redirectTo`. There is no
fallback to `window.location.origin`, localhost, or `VITE_PUBLIC_SITE_URL`.
`UpdatePasswordPage` still distinguishes a missing/expired recovery session from
a valid one, shows a safe actionable message, handles implicit-flow errors such
as `otp_expired`, clears sensitive hash/query data, and confirms success only
after `updateUser` succeeds.

The production deployment (`https://exavyn.vercel.app`, asset `index-ZmwEjDxh.js`,
deployment `dpl_Ex1CW9ZeL1VYCe9N7EDqUBkeBNvW`) sends
`redirect_to=https://exavyn.vercel.app/update-password`. The production Supabase
project is the hosted test project `tddmtdhhckykwnoydvjc`, not the linked
migration project. A fresh recovery email captured with a disposable inbox
still contains `redirect_to=http://localhost:3000`: localhost appears only
inside the generated action URL, not in visible email copy.

**Still blocked:** the available account cannot manage
`tddmtdhhckykwnoydvjc` (Management API returns 403; the project is absent from
the accessible project list), so its Auth Site URL/allowlist/template cannot be
confirmed or changed. In Supabase Dashboard → Authentication → URL Configuration
set **Site URL** to `https://exavyn.vercel.app`, add exact redirect
`https://exavyn.vercel.app/update-password`, and remove any localhost from the
recovery template. Until then, `check:auth-redirect -- <test-email>` and fresh
production recovery emails still return localhost.

**Verification for these fixes:** unit **143/143**; lint, typecheck, and build
clean; production expired-recovery E2E **1/1**; production recovery request
**200** with the canonical `redirect_to`; fresh email inspected without logging
its token.

## Completion report

**Version 2 implemented:** stable answer mapping/revisions and explicit clear,
controlled save-before-navigation, bookmarks, independent scheduled score/key
release, exact-point score classification, shared pagination, password visibility,
responsive sidebar/drawer with persisted desktop collapse, profile appearance
settings, answered/unanswered/marked progress counts, exclusive session leases,
account-linked role-scoped feedback with two-way unread state, best-effort exam
interaction restrictions, and fullscreen fallback.

**Migrations:** forward-only `2026010100013` through `2026010100026` were applied
to project `tddmtdhhckykwnoydvjc` without a reset and recorded in
`supabase_migrations.schema_migrations`.

**Checks actually run in this repository:**
`npm run typecheck` pass · `npm run lint` pass · `npm test` **141/141** ·
`npm run build` pass (one non-blocking chunk-size warning) ·
Playwright Chromium **28 passed / 1 skipped**, Firefox public smoke **12/12**
plus recovery/search **2/2**, and answer integrity **1/1** locally. The dedicated credential-gated sidebar/
admin **4/4**, authenticated theme **2/2**, and feedback **3/3** are included in
the Chromium run. The current hosted database suites are **146/146** after the
teacher-search migration; the visual redesign itself changed no backend/auth
code.

**Hosted steps (dedicated test project `tddmtdhhckykwnoydvjc`):**
forward migrations through `2026010100026` applied via `supabase db push`/`db
push --db-url` (no reset); `bootstrap-admin` deployed and run to provision the first admin;
`npm run seed` seeded the demo (6 users, course `SOP101`, approved + pending
enrollment, one 50-item published exam) and is idempotent on re-run. Re-verified
live: `npm run test:hosted` exit 0 — `rls` **36/36**, `workflow` **65/65**,
`concurrency` **5/5**, `finality` **10/10**, feedback **18/18**, teacher search
**12/12**: **146/146 hosted checks**. A scripted lifecycle **17/17** (start → acquire controller → payload → save →
Warning 1 of 2 → duplicate-episode dedup → second departure → immutable
`violation_limit` result → post-finalize no-ops); Edge Functions confirmed
ACTIVE (v2) via CLI and probed (`bootstrap-admin` 403 bad token,
`provision-teacher` 401/403); the one-time `BOOTSTRAP_ADMIN_TOKEN` was later
**removed** after `admin@gmail.com` was provisioned (post-removal probe now
`500` "not configured" — the path fails closed); `pg_cron`
`finalize-expired-attempts` proven live — a near-deadline attempt auto-finalised
to `submitted:time_expired` in ~55s with no client call. The only step still
**blocked** is the local-vs-hosted `migration list` diff: this host has no TCP
path to Postgres (ports 5432/6543 egress-blocked) even though
`SUPABASE_DB_PASSWORD` is present. `npm run check:env` reports exactly what is
present or blocked without printing any value.

**Fixes made during this verification pass:** `scripts/lib/load-env.mjs` now
ignores empty-valued keys (an empty `SEED_PASSWORD` had broken sign-in);
`supabase/tests/finality.test.mjs` now promotes its fixture teacher via
`admin_set_role` before `create_course`; `src/pages/auth/RegisterPage.tsx` now
uses a synchronous in-flight guard (one request per submit) and `src/lib/errors.ts`
maps `over_email_send_rate_limit`/429 to a clear cooldown message instead of the
raw Supabase text. Email confirmation was then disabled on the hosted project
(see below), so signup no longer depends on the mailer at all.

**Exam-window availability:** the schema reuses `P0002` for several distinct
authored conditions, so `src/lib/errors.ts` now matches the authored text
(`Exam has not opened yet`, `Exam has closed`, …) instead of collapsing every
`P0002` into "record not found". `src/lib/datetime.ts` classifies the window, and
the student instructions page names the opening/closing instant with an explicit
timezone while disabling the start button outside the window; the database still
enforces the check atomically in `start_attempt`.

**Registration without email confirmation (fixed):** the hosted project previously
had email confirmation enabled (`mailer_autoconfirm: false`), so every signup sent
a confirmation email and the built-in sender's ceiling surfaced
`429 {"error_code":"over_email_send_rate_limit"}`. Email confirmation is now
**disabled** on `tddmtdhhckykwnoydvjc` (`auth.email.enable_confirmations = false`;
pushed with a scoped `npx supabase config push` that changed only this property),
so `POST /auth/v1/signup` returns a live session and the app sends the student
straight to `/student` — no confirmation email, no resend step. Verified live: a
fresh anon-key signup returns `access_token` (validated by reading the caller's
own `user_roles` row = `student`) with `email_confirmed_at` set; the probe account
was deleted afterward. The `over_email_send_rate_limit` mapping is retained as
defense-in-depth for the remaining email flows (password recovery / invites) and
its wording is no longer signup-specific. Public signup still yields only a
`student` role via the `app.handle_new_user()` trigger, which never trusts
metadata. Full lifecycle verified live with one throwaway account (deleted
afterward): signup → live session + own `profiles`/`user_roles` readable →
sign-out (session null) → password sign-in succeeds. Administrators can still
pre-provision accounts with `npm run user:provision`.

**Other limits still apply:** disabling confirmation does not raise the
sign-in/sign-up request rate limit (`auth.rate_limit.sign_in_sign_ups`, default
30 per 5 minutes per IP). This is not an "unlimited signups" change; for bulk
onboarding use `npm run user:provision`.

**Previously unconfirmed accounts:** an account created while confirmation was on
and never confirmed has `email_confirmed_at = null`. With confirmation now
disabled such accounts can sign in normally; to explicitly mark them confirmed
**without deleting or resetting anything**, use `npm run users:confirm`
(read-only dry run; `--apply` sets `email_confirm: true` via the admin API). At
verification time the hosted project had **0** unconfirmed accounts (170 total),
so nothing needed changing.

**New provisioning tooling:** `scripts/provision-admin.mjs`
(`npm run admin:provision`) drives the token-gated `bootstrap-admin` function with
a **hidden** password prompt and verifies sign-in, the `admin` role, and the
admin-only `admin_dashboard_stats()` RPC (`--browser` also asserts `/admin`);
`scripts/provision-user.mjs` (`npm run user:provision`) creates a pre-confirmed
student/teacher via the service role and verifies sign-in. Neither prints or
persists the password. `scripts/verify-admin-login.mjs` (`npm run admin:verify`)
re-checks an existing admin's sign-in/role/admin RPC with a hidden prompt.

The hidden prompt reads the terminal in **raw mode** (tty echo disabled), so a
typed or pasted secret is never displayed. `--browser` hands the credentials to
Playwright via the **environment only** (satisfying the spec's
`E2E_SUPABASE_CONFIGURED === 'true'` gate) and requires **2 passed / 0 skipped /
0 failed** before reporting success — skips are treated as a failed verification,
never a pass.

**Bootstrap path closed:** after `admin@gmail.com` was provisioned, the deployed
`BOOTSTRAP_ADMIN_TOKEN` secret was **removed** and its line deleted from the
gitignored `.env.server.local` (`check:env` now reports it `absent`).
`bootstrap-admin` now fails closed (`500 BOOTSTRAP_ADMIN_TOKEN is not
configured`), so no further admin can be created; the already-provisioned
`admin@gmail.com` is unaffected (still `email_confirmed`, role `admin`, profile
`active`, and `/admin` reachable). Removing an Edge Function secret cannot affect
Auth password sign-in.

**Bug found and fixed during hosted verification:** the fullscreen exam page
crashed (blank screen) at runtime because `ExamPage` called `useBlocker` while
the app used a component `<BrowserRouter>`; `useBlocker` requires a data router.
`src/App.tsx` now uses `createBrowserRouter` + `<RouterProvider>`, restoring the
navigation guard (SOP req 119 / acceptance 13).

**Known limitations:** browser monitoring is not a cheat guarantee (see
disclaimer); full device lockdown and other monitoring channels are future
work; result views add `after_close` release only after the DB job or visible
window confirms it server-side.
---
## Stress Reliever (Student)
- Added 'Stress Reliever' to the student sidebar with three recreational games: Bubble Pop, Word Puzzle, and Stack Blocks.
- Games are hidden/blocked during active exams; keyboard handlers are scoped to games and cleaned up on navigation. Local storage for game progress is scoped by session and not shared with exam data.
- Not a treatment for anxiety; no public leaderboard or tracking.
