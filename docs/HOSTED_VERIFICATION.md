# Hosted verification runbook

This document is the operator's guide for verifying the Exavyn app
against a **real PostgreSQL + Auth + Edge Functions backend**. Local, offline
checks (unit tests, type-check, build, public-surface e2e) already pass; the
steps here prove the database-enforced security model, the authenticated exam
workflow, and the concurrency/finality guarantees.

> Status: **executed** against the dedicated hosted test project
> `tddmtdhhckykwnoydvjc`. Re-verified live on 2026-10-26 after the teacher-search
> and recovery fixes: RLS **36/36**, workflow **65/65**, concurrency **5/5**,
> finality **10/10**, feedback **18/18**, teacher search **12/12** (hosted total
> **146/146**); unit **138/138**; Chromium **28 passed / 1 skipped**; Firefox
> public smoke **12/12** plus recovery/search **2/2**; typecheck/lint/build
> clean. Production is deployed at `https://exavyn.vercel.app` (assets
> `index-BLAhqpOA.js` / `index-DqhDLp1g.css`); production public **10/10**,
> teacher search **1/1**, and expired-recovery **1/1** passed.
> Forward migrations `0013`-`0026` are applied without a reset and recorded.
> **Recovery config remains blocked:** hosted Auth Site URL is still
> `http://localhost:3000` and the production redirect is not allowlisted, so
> valid production recovery emails still fall back to localhost until the
> operator changes Authentication → URL Configuration (exact steps in §10).
> Email confirmation remains disabled on the hosted project (scoped config
> push), so public sign-up returns a live session. See §10 for counts, causes,
> and the unresolved operator action. OS-level app switches
> (Command+Tab / Alt+Tab) are covered by a **manual checklist** (§5) and are
> **UNVERIFIED** until run on that OS. Real iPhone/iPad hardware verification is
> also **UNVERIFIED**; runtime capability tests and browser fallback checks do
> not establish real-device support.

---

## 0. Golden rules

1. **Never point this at production.** Use a local ephemeral stack or a
   dedicated throwaway/test project. Several suites create users, publish exams,
   and produce immutable rows.
2. **Never put server secrets in the browser.** Only `VITE_*` values reach the
   frontend bundle. The service-role key, bootstrap token, and seed password are
   server-only.
3. **Never deploy the frontend to production** as part of routine verification;
   production promotion requires a separate explicit release request.
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
| `VITE_PUBLIC_SITE_URL` | Canonical origin for password-recovery redirects; set to `https://exavyn.vercel.app` in Vercel Production. Unset locally so recovery returns to the dev origin. |

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
| `E2E_SUPABASE_CONFIGURED`, `E2E_STUDENT_EMAIL`, `E2E_STUDENT_PASSWORD`, `E2E_TEACHER_EMAIL`, `E2E_TEACHER_PASSWORD`, `E2E_EXAM_ID`, `E2E_COURSE_ID`, `E2E_BASE_URL` | authenticated Playwright checks | `npm run e2e:fixture`, or your seeded teacher/student + published exam/course |

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
npx supabase@latest db reset         # applies all migrations 0000-0012 (seed disabled)
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
| `npm run test:feedback` | Feedback routing, deduplication, unread state, and role/private-note isolation | yes |
| `npm run test:teacher-search` | Teacher enrollment search literals, status/pagination/count, cross-teacher and anonymous denial | yes |
| `npm run test:hosted` | RLS → workflow → concurrency → finality → feedback → teacher search, sequentially | yes |
| `npm run test:e2e` | Public-surface + registration smoke (always) + gated authenticated/admin checks | no* |

\* The registration smoke runs offline (the endpoint is intercepted). The
authenticated UI checks additionally require `E2E_SUPABASE_CONFIGURED=true`,
`E2E_STUDENT_EMAIL`, `E2E_STUDENT_PASSWORD`, and (for the full flow)
`E2E_EXAM_ID`; the teacher-search check requires `E2E_TEACHER_EMAIL`,
`E2E_TEACHER_PASSWORD`, and `E2E_COURSE_ID`; the admin route check requires
`E2E_ADMIN_EMAIL` /
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
| 35 | Student result history paginates and searches server-side, with a stable total and no unreleased-score leak | schema (`0011`/`0012`), `workflow`: "get_my_results_page paginates and searches server-side" |
| 36 | Every authorized data table uses URL-backed 10/25/50 pagination; filters/search apply before the slice | `Pagination.tsx`, `usePageState`, page wiring, `npm run typecheck` |
| 37 | Score badges use the unrounded authoritative percentage: green at/above threshold, yellow within 10 points below, red further below; missing/unreleased states neutral | `score.test.ts`, `ScoreBadge` usage, `workflow` pass-threshold checks |
| 38 | Devices without usable fullscreen can start/answer/submit in an accessible fallback; fullscreen absence is never a violation or recovery blocker | `fullscreen.test.ts`, `useExamMonitor.test.tsx`, `ExamInstructionsPage.test.tsx` |

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

