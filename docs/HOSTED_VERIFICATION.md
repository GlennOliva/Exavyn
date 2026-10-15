# Hosted verification runbook

This document is the operator's guide for verifying the Exavyn app
against a **real PostgreSQL + Auth + Edge Functions backend**. Local, offline
checks (unit tests, type-check, build, public-surface e2e) already pass; the
steps here prove the database-enforced security model, the authenticated exam
workflow, and the concurrency/finality guarantees.

> Status: **executed** against the dedicated hosted test project
> `tddmtdhhckykwnoydvjc` (never production). Re-verified live on 2026-10-15:
> RLS **36/36**, workflow **57/57**, concurrency **5/5**, finality **10/10**
> (service role used for fixture setup only), public/local e2e **26 passed /
> 10 skipped**, unit **96/96**, authenticated e2e (isolated fixture, Chromium
> headed) **3/3** plus themed-authenticated **2/2**. Migrations `0009` (teacher
> features) and `0010` (answer review + pass threshold) were applied to the
> hosted project via `npx supabase db push` and `npx supabase migration list`
> was re-verified once DB egress was available. Email confirmation was then
> **disabled** on the hosted project (scoped `config push`), so public sign-up
> returns a live session and is not gated by the email sender; a fresh anon-key
> signup was verified live and the probe account deleted. See §10 for counts and
> the bugs found and fixed. OS-level app switches (Command+Tab / Alt+Tab) are
> covered by a **manual checklist** (§5) and are **UNVERIFIED** until run on that
> OS.

---

## 0. Golden rules

1. **Never point this at production.** Use a local ephemeral stack or a
   dedicated throwaway/test project. Several suites create users, publish exams,
   and produce immutable rows.
2. **Never put server secrets in the browser.** Only `VITE_*` values reach the
   frontend bundle. The service-role key, bootstrap token, and seed password are
   server-only.
3. **Never deploy the frontend to production** as part of verification.
4. **Never print secrets.** The harness refuses to echo keys; keep it that way.
5. A run that cannot find credentials exits with code **2 (BLOCKED)**, not 1
   (FAILED). Blocked ≠ passed.

---

## 0.5 Pre-flight: confirm the project identity

Before applying anything, prove that (a) the app can reach the project in
`.env.local` and (b) the CLI is authenticated against the **same** project.

```bash
npm run check:project     # browser-safe only: reachability + table/RPC presence
npx supabase projects list
npx supabase projects list --output json   # compare ref to the .env.local ref
```

`check:project` masks all secrets and prints `SCHEMA: PRESENT` or `SCHEMA:
ABSENT/INCOMPLETE`. If the CLI account does **not** own the ref in `.env.local`,
stop — do not link or push. Sign in with the owning account, or point
`.env.local` at the intended project.

The CLI authenticates with a Personal Access Token. Provide it without ever
committing it:

```bash
export SUPABASE_ACCESS_TOKEN=sbp_...   # https://supabase.com/dashboard/account/tokens
# or: npx supabase login
```

Management-API commands (`projects list`, `functions list`, `secrets list`) only
need the access token. Commands that open a **direct database connection**
(`migration list --linked`, `db push`, `db pull`, `db dump`) additionally need
the database password for the target project; supply it via `SUPABASE_DB_PASSWORD`
(or the interactive prompt). Without it those commands block at the password
prompt — that is a blocked run, not a failure. Never commit the password and
never put it in a `VITE_*` variable.

---

## 1. Configuration

### Browser-safe (goes in `.env.local`, `VITE_` prefix)

| Variable | Purpose |
| --- | --- |
| `VITE_SUPABASE_URL` | Project URL |
| `VITE_SUPABASE_ANON_KEY` | Publishable / anon key |
| `VITE_APP_NAME` | Optional display name |

### Server-only secrets — `.env.server.local` (gitignored; template `.env.server.example`)

Copy `.env.server.example` to `.env.server.local` and fill it in. Server-side
tools load it automatically — the Node suites (`supabase/tests/lib/harness.mjs`),
`scripts/seed-demo.mjs`, and `playwright.config.ts` — via
`scripts/lib/load-env.mjs`. It is:

- **never** imported by anything under `src/` (never reaches the browser bundle);
- **never** prefixed with `VITE_`;
- loaded *before* `.env.local`, but a real process environment always wins.

| Variable | Used by | Where to obtain it |
| --- | --- | --- |
| `SUPABASE_URL` | Node suites, seeder | optional; falls back to `VITE_SUPABASE_URL` |
| `SUPABASE_ANON_KEY` | Node suites | optional; falls back to `VITE_SUPABASE_ANON_KEY` |
| `SUPABASE_SERVICE_ROLE_KEY` | workflow / concurrency / finality suites, seeder | Project Settings → API → Project API keys → `service_role` (Reveal) |
| `SUPABASE_ACCESS_TOKEN` | `npx supabase` (migration list, functions deploy, secrets) | Dashboard → Account → Access Tokens → Generate new token |
| `SUPABASE_DB_PASSWORD` | `db push` / `db pull` / `db dump` only | Project Settings → Database |
| `BOOTSTRAP_ADMIN_TOKEN` | `bootstrap-admin` (one time) | generate yourself, e.g. `openssl rand -hex 32`; rotate/remove after |
| `SEED_PASSWORD` | seeder + `test:rls` | optional; default `ExamDemo!234` |
| `E2E_SUPABASE_CONFIGURED`, `E2E_STUDENT_EMAIL`, `E2E_STUDENT_PASSWORD`, `E2E_EXAM_ID`, `E2E_BASE_URL` | authenticated Playwright checks | your seeded student + published exam |

