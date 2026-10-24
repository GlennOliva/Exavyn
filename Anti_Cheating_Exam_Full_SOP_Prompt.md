# Full Development SOP Prompt: Anti-Cheating Exam

Copy the entire prompt below into your coding assistant.

---

You are a senior full-stack engineer. Build a complete web application named **Anti-Cheating Exam** using **React, TypeScript, and Supabase**. Implement the working application, database migrations, authorization policies, exam workflows, tests, and setup documentation. Do not stop at a UI mockup or implementation plan.

## 1. Goal and required behavior

Build an examination platform with separate Admin, Teacher, and Student pages. Teachers create courses with unique course codes, enroll students, and publish multiple-choice examinations. Published examinations automatically appear for students enrolled in the corresponding course. Students take an examination in a focused fullscreen interface.

Apply this exact violation policy:

- First distinct violation: record it and show a warning, “Warning 1 of 2. Leaving the exam again will automatically submit your answers.”
- Second distinct violation: immediately lock answering and ask the backend to finalize the attempt using answers already accepted by the server. Do not give two warnings followed by a third violation.
- Manual submission, time expiry, and the second violation all produce a final, immutable score.
- No student, teacher, or administrator workflow may edit that final score, reopen the attempt, reset the flags, or silently regrade it.

Example: a teacher publishes a 50-item MCQ examination for course IT101. An enrolled student answers 30 correctly before the second violation. With one point per question, the result is 30/50, or 60%. Unanswered questions receive zero. This result remains final.

## 2. Browser limitations and honest product wording

A normal web application cannot reliably prevent operating-system Alt+Tab, lock a device, detect every outside activity, or prove cheating. Implement browser activity monitoring and fullscreen requirements without claiming complete prevention.

Use document visibility changes, window focus events, fullscreen changes, and application navigation guards. Treat these as policy violations or focus-loss events, not proof of misconduct. Browser-reported events can be suppressed or forged by a modified client; securing the event counter does not make browser telemetry tamper-proof.

Explain this limitation in README and on the pre-exam rules screen. If strict device lockdown is later required, describe a separate managed kiosk or lockdown-browser integration as future work. Do not add it to the initial application.

Do not add webcam recording, microphone recording, biometric checks, AI proctoring, or screen recording to this scope.

## 3. Technology and project structure

- React with TypeScript strict mode and Vite.
- React Router for role-specific routes.
- Supabase Auth for identity, PostgreSQL for data, RLS for authorization, and database functions for transactional exam actions.
- Supabase Edge Functions for operations needing server secrets, such as administrative account provisioning.
- A responsive component system with accessible controls and clear loading, empty, success, and error states.
- Vitest and React Testing Library for meaningful unit/component tests; Playwright for complete browser workflows; database tests for RLS and transactional rules.

Use stable compatible dependencies verified against their official documentation. Keep business rules out of page components. Suggested directories: src/features/auth, courses, exams, attempts, monitoring, results; src/components; src/lib; supabase/migrations; supabase/functions; supabase/tests; tests/e2e; docs.

Only browser-safe Supabase configuration may enter the frontend. Keep service-role keys and server secrets out of source control, browser bundles, logs, and VITE_* variables. Provide .env.example with placeholders.

## 4. Roles and authorization

### Admin

- View user/course/exam/attempt counts and flagged-attempt summaries.
- Approve or provision teacher accounts and manage student accounts.
- Assign trusted roles and suspend accounts through authenticated backend operations.
- View courses, enrollment records, examination metadata, results, and event logs.
- Export authorized reports and inspect append-only administrative audit logs.
- Archive records instead of deleting historical examinations and results.
- Cannot edit finalized scores or reopen submitted attempts.

### Teacher

- Manage only their own courses, enrollments, examination drafts, and course reports.
- Create a course with title, description, section, academic term, and unique course code.
- Generate a separate enrollment join code; a course identifier such as IT101 must not itself grant enrollment.
- Approve enrollment requests or enroll existing students directly.
- Create, preview, validate, publish, and archive MCQ examinations.
- See their students’ progress, final results, submission reasons, and violation timelines.
- Cannot access another teacher’s private course or change finalized results.