**Direct API release gate.** Migration `0022` hides active and unreleased
`exam_attempts` rows from student PostgREST reads. Authorized student result
access goes through release-gated RPCs; owner teachers and admins retain report
access. The hosted workflow verifies that direct score-column reads return no row
before `after_close` and scheduled release.

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

### Paginated results, score status, and fullscreen fallback (`0011`/`0012`)

Migration `2026010100011_result_pagination.sql` adds the release-guarded
`get_my_results_page(p_search, p_page, p_page_size)` RPC; `0012` fixes its
single-statement CTE scope after the first hosted run caught it. Limits are
clamped to 1–50, search is applied before the page slice, and ordering is
`started_at desc, id desc` for a stable unique tie-breaker. Score values and
`passed` are computed only when the existing release rule allows them.

The UI now paginates every authorized data list (admin users/courses/exams/
reports/audit; teacher courses/enrollments/exams/results/violations; student
courses/exams/history) with `10/25/50`, URL-preserved state, and filters/search
before the page slice. Exam question navigation is intentionally not paginated.

Fullscreen is now capability-based, not device-name-based. A rejected or
unsupported request enters a focused viewport fallback; it is never counted as
a violation and never blocks recovery. Real iPhone/iPad Safari verification
remains **UNVERIFIED** until run on physical hardware.

| Layer | Behavior | Verified by |
| --- | --- | --- |
| Result pagination | Server-side search + page/page-size, stable total/order, release guard preserved | `workflow`: "get_my_results_page paginates and searches server-side" |
| Shared pagination | Same controls everywhere, default 10, 10/25/50, URL state, page clamped after shrink | `pagination.test.ts`, page wiring, `typecheck`/`lint` |
| Score status | Unrounded threshold boundary; 10-point yellow band below passing; no-threshold/pending/unreleased neutral | `score.test.ts`; badges in result/history/dashboard/teacher/admin views |
| Fullscreen fallback | Capability detection, request from gesture, honest fallback message/labels, no fullscreen violation in fallback, recovery needs visible + focused only | `fullscreen.test.ts`, `useExamMonitor.test.tsx`, `ExamInstructionsPage.test.tsx` |
| iOS layout | `viewport-fit=cover`, `100dvh`, safe-area padding, 44px mobile pagination targets | CSS review; **device check UNVERIFIED** |

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

Re-verified live on **2026-10-26** against `tddmtdhhckykwnoydvjc` with the full
server environment present (`.env.server.local`).

