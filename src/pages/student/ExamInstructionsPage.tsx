import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAsync } from '../../lib/useAsync';
import { getExamVersion, getStudentExam } from '../../features/exams/api';
import { getMyExamAttempts, startAttempt } from '../../features/attempts/api';
import {
  getAttemptIdForExam,
  getControllerToken,
  setAttemptIdForExam,
  setAttemptMonitoringMode,
  setControllerToken,
  type AttemptMonitoringMode,
} from '../../features/attempts/storage';
import {
  detectFullscreenCapability,
  FULLSCREEN_FALLBACK_MESSAGE,
  requestExamFullscreen,
} from '../../features/exam/fullscreen';
import { Alert, Button, Card, PageSpinner } from '../../components/ui';
import { errorMessage } from '../../lib/errors';
import { formatDateTimeWithZone } from '../../lib/format';
import { examAvailability } from '../../lib/datetime';

export function ExamInstructionsPage() {
  const { examId = '' } = useParams();
  const navigate = useNavigate();
  const [acknowledged, setAcknowledged] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const data = useAsync(async () => {
    const exam = await getStudentExam(examId);
    const version = exam?.current_version_id
      ? await getExamVersion(exam.current_version_id)
      : null;
    const attempts = exam ? await getMyExamAttempts(examId) : null;
    return { exam, version, attempts };
  }, [examId]);

  if (data.loading) return <PageSpinner />;
  if (data.error) return <Alert tone="danger" role="alert">{data.error}</Alert>;
  if (!data.data?.exam) return <Alert tone="warning">Exam not available.</Alert>;

  const { exam, version, attempts } = data.data;
  const availability = examAvailability(exam.opens_at, exam.closes_at);
  const resumedAttemptId = attempts?.active_attempt_id ?? getAttemptIdForExam(examId);
  const maxAttempts = attempts?.max_attempts ?? exam.max_attempts ?? 1;
  const usedAttempts = attempts?.used ?? 0;
  const remainingAttempts = Math.max(maxAttempts - usedAttempts, 0);
  const resultPolicy = attempts?.result_policy ?? exam.result_policy ?? 'latest';
  const attemptsExhausted = remainingAttempts === 0 && !resumedAttemptId;
  const fullscreen = detectFullscreenCapability();
  const canRequestFullscreen = fullscreen.supported;

  const begin = async () => {
    setBusy(true);
    setError(null);
    let monitoringMode: AttemptMonitoringMode = 'fallback';
    let enteredFullscreen = false;
    try {
      // Request fullscreen directly from the click/tap gesture when the
      // runtime says it is available. A rejection is not a violation and does
      // not block the exam: it selects the accessible viewport fallback.
      if (canRequestFullscreen) {
        const requested = await requestExamFullscreen();
        enteredFullscreen = requested.ok;
        monitoringMode = requested.ok ? 'fullscreen' : 'fallback';
      }
      // Resuming reuses the stored controller token so the server can confirm
      // this session already holds the lease; a fresh start passes null.
      const currentToken = resumedAttemptId ? getControllerToken(resumedAttemptId) : null;
      const result = await startAttempt(examId, currentToken);
      setAttemptIdForExam(examId, result.attempt_id);
      setControllerToken(result.attempt_id, result.controller_token);
      setAttemptMonitoringMode(result.attempt_id, monitoringMode);
      navigate(`/student/exams/${examId}/take`, { replace: true });
    } catch (err) {
      if (enteredFullscreen && document.fullscreenElement) {
        try {
          await document.exitFullscreen();
        } catch {
          /* best effort only; an unsupported exit is harmless here */
        }
      }
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="narrow stack">
      <Link to="/student" className="small">
        ← Dashboard
      </Link>
      <Card>
        <h1>{exam.title}</h1>
        <p className="muted">
          {exam.course_code} · {exam.course_title}
        </p>

        <div className="table-wrap mt-2 exam-instructions-details">
          <table>
            <tbody>
              <tr>
                <th>Items</th>
                <td>{version?.item_count ?? '—'}</td>
              </tr>
              <tr>
                <th>Duration</th>
                <td>{exam.duration_minutes} minutes</td>
              </tr>
              <tr>
                <th>Availability</th>
                <td className="small">
                  {formatDateTimeWithZone(exam.opens_at)} → {formatDateTimeWithZone(exam.closes_at)}
                </td>
              </tr>
              <tr>
                <th>Attempts</th>
                <td>
                  {maxAttempts === 1
                    ? 'One attempt only'
                    : `${usedAttempts} of ${maxAttempts} attempts used · ${remainingAttempts} remaining`}
                </td>
              </tr>
              {maxAttempts > 1 ? (
                <tr>
                  <th>Multiple attempts</th>
                  <td>
                    {resultPolicy === 'highest'
                      ? 'Your highest score among all attempts is recorded'
                      : 'Your most recent completed attempt is recorded'}
                  </td>
                </tr>
              ) : null}
              <tr>
                <th>Result release</th>
                <td>{exam.result_release === 'immediate' ? 'On submission' : 'After the exam closes'}</td>
              </tr>
            </tbody>
          </table>
        </div>

        {exam.instructions ? (
          <>
            <h2 className="mt-2">Instructions</h2>
            <pre className="instructions">{exam.instructions}</pre>
          </>
        ) : null}

        <Alert tone="warning">
          <h3>Exam rules</h3>
          <ul>
            <li>
              <strong>Two-violation rule:</strong> the first time you leave the exam you receive a
              warning. Leaving a second time automatically submits your saved answers.
            </li>
            <li>
              When the browser supports it, the exam runs in fullscreen. Leaving fullscreen,
              switching tabs, or losing window focus may be recorded as a departure. Where
              fullscreen is unavailable, the exam uses a focused layout and still monitors tab
              and window visibility where the browser reports it.
            </li>
            <li>
              <strong>Final-score rule:</strong> manual submission, time expiry, and the second
              violation all produce a final, immutable score. Nothing can be reopened or regraded.
            </li>
            <li>Only answers saved to the server count toward your score.</li>
          </ul>
        </Alert>

        <Alert tone="info">
          <h3>Browser monitoring limitations</h3>
          <p className="small">
            A web application cannot reliably prevent operating-system app switching, lock your
            device, or prove cheating. Browser events can be suppressed or forged by a modified
            client. Departures are treated as policy flags, not proof of misconduct. Strict device
            lockdown would require a managed kiosk or lockdown browser, which is out of scope. No
            webcam, microphone, or screen recording is used.
          </p>
        </Alert>

        {!canRequestFullscreen ? (
          <Alert tone="info" role="status">
            <strong>Fullscreen is not available in this browser.</strong>{' '}
            {FULLSCREEN_FALLBACK_MESSAGE} You can still start, answer, save, and submit this exam.
          </Alert>
        ) : null}
        {availability === 'upcoming' ? (
          <Alert tone="info" role="status">
            <strong>This exam has not opened yet.</strong> It opens on{' '}
            {formatDateTimeWithZone(exam.opens_at)} and closes on{' '}
            {formatDateTimeWithZone(exam.closes_at)}. The start button unlocks once the opening
            time is reached.
          </Alert>
        ) : null}
        {availability === 'closed' ? (
          <Alert tone="warning" role="status">
            <strong>This exam has closed.</strong> The window ended on{' '}
            {formatDateTimeWithZone(exam.closes_at)}. You can no longer start or resume this exam.
          </Alert>
        ) : null}
        {attemptsExhausted && availability === 'open' ? (
          <Alert tone="warning" role="status">
            <strong>No attempts remaining.</strong> You have used all {maxAttempts} allowed
            attempt{maxAttempts === 1 ? '' : 's'} for this exam. Contact your teacher if you believe
            this is an error.
          </Alert>
        ) : null}
        {error ? <Alert tone="danger" role="alert">{error}</Alert> : null}

        {resumedAttemptId ? (
          <Alert tone="info">
            You have an active attempt in progress. Resuming restores the same timer, saved
            answers, and warning count.
          </Alert>
        ) : null}

        <label className="row mt-3 exam-instructions-rules">
          <input
            type="checkbox"
            checked={acknowledged}
            onChange={(e) => setAcknowledged(e.target.checked)}
          />
          <span>I have read and accept the exam rules and monitoring policy.</span>
        </label>

        <div className="row-between mt-2">
          <Button
            variant="primary"
            disabled={
              !acknowledged ||
              busy ||
              availability !== 'open' ||
              attemptsExhausted
            }
            onClick={begin}
          >
            {busy
              ? 'Starting…'
              : canRequestFullscreen
                ? resumedAttemptId
                  ? 'Resume exam'
                  : maxAttempts > 1
                    ? `Enter fullscreen & start attempt ${usedAttempts + 1}`
                    : 'Enter fullscreen & start'
                : resumedAttemptId
                  ? 'Resume exam'
                  : maxAttempts > 1
                    ? `Start attempt ${usedAttempts + 1}`
                    : 'Start exam'}
          </Button>
        </div>
      </Card>
    </div>
  );
}