Confirm what is present **without printing any value**:

```bash
npm run check:env     # prints paths, char counts, project ref, READY/BLOCKED
```

If you prefer to export instead of using the file, real process env still wins:

```bash
export SUPABASE_SERVICE_ROLE_KEY=... SUPABASE_ACCESS_TOKEN=...
```

---

## 2. Path A — local ephemeral stack (recommended)

Requires Docker Desktop or Podman on `PATH`.

```bash
npx supabase@latest start            # boots Postgres, Auth, Studio, Storage
npx supabase@latest db reset         # applies all migrations 0000-0010 (seed disabled)
npx supabase@latest status -o env    # prints local URL + keys (do not paste into chat)
```

`supabase/config.toml` is committed with:
- `minimum_password_length = 8`
- email confirmations off for local sign-up
- `bootstrap-admin` deployed with `verify_jwt = false` (token-gated)
- `provision-teacher` with JWT verification on

Migration `0008` schedules `finalize-expired-attempts` every minute via
`pg_cron` (guarded: it is a no-op if the extension is unavailable). Confirm the
job exists and is running:

```sql
select jobid, schedule, command, active from cron.job;   -- expect finalize-expired-attempts
select * from cron.job_run_details order by start_time desc limit 5;
```

If `pg_cron` is unavailable on the platform (or the extension could not be
created by the migration), enable it in the dashboard's Extensions page and
re-run `supabase db push`, **or** point an external scheduler (e.g. a Supabase
Scheduled Edge Function or `pg_cron`-equivalent) at
`select public.finalize_expired_attempts();` on a 1-minute cadence. The
function itself is unchanged and needs no auth.

Serve functions locally when testing the bootstrap/provision flows:

```bash
npx supabase@latest functions serve --env-file supabase/.env.local
```

Put the local URL + anon key into `.env.local` (browser), export the service
role for the shell, then continue to §4.

Because the whole stack is disposable, `npx supabase db reset` is the cleanest
teardown — no immutable rows need manual cleanup.

---

## 3. Path B — hosted test project

```bash
npx supabase@latest login
npx supabase@latest link --project-ref <test-project-ref>
npx supabase@latest db push                       # applies migrations
npx supabase@latest functions deploy bootstrap-admin --no-verify-jwt
npx supabase@latest functions deploy provision-teacher
npx supabase@latest secrets set BOOTSTRAP_ADMIN_TOKEN=<long-random-string>
```

Set `.env.local` (browser) and export server-only values (§1).

### Provision the first administrator (once)

```bash
curl -sS -X POST "$SUPABASE_URL/functions/v1/bootstrap-admin" \
  -H 'Content-Type: application/json' \
  -d '{"token":"<BOOTSTRAP_ADMIN_TOKEN>","email":"admin@your-test.test","password":"<8+ chars>","full_name":"Admin"}'
```

Then **rotate or delete** `BOOTSTRAP_ADMIN_TOKEN` (`npx supabase secrets unset
BOOTSTRAP_ADMIN_TOKEN`, and remove the line from `.env.server.local`). Once it is
gone the function fails closed with `500 BOOTSTRAP_ADMIN_TOKEN is not configured`.
Additional admins are created by existing admins; teachers are created by an
admin via `provision-teacher` **or** by promoting an existing user with the
`admin_set_role` RPC. Verify a provisioned admin any time with
`npm run admin:verify -- --email admin@gmail.com --browser`.

### Helper scripts (safer than raw curl)

Both scripts read `.env.server.local` and prompt for the password through a
**hidden** terminal prompt (never printed, never written to disk):

```bash
npm run admin:provision -- --email admin@gmail.com          # bootstrap-admin path
npm run admin:provision -- --email admin@gmail.com --browser # + Playwright /admin check
npm run user:provision  -- --email student-e2e@exam.test --role student
```

- `admin:provision` posts to `bootstrap-admin`, then verifies sign-in, the
  `admin` role, and the admin-only `admin_dashboard_stats()` RPC.
- `admin:verify` re-checks an existing admin any time (no bootstrap token needed).
- `user:provision` creates a **pre-confirmed** user (default `student`) with the
  service role and verifies sign-in — no email is sent. It refuses `--role
  admin` so the audited bootstrap path stays authoritative.

