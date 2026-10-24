import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useBlocker, useNavigate, useParams } from 'react-router-dom';
import {
  acquireAttemptController,
  getAttemptPayload,
  saveAnswer,
  submitAttempt,
} from '../../features/attempts/api';
import { supabase } from '../../lib/supabase';
import {
  getAttemptIdForExam,
  getAttemptMonitoringMode,
  getControllerToken,
  setAttemptMonitoringMode,
  setControllerToken,
  type AttemptMonitoringMode,
} from '../../features/attempts/storage';
import {
  detectFullscreenCapability,
  FULLSCREEN_FALLBACK_MESSAGE,
  isFullscreenActive,
  requestExamFullscreen,
} from '../../features/exam/fullscreen';
import { useExamMonitor } from '../../features/monitoring/useExamMonitor';
import type { AttemptPayload } from '../../features/attempts/types';
import { Alert, Button, Card, PageSpinner, Spinner } from '../../components/ui';
import { errorMessage } from '../../lib/errors';
import { formatDuration, remainingMs } from '../../lib/format';
import { isBlockedExamShortcut, isEditableExamTarget } from '../../features/exam/restrictions';

type SaveState = 'saved' | 'saving' | 'error';

export function ExamPage() {
  const { examId = '' } = useParams();
  const navigate = useNavigate();

  const [attemptId, setAttemptId] = useState<string | null>(null);
  const [controllerToken, setToken] = useState<string | null>(null);
  const [payload, setPayload] = useState<AttemptPayload | null>(null);
  const [blocked, setBlocked] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [current, setCurrent] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string | null>>({});
  const [saveStates, setSaveStates] = useState<Record<string, SaveState>>({});
  const [bookmarks, setBookmarks] = useState<Set<string>>(new Set());
  const [visited, setVisited] = useState<Set<string>>(new Set());
  const [navigating, setNavigating] = useState(false);
  const [showSubmit, setShowSubmit] = useState(false);
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine);

  const revisionRef = useRef<Record<string, number>>({});
  const finalizedRef = useRef(false);
  const latestSaveRef = useRef<Record<string, Promise<boolean>>>({});
  const [finalizing, setFinalizing] = useState(false);
  const [monitoringMode, setMonitoringMode] = useState<AttemptMonitoringMode>('fullscreen');
  const [fullscreenActive, setFullscreenActive] = useState(() => isFullscreenActive());
  const examShellRef = useRef<HTMLDivElement>(null);

  // --- Controller acquisition + payload load ------------------------------
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        // The attempt id is stored per exam at start time.
        const storedAttempt = getAttemptIdForExam(examId);
        const storedToken = storedAttempt ? getControllerToken(storedAttempt) : null;
        if (!storedAttempt) {
          navigate(`/student/exams/${examId}`, { replace: true });
          return;
        }
        const acquired = await acquireAttemptController(storedAttempt, storedToken);
        if (!active) return;
        if (acquired.state === 'submitted') {
          navigate(`/student/attempts/${storedAttempt}/result`, { replace: true });
          return;
        }
        setAttemptId(storedAttempt);
        setToken(acquired.controller_token);
        setControllerToken(storedAttempt, acquired.controller_token);

        // Restore the monitoring mode chosen when the attempt started. Legacy
        // attempts without a stored mode fall back to a runtime capability
        // check rather than a device name.
        const storedMode = getAttemptMonitoringMode(storedAttempt);
        const resolvedMode: AttemptMonitoringMode =
          storedMode ?? (detectFullscreenCapability().supported ? 'fullscreen' : 'fallback');
        setMonitoringMode(resolvedMode);
        setAttemptMonitoringMode(storedAttempt, resolvedMode);

        const data = await getAttemptPayload(storedAttempt);
        if (!active) return;
        if (data.attempt.state === 'submitted') {
          navigate(`/student/attempts/${storedAttempt}/result`, { replace: true });
          return;
        }
        setPayload(data);
        const initial: Record<string, string | null> = {};
        const revisions: Record<string, number> = {};
        const initialStates: Record<string, SaveState> = {};
        const initialVisited = new Set<string>();
        for (const [index, q] of data.questions.entries()) {
          if (index === 0 || q.saved_option_id) initialVisited.add(q.id);
          if (q.saved_option_id) {
            initial[q.id] = q.saved_option_id;
            revisions[q.id] = q.revision ?? 0;
            initialStates[q.id] = 'saved';
          } else {
            initial[q.id] = null;
            revisions[q.id] = q.revision ?? 0;
          }
        }
        setAnswers(initial);
        revisionRef.current = revisions;
        setSaveStates(initialStates);
        setVisited(initialVisited);
        setCurrent(0);
        // Load bookmarks
        if (acquired.controller_token) {
          try {
            const { data: bm } = await supabase.rpc('get_bookmarks', { p_attempt_id: storedAttempt, p_controller_token: acquired.controller_token });
            const list = (bm as { bookmarks?: string[] } | null)?.bookmarks || [];
            setBookmarks(new Set(list));
          } catch {
            // ignore
          }
        }
      } catch (err) {
        if (!active) return;
        const message = errorMessage(err);
        if (/another session/i.test(message)) {
          setBlocked(message);
        } else {
          setError(message);
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [examId, navigate]);

  const initialViolationCount = payload?.attempt.violation_count ?? 0;

  const onViolation = useCallback(() => {
    // Count updates are handled by the monitor; nothing else required here.
  }, []);

  const monitor = useExamMonitor({
    attemptId,
    controllerToken,
    initialViolationCount,
    threshold: payload?.attempt.violation_threshold,
    enabled: Boolean(payload && attemptId && controllerToken),
    fullscreenRequired: monitoringMode === 'fullscreen',
    onViolation,
  });

  // Keep the fullscreen indicator honest without treating an exit as a
  // fallback permission: the monitor still applies the fullscreen policy when
  // the attempt started in fullscreen mode.
  useEffect(() => {
    const onChange = () => setFullscreenActive(isFullscreenActive());
    document.addEventListener('fullscreenchange', onChange);
    document.addEventListener('webkitfullscreenchange', onChange);
    return () => {
      document.removeEventListener('fullscreenchange', onChange);
      document.removeEventListener('webkitfullscreenchange', onChange);
    };
  }, []);

  // Online/offline awareness: freeze answering while disconnected.
  useEffect(() => {
    const up = () => {
      setOnline(true);
      void monitor.flushPending();
    };
    const down = () => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
    };
  }, [monitor]);

  // --- Countdown ----------------------------------------------------------
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const remaining = payload ? remainingMs(payload.attempt.deadline_at, now) : 0;

  const goToResult = useCallback(
    (id: string) => {
      finalizedRef.current = true;
      navigate(`/student/attempts/${id}/result`, { replace: true });
    },
    [navigate],
  );

  // Deadline expiry: ask the backend to finalize (it is authoritative).
  useEffect(() => {
    if (!payload || !attemptId || !controllerToken) return;
    if (remaining > 0 || finalizedRef.current) return;
    (async () => {
      try {
        await submitAttempt(attemptId, controllerToken);
      } finally {
        goToResult(attemptId);
      }
    })();
  }, [remaining, payload, attemptId, controllerToken, goToResult]);

  // Finalized by the second violation: leave the exam immediately.
  useEffect(() => {
    if (monitor.isFinalized && attemptId) goToResult(attemptId);
  }, [monitor.isFinalized, attemptId, goToResult]);

  // --- Navigation guard ---------------------------------------------------
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      !finalizedRef.current &&
      Boolean(payload) &&
      currentLocation.pathname !== nextLocation.pathname,
  );

  useEffect(() => {
    if (blocker.state === 'blocked') {
      monitor.reportNavigationBlocked();
      blocker.reset();
    }
  }, [blocker, monitor]);

  // Best-effort unload warning (not authoritative).
  useEffect(() => {
    const handler = (event: BeforeUnloadEvent) => {
      if (!finalizedRef.current && payload) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [payload]);

  // Best-effort deterrence only. These events are never reported as monitoring
  // violations, and ordinary navigation/accessibility keys remain available.
  useEffect(() => {
    const root = examShellRef.current;
    if (!root || !payload || finalizedRef.current) return;
    const preventOutsideEditor = (event: Event) => {
      if (!isEditableExamTarget(event.target)) event.preventDefault();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (isBlockedExamShortcut(event)) event.preventDefault();
    };
    root.addEventListener('contextmenu', preventOutsideEditor);
    root.addEventListener('copy', preventOutsideEditor);
    root.addEventListener('cut', preventOutsideEditor);
    root.addEventListener('keydown', onKeyDown);
    return () => {
      root.removeEventListener('contextmenu', preventOutsideEditor);
      root.removeEventListener('copy', preventOutsideEditor);
      root.removeEventListener('cut', preventOutsideEditor);
      root.removeEventListener('keydown', onKeyDown);
    };
  }, [payload]);

  // --- Answer saving ------------------------------------------------------
  const persistAnswer = useCallback(
    async (questionId: string, optionId: string | null): Promise<boolean> => {
      if (!attemptId || !controllerToken) return false;
      const revision = (revisionRef.current[questionId] ?? 0) + 1;
      revisionRef.current[questionId] = revision;
      const requestId = crypto.randomUUID();

      setSaveStates((prev) => ({ ...prev, [questionId]: 'saving' }));
      const p: Promise<boolean> = (async () => {
        try {
          const result = await saveAnswer({
            attemptId,
            questionId,
            optionId,
            revision,
            requestId,
            controllerToken,
          });
          if (!result.accepted) {
            if (result.reason === 'time_expired' || result.reason === 'finalized') {
              goToResult(attemptId);
              return false;
            }
            if (result.reason === 'controller') {
              setBlocked('This attempt became active in another session.');
              return false;
            }
            if (revisionRef.current[questionId] === revision) {
              if (typeof result.revision === 'number') {
                revisionRef.current[questionId] = Math.max(revision, result.revision);
              }
              setSaveStates((prev) => ({ ...prev, [questionId]: 'error' }));
              return false;
            }
            return true;
          }
          if (revisionRef.current[questionId] === revision) {
            setSaveStates((prev) => ({ ...prev, [questionId]: 'saved' }));
          }
          return true;
        } catch {
          if (revisionRef.current[questionId] === revision) {
            setSaveStates((prev) => ({ ...prev, [questionId]: 'error' }));
          }
          return false;
        }
      })();
      latestSaveRef.current[questionId] = p;
      return await p;
    },
    [attemptId, controllerToken, goToResult],
  );

  const selectOption = (questionId: string, optionId: string) => {
    if (monitor.interactionLocked || !online) return;
    setAnswers((prev) => ({ ...prev, [questionId]: optionId }));
    setVisited((prev) => new Set(prev).add(questionId));
    void persistAnswer(questionId, optionId);
  };

  const clearAnswer = (questionId: string) => {
    if (monitor.interactionLocked || !online) return;
    setAnswers((prev) => ({ ...prev, [questionId]: null }));
    void persistAnswer(questionId, null);
  };

  const toggleBookmark = async (questionId: string) => {
    if (!attemptId || !controllerToken || monitor.interactionLocked) return;
    try {
      const { data } = await supabase.rpc('toggle_bookmark', { p_attempt_id: attemptId, p_question_id: questionId, p_controller_token: controllerToken });
      const bookmarked = (data as { bookmarked?: boolean } | null)?.bookmarked;
      setBookmarks((prev) => {
        const next = new Set(prev);
        if (bookmarked) next.add(questionId);
        else next.delete(questionId);
        return next;
      });
    } catch {
      // ignore
    }
  };

  const retryAllFailed = () => {
    if (!online) return;
    for (const questionId of Object.keys(saveStates)) {
      if (saveStates[questionId] === 'error') {
        const ans = answers[questionId];
        if (ans) void persistAnswer(questionId, ans);
        else void clearAnswer(questionId);
      }
    }
  };

  const flushPendingSaves = useCallback(async (): Promise<boolean> => {
    const promises = Object.values(latestSaveRef.current);
    if (promises.length === 0) return true;
    const results = await Promise.all(promises);
    return results.every(Boolean);
  }, []);

  const saveCurrentBeforeNavigation = useCallback(async (): Promise<boolean> => {
    const question = payload?.questions[current];
    if (!question || navigating) return false;
    setNavigating(true);
    try {
      const pendingSaved = await flushPendingSaves();
      if (!pendingSaved) return false;
      if (saveStates[question.id] === 'error') return false;
      if (!saveStates[question.id] && answers[question.id]) {
        return await persistAnswer(question.id, answers[question.id]);
      }
      return true;
    } finally {
      setNavigating(false);
    }
  }, [answers, current, flushPendingSaves, navigating, payload?.questions, persistAnswer, saveStates]);

  const moveToAdjacentQuestion = useCallback(async (target: number) => {
    const bounded = Math.max(0, Math.min(target, (payload?.questions.length ?? 1) - 1));
    const targetQuestion = payload?.questions[bounded];
    if (!targetQuestion) return;
    if (Math.abs(bounded - current) !== 1 || !(await saveCurrentBeforeNavigation())) return;
    setVisited((prev) => new Set(prev).add(targetQuestion.id));
    setCurrent(bounded);
  }, [current, payload?.questions, saveCurrentBeforeNavigation]);

  // --- Manual submit ------------------------------------------------------
  const confirmSubmit = async () => {
    if (!attemptId || !controllerToken) return;
    setFinalizing(true);
    try {
      if (!(await flushPendingSaves())) {
        setFinalizing(false);
        setShowSubmit(false);
        setError('Some answers could not be saved. Retry them before submitting.');
        return;
      }
      await submitAttempt(attemptId, controllerToken);
      finalizedRef.current = true;
      goToResult(attemptId);
    } catch (err) {
      setFinalizing(false);
      setShowSubmit(false);
      setError(errorMessage(err));
    }
  };

  const questions = useMemo(() => payload?.questions ?? [], [payload]);
  const answeredCount = useMemo(
    () => questions.filter((q) => answers[q.id] !== null && answers[q.id] !== undefined && answers[q.id] !== '').length,
    [questions, answers],
  );
  const saveSummary = useMemo(() => {
    const states = Object.values(saveStates);
    if (states.includes('saving')) return 'Saving…';
    if (states.includes('error')) return 'Not saved';
    return 'Saved';
  }, [saveStates]);

  if (blocked) {
    return (
      <div className="narrow mt-3">
        <Card>
          <h1>Attempt unavailable</h1>
          <Alert tone="warning" role="alert">{blocked}</Alert>
          <p className="muted">
            Only one tab or device may hold an active attempt. Close other sessions and retry.
            Recovery is possible once the previous session's lease expires.
          </p>
          <Button variant="primary" onClick={() => window.location.reload()}>
            Retry
          </Button>
        </Card>
      </div>
    );
  }

  if (error && !payload) {
    return (
      <div className="narrow mt-3">
        <Alert tone="danger" role="alert">{error}</Alert>
      </div>
    );
  }

  if (!payload || !attemptId) {
    return <PageSpinner />;
  }

  const question = questions[current];
  const lowTime = remaining <= 60_000;

  return (
    <div className="exam-shell" ref={examShellRef}>
      <div className="exam-topbar">
        <div>
          <strong>{payload.exam.title}</strong>
          <div className="small muted">
            Question {current + 1} of {questions.length} · {answeredCount} answered
          </div>
          {monitoringMode === 'fallback' ? (
            <span className="badge">Focused layout · fullscreen unavailable</span>
          ) : null}
        </div>
        <div className="row">
          <span className={`exam-timer ${lowTime ? 'low' : ''}`} aria-live="polite">
            {formatDuration(remaining)}
          </span>
          <span className="badge badge-warning">
            Warnings {monitor.violationCount} / {monitor.threshold}
          </span>
          <span className={`badge ${saveSummary === 'Saved' ? 'badge-success' : saveSummary === 'Not saved' ? 'badge-danger' : ''}`}>
            {saveSummary}
          </span>
          <Button
            variant="primary"
            size="sm"
            onClick={async () => {
              if (await saveCurrentBeforeNavigation()) setShowSubmit(true);
            }}
            disabled={navigating || monitor.interactionLocked || !online}
          >
            Submit exam
          </Button>
        </div>
      </div>

      {monitoringMode === 'fallback' ? (
        <div className="exam-layout">
          <Alert tone="info" role="status">
            <strong>Fullscreen is unavailable.</strong> {FULLSCREEN_FALLBACK_MESSAGE}
          </Alert>
        </div>
      ) : null}
      {monitoringMode === 'fullscreen' && !fullscreenActive ? (
        <div className="exam-layout">
          <Alert tone="warning" role="status">
            Fullscreen is off. Return to fullscreen to keep the full monitoring policy active.{' '}
            <Button
              size="sm"
              onClick={() => {
                void requestExamFullscreen().then((result) => {
                  if (!result.ok) {
                    // The device cannot honour fullscreen right now. Continue
                    // monitoring visibility/focus; this is not a violation and
                    // recovery can still complete in the focused layout.
                    setMonitoringMode('fallback');
                    if (attemptId) setAttemptMonitoringMode(attemptId, 'fallback');
                  }
                });
              }}
            >
              Return to fullscreen
            </Button>
          </Alert>
        </div>
      ) : null}
      {!online ? (
        <div className="exam-layout">
          <Alert tone="warning" role="alert">
            You are offline. Answering is frozen until the connection returns. Only answers already
            saved to the server count toward your score.
          </Alert>
        </div>
      ) : null}
      {monitor.pendingSubmission ? (
        <div className="exam-layout">
          <Alert tone="danger" role="alert">
            Submission pending — reconnect to confirm. Do not close this window.
          </Alert>
        </div>
      ) : null}
      {monitor.crossTabBlocked ? (
        <div className="exam-layout">
          <Alert tone="warning" role="alert">
            This attempt is open in another tab in this browser. Answering is paused here to avoid
            conflicting saves. Keep one tab open and reload this one before continuing.
          </Alert>
        </div>
      ) : null}
      {monitor.lastError && !monitor.pendingSubmission ? (
        <div className="exam-layout">
          <Alert tone="warning">{monitor.lastError}</Alert>
        </div>
      ) : null}

      <div className="exam-layout">
        <div>
          {question ? (
            <div className="question-card">
              <div className="row-between">
                <span className="badge badge-info">
                  Q{current + 1} · {question.points} point(s)
                </span>
                <div className="row" style={{ gap: 8 }}>
                  <Button size="sm" variant="ghost" onClick={() => void toggleBookmark(question.id)}>
                    {bookmarks.has(question.id) ? '★ Unmark' : '☆ Mark for review'}
                  </Button>
                  {answers[question.id] ? (
                    <Button size="sm" variant="ghost" onClick={() => clearAnswer(question.id)} disabled={monitor.interactionLocked || !online}>
                      Clear answer
                    </Button>
                  ) : null}
                </div>
              </div>
              <h2 className="mt-2">{question.prompt}</h2>
              <fieldset
                disabled={monitor.interactionLocked || !online}
                style={{ border: 'none', padding: 0, margin: 0 }}
              >
                <legend className="sr-only">Choose one answer</legend>
                {question.options.map((option) => (
                  <label
                    key={option.id}
                    className={`choice ${answers[question.id] === option.id ? 'selected' : ''}`}
                  >
                    <input
                      type="radio"
                      name={`q-${question.id}`}
                      checked={answers[question.id] === option.id}
                      onChange={() => selectOption(question.id, option.id)}
                    />
                    <span>{option.label}</span>
                  </label>
                ))}
              </fieldset>
              <div className="row-between mt-2">
                <Button
                  onClick={() => void moveToAdjacentQuestion(current - 1)}
                  disabled={current === 0 || navigating || saveStates[question.id] === 'saving'}
                >
                  ← Previous
                </Button>
                {saveStates[question.id] === 'error' ? (
                  <span className="small" style={{ color: 'var(--danger)' }}>
                    Not saved.{' '}
                    <button className="btn btn-ghost btn-sm" onClick={retryAllFailed}>
                      Retry
                    </button>
                  </span>
                ) : (
                  <span className="small muted">
                    {saveStates[question.id] === 'saving' ? 'Saving…' : 'Saved to server'}
                  </span>
                )}
                {current >= questions.length - 1 ? (
                  <Button
                    variant="primary"
                    onClick={async () => {
                      if (await saveCurrentBeforeNavigation()) setShowSubmit(true);
                    }}
                    disabled={navigating || saveStates[question.id] === 'saving' || monitor.interactionLocked || !online}
                  >
                    Submit exam
                  </Button>
                ) : (
                  <Button
                    variant="primary"
                    onClick={() => void moveToAdjacentQuestion(current + 1)}
                    disabled={navigating || saveStates[question.id] === 'saving' || monitor.interactionLocked || !online}
                  >
                    Next →
                  </Button>
                )}
              </div>
            </div>
          ) : (
            <Alert tone="danger">This attempt has no questions.</Alert>
          )}
        </div>

        <aside className="q-nav">
          <Card>
            <h3>Questions</h3>
            <div className="small muted mb-2">
              Progress: {answeredCount}/{questions.length} answered
            </div>
            <div className="progress-bar mb-2" aria-label="Progress">
              <div className="progress-bar-fill" style={{ width: `${questions.length ? (answeredCount / questions.length) * 100 : 0}%` }} />
            </div>
            <div className="q-grid" aria-label="Question status">
              {questions.map((q, index) => (
                <span
                  key={q.id}
                  className={`q-dot ${answers[q.id] ? 'answered' : ''} ${index === current ? 'current' : ''} ${bookmarks.has(q.id) ? 'bookmarked' : ''} ${visited.has(q.id) ? 'visited' : ''}`}
                  aria-label={`Question ${index + 1}${answers[q.id] ? ', answered' : ', unanswered'}${bookmarks.has(q.id) ? ', marked for review' : ''}${index === current ? ', current' : ''}`}
                >
                  {index + 1}
                </span>
              ))}
            </div>
            <div className="mt-2 small muted">
              <div>★ {bookmarks.size} bookmarked · {questions.length - answeredCount} unanswered</div>
              {bookmarks.size ? <div>Marked questions: {questions.flatMap((q, index) => bookmarks.has(q.id) ? [index + 1] : []).join(', ')}</div> : null}
              <div>Use Previous and Next to move between questions.</div>
              <div>Answering every question does not submit the exam.</div>
            </div>
          </Card>
        </aside>
      </div>

      {monitor.warningVisible ? (
        <div className="warning-overlay" role="alertdialog" aria-modal="true">
          <div className="warning-box">
            <h2>Warning {monitor.violationCount} of {monitor.threshold}</h2>
            <p>
              Leaving the exam again will automatically submit your answers. Answering is paused
              until you acknowledge this warning
              {monitoringMode === 'fullscreen' ? ' and return to fullscreen' : ''}.
            </p>
            <div className="row">
              <Button
                variant="primary"
                onClick={async () => {
                  if (monitoringMode === 'fullscreen' && !isFullscreenActive()) {
                    const requested = await requestExamFullscreen();
                    if (!requested.ok) {
                      // Do not trap the student: unavailable fullscreen is a
                      // fallback, never a violation or a recovery blocker.
                      setMonitoringMode('fallback');
                      if (attemptId) setAttemptMonitoringMode(attemptId, 'fallback');
                    }
                  }
                  monitor.acknowledgeWarning();
                }}
              >
                I understand — continue exam
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {showSubmit ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal">
            <h2>Submit exam</h2>
            <p>
              You have answered {answeredCount} of {questions.length} questions. Unanswered
              questions receive zero.
            </p>
            <p>{bookmarks.size} question(s) are marked for review.</p>
            {answeredCount < questions.length ? (
              <Alert tone="warning">
                {questions.length - answeredCount} unanswered question(s) remain.
              </Alert>
            ) : null}
            {saveSummary === 'Not saved' ? (
              <Alert tone="danger">
                Some answers are not saved. Retry before submitting; only server-saved answers
                count.
              </Alert>
            ) : null}
            <p className="muted small">
              This produces a final, immutable score. It cannot be reopened or regraded.
            </p>
            <div className="row-between">
              <Button onClick={() => setShowSubmit(false)} disabled={finalizing}>
                Cancel
              </Button>
              <Button variant="danger" onClick={() => void confirmSubmit()} disabled={finalizing}>
                {finalizing ? 'Submitting…' : 'Confirm final submission'}
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {finalizing ? (
        <div className="warning-overlay">
          <div className="warning-box center">
            <Spinner label="Finalizing your attempt…" />
          </div>
        </div>
      ) : null}
    </div>
  );
}
