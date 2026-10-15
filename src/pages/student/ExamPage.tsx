import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useBlocker, useNavigate, useParams } from 'react-router-dom';
import {
  acquireAttemptController,
  getAttemptPayload,
  saveAnswer,
  submitAttempt,
} from '../../features/attempts/api';
import {
  getAttemptIdForExam,
  getControllerToken,
  setControllerToken,
} from '../../features/attempts/storage';
import { useExamMonitor } from '../../features/monitoring/useExamMonitor';
import type { AttemptPayload } from '../../features/attempts/types';
import { Alert, Button, Card, PageSpinner, Spinner } from '../../components/ui';
import { ThemeToggle } from '../../components/ThemeToggle';
import { errorMessage } from '../../lib/errors';
import { formatDuration, remainingMs } from '../../lib/format';

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
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [saveStates, setSaveStates] = useState<Record<string, SaveState>>({});
  const [showSubmit, setShowSubmit] = useState(false);
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine);

  const revisionRef = useRef<Record<string, number>>({});
  const requestRef = useRef<Record<string, string>>({});
  const finalizedRef = useRef(false);
  const [finalizing, setFinalizing] = useState(false);

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

        const data = await getAttemptPayload(storedAttempt);
        if (!active) return;
        if (data.attempt.state === 'submitted') {
          navigate(`/student/attempts/${storedAttempt}/result`, { replace: true });
          return;
        }
        setPayload(data);
        const initial: Record<string, string> = {};
        for (const q of data.questions) {
          if (q.saved_option_id) initial[q.id] = q.saved_option_id;
        }
        setAnswers(initial);
        const states: Record<string, SaveState> = {};
        for (const q of data.questions) if (q.saved_option_id) states[q.id] = 'saved';
        setSaveStates(states);
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
    onViolation,
  });

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

  // --- Answer saving ------------------------------------------------------
  const persistAnswer = useCallback(
    async (questionId: string, optionId: string) => {
      if (!attemptId || !controllerToken) return;
      const revision = (revisionRef.current[questionId] ?? 0) + 1;
      revisionRef.current[questionId] = revision;
      const requestId = requestRef.current[questionId] ?? crypto.randomUUID();
      requestRef.current[questionId] = requestId;

      setSaveStates((prev) => ({ ...prev, [questionId]: 'saving' }));
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
            return;
          }
          if (result.reason === 'controller') {
            setBlocked('This attempt became active in another session.');
            return;
          }
          // 'stale' is a safe no-op (an older revision lost the race).
        }
        setSaveStates((prev) => ({ ...prev, [questionId]: 'saved' }));
      } catch {
        setSaveStates((prev) => ({ ...prev, [questionId]: 'error' }));
      }
    },
    [attemptId, controllerToken, goToResult],
  );

  const selectOption = (questionId: string, optionId: string) => {
    if (monitor.interactionLocked || !online) return;
    setAnswers((prev) => ({ ...prev, [questionId]: optionId }));
    void persistAnswer(questionId, optionId);
  };

  const retryAllFailed = () => {
    if (!online) return;
    for (const questionId of Object.keys(saveStates)) {
      if (saveStates[questionId] === 'error' && answers[questionId]) {
        void persistAnswer(questionId, answers[questionId]);
      }
    }
  };

  // --- Manual submit ------------------------------------------------------
  const confirmSubmit = async () => {
    if (!attemptId || !controllerToken) return;
    setFinalizing(true);
    try {
      await submitAttempt(attemptId, controllerToken);
      goToResult(attemptId);
    } catch (err) {
      setError(errorMessage(err));
      setFinalizing(false);
    }
  };

  const questions = useMemo(() => payload?.questions ?? [], [payload]);
  const answeredCount = useMemo(
    () => questions.filter((q) => answers[q.id]).length,
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
    <div className="exam-shell">
      <div className="exam-topbar">
        <div>
          <strong>{payload.exam.title}</strong>
          <div className="small muted">
            Question {current + 1} of {questions.length} · {answeredCount} answered
          </div>
        </div>
        <div className="row">
          <ThemeToggle />
          <span className={`exam-timer ${lowTime ? 'low' : ''}`} aria-live="polite">
            {formatDuration(remaining)}
          </span>
          <span className="badge badge-warning">
            Warnings {monitor.violationCount} / {monitor.threshold}
          </span>
          <span className={`badge ${saveSummary === 'Saved' ? 'badge-success' : saveSummary === 'Not saved' ? 'badge-danger' : ''}`}>
            {saveSummary}
          </span>
          <Button variant="primary" size="sm" onClick={() => setShowSubmit(true)}>
            Submit exam
          </Button>
        </div>
      </div>

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
                  onClick={() => setCurrent((i) => Math.max(0, i - 1))}
                  disabled={current === 0}
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
                <Button
                  variant="primary"
                  onClick={() => setCurrent((i) => Math.min(questions.length - 1, i + 1))}
                  disabled={current >= questions.length - 1}
                >
                  Next →
                </Button>
              </div>
            </div>
          ) : (
            <Alert tone="danger">This attempt has no questions.</Alert>
          )}
        </div>

        <aside className="q-nav">
          <Card>
            <h3>Questions</h3>
            <div className="q-grid">
              {questions.map((q, index) => (
                <button
                  key={q.id}
                  className={`q-dot ${answers[q.id] ? 'answered' : ''} ${index === current ? 'current' : ''}`}
                  onClick={() => setCurrent(index)}
                  aria-label={`Go to question ${index + 1}${answers[q.id] ? ', answered' : ''}`}
                >
                  {index + 1}
                </button>
              ))}
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
              until you acknowledge this warning and return to fullscreen.
            </p>
            <div className="row">
              <Button
                variant="primary"
                onClick={async () => {
                  if (!document.fullscreenElement) {
                    try {
                      await document.documentElement.requestFullscreen();
                    } catch {
                      /* requires a user gesture; the click provides it */
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