The password prompt reads the terminal in **raw mode** (kernel echo disabled), so
a typed or pasted secret is never displayed. `--browser` passes the credentials
to Playwright **only via environment variables** (never argv, never disk), sets
`E2E_SUPABASE_CONFIGURED='true'` so the spec's gate is actually satisfied, and
**requires 2 passed / 0 skipped / 0 failed** before reporting success — a skipped
run is a failure, not a pass. A JSON report is written to a temp file and deleted
immediately after parsing.

### Registration does not depend on email confirmation

Email confirmation is **disabled** on the hosted test project, so public sign-up
creates a confirmed account and returns a live session immediately — no
confirmation email is sent, and the app sends the new student straight to
`/student` (`src/pages/auth/api.ts`, `src/pages/auth/RegisterPage.tsx`).

Confirm/disable it for a project with a **scoped** config push (only the declared
property is written; other remote settings are left untouched):

```bash
# supabase/config.toml, temporarily containing just:
#   project_id = "exam_detector"
#   [auth.email]
#   enable_confirmations = false
npx supabase config diff --project-ref <test-project-ref>   # review first
npx supabase config push --project-ref <test-project-ref> --yes
```

Or via the dashboard: Authentication → Sign In / Providers → Email → turn off
**Confirm email** (`mailer_autoconfirm = true`). Verify live: an anon-key
`POST /auth/v1/signup` returns an `access_token` and the caller's own
`user_roles` row reads `student`.

The **email send rate limit** still bounds the remaining email flows (password
recovery, email change, invites); exceeding it returns `429
over_email_send_rate_limit`, which the app maps to a clear cooldown message
(`src/lib/errors.ts`). To raise the limit, configure a custom SMTP sender
(Dashboard → Authentication → Emails/SMTP). Administrators can still
pre-provision accounts with `npm run user:provision`.

Disabling email confirmation does **not** raise any other limit: the
sign-in/sign-up request rate limit (`auth.rate_limit.sign_in_sign_ups`, default
**30 per 5 minutes per IP**) still applies to registration. Batch/one-time
onboarding of many students should use `npm run user:provision` (service role)
rather than 40 rapid public signups.

### Enabling pre-existing unconfirmed accounts

With confirmation disabled, accounts that never confirmed can sign in normally.
To explicitly mark them confirmed — **without deleting accounts or resetting
passwords** — use the read-only-by-default helper:

```bash
npm run users:confirm             # dry run: lists unconfirmed accounts (masked)
npm run users:confirm -- --apply  # sets email_confirm=true (admin API) only
```

It never touches passwords or roles (roles are owned by the signup trigger /
`admin_set_role`). At verification time there were **0** unconfirmed accounts
(170 total), so no change was required. Dashboard equivalent: Authentication →
Users → open a user → "Confirm email".

> Accounts created while confirmation was enabled but never confirmed (0 in the
> hosted project at the time of this run) are left untouched — they are not
> deleted or bulk-confirmed. With confirmation off they can sign in normally.

---

## 4. Seed demo data (optional but convenient)

```bash
npm run seed          # idempotent: 6 users (pw from SEED_PASSWORD), course SOP101,
                      # approved + pending enrollment, one 50-item published exam
```

The seeder and the RLS suite share the fixture contract in `scripts/seed-demo.mjs`.

---

## 5. Run the suites

| Command | What it proves | Needs service key |
| --- | --- | --- |
| `npm run test:rls` | Row-level security + grant boundaries + review-RPC authorization + role-escalation denial + cross-student isolation, with real user tokens | no |
| `npm run test:workflow` | Full authenticated workflow + immutability + release policy + answer review + pass threshold | yes |
| `npm run test:concurrency` | Races, duplicate-episode dedup, controller recovery, expiry | yes |
| `npm run test:finality` | Final-score immutability: idempotent submit, no user-facing rewrite/delete | yes |
| `npm run test:hosted` | RLS → workflow → concurrency → finality, sequentially | yes |
| `npm run test:e2e` | Public-surface + registration smoke (always) + gated authenticated/admin checks | no* |

\* The registration smoke runs offline (the endpoint is intercepted). The
authenticated UI checks additionally require `E2E_SUPABASE_CONFIGURED=true`,
`E2E_STUDENT_EMAIL`, `E2E_STUDENT_PASSWORD`, and (for the full flow)
`E2E_EXAM_ID`; the admin route check requires `E2E_ADMIN_EMAIL` /
`E2E_ADMIN_PASSWORD` (set in-process by `npm run admin:provision -- --browser`).
They skip silently otherwise.

### Authenticated UI checks (optional)

With a live stack and an approved student who has a published exam:

```bash
E2E_SUPABASE_CONFIGURED=true \
E2E_STUDENT_EMAIL=student-e2e@exam.test \
E2E_STUDENT_PASSWORD=... \
E2E_EXAM_ID=<published-exam-uuid> \
npm run test:e2e
```

These assert: sign-in → dashboard, instructions expose the monitoring policy
with no answer-key material in the DOM, and (Chromium only, **headed**) start →
answer saved → first departure shows "Warning 1 of 2" → second departure
navigates to an immutable result. Departures are produced by **real fullscreen
exits** (`document.exitFullscreen()`): synthetic events cannot change real
`document` state, so they never register. Recovery must clear
`DEPARTURE_COALESCE_MS` (1200ms) before the second departure so it opens a new
episode. Where the environment refuses fullscreen, the flow **skips** rather
than fails.