### Student

- Register/login, update allowed profile fields, and request enrollment using a join code.
- See only their approved courses, published exam availability, own attempts, and own results.
- Take an available exam once, resume that same active attempt when permitted, and view the final result.
- Cannot choose their role at registration, approve their own enrollment, access answer keys, edit scores, or reset attempts.

Public registration creates students only. Bootstrap the initial administrator using a documented server-side process. Store roles in trusted data; do not authorize using editable profile metadata or local storage. Enforce account status and ownership inside every protected backend operation. Client route guards supplement backend security.

## 5. Course and enrollment workflow

Teacher creates a course → student requests enrollment with the join code → teacher approves → course and its published exams appear on the student dashboard.

Enforce a unique enrollment per course/student. Enrollment states: pending, approved, rejected, withdrawn. Prevent duplicate requests. Rate-limit and validate join-code submissions without revealing unrelated course rosters.

Only approved enrollment permits starting an examination. Recheck enrollment at the server when starting. If enrollment is withdrawn after an attempt starts, preserve that active attempt’s access until finalization and prohibit new starts; document this policy explicitly.

Publication must make an exam visible without requiring the teacher to manually assign it to each enrolled student. Refresh availability on dashboard load and provide a refresh control; realtime updates are optional.

## 6. Examination authoring and publication

Support exams with 50 questions and other valid positive question counts. Each question has a prompt, four choices, exactly one correct option, and one point by default.

Exam settings: title, instructions, course, duration, opens_at, closes_at, question randomization, option randomization, and result-release policy. The violation threshold is fixed at two for this project.

Validate nonempty prompts, four nonempty choices, valid correct option, positive duration, at least one question, and opening time before closing time. Display item count and maximum score before publishing. Preview authoring content without creating a student attempt or triggering monitoring.

Use draft → published → archived states. Publish an immutable exam version containing its question content, correct answers, points, schedule, and rules. Editing a published exam must create a separate draft/version; never mutate a version referenced by an attempt. For the MVP, freeze the published exam and allow duplication into a new exam instead.

Students may see scheduled published exams, but the backend releases question content only to an eligible active attempt. Draft questions and answer keys must not be readable by students. Store keys separately from student-readable question content. Do not put hidden correctness fields into JSON responses, HTML, frontend types, or accessible realtime feeds.

## 7. Student exam experience

Dashboard shows upcoming, available, closed, and completed exams. Pre-exam screen shows course, instructions, item count, duration, availability, single-attempt rule, two-violation rule, final-score rule, and browser-monitoring limitations.

Require the student to acknowledge the rules. Detect fullscreen capability at runtime and request fullscreen synchronously from the start gesture. If the request is unsupported or rejected (for example, iPhone/iPad Safari), do not block the student: clearly disclose that the exam will use a focused viewport fallback, that monitoring is limited where the browser reports it, and that a web page cannot prevent app switching. Never describe the fallback as fullscreen or as device lockdown. Continue monitoring visibility and focus where available.

Once started, display question text, choices, question navigation, answered/unanswered indicators, server-derived remaining time, save status, warning count, and a submit button. Support keyboard navigation and readable contrast. Hide unrelated application navigation during the attempt.

Save each answer promptly to the server, with retry-safe requests and an explicit Saved/Saving/Not saved indicator. Reject invalid question/option combinations. Persist randomized question/option order once at attempt creation and reuse it on reload. Never reveal correctness during the attempt.

Manual submission displays an unanswered-item summary and confirmation. A second violation or deadline requires no confirmation. After backend finalization, remove monitoring listeners before exiting fullscreen or navigating to results so application cleanup cannot create another event.

## 8. Violation detection and deduplication

Monitor only an active attempt, after startup and fullscreen prompts have completed.