```
Environment: hosted test project tddmtdhhckykwnoydvjc   Node 24.14.0
Local checks (offline):  typecheck PASS, lint PASS, unit 138/138, build PASS,
                         Chromium 28 passed / 1 skipped; Firefox public smoke
                         12/12 plus recovery/search 2/2 (authenticated/admin
                         specs use fixture E2E_* creds)
Dedicated browser specs: sidebar/admin 4/4, theme 2/2, feedback 3/3,
                         answer integrity 1/1; all green locally and against
                         https://exavyn.vercel.app
Production smoke:        public 10/10, teacher enrollment search 1/1,
                         expired-recovery 1/1
Local valid recovery:    PASS (generated link -> new password -> sign-in)

Hosted checks (this session): `npm run test:hosted` exit 0 (146/146)
  rls                    36/36   PASS   (real user tokens; anon key only;
                                         join-code column confidentiality,
                                         non-owner RPC denial,
                                         get_attempt_review authorization
                                         (peer student / non-owner teacher),
                                         role-escalation denial (no user_roles
                                         insert/update, no admin_set_role),
                                         and cross-student record isolation
                                         (profile / role / attempts))
  workflow               65/65   PASS   (service role for fixture setup only;
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
                                         gating, pass-threshold pass/fail, and
                                          server-side paginated result history,
                                          stable answer change/clear/review,
                                          bookmarks, scheduled release + direct
                                          API withholding)
  concurrency             5/5    PASS   (racing submit/violation/save, 10x
                                         episode storm, lease rotation +
                                         recovery, clock independence, bulk
                                         expiry)
  finality               10/10   PASS   (idempotent + simultaneous re-submit,
                                         no user-facing rewrite/delete of final
                                         fields, post-finalize answer/violation
                                          no-ops, deadline precedence)
  feedback                18/18  PASS   (idempotent request ids + duplicate
                                          window, server-side recipient
                                          resolution, own history, owner-teacher/
                                          admin scope, admin-only isolation,
                                          direct-table denial, cross-teacher and
                                          cross-student denial, private notes vs
                                          response, two-way unread/mark-read,
                                          recipient filter, length limits,
                                          draft-exam rejection, no key leakage,
                                          unenrolled rejection, suspended staff,
                                          admin global access)
  teacher search          12/12  PASS   (authorized empty/partial name/email,
                                         mixed case, literal %/_/apostrophe/
                                         comma/parentheses, status composition,
                                         filtered count before pagination,
                                         stable ordering, clear-restores, cross-
                                         teacher 42501, anonymous denial)

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
                                 Appearance only under Profile -> Settings,
                                 choice persisting across reload (no console
                                 errors), and the chosen theme carrying into the
                                 exam instructions page. Public auth pages are
                                 fixed dark with no appearance controls.

Sidebar/admin e2e (isolated fixture; Chromium): 4/4 PASS
                                 /admin/users role embed without PGRST201,
                                 desktop hamburger hide/show without horizontal
                                 overflow or tagline, mobile drawer Escape/
                                 backdrop/focus-trap/focus-restore/inert, student
                                 nav order, and Appearance under Profile.

Feedback UI e2e (isolated fixture; Chromium, production): 3/3 PASS
                                 student -> course teacher routing, admin reply
                                 + private note, student sees reply but never the
                                 private note, and "Mark response as read"
                                 clears the unread badge.

Answer-integrity e2e (isolated fixture; Chromium, local + production): 1/1 PASS
                                 B -> C, delayed save, explicit clear, reload,
                                 exact graded review, and answered/unanswered/
                                 marked progress counters.

Teacher enrollment search e2e (fixture; Chromium local + production, Firefox):
  PASS                           partial name, uppercase email, no-result and
                                 literal-% empty states, clear button restores
                                 all rows, pending -> approved filter, no
                                 PostgREST parser text, and exact count.

Password recovery:
  expired-link UI (Chromium + Firefox, local + production)  PASS
                                 safe message, no form, no hash/query leakage,
                                 request-new-email link
  valid-link local flow          PASS
                                 generated one-time link -> password form ->
                                 update -> sign-in with new password
  production valid-email flow    BLOCKED until hosted Auth Site URL/allowlist
                                 is changed; no authorized mailbox available.

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

Migrations:
  migration history       PASS    forward migrations through 2026010100026
                                  applied without reset and recorded in
                                  supabase_migrations.schema_migrations.

Device checks:
  real iPhone/iPad Safari UNVERIFIED  fallback is unit-tested and uses
                                     viewport-fit/dvh/safe-area CSS, but no
                                     physical iOS hardware was available.

Skipped (NOT counted as passed):
  answer-integrity e2e                     1 skipped  (separate opt-in gate)
  Firefox authenticated/admin flow         not run    (Chromium-only by design)

Blocked (NOT counted as passed):
  production valid recovery email          hosted Auth Site URL/allowlist has no
                                           management access; default remains
                                           http://localhost:3000
  fresh recovery-email delivery            no authorized test inbox

Failed:                  none
Immutable leftovers:     expected (published versions / finalized attempts /
                         violation events cannot be deleted by design)
```

### Teacher search and password recovery (2026-10-26)

**Teacher enrollment search.** The failing query put an embedded relationship
alias inside PostgREST's logical tree:
`.or('student.full_name.ilike.%q%,student.email.ilike.%q%')`. PostgREST rejects
it with `PGRST100`; removing the alias produces `42703` because
`enrollments` has no `full_name`/`email` column. Migration
`2026010100026_teacher_enrollment_search.sql` adds
`public.get_course_enrollments_page(p_course_id, p_search, p_status, p_page,
p_page_size)`. The `SECURITY DEFINER` function requires an active account and
course ownership (or admin), matches name/email with literal case-insensitive
`strpos(lower(...), lower(...))`, counts before pagination, filters status, and
orders by `requested_at DESC, id DESC`. `%`, `_`, quotes, commas, and
parentheses are data, not filter syntax. The UI debounces 300 ms, hides stale
rows/counts while a query settles, resets to page 1, and clears search + status
atomically.