Generate an **isolated** fixture (dedicated teacher + student + fresh published
exam, approved enrollment) instead of reusing demo accounts:

```bash
npm run e2e:fixture        # provisions via the real RPCs, writes E2E_* to .env.server.local
npx playwright test tests/e2e/authenticated.exam.spec.ts --project=chromium --headed
```

`e2e:fixture` keeps the generated password in the gitignored `.env.server.local`
only — it is never echoed to the terminal. Two caveats:

- Playwright auto-starts the dev server whenever the base URL is local (the
  default, or `E2E_BASE_URL` pointing at localhost/127.0.0.1); a non-local
  `E2E_BASE_URL` is treated as an external server.
- The full-flow test consumes one attempt, so use a **fresh exam per run**.

### Departure / app-switch detection

| Signal | Physical cause | How verified |
| --- | --- | --- |
| `visibility_hidden` | Tab switch / window hidden | `useExamMonitor.test.tsx` (real `visibilitychange`), unit |
| `focus_lost` | OS app switch (Command+Tab / Alt+Tab) or any window that takes focus, sustained past `FOCUS_LOSS_GRACE_MS` (1000ms) | `useExamMonitor.test.tsx` (real `blur` event → grace timer), unit |
| `fullscreen_exit` | Leaving fullscreen | authenticated e2e (real `document.exitFullscreen()`), Chromium, headed |

Overlapping signals from a single physical departure coalesce into one episode
(one violation); returning does not re-create one, and the server dedupes by
`(attempt_id, episode_id)`.

**Manual OS-level checks — UNVERIFIED until run on that OS.** A genuine OS app
switch cannot be injected from the test runner without Accessibility/Screen
Recording permission, and synthetic DOM events deliberately do not register, so
these are documented rather than automated:

- macOS: answer the first question, then **Command+Tab** to another app, wait
  past the 1s grace, **Command+Tab** back — a "Warning 1 of 2" overlay must be
  waiting. Repeat once → locked; the attempt finalizes.
- Windows: the same with **Alt+Tab**.

---

## 6. Acceptance matrix

| # | Criterion | Where verified |
| --- | --- | --- |
| 1 | Admin provisions teachers; students cannot self-promote | `workflow` |
| 2 | Cross-teacher isolation | `rls`, `workflow` |
| 3 | Pending student is denied | `workflow` |
| 4 | Unenrolled student is denied | `rls`, `workflow` |
| 5 | No cross-student attempt/result access | `rls`, `workflow` |
| 6 | No answer-key exposure to students | `rls`, `workflow`, e2e DOM check |
| 7 | Controller-gated resume: holding the token resumes the same attempt (no reset); a second session without it is rejected | `workflow` |
| 8 | Reload cannot reset warnings/deadline | `workflow` (resume) |
| 9 | One departure = one count across raw signals | `workflow`, `concurrency` |
| 10 | 1st departure → warning; 2nd → atomic finalize | `workflow`, e2e (Chromium, headed) |
| 11 | Duplicate/replayed episodes never double count | `workflow`, `concurrency` |
| 12 | Only server-saved answers count | `workflow` |
| 13 | Manual submit produces one final score | `concurrency` |
| 14 | Score cannot be edited via APIs (RLS + triggers) | `rls`, `workflow`, `finality` |
| 15 | Answer keys freeze once an attempt exists | `workflow` (implicit), schema |
| 16 | Racing submit/violation/save → one result | `concurrency` |
| 17 | Post-finalize writes are no-ops | `workflow`, `finality` |
| 18 | Passed deadline forces `time_expired` over manual | `workflow`, `concurrency` |
| 19 | Client clock cannot bend server time | `concurrency` |
| 20 | Controller lease rotation + recovery | `concurrency` |
| 21 | `after_close` withholds the score until close | `workflow` |
| 22 | Teacher reads results for own course only | `workflow`, `rls` |
| 23 | Teacher/peer cannot read others' attempts | `rls` |
| 24 | Immutable artifacts cannot be deleted | schema triggers (see §7) |
| 25 | Scheduled job finalises expired attempts with no browser open | migration 0008 (`cron.job`); `concurrency` bulk expiry |
| 26 | Teacher sets attempt limit + result policy on a published exam; settings apply prospectively | schema (`0009`), `workflow` |
| 27 | Multi-attempt numbering, exhaustion, and `highest` selection | `workflow` |
| 28 | Course edit/archive/guarded-delete; join code retrievable by owner only | `workflow`, `rls` |
| 29 | Student history is release-guarded (`get_my_results`) | `workflow` |
| 30 | Published exams can be archived/restored/duplicated; only unused drafts deleted | `workflow` |
| 31 | Answer review is release-gated per policy (`immediate`/`after_attempts`/`after_close`/`never`) and never earlier than score release | schema (`0010`), `workflow` |
| 32 | `get_attempt_review` is owner-only (student must be approved-enrolled; owner teacher/admin only) and returns no key material while withheld | `rls`, `workflow` |
| 33 | Pass threshold marks attempts `passed`/`failed` on `get_result` and `get_my_results` | schema (`0010`), `workflow` |
| 34 | Attempts snapshotted before `0010` default to `never` (keys never retroactively exposed) | schema (`0010`) |