Qualifying signals:

- document.visibilityState becomes hidden.
- Window focus is lost continuously for more than a documented short grace period, initially 1 second. This is a focus-loss signal, not an Alt+Tab detector.
- Fullscreen is exited unexpectedly.
- The student intentionally attempts to navigate to another application route while the exam is active. Guard and block the transition, record one navigation episode, and show the warning when appropriate.

Do not count clicking another answer, ordinary keyboard focus changes inside the exam, allowed exam dialogs, initial browser permission/fullscreen prompts, network loss by itself, or cleanup after finalization as violations.

One physical departure may emit blur, visibilitychange, and fullscreenchange together. Group these into one departure episode with a stable episode UUID. Attach multiple signal types to that episode but increment the count once. Use a state machine and short coalescing interval; do not rely only on a fixed debounce timeout.

Rearm departure detection only after the document is visible, window focus has returned, and — only when the attempt is in fullscreen mode — required fullscreen has been restored. Fallback attempts never require fullscreen and must not count its absence as a departure. A prolonged absence counts as one episode. A later departure after recovery counts as the second. Deduplicate navigation episodes against overlapping departure signals. Persist pending episode IDs across reload and retries; never generate a new UUID simply because a request failed.

After warning one, pause answer interaction until the student acknowledges the warning and, in fullscreen mode, restores fullscreen. The timer continues running. Do not auto-request fullscreen without the required user gesture; if the request fails, switch honestly to fallback rather than trapping the student.

Send event reports to a backend function that verifies the caller owns an active attempt. Store attempt ID, episode ID, signal types, client observed time, server received time, and relevant diagnostic details. Use server time for enforcement and make duplicate episode reports idempotent. The server owns the warning count and returns the authoritative attempt state.

On episode two, a single database transaction must record the event, update the count, grade saved answers, and finalize the attempt. Lock the attempt row to serialize competing answer-save and submission requests. Answers committed before finalization are graded; later writes are rejected. Do not depend on a separate client-side submit request succeeding after the event has been recorded.

## 9. Reloads, shutdowns, disconnections, and multiple tabs

Do not promise reliable interception of browser close, reload, back navigation, or operating-system shutdown. beforeunload/pagehide delivery is best effort. Do not perform authoritative grading in an unload handler.

Persist the attempt and its existing violation count on the server. Reload must recover the same attempt, never create a fresh timer or zero the warnings. Treat reload/reconnect as recovery unless a distinct departure event was actually recorded; do not invent a violation from a connectivity gap alone.

Use heartbeats to track stale sessions as diagnostic status. Heartbeat silence is not proof of cheating. On reconnect, reconcile pending events before allowing further answer writes, then retrieve the authoritative attempt state. If the second event could not reach the backend, lock interaction locally and display “Submission pending — reconnect to confirm.” Retry the same event ID. Do not claim final submission until the server confirms it.

For the MVP, require connectivity for accepting new answers; freeze answering during disconnection and keep the existing server deadline. Explain that only server-saved answers contribute to the final score. Preserve unsent events for retry and show recovery status honestly.

Enforce one attempt per exam/student in the database. Use an active controller token and renewable server lease to reject answer/event mutations from a second tab or device. Permit recovery after the previous controller lease expires, rotating the token so stale tabs cannot write. Coordinate same-browser tabs with BroadcastChannel where supported, but do not treat it as backend security. Never reset the attempt during controller recovery.

## 10. Authoritative timing, grading, and finality

At start, backend sets started_at and deadline_at = min(started_at + duration, exam closes_at), using server timestamps. Check availability atomically at start.

Use the client countdown only for display. Every answer save, event report, and submission checks the deadline against server time. An overdue attempt is finalized before any new answer is accepted. A scheduled server job finalizes expired attempts even if the browser is closed; state reconciliation also catches overdue attempts.

Grade using the immutable server-side key and accepted answer rows. Never accept submitted scores, percentage, correct-answer count, warning count, or deadlines from the client.