**Password recovery.** `resetPasswordForEmail` now uses the compiled
`VITE_PUBLIC_SITE_URL` when it is a valid non-localhost HTTP(S) origin, with the
current origin as the local fallback. Vercel Production sets
`VITE_PUBLIC_SITE_URL=https://exavyn.vercel.app` (confirmed in the deployed
bundle). `UpdatePasswordPage` separately models an invalid/expired link versus a
valid recovery session, maps `otp_expired` / `session_not_found` /
`access_denied` to safe actionable copy, removes sensitive hash/query data, and
only reports success after `updateUser` resolves. A generated local recovery
link completed form → update → sign-in successfully; the expired state passes on
production.

**Operator action still required (blocked — no management access).** Hosted
Auth still returns `http://localhost:3000` for a production recovery request:

```
npm run check:auth-redirect -- <disposable-test-email>
Auth default redirect : http://localhost:3000
Requested redirect    : https://exavyn.vercel.app/update-password
Returned redirect     : http://localhost:3000
FAIL
```

In Supabase Dashboard → Authentication → URL Configuration:

1. Set **Site URL** to `https://exavyn.vercel.app`.
2. Add exact redirect `https://exavyn.vercel.app/update-password`.
3. Keep `http://localhost:5173/update-password` and
   `http://localhost:3000/update-password` for local development.
4. Do not add a production wildcard. Re-run `check:auth-redirect`; it must print
   `PASS`.

The CLI account cannot access this project (`SUPABASE_ACCESS_TOKEN` absent;
`supabase link` returns “Your account does not have the necessary privileges”).
Fresh production recovery-email delivery is also unverified because no
authorized test inbox is available. The expired-link UI, local valid-link flow,
code path, and deployed environment value are verified; the remote Auth setting
is not.

### V2 shell, feedback routing, progress, and exact-point scoring (2026-10-25)

- **Migration `2026010100025_feedback_recipients_unread.sql`** (applied via
  `db push --db-url`, no reset): adds `recipient_type` /
  `recipient_teacher_id`, `student_read_at`, `staff_read_at`,
  `response_updated_at`, and unread partial indexes; backfills course-linked
  feedback to the course owner; replaces `submit_feedback` (9 args) and
  `get_staff_feedback_page` (6 args); hardens `update_feedback`,
  `mark_my_feedback_read`, `mark_feedback_read`, and
  `get_feedback_unread_counts`; and closes the suspended-account hole in the
  legacy `get_feedback_summary`. Recipients are resolved server-side, linked
  exams must be published/visible, notes and responses are limited to 5000
  characters, and every definer function calls `app.require_user()`.
- **Admin users directory:** the ambiguous `profiles` → `user_roles` embed is
  now named explicitly (`user_roles!user_roles_user_id_fkey!inner(role)`),
  fixing PGRST201 while preserving server-side role filtering before pagination.
  Verified through `/admin/users` in the browser and by the dedicated e2e.
- **Shell:** inline-SVG hamburger with `aria-expanded`/`aria-controls`, persisted
  desktop collapse (`exavyn.sidebar.collapsed`), mobile overlay drawer with
  focus trap, Escape/backdrop close, `inert`/dialog semantics, focus restore,
  nav-close focus handoff to `<main tabIndex={-1}>`, scrollable sidebar, and
  unread Feedback badge. Authenticated chrome omits the public tagline and keeps
  the white logo backing on dark surfaces.
- **Appearance:** theme controls moved from the header into
  Profile → Settings → Appearance for every role, with the existing
  Light/Dark/System persistence and live OS subscription. Public account screens
  are fixed-dark via `data-surface="public"` and never read, write, or persist
  `exavyn.theme`.
- **Cyber-Tribal visual system:** original local SVG/CSS artwork, Space Grotesk
  display type (reported substitute for the unavailable Azonix asset), JetBrains
  Mono for technical values, off-white authenticated light surfaces, accessible
  functional tokens, contained table scrolling, matched skeleton loaders, and
  reduced-motion handling. The active exam remains quiet with no sidebar,
  appearance controls, or decorative animation. Production screenshots were
  captured for login, student dashboard, settings, and an active exam.