### Teacher features (migration `0009`)

Migration `20260101000009_teacher_features.sql` adds teacher-configurable
attempts, course management, and retrievable join codes. Applying it is
forward-only; it does not rewrite `0000`–`0008`.

| Layer | Behavior | Verified by |
| --- | --- | --- |
| Attempts | `max_attempts` 1–20 + `result_policy` (`latest`/`highest`) on drafts and published exams; numbered attempts; resume consumes none; submitted/expired/violation-finalised all count; lowering the limit never deletes history | `workflow`: "second attempt is numbered", "a third start is blocked", "highest-score policy" |
| Published settings | Questions/choices/keys stay frozen; only schedule/attempt settings change, prospectively; archived exams reject edits until restored | `workflow`: "raises max_attempts", "archived exam rejects settings edits" |
| Courses | Edit details, archive/restore (blocks new attempts), guarded delete (fails with exams/enrollments) | `workflow`: "updates course details", "archiving a course blocks new attempts", "delete_course refuses..." |
| Join codes | Owner-only retrieval via `get_join_code`; `code_hash`/`code_cipher` columns are unselectable; pre-0009 codes report `legacy` | `rls`: "join-code metadata but not the hash/cipher columns"; `workflow`: "owner retrieves the current join code" |
| Exam lifecycle | `restore_exam` (draft if never published, else published); `duplicate_exam` → fresh draft; `delete_exam` only for unused drafts | `workflow`: "duplicating a published exam", "published exams cannot be deleted" |
| Student UI | Instructions show `used/max`, remaining attempts, and the multi-attempt policy; start button blocked when exhausted; history is release-guarded | `ExamInstructionsPage.test.tsx`, `workflow` (`get_my_results`) |
| Client types | `get_my_exam_attempts` / `get_my_results` typed (`MyExamAttempts`, `MyResultRow`); student history no longer reads `exam_attempts` directly | `npm run typecheck` |

**Documented API gap.** The student history now uses the release-guarded
`get_my_results` RPC, but `exam_attempts` still permits a student to `SELECT`
their own row directly (GRANT + RLS), which exposes raw `earned_points` before an
`after_close` release. Column-level grants cannot separate student from teacher
(both use the `authenticated` role), so closing this fully requires a view or a
policy split; the student UI does not request those columns. Treat direct
PostgREST reads of `exam_attempts` as out of the supported client surface.

### Answer review + pass threshold (migration `0010`)

Migration `2026010100010_attempt_review.sql` adds the `answer_review_policy` enum
(`immediate`/`after_attempts`/`after_close`/`never`), `answer_review` +
`pass_threshold` on `exams`/`exam_versions`/`exam_attempts`, an `explanation`
column on `exam_questions`, the helper `app.answer_review_status()`, and the
authorized RPC `get_attempt_review()`. It is forward-only; it does not rewrite
`0000`–`0009`. Every pre-existing exam/attempt/version was set to
`answer_review = 'never'` so previously authored keys are never retroactively
exposed; new exams default to `immediate`.

| Layer | Behavior | Verified by |
| --- | --- | --- |
| Release order | Answer review is never earlier than score release; score gate = `result_release='immediate'` or past `closes_at` | `app.answer_review_status()`, `workflow`: "after_close", "never" |
| Review RPC | `get_attempt_review` returns per-question prompt/points/explanation, the student's selection, the correct choice, correctness, and options in shown order — but `questions: []` with a `review_reason` until released | `workflow`: "the owning teacher may read", "immediate answer review exposes per-question detail" |
| Authorization | Student owner must still be approved-enrolled; owner teacher/admin only; peer student denied; no key material in a withheld payload | `rls`: "student2 cannot read student1 attempt review via RPC", "teacher2 (not course owner) cannot read..."; `workflow`: "peer student cannot read" |
| Policies | `never` withholds all key material; `after_close` waits for the close while the score may already be released; `after_attempts` releases once the student can no longer retake | `workflow`: `never`, `after_close`, `after_attempts` |
| Pass threshold | `pass_threshold` (0–100, nullable) snapshotted per attempt; `get_result` / `get_my_results` report `passed` | `workflow`: "pass threshold marks ... failed/passed" |
| Settings | `update_exam_settings` gained `p_answer_review` / `p_pass_threshold`; archived exams reject edits | schema (`0010`), `workflow` |
| Student UI | Result page shows pass/fail, attempt/remaining/time-spent, and a review link (or the withheld reason); per-question review page renders outcomes in shown order with explanations | `ResultPage.tsx`, `AttemptReviewPage.tsx`, `npm run typecheck` |
| Client cache | Local resume/controller keys are cleared on sign-out and on account switch | `src/features/attempts/storage.ts` (`clearAttemptStorage`), `AuthContext` |