Store earned points, maximum points, percentage, answered count, correct count, finalization timestamp, violation count, exam version, and submission reason. Reasons: manual, violation_limit, time_expired. Apply a documented precedence: if the server deadline has already passed when processing a request, time_expired wins; otherwise the transaction that finalizes first determines the reason.

Finalization is idempotent: repeated or simultaneous calls return the same stored result. Once finalized, deny answer inserts/updates/deletes, score mutations, attempt reopening, and event changes affecting the final count. Protect these invariants with grants, functions, constraints/triggers, and tests, rather than frontend disabling alone.

Database project owners can still alter a database outside the application; document that platform-level access is outside the application's immutability guarantee. No application role gets a result-editing endpoint.

Result release supports immediate or after exam closing. Hide totals until release if configured. For the MVP, do not release correct answer keys to students, including through raw APIs. Teachers can see authorized final results immediately.

## 11. Suggested database model

Design migrations for:

- profiles: auth user reference and allowed identity fields.
- user_roles: trusted role assignments, protected against self-promotion.
- courses: owner, unique course code, metadata, archived status.
- course_join_codes: protected hashed join codes and rotation/expiry data.
- enrollments: course/student/status with unique course/student pair.
- exams and exam_versions: authoring metadata and immutable published rules.
- exam_questions and question_options: draft content and immutable published content with stable IDs.
- private answer_keys: published question IDs, correct option IDs, points; no student access.
- exam_attempts: student, version, state, timestamps, count, order, controller lease, final result fields.
- attempt_answers: unique attempt/question, selected option, server timestamp, revision/request identifiers.
- violation_events: unique attempt/episode, signal metadata, observed/received timestamps.
- attempt_heartbeats: minimal session-health information.
- audit_logs: append-only administrative and publication actions.

Keep authoritative final fields on the attempt row or enforce a one-to-one immutable result row transactionally. Add foreign keys, useful indexes, unique constraints, and checks. Preserve history on account/course archival. Do not cascade-delete completed attempt history through ordinary admin actions.

## 12. Backend functions and security

Implement operations equivalent to: create_course, request_enrollment, approve_enrollment, publish_exam, start_attempt, acquire_attempt_controller, get_attempt_payload, save_answer, record_violation, submit_attempt, get_result, and finalize_expired_attempts.

Derive the user from authenticated server context. Never trust a caller-supplied student ID or teacher ID for authorization. Validate role, account status, course ownership, enrollment, exam state, attempt ownership, active controller, option membership, and deadlines as appropriate.

Apply RLS and least-privilege table/function grants. Students can read only their permitted data; teachers only their courses and authorized student records; administrators receive explicitly scoped management/report permissions. Prevent direct API writes that bypass publication, score finality, event counting, or timing rules.

If SECURITY DEFINER functions are necessary, use a fixed safe search_path, schema-qualified objects, narrow execute grants, and explicit caller checks. Revoke unintended public execution. Ensure views and realtime feeds cannot bypass protected tables or expose answer keys.

Use database transactions for multi-step authoritative operations. An Edge Function making several independent database requests is not an atomic transaction. Use bounded retries and idempotency keys. Reject out-of-order answer saves so a delayed older request cannot overwrite a newer accepted selection.

Render question text safely without arbitrary HTML execution. Rate-limit sensitive operations. Never expose raw database errors or credentials to students. Keep event diagnostics minimal and show students the monitoring policy before starting.

## 13. Required pages

Public: login, student registration, account recovery.

Admin: dashboard, user management, teacher approvals, course directory, examination directory, result reports, violation reports, audit logs.

Teacher: dashboard, courses, course detail/enrollment requests, exam builder, exam preview, exam settings/publication, student results, attempt/event detail.

Student: dashboard, join course, course detail/exam list, exam instructions, exam interface (native fullscreen where available, accessible viewport fallback otherwise), final result, examination history, profile.

