import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useBlocker } from 'react-router-dom';
import { useAsync } from '../../lib/useAsync';
import {
  acquireAttemptController,
  getAttemptPayload,
  getMyExamAttempts,
  saveAnswer,
  submitAttempt,
} from '../../features/attempts/api';
import {
  getAttemptIdForExam,
  getControllerToken,
  setAttemptIdForExam,
  setControllerToken,
  type AttemptMonitoringMode,
} from '../../features/attempts/storage';
import { useExamMonitor } from '../../features/monitoring/useExamMonitor';
import { Alert, Button, Card, PageSpinner, Spinner } from '../../components/ui';
import { errorMessage } from '../../lib/errors';
import { remainingMs } from '../../lib/format';
import { formatDuration } from '../../lib/format';
import {
  FULLSCREEN_FALLBACK_MESSAGE,
  isFullscreenActive,
  requestExamFullscreen,
} from '../../features/exam/fullscreen';
import { supabase } from '../../lib/supabase';
import { QuestionJumpPanel } from './components/QuestionJumpPanel';
import { useToasts } from '../../components/toast/ToastProvider';
import type { AttemptPayload } from '../../features/attempts/types';

function isEditableExamTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return true;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'BUTTON' || tag === 'A';
}

function isBlockedExamShortcut(event: KeyboardEvent) {
  const key = event.key.toLowerCase();
  if ((event.ctrlKey || event.metaKey) && ['a', 'c', 'x', 's', 'p'].includes(key)) return true;
  if (event.key === 'PrintScreen') return true;
  return false;
}