### Exam window availability (`opens_at` / `closes_at`)

`start_attempt` checks the window atomically and raises distinct `P0002`
messages (`Exam has not opened yet`, `Exam has closed`, `Exam not found`). The
client maps those by authored text instead of collapsing every `P0002` into
"record not found", so students see the real reason and the start button is
disabled outside the window.

| Layer | Behavior | Verified by |
| --- | --- | --- |
| Database | Not startable before `opens_at`; not startable at/after `closes_at`; published exam stays visible to approved students in the meantime | `workflow`: "published exam is visible before it opens", "exam before its opening time is not startable", "exam past its closing time is not startable" |
| Client | Upcoming/closed alerts name the opening/closing instant with an explicit timezone; start button gated by availability | `ExamInstructionsPage.test.tsx`, `datetime.test.ts` (Asia/Manila → UTC), `errors.test.ts` |

### TXT questionnaire import (teacher editor)

Draft-only teachers can paste or upload a plain-text questionnaire; an asterisk
before a choice marks the correct answer:

```
1. Which of the following is a prime number?
a) 4
*b) 5
c) 6
d) 8
```

Rules: numbered items (`1.` / `1)`), 4 choices each (`a) …` / `a. …`, `a`–`d`),
exactly one `*`-marked choice, wrapped prompt lines joined before the first
choice, blank lines/case/indentation tolerated, CRLF/CR/LF accepted. The importer
**previews** the parsed questions with the marked answer highlighted, lists every
problem with the offending question number and source line, and **replaces** the
current question list only on confirm. A malformed file imports nothing (no
partial import), and the answer key never appears as text in the preview.

| Layer | Behavior | Verified by |
| --- | --- | --- |
| Parser | Faithful parse; validates count=4, exactly one answer, non-empty prompt/choices; reports question + 1-based line; all-or-nothing | `src/features/exams/txtImport.test.ts` |
| Dialog | Preview, "marked answer" badge with no `*` in labels, errors block import, cancel/confirm | `src/pages/teacher/ImportTxtDialog.test.tsx` |
| Editor wiring | "Import TXT" on the draft-only builder; confirm replaces questions | `src/pages/teacher/ExamBuilderPage.tsx` (draft form only) |

---

## 7. Fixtures & cleanup policy

Each suite writes a manifest to `supabase/tests/.fixtures/<suite>-<run>.json`
(gitignored) recording every user, course, exam, and attempt it created.

Best-effort cleanup removes enrollments, join codes, non-published exams,
courses, and users. **It cannot remove immutable artifacts.** By design:

- `exam_versions` that are `frozen` cannot be deleted (`guard_version_immutable`).
- Published `exam_questions` cannot be deleted (`guard_published_question`).
- `violation_events` is append-only.
- Finalized `exam_attempts` cannot be modified, and their answers are locked
  (`guard_attempt_immutable`, `guard_answer_after_finalize`); cascading deletes
  fire those triggers too.

Consequently, a workflow/concurrency run leaves published exams, finalized
attempts, and violation events behind. This is intentional (audit integrity) and
why the runbook insists on a **dedicated test project** or a **disposable local
stack** (`npx supabase db reset`) rather than a shared database.

The manifest lists leftover identifiers so nothing is silently orphaned.

---

## 8. What this does **not** prove

- It does not guarantee the frontend is exam-ready for real students.
- Browser monitoring is best-effort; a modified client can suppress or forge
  events. Departures are policy flags, **not** proof of misconduct.
- OS-level app switching (Command+Tab / Alt+Tab), device lock, and kiosk mode are
  out of scope for automation. The app *detects* them via `focus_lost` (unit
  tested), but the OS switch itself is verified by the manual checklist in §5 and
  is **UNVERIFIED** until run on that OS.
- The authenticated UI checks are environment-sensitive and may skip.

---

## 9. Report template

When you run the suites, capture and report:

```
Environment: <local | hosted test project ref>   Node <version>
Local checks (offline):      typecheck __, lint __, unit __/__, build __, public e2e __/__
Hosted checks:               rls __/__, workflow __/__, concurrency __/__
Blocked:                     <none | list>
Failed:                      <none | list with first error>
Remaining acceptance:        <criteria not yet verified + why>
Immutable leftovers:         <count from manifest>
```

---

## 10. Verification results (this workspace)

Re-verified live on **2026-10-15** against `tddmtdhhckykwnoydvjc` with the full
server environment present (`.env.server.local`).