Use a professional school-oriented design with readable typography, consistent spacing, status badges, searchable tables, and clear actions. Support responsive dashboards and mobile exam taking through the documented fallback. Native fullscreen is preferred where tested; never silently weaken the monitoring policy or mislabel fallback as fullscreen. Paginate every data table server-side (default 10, options 10/25/50, stable ordering, filters before slicing) and use green/yellow/red score badges for passed/near-passing/failed with neutral pending/unreleased states.

## 14. Development SOP and phase exit criteria

Phase 1 — Plan and scaffold: document assumptions, browser limits, role matrix, schema, routes, and attempt state machine; scaffold React/TypeScript. Exit: application runs and architecture is documented.

Phase 2 — Database and authentication: implement migrations, grants/RLS, trusted role management, bootstrap process, login/recovery, and role dashboards. Exit: direct API tests prove cross-role access is denied.

Phase 3 — Courses and enrollments: build teacher course creation, join-code requests, approval, and student course visibility. Exit: approved students see their course; other students cannot access it.

Phase 4 — Exam builder and publication: implement MCQ CRUD, validation, preview, immutable publication, and enrolled-student discovery. Exit: a 50-item published exam appears for eligible students and keys remain private.

Phase 5 — Attempts, answers, timing, grading: build server-started attempts, persisted order, autosave, single-controller recovery, submission, expiry job, and immutable results. Exit: manual and expired submissions are correctly graded and retry safe.

Phase 6 — Monitoring: implement departure episodes, warning one, atomic finalization on episode two, navigation guards, fullscreen recovery, and offline event retries. Exit: one departure cannot consume both flags; second distinct departure produces a final result.

Phase 7 — Reports and verification: implement authorized reports/CSV exports; execute unit, browser, security, concurrency, and hosted integration checks. Exit: required acceptance criteria pass and defects are resolved or explicitly reported.

Phase 8 — Handover: provide setup/runbook, migrations, seeds, test evidence, limitations, screenshots, and deployment configuration. Do not mark hosted tasks complete if only local mocks were tested.

Proceed through authorized implementation and reversible fixes. Ask only about genuine blockers or material product decisions. Do not deploy to production without explicit authorization. Missing credentials must produce a precise setup/blocker report, not fabricated success.

## 15. Required acceptance criteria and verification

1. A student registering publicly cannot assign themselves teacher/admin through UI or direct API calls.
2. Teacher A cannot read or modify Teacher B’s private course, drafts, keys, or results.
3. An unenrolled student cannot obtain exam questions or start an attempt by guessing IDs.
4. Approval makes the course’s published exam visible; drafts remain hidden.
5. A teacher can create and publish a valid 50-item MCQ exam; invalid/incomplete exams cannot publish.
6. Student payloads, direct queries, views, realtime messages, and result endpoints do not leak answer keys.
7. Double-clicked or simultaneous start requests create one attempt and one deadline.
8. Randomized order and server-saved answers survive reload; warnings and deadline do not reset.
9. One departure producing blur + hidden + fullscreen-exit increments the count once. A long absence does not generate repeated flags.
10. After recovery, a second distinct departure immediately locks the UI and atomically finalizes at count two.
11. Duplicate event deliveries, including after reload, never double-count an episode.
12. Clicking answers, using question navigation, or accepting startup prompts does not trigger flags.
13. Leaving for another application route is blocked and counted once according to the policy.
14. Server scoring returns 30/50 and 60% for 30 correct one-point responses, regardless of a forged client score.
15. Invalid options, foreign question IDs, another student’s attempt ID, stale controllers, and late answer writes are rejected.
16. Manual submit racing with a second event, answer save, or expiry produces exactly one consistent final result.
17. Direct authenticated API calls cannot alter final scores, final answers, final count, or submitted state, including calls made by teachers/admins.
18. Expired attempts finalize with the browser closed; changing the computer clock does not extend time.
19. Offline second-event delivery shows pending status, locks answering, and retries the same episode; it never falsely displays confirmed submission.
20. A second tab/device cannot save answers concurrently, and documented controller recovery preserves attempt state.
21. Result release rules hold at the API layer, including before scheduled release.
22. Archiving a course or suspending an account preserves historical results and audit records.
23. CSV exports include only authorized records and escape spreadsheet-formula injection in user-supplied text fields.
24. Browser tests cover supported desktop browsers. Manually verify real tab switching, app switching, fullscreen exit, reconnect, and reload because synthetic events alone do not establish browser behavior.
25. Devices or browsers without a usable Fullscreen API can start, answer, save, and submit in the accessible fallback; fullscreen absence is never a violation, and recovery in fallback requires only visible + focused.
26. Every authorized data list paginates server-side with 10/25/50 page sizes, stable total/order, URL-preserved state, and filters/search applied before the page slice; active-exam question navigation is not paginated.
27. Score status is computed from the unrounded authoritative percentage against the snapshotted pass threshold: green at/above, yellow within 10 points below, red further below; missing thresholds and unreleased/pending results stay neutral and do not imply pass/fail.