- **Feedback UI:** explicit Administration vs Course teacher recipient,
  authorized enrollment/exam selectors with no raw UUID entry, duplicate-click
  request-id reuse, post-exam defaults, private staff notes separate from the
  student-visible response, unread badges/counters both ways, and
  pagination/search/filters. Hosted feedback suite grew from 6 to **18**
  checks; the new production UI spec covers submit → reply → read.
- **Exam progress:** `role="progressbar"` with min/max/now/valuetext and
  answered/unanswered/marked counters; covered by the answer-integrity e2e.
- **Exact-point score classification:** `classifyScore` prefers raw
  `earned/max` points when available (the database stores percentage at two
  decimals), maps green ≥ threshold, yellow within 10pp below, red >10pp below,
  and stays neutral when threshold/score is missing or withheld. Unit count is
  now **124/124**.

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
- `supabase/tests/workflow.test.mjs`: now verifies stable option IDs, change,
  out-of-order writes, explicit clear/reload, bookmarks, exact graded review,
  scheduled release, and direct-API withholding (65/65).
- `supabase/tests/rls.test.mjs`: added `get_attempt_review` authorization checks
  for a non-owner student and a non-owner teacher, plus the signup-hardening
  checks (role-escalation denial + cross-student isolation); the suite is now
  **36/36**.

### Bug found and fixed

The answer-change defect was caused by reusing one `request_id` per question in
`ExamPage`. `save_answer` correctly treated that as an idempotent retry and
returned the first accepted selection, so later choices could appear to revert.
The client now creates a fresh request UUID for every logical change, advances a
per-question revision initialized from the hosted row, ignores stale responses,
and waits for the latest save before navigation/submission. Hosted checks prove
change, rapid out-of-order updates, clear/reload, final grading, and review
mapping. Finalization was also corrected to count only non-null selections; no
historical finalized score was rewritten.

A separate shuffled-review defect used the authored `question.position` as the
display number even though review rows were ordered by the persisted shuffled
`question_order`. The review page now numbers the returned persisted order, so
the number, prompt, saved option UUID, grading key, and explanation remain
aligned.

Dedicated hosted browser proof (`answer-integrity.exam.spec.ts`, Chromium,
isolated five-question shuffled fixture): **1/1 passed**. It selects B on the
first displayed question, waits for Next, answers question 2, returns only with
Previous, verifies B, changes to C, reloads, exercises out-of-order A → C → B,
clears another answer, submits, compares database rows and computed grading, and
verifies review shows C. It also asserts question/bookmark status markers cannot
navigate and that both navigation buttons are disabled until save acknowledgement.

The same scenario was rerun against the public production alias after promoting
the verified Vercel preview: **1/1 passed**. The trace asserts distinct request
UUIDs for B and C, revisions 1 and 2, accepted RPC responses, the final C option
UUID in `attempt_answers`, the matching grading input, and the matching
`get_attempt_review` payload. That proof ran on the previous V2 deployment
(`index-B9zquRSL.js` / `index-WtXLvfJy.css`). The subsequent Cyber-Tribal
deployment served `index-Cyby463L.js` / `index-DqhDLp1g.css`; the current
teacher-search/recovery deployment serves `index-BLAhqpOA.js` /
`index-DqhDLp1g.css`. Those UI fixes changed no attempt, auth-token, or
answer-integrity code; production public **10/10**, teacher search **1/1**, and
expired recovery **1/1** were rerun against the current assets.
The earlier V2 deployment served `index-CCj1TNHp.js`, and the original defect
before that served `index-DsrZm_K0.js` with request-ID reuse and direct
question-jump behavior.

Read-only historical audit snapshot before the final verification fixtures:
483 attempts and 6,043 answer rows overall. Excluding generated E2E exams, one
submitted attempt had `answered_count=31` with 30 non-null selections across 31
rows. It was not modified because finalized outcomes are immutable. The old
client did not record rejected logical changes, so revision-1 rows cannot prove
that a student changed an answer and cannot safely identify every affected
attempt; no historical selection or score was inferred or rewritten.

Migrations `0018`/`0019` restored omitted private order/finalization helpers;
`0021` removed an obsolete `update_exam_settings` overload that made PostgREST
resolution ambiguous. Hosted function-signature and lifecycle suites pass.

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
