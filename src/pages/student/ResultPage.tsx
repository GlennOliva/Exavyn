import { Link, useParams } from 'react-router-dom';
import { useAsync } from '../../lib/useAsync';
import { getResult } from '../../features/attempts/api';
import { Alert, Badge, Button, Card, PageSpinner, StatusBadge } from '../../components/ui';
import { FeedbackForm } from '../../features/feedback/FeedbackForm';
import { ScoreBadge } from '../../components/ScoreBadge';
import {
  formatDateTime,
  formatDateTimeWithZone,
  formatDuration,
  percent,
  reviewUnavailableReasonText,
  submissionReasonLabel,
} from '../../lib/format';

export function ResultPage() {
  const { attemptId = '' } = useParams();
  const { data, loading, error, reload } = useAsync(() => getResult(attemptId), [attemptId]);

  if (loading) return <PageSpinner />;
  if (error) return <Alert tone="danger" role="alert">{error}</Alert>;
  if (!data) return <Alert tone="warning">Result not available.</Alert>;

  if (data.attempt_state === 'in_progress') {
    return (
      <div className="narrow stack">
        <Alert tone="info">
          This attempt is still in progress. Deadline: {formatDateTime(data.deadline_at)}.
        </Alert>
        <Link className="btn" to="/student">
          Back to dashboard
        </Link>
      </div>
    );
  }

  return (
    <div className="narrow stack">
      <div className="row-between">
        <h1>Final result</h1>
        <StatusBadge status="submitted" />
      </div>

      <Card>
        <Alert tone="info">
          This result is final and immutable. It cannot be reopened, edited, or regraded by any
          role, including administrators.
        </Alert>

        {data.released ? (
          <>
            <div className="stat-grid mt-2">
              <div>
                <div className="stat-value">
                  {data.earned_points ?? 0}/{data.max_points ?? 0}
                </div>
                <div className="stat-label">Score</div>
              </div>
              <div>
                <div className="stat-value">{percent(data.percentage)}</div>
                <div className="stat-label">Percentage</div>
              </div>
              <div>
                <div className="stat-value">{data.correct_count ?? 0}</div>
                <div className="stat-label">Correct</div>
              </div>
              <div>
                <div className="stat-value">{data.answered_count ?? 0}</div>
                <div className="stat-label">Answered</div>
              </div>
            </div>
            <p className="mt-2">
              <ScoreBadge
                percentage={data.percentage}
                passThreshold={data.pass_threshold}
                state={data.attempt_state}
                released={data.released}
              />{' '}
              <span className="muted small">
                {data.pass_threshold === null || data.pass_threshold === undefined
                  ? 'No passing threshold was configured for this exam.'
                  : `Pass mark: ${percent(data.pass_threshold)} · your score ${percent(data.percentage)}`}
              </span>
            </p>
          </>
        ) : (
          <Alert tone="warning" role="status">
            {data.result_release === 'after_close'
              ? 'Submitted - results are available after the exam closes.'
              : data.result_release === 'scheduled'
                ? `Submitted - results are available at ${formatDateTimeWithZone(data.result_release_at)}.`
                : 'Submitted - results are not available yet.'}
          </Alert>
        )}

        <p className="mt-2">
          <Badge tone="info">{submissionReasonLabel(data.submission_reason ?? null)}</Badge>{' '}
          <span className="muted small">Submitted {formatDateTime(data.submitted_at)}</span>
        </p>
        <p className="muted small">
          Attempt {data.attempt_no ?? 1}
          {data.max_attempts ? ` of ${data.max_attempts}` : ''}
          {typeof data.remaining_attempts === 'number'
            ? ` · ${data.remaining_attempts} remaining`
            : ''}
          {typeof data.time_spent_seconds === 'number'
            ? ` · Time spent ${formatDuration(data.time_spent_seconds * 1000)}`
            : ''}
        </p>
      </Card>

      <Card>
        <h2>Answer review</h2>
        {data.review_released ? (
          <>
            <p className="muted">
              See each question, your answer, the correct answer, and any explanation your
              instructor provided.
            </p>
            <Link className="btn btn-primary" to={`/student/attempts/${attemptId}/review`}>
              Review answers
            </Link>
          </>
        ) : (
          <Alert tone="warning" role="status">
            {data.review_reason === 'awaiting_scheduled' && data.review_release_at
              ? `Correct answers will be visible at ${formatDateTimeWithZone(data.review_release_at)}.`
              : reviewUnavailableReasonText(data.review_reason)}
          </Alert>
        )}
      </Card>

      <Card>
        <h2>Feedback</h2>
        <p className="muted small">Share optional feedback about this exam. Feedback does not affect result release.</p>
        <FeedbackForm examId={data.exam_id ?? null} postExam />
      </Card>

      <div className="row">
        <Button onClick={() => void reload()}>Refresh</Button>
        <Link className="btn" to="/student/history">
          Examination history
        </Link>
      </div>
    </div>
  );
}