Use isolated test accounts for admin, two teachers, and multiple enrolled/unenrolled students. Test RLS with real user tokens; service-role requests do not prove user-policy enforcement. Include duplicate/reordered requests and concurrency tests against the database.

## 16. Deliverables and completion report

Deliver working source code, versioned SQL migrations, RLS/grant tests, database functions, required Edge Functions, safe sample data, .env.example, README, role/route matrix, monitoring policy, setup and deployment instructions, and test reports.

Explain how to provision the initial administrator, approve a teacher, create a course, enroll a student, publish a 50-item exam, take it, trigger two distinct events, and inspect the immutable score.

Final report must identify implemented features, migrations applied, checks actually run with pass/fail counts, unverified hosted steps, known browser limits, and remaining blockers. Never describe browser monitoring as guaranteed cheating prevention.

Start by inspecting the project and existing instructions. State the architecture and assumptions briefly, then implement phase by phase until the complete authorized application is working.

---

## Official references for the implementer

- Page Visibility API: https://developer.mozilla.org/en-US/docs/Web/API/Page_Visibility_API
- Fullscreen API guide: https://developer.mozilla.org/en-US/docs/Web/API/Fullscreen_API/Guide
- Supabase RLS: https://supabase.com/docs/guides/database/postgres/row-level-security

These references support the browser capability boundaries and database authorization approach. The two-violation threshold, episode grouping, connectivity policy, and final-score rules above are application requirements.
## Exavyn Version 2 implementation addendum (2026-10-24)

- Answers are keyed by `(attempt_id, question_id)` and store immutable option
  UUIDs. Each logical change has a fresh request UUID and increasing revision;
  stale writes cannot replace newer selections. Null is an explicit clear.
- Next, Previous, bookmarked/visited revisits, and manual submission wait for
  the latest accepted save. Question numbers and bookmark summaries are status
  only and never navigate; every revisit uses Previous/Next. Expiry and
  violation-limit finalization never wait indefinitely for the client.
- Question and option orders are generated once at attempt creation and reused
  from persisted JSON order on resume, grading, and review.
- Score and answer release are separate, snapshot per attempt, support scheduled
  instants, and are enforced in RPCs and RLS. Answer keys never release before
  scores. Score colors use the unrounded configured threshold and a ten-point
  near-passing band.
- Feedback is account-linked, paginated, duplicate-protected, and role-scoped.
  Private staff notes are excluded from the submitter endpoint; visible staff
  responses are separate. No notification email is sent.
- Context menu and page copy/cut shortcuts are best-effort deterrents scoped to
  the active exam. They are not violations or proof of cheating, do not block
  paste in editable fields, and do not disable navigation/accessibility keys.
- Fullscreen is capability-detected. Unsupported/rejected requests use a
  safe-area-aware viewport fallback and are not violations. Managed browser or
  kiosk software is required for actual device lockdown.