```
Environment: hosted test project tddmtdhhckykwnoydvjc   Node 24.14.0
Local checks (offline):  typecheck PASS, lint PASS, unit 96/96, build PASS,
                         e2e 26/26 passed / 10 skipped
                         (Chromium + Firefox; public + registration + branding/
                         theme run always, authenticated/admin specs skip unless
                         E2E_* creds)

Hosted checks (this session): `npm run test:hosted` exit 0
  rls                    36/36   PASS   (real user tokens; anon key only;
                                         join-code column confidentiality,
                                         non-owner RPC denial,
                                         get_attempt_review authorization
                                         (peer student / non-owner teacher),
                                         role-escalation denial (no user_roles
                                         insert/update, no admin_set_role),
                                         and cross-student record isolation
                                         (profile / role / attempts))
  workflow               57/57   PASS   (service role for fixture setup only;
                                         provisioning, isolation, enrollment,
                                         publish, controller, grading, dedup,
                                         warning->finalize, immutability,
                                         deadline precedence, after_close,
                                         exam-window visibility + pre-open /
                                         post-close start denial, teacher
                                         features: join-code retrieval, course
                                         edit/archive/guarded-delete, published-
                                         exam settings edits, multi-attempt
                                         numbering/exhaustion, highest-score
                                         selection, release-guarded results,
                                         exam duplication, draft-only deletion;
                                         answer review: immediate per-question
                                         detail, owner-teacher access, peer
                                         denial, never/after_close/after_attempts
                                         gating, and pass-threshold pass/fail)
  concurrency             5/5    PASS   (racing submit/violation/save, 10x
                                         episode storm, lease rotation +
                                         recovery, clock independence, bulk
                                         expiry)
  finality               10/10   PASS   (idempotent + simultaneous re-submit,
                                         no user-facing rewrite/delete of final
                                         fields, post-finalize answer/violation
                                         no-ops, deadline precedence)

Authenticated UI e2e (isolated fixture; Chromium, headed):
  3/3                     PASS   dedicated teacher + student + fresh exam,
                                 creds passed inline: sign-in -> dashboard,
                                 instructions policy with no answer-key material,
                                 start -> answer saved -> first departure
                                 "Warning 1 of 2" -> second departure ->
                                 immutable result (real fullscreen exits)

Admin route e2e (Chromium): 2/2 PASS  admin@exam.test sign-in -> /admin, and
                                 /admin/users opens (proves the role-gated route
                                 the bootstrap-provisioned admin will use).

Themed authenticated e2e (isolated fixture; Chromium): 2/2 PASS
                                 dashboard brand + Light/Dark/System control with
                                 the choice persisting across reload (no console
                                 errors), and the chosen theme carrying into the
                                 exam instructions page.

Registration smoke e2e (Chromium + Firefox): 4/4 PASS
                                 double submit -> exactly one /auth/v1/signup
                                 request; 429 over_email_send_rate_limit ->
                                 clear cooldown message (never the raw text).
Registration unit (RegisterPage.test.tsx): 3/3 PASS
                                 session -> redirect to /student; null session
                                 -> "already exists" hint, no redirect;
                                 mismatched passwords block submit.

Live signup without email confirmation (hosted, anon key): PASS
  - `auth.email.enable_confirmations` remote = false (scoped `config push`; the
    one `[update]` in `config diff`, 11 other remote props left unchanged).
  - `signUp()` via supabase-js returned a live `session` (and `getSession()`
    agreed); `user.email_confirmed_at` set; no confirmation email sent.
  - the new user's own `user_roles` row read `{role:"student"}` via its token,
    and its `profiles` row was created by the `handle_new_user()` trigger.
  - probe account deleted via the service-role admin API (200).
  - unconfirmed accounts in the project at run time: **0** (170 total users).

Live signup lifecycle (one throwaway account, deleted after): PASS
  - fresh `signUp` -> no error, live session, `email_confirmed_at` set.
  - immediate authenticated access: own `profiles` row = 1, own `user_roles`
    row = `student` (read with the new session).
  - `signOut()` -> `getSession()` = null.
  - subsequent `signInWithPassword` -> session returned, own profile readable.
  - `npm run users:confirm` -> scanned 170 accounts, 0 unconfirmed.

Preceding this session (user tokens only):
  live lifecycle         17/17   PASS
  scheduler               PASS   (unattended submitted:time_expired ~55s)
  edge functions          PASS   (both ACTIVE v2; 403 / 401->403 probes)
  admin provisioning      PASS   admin@gmail.com created via bootstrap-admin,
                                 then BOOTSTRAP_ADMIN_TOKEN removed (Edge Function
                                 secret unset + .env.server.local line deleted):
                                 bootstrap-admin now 500 "not configured"
                                 (fails closed); admin@gmail.com still confirmed,
                                 role admin, profile active; /admin route 2/2
  CLI / secrets           PASS   (`secrets list` names, digests only)

BLOCKED (environment network, not credentials):
  migration history diff  BLOCKED  Postgres ports 5432/6543 are unreachable
                                   from this host (egress-blocked). The CLI
                                   account IS authenticated (Management API
                                   works) and SUPABASE_DB_PASSWORD is present,
                                   but there is no TCP path; the Management API
                                   SQL endpoint needs a personal token that only
                                   prompts interactively, and PostgREST cannot
                                   expose supabase_migrations. Unverified.

Skipped (NOT counted as passed):
  default e2e authenticated spec          6 skipped  (gated on E2E_* creds)
  default e2e admin spec                  4 skipped  (gated on E2E_ADMIN_* creds)
  Firefox authenticated/admin flow        not run    (Chromium-only by design)

Failed:                  none
Immutable leftovers:     expected (published versions / finalized attempts /
                         violation events cannot be deleted by design)
```