export function ExamPage() {
  const { examId = '' } = useParams();
  const navigate = useNavigate();
  const { toast } = useToasts();
  const examShellRef = useRef<HTMLDivElement>(null);
  const finalizedRef = useRef(false);
  const revisionRef = useRef<Record<string, number>>({});
  const latestSaveRef = useRef<Record<string, Promise<boolean>>>({});

  const [attemptId, setAttemptId] = useState<string | null>(() => getAttemptIdForExam(examId));
  const [controllerToken, setControllerTokenState] = useState<string | null>(() => {
    const id = getAttemptIdForExam(examId);
    return id ? getControllerToken(id) : null;
  });
  const [blocked, setBlocked] = useState<string | null>(null);
  const [payload, setPayload] = useState<Awaited<ReturnType<typeof getAttemptPayload>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [current, setCurrent] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string | null>>({});
  const [visited, setVisited] = useState<Set<string>>(new Set());
  const [bookmarks, setBookmarks] = useState<Set<string>>(new Set());
  const [saveStates, setSaveStates] = useState<Record<string, 'saving' | 'saved' | 'error'>>({});
  const [monitoringMode, setMonitoringMode] = useState<AttemptMonitoringMode>('fullscreen');
  const [fullscreenActive, setFullscreenActive] = useState(() => isFullscreenActive());
  const [online, setOnline] = useState(() => navigator.onLine);
  const [showSubmit, setShowSubmit] = useState(false);
  const [finalizing, setFinalizing] = useState(false);
  const [navigating, setNavigating] = useState(false);
  const [showBookmarks, setShowBookmarks] = useState(false);
  const [showUnanswered, setShowUnanswered] = useState(false);

  const data = useAsync(async () => {
    let id = attemptId;
    let token = controllerToken;
    if (!id) throw new Error('No active attempt found for this exam.');
    if (!token) throw new Error('Missing attempt controller token.');
    const attempts = await getMyExamAttempts(examId).catch(() => null);
    const activeId = attempts?.active_attempt_id ?? id;
    const activeToken = attempts?.active_attempt_id ? getControllerToken(activeId) : token;
    if (!activeId || !activeToken) throw new Error('No active attempt found for this exam.');
    if (activeId !== id) {
      setAttemptId(activeId);
      setControllerTokenState(activeToken);
      setAttemptIdForExam(examId, activeId);
      setControllerToken(activeId, activeToken);
      id = activeId;
      token = activeToken;
    }
    const acquired = await acquireAttemptController(id, token);
    if (acquired.state === 'submitted') {
      finalizedRef.current = true;
      navigate(`/student/attempts/${id}/result`, { replace: true });
      return null;
    }
    if ((acquired as { error?: string }).error === 'controller') {
      setBlocked('This attempt became active in another session.');
      return null;
    }
    const attemptPayload = await getAttemptPayload(id);
    const storedMode =
      (localStorage.getItem(`ace-monitor-mode-${id}`) as AttemptMonitoringMode | null) ?? null;
    const mode =
      storedMode ?? (document.fullscreenElement || (document as Document & { webkitFullscreenElement?: Element | null }).webkitFullscreenElement ? 'fullscreen' : 'fallback');
    setMonitoringMode(mode);
    return { payload: attemptPayload, attemptId: id, controllerToken: token, mode };
  }, [examId]);

  useEffect(() => {
    if (!data.data) return;
    const p = data.data.payload;
    setPayload(p);
    const nextAnswers: Record<string, string | null> = {};
    for (const q of p.questions) nextAnswers[q.id] = null;
    for (const a of ((p as AttemptPayload & { answers?: Array<{question_id:string; selected_option_id:string|null}> }).answers ?? [])) nextAnswers[a.question_id] = a.selected_option_id ?? null;
    setAnswers(nextAnswers);
    setVisited(new Set(p.questions.slice(0, 1).map((q) => q.id)));
    setCurrent(0);
  }, [data.data]);

  const monitor = useExamMonitor({
    attemptId: payload?.attempt.id ?? null,
    controllerToken: controllerToken,
    initialViolationCount: payload?.attempt.violation_count ?? 0,
    enabled: Boolean(payload) && !finalizedRef.current,
    fullscreenRequired: monitoringMode === 'fullscreen',
  });

  useEffect(() => {
    const onChange = () => setFullscreenActive(isFullscreenActive());
    document.addEventListener('fullscreenchange', onChange);
    document.addEventListener('webkitfullscreenchange', onChange);
    return () => {
      document.removeEventListener('fullscreenchange', onChange);
      document.removeEventListener('webkitfullscreenchange', onChange);
    };
  }, []);

  // Online/offline
  useEffect(() => {
    const up = () => { setOnline(true); void monitor.flushPending(); };
    const down = () => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => { window.removeEventListener('online', up); window.removeEventListener('offline', down); };
  }, [monitor]);

  // Heartbeat already handled by monitor; ensure we don't duplicate; keep as-is

  // Countdown
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const remaining = payload ? remainingMs(payload.attempt.deadline_at, now) : 0;

  const exitFullscreenIfOwned = useCallback(async () => {
    try {
      if (document.fullscreenElement && document.exitFullscreen) {
        await document.exitFullscreen();
      } else if ((document as Document & { webkitFullscreenElement?: Element | null; webkitExitFullscreen?: () => Promise<void> | void }).webkitFullscreenElement && (document as Document & { webkitExitFullscreen?: () => Promise<void> | void }).webkitExitFullscreen) {
        await (document as Document & { webkitExitFullscreen?: () => Promise<void> | void }).webkitExitFullscreen?.();
      }
    } catch {
      // graceful
    }
  }, []);

  const goToResult = useCallback(
    async (id: string) => {
      if (finalizedRef.current && window.location.pathname.includes(id)) return;
      finalizedRef.current = true;
      await exitFullscreenIfOwned();
      navigate(`/student/attempts/${id}/result`, { replace: true });
    },
    [navigate, exitFullscreenIfOwned],
  );

  // Deadline expiry
  useEffect(() => {
    if (!payload || !attemptId || !controllerToken) return;
    if (remaining > 0 || finalizedRef.current) return;
    (async () => {
      try {
        await submitAttempt(attemptId, controllerToken);
      } catch {
        // ignore
      } finally {
        await goToResult(attemptId);
      }
    })();
  }, [remaining, payload, attemptId, controllerToken, goToResult]);

  // Violation finalization
  useEffect(() => {
    if (monitor.isFinalized && attemptId && !finalizedRef.current) {
      void goToResult(attemptId);
    }
  }, [monitor.isFinalized, attemptId, goToResult]);

  // Navigation guard
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

  // Unload warning
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

  // Exam restrictions
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

  // Answer saving
  const persistAnswer = useCallback(
    async (questionId: string, optionId: string | null): Promise<boolean> => {
      if (!attemptId || !controllerToken || finalizedRef.current) return false;
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
              void goToResult(attemptId);
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
            }
            return false;
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
    if (monitor.interactionLocked || !online || finalizedRef.current) return;
    setAnswers((prev) => ({ ...prev, [questionId]: optionId }));
    setVisited((prev) => new Set(prev).add(questionId));
    void persistAnswer(questionId, optionId);
  };

  const clearAnswer = (questionId: string) => {
    if (monitor.interactionLocked || !online || finalizedRef.current) return;
    setAnswers((prev) => ({ ...prev, [questionId]: null }));
    void persistAnswer(questionId, null);
  };

  const toggleBookmark = async (questionId: string) => {
    if (!attemptId || !controllerToken || monitor.interactionLocked || finalizedRef.current) return;
    try {
      const { data } = await supabase.rpc('toggle_bookmark', {
        p_attempt_id: attemptId,
        p_question_id: questionId,
        p_controller_token: controllerToken,
      });
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
    if (!online || finalizedRef.current) return;
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
    if (!question || navigating || finalizedRef.current) return false;
    setNavigating(true);
    try {
      const pendingSaved = await flushPendingSaves();
      if (!pendingSaved) {
        toast({ tone: 'error', message: 'Some answers could not be saved. Retry them before navigating.' });
        return false;
      }
      if (saveStates[question.id] === 'error') {
        toast({ tone: 'error', message: 'Current answer not saved. Retry before moving to another question.' });
        return false;
      }
      if (!saveStates[question.id] && answers[question.id]) {
        const ok = await persistAnswer(question.id, answers[question.id]);
        if (!ok) {
          toast({ tone: 'error', message: 'Failed to save answer. Retry before navigating.' });
          return false;
        }
        return true;
      }
      return true;
    } finally {
      setNavigating(false);
    }
  }, [answers, current, flushPendingSaves, navigating, payload?.questions, persistAnswer, saveStates, toast]);

  const moveToAdjacentQuestion = useCallback(
    async (target: number) => {
      if (finalizedRef.current) return;
      const bounded = Math.max(0, Math.min(target, (payload?.questions.length ?? 1) - 1));
      const targetQuestion = payload?.questions[bounded];
      if (!targetQuestion) return;
      if (Math.abs(bounded - current) !== 1 || !(await saveCurrentBeforeNavigation())) return;
      setVisited((prev) => new Set(prev).add(targetQuestion.id));
      setCurrent(bounded);
    },
    [current, payload?.questions, saveCurrentBeforeNavigation],
  );

  const jumpToQuestion = useCallback(
    async (targetIndex: number) => {
      if (finalizedRef.current) return;
      if (!(await saveCurrentBeforeNavigation())) return;
      const targetQuestion = payload?.questions[targetIndex];
      if (!targetQuestion) return;
      setVisited((prev) => new Set(prev).add(targetQuestion.id));
      setCurrent(targetIndex);
      setShowBookmarks(false);
      setShowUnanswered(false);
    },
    [payload?.questions, saveCurrentBeforeNavigation],
  );

  const confirmSubmit = async () => {
    if (!attemptId || !controllerToken || finalizedRef.current) return;
    setFinalizing(true);
    try {
      if (!(await flushPendingSaves())) {
        setFinalizing(false);
        setShowSubmit(false);
        setError('Some answers could not be saved. Retry them before submitting.');
        toast({ tone: 'error', message: 'Some answers could not be saved. Retry before submitting.' });
        return;
      }
      if (saveStates[payload?.questions[current]?.id ?? ''] === 'error') {
        setFinalizing(false);
        setShowSubmit(false);
        setError('Current answer is not saved. Retry before submitting.');
        toast({ tone: 'error', message: 'Current answer not saved. Retry before submitting.' });
        return;
      }
      await submitAttempt(attemptId, controllerToken);
      finalizedRef.current = true;
      await goToResult(attemptId);
    } catch (err) {
      setFinalizing(false);
      // keep dialog open? requirement says keep dialog open with helpful message if submission fails
      setError(errorMessage(err));
      toast({ tone: 'error', message: 'Submission failed. Try again.' });
    }
  };

  const questions = useMemo(() => payload?.questions ?? [], [payload]);
  const answeredCount = useMemo(
    () => questions.filter((q) => answers[q.id] !== null && answers[q.id] !== undefined && answers[q.id] !== '').length,
    [questions, answers],
  );
  const unansweredCount = questions.length - answeredCount;
  const unansweredItems = useMemo(
    () =>
      questions
        .map((q, idx) => ({ q, idx }))
        .filter(({ q }) => answers[q.id] === null || answers[q.id] === undefined || answers[q.id] === '')
        .map(({ q, idx }) => ({ id: q.id, index: idx, preview: q.prompt.slice(0, 80), answered: false })),
    [questions, answers],
  );
  const bookmarkedItems = useMemo(
    () =>
      questions
        .map((q, idx) => ({ q, idx }))
        .filter(({ q }) => bookmarks.has(q.id))
        .map(({ q, idx }) => ({ id: q.id, index: idx, preview: q.prompt.slice(0, 80), answered: answers[q.id] !== null && answers[q.id] !== undefined && answers[q.id] !== '' })),
    [questions, bookmarks, answers],
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
    <div className="exam-shell" ref={examShellRef} id="exam-root">
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
          <Button variant="ghost" size="sm" onClick={() => setShowBookmarks(true)}>
            Marked for review ({bookmarks.size})
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setShowUnanswered(true)}>
            Unanswered ({unansweredCount})
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={async () => {
              if (await saveCurrentBeforeNavigation()) setShowSubmit(true);
            }}
            disabled={navigating || monitor.interactionLocked || !online || finalizedRef.current}
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
                    setMonitoringMode('fallback');
                    if (attemptId) localStorage.setItem(`ace-monitor-mode-${attemptId}`, 'fallback');
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
            You are offline. Answering is frozen until the connection returns. Only answers already saved to the server count toward your score.
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
            This attempt is open in another tab in this browser. Answering is paused here to avoid conflicting saves. Keep one tab open and reload this one before continuing.
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
                  <Button size="sm" variant="ghost" onClick={() => void toggleBookmark(question.id)} disabled={monitor.interactionLocked || finalizedRef.current}>
                    {bookmarks.has(question.id) ? '★ Unmark' : '☆ Mark for review'}
                  </Button>
                  {answers[question.id] ? (
                    <Button size="sm" variant="ghost" onClick={() => clearAnswer(question.id)} disabled={monitor.interactionLocked || !online || finalizedRef.current}>
                      Clear answer
                    </Button>
                  ) : null}
                </div>
              </div>
              <h2 className="mt-2">{question.prompt}</h2>
              <fieldset disabled={monitor.interactionLocked || !online || finalizedRef.current} style={{ border: 'none', padding: 0, margin: 0 }}>
                <legend className="sr-only">Choose one answer</legend>
                {question.options.map((option) => (
                  <label key={option.id} className={`choice ${answers[question.id] === option.id ? 'selected' : ''}`}>
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
                <Button onClick={() => void moveToAdjacentQuestion(current - 1)} disabled={current === 0 || navigating || saveStates[question.id] === 'saving' || finalizedRef.current}>
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
                    {saveStates[question.id] === 'saving' ? 'Saving…' : saveStates[question.id] === 'saved' ? 'Saved to server' : ' '}
                  </span>
                )}
                {current >= questions.length - 1 ? (
                  <Button
                    variant="primary"
                    onClick={async () => {
                      if (await saveCurrentBeforeNavigation()) setShowSubmit(true);
                    }}
                    disabled={navigating || saveStates[question.id] === 'saving' || monitor.interactionLocked || !online || finalizedRef.current}
                  >
                    Submit exam
                  </Button>
                ) : (
                  <Button
                    variant="primary"
                    onClick={() => void moveToAdjacentQuestion(current + 1)}
                    disabled={navigating || saveStates[question.id] === 'saving' || monitor.interactionLocked || !online || finalizedRef.current}
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
            <div
              className="progress-bar mb-2"
              role="progressbar"
              aria-label="Answered questions"
              aria-valuemin={0}
              aria-valuemax={questions.length}
              aria-valuenow={answeredCount}
              aria-valuetext={`${answeredCount} of ${questions.length} questions answered`}
            >
              <div className="progress-bar-fill" style={{ width: `${questions.length ? (answeredCount / questions.length) * 100 : 0}%` }} />
            </div>
            <div className="q-stats" role="group" aria-label="Question counts">
              <span><strong>{answeredCount}</strong> answered</span>
              <span><strong>{unansweredCount}</strong> unanswered</span>
              <span><strong>{bookmarks.size}</strong> marked</span>
            </div>
            <div className="q-grid" aria-label="Question status (non-clickable grid)">
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
              <div>★ {bookmarks.size} bookmarked · {unansweredCount} unanswered</div>
              <div>Use the Marked for review and Unanswered panels for direct navigation; Previous/Next to move.</div>
            </div>
          </Card>
        </aside>
      </div>

      {monitor.warningVisible ? (
        <div className="warning-overlay" role="alertdialog" aria-modal="true">
          <div className="warning-box">
            <h2>Warning {monitor.violationCount} of {monitor.threshold}</h2>
            <p>
              Leaving the exam again will automatically submit your answers. Answering is paused until you acknowledge this warning
              {monitoringMode === 'fullscreen' ? ' and return to fullscreen' : ''}.
            </p>
            <div className="row">
              <Button
                variant="primary"
                onClick={async () => {
                  if (monitoringMode === 'fullscreen' && !isFullscreenActive()) {
                    const requested = await requestExamFullscreen();
                    if (!requested.ok) {
                      setMonitoringMode('fallback');
                      if (attemptId) localStorage.setItem(`ace-monitor-mode-${attemptId}`, 'fallback');
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
            <h2>Finish Examination</h2>
            <p>You have answered {answeredCount} of {questions.length} questions. Unanswered questions receive zero.</p>
            <div className="row" style={{ gap: 12 }}>
              <span><strong>{answeredCount}</strong> answered</span>
              <span><strong>{unansweredCount}</strong> unanswered</span>
              <span><strong>{bookmarks.size}</strong> marked for review</span>
            </div>
            {unansweredCount > 0 ? (
              <Alert tone="info">
                {unansweredCount} unanswered question(s) remain.{' '}
                <Button size="sm" variant="ghost" onClick={() => { setShowSubmit(false); setShowUnanswered(true); }}>Review unanswered</Button>
              </Alert>
            ) : null}
            {saveSummary === 'Not saved' ? (
              <Alert tone="danger">
                Some answers are not saved. Retry before submitting; only server-saved answers count.
              </Alert>
            ) : null}
            {error ? <Alert tone="danger">{error}</Alert> : null}
            <p className="muted small">Submission is final. This produces a final, immutable score. It cannot be reopened or regraded.</p>
            <div className="row-between">
              <Button onClick={() => { setShowSubmit(false); setError(null); }} disabled={finalizing}>
                Continue exam
              </Button>
              <Button variant="primary" style={{ background: 'var(--success)', borderColor: 'var(--success)', color: 'var(--on-primary)' }} onClick={() => void confirmSubmit()} disabled={finalizing}>
                {finalizing ? 'Submitting…' : 'Submit exam'}
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

      {showBookmarks ? (
        <QuestionJumpPanel
          title={`Marked for review (${bookmarks.size})`}
          items={bookmarkedItems}
          onJump={jumpToQuestion}
          onUnmark={(qid) => { void toggleBookmark(qid); }}
          showUnmark
          emptyText="No questions are marked for review."
          onClose={() => setShowBookmarks(false)}
        />
      ) : null}

      {showUnanswered ? (
        <QuestionJumpPanel
          title={`Unanswered (${unansweredCount})`}
          items={unansweredItems}
          onJump={jumpToQuestion}
          emptyText="All questions have been answered."
          onClose={() => setShowUnanswered(false)}
        />
      ) : null}
    </div>
  );
}
// Note: bookmarks loaded via toggle/get_bookmarks if needed; current implementation uses local state + toggle