### Fixes made while re-running (this session)

- `scripts/lib/load-env.mjs`: a key present with an **empty** value (e.g. the
  empty `SEED_PASSWORD` / `SUPABASE_ACCESS_TOKEN` lines in `.env.server.local`)
  is now skipped instead of assigned as `''`. An empty string had defeated the
  `?? default` fallbacks in the suites and broke sign-in. Empty now means
  "not configured".
- `supabase/tests/finality.test.mjs`: now promotes its fixture teacher via
  `admin_set_role` before creating a course. The suite had called `create_course`
  as a non-teacher and aborted with `Only teachers may create courses`; it now
  passes 10/10.
- `playwright.config.ts`: auto-start the dev server whenever the base URL is
  local (default or a localhost `E2E_BASE_URL`); only a non-local `E2E_BASE_URL`
  skips the server. Previously any `E2E_BASE_URL` disabled the server, which
  broke `npm run test:e2e` once `.env.server.local` set it.

### Signup without email confirmation

- Hosted setting: `auth.email.enable_confirmations` pushed to `false` with a
  **scoped** `npx supabase config push` (config.toml temporarily declared only
  that property; `config diff` reported a single `[update]` and left the other 11
  remote properties unchanged, called out by the CLI itself).
- `src/features/auth/api.ts`: `signUp` now returns the returned `session`
  (`{ session }`) instead of `{ needsConfirmation }`.
- `src/pages/auth/RegisterPage.tsx`: removed the confirmation/resend copy and the
  `done` success state; a returned session redirects to `/student`, and a null
  session shows the "already exists" sign-in hint. Client password checks and the
  synchronous single-submit guard are unchanged.
- `supabase/tests/rls.test.mjs`: added role-escalation denial (`user_roles`
  insert/update, `admin_set_role`, role still `student`) and cross-student record
  isolation (profile / role / attempts) checks — now **36/36**.
- `scripts/confirm-unconfirmed-users.mjs` (`npm run users:confirm`): read-only by
  default; `--apply` sets `email_confirm=true` via the admin API for pre-existing
  unconfirmed accounts (never deletes users, never resets passwords, never grants
  roles).
- `src/features/auth/AuthContext.tsx`: `signUp` context signature updated to
  `Promise<{ session: Session | null }>`.
- `src/lib/errors.ts`: the `over_email_send_rate_limit` message no longer claims
  "verification emails" (signup no longer sends one); retained for the remaining
  email flows.
- `src/pages/auth/RegisterPage.test.tsx` (new, 3 tests) and
  `tests/e2e/registration.exam.spec.ts` (assertion wording) updated. Public
  sign-up still yields only a `student` role — the `app.handle_new_user()` trigger
  never trusts metadata (unchanged; migration `0004`).

### Fixes made while re-running (this session)

- `supabase/migrations/2026010100010_attempt_review.sql` authored and applied via
  `npx supabase db push`; pre-existing rows backfilled to `answer_review='never'`
  (verified: 165 exams / 162 attempts / 165 versions). `update_exam_settings`
  gained `p_answer_review`/`p_pass_threshold`; its old 9-argument overload was
  dropped, so the suite calls were updated to pass the new arguments.
- `supabase/tests/lib/harness.mjs`: `buildExamPayload` now accepts
  `answerReview`, `passThreshold`, and `maxAttempts` so suites can author policy
  variants.
- `supabase/tests/workflow.test.mjs`: added answer-review and pass-threshold
  checks (57/57). The attempt-limit assertion was relaxed to match the wording
  now emitted by `start_attempt` (`You have used all N attempts for this exam`).
- `supabase/tests/rls.test.mjs`: added `get_attempt_review` authorization checks
  for a non-owner student and a non-owner teacher, plus the signup-hardening
  checks (role-escalation denial + cross-student isolation); the suite is now
  **36/36**.

### Bug found and fixed

The fullscreen exam page (`/student/exams/:examId/take`) blank-screened at
runtime. Root cause: `ExamPage` calls `useBlocker` (SOP req 119 / acceptance 13
navigation guard), but the app used a component `<BrowserRouter>`; `useBlocker`
**requires a data router** and threw
`useBlocker must be used within a data router`, so the page rendered nothing and
no attempt RPCs fired. Fix: `src/App.tsx` now builds the route tree with
`createBrowserRouter` + `<RouterProvider>`. Do not revert to
`<BrowserRouter>`/`<Routes>`.

### Re-runnability notes

- `scripts/seed-demo.mjs` is now genuinely idempotent: it reuses the existing
  `SOP101` course, approved/pending enrollments, and the published demo exam
  (matched by title) instead of failing on the unique `course_code`.
- `supabase/tests/rls.test.mjs` creates a fresh published exam per run for the
  attempt-lifecycle checks, because an attempt is single-use per student/exam
  (the previous run consumes the demo exam). Ownership/visibility checks still
  target the stable demo exam. This keeps `npm run test:rls` green on every run.
