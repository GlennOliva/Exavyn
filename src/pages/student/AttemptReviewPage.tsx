import { Link, useParams } from 'react-router-dom';
import { useAsync } from '../../lib/useAsync';
import { getAttemptReview } from '../../features/attempts/api';
import { Alert, Badge, Card, PageSpinner, StatusBadge } from '../../components/ui';
import {
  formatDateTime,
  formatDateTimeWithZone,
  percent,
  reviewUnavailableReasonText,
  submissionReasonLabel,
} from '../../lib/format';

export function AttemptReviewPage() {
  const { attemptId = '' } = useParams();
  const { data, loading, error } = useAsync(() => getAttemptReview(attemptId), [attemptId]);

  if (loading) return <PageSpinner />;
  if (error) return <Alert tone="danger" role="alert">{error}</Alert>;
  if (!data) return <Alert tone="warning">Review not available.</Alert>;

  if (data.attempt_state === 'in_progress') {
    return (
      <div className="narrow stack">
        <Alert tone="info">This attempt is still in progress.</Alert>
        <Link className="btn" to="/student">
          Back to dashboard
        </Link>
      </div>
    );
  }

  if (!data.review_released) {
    return (
      <div className="narrow stack">
        <div className="row-between">
          <h1>Answer review</h1>
          <StatusBadge status="submitted" />
        </div>
        <Card>
          <Alert tone="warning" role="status">
            {data.review_reason === 'awaiting_scheduled' && data.review_release_at
              ? `Correct answers will be visible at ${formatDateTimeWithZone(data.review_release_at)}.`
              : reviewUnavailableReasonText(data.review_reason)}
          </Alert>
          <div className="row mt-2">
            <Link className="btn" to={`/student/attempts/${attemptId}/result`}>
              View score
            </Link>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="narrow stack">
      <div className="row-between">
        <div>
          <h1>Answer review</h1>
          <p className="muted">{data.exam_title ?? 'Exam'}</p>
        </div>
        <StatusBadge status="submitted" />
      </div>

      <Card>
        <div className="stat-grid">
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
        <p className="mt-2 muted small">
          Attempt {data.attempt_no} · Submitted {formatDateTime(data.submitted_at)} ·{' '}
          {submissionReasonLabel(data.submission_reason ?? null)}
        </p>
      </Card>

      {data.questions.map((question, index) => (
        <Card key={question.id}>
          <div className="row-between">
            <strong>Question {index + 1}</strong>
            <Badge tone={question.is_correct ? 'success' : 'danger'}>
              {question.is_correct ? 'Correct' : 'Incorrect'}
            </Badge>
          </div>
          <p className="mt-2">{question.prompt}</p>
          <ul className="stack" style={{ listStyle: 'none', padding: 0 }}>
            {question.options.map((option) => {
              const isCorrect = option.id === question.correct_option_id;
              const isChosen = option.id === question.selected_option_id;
              return (
                <li
                  key={option.id}
                  className="row"
                  style={{ alignItems: 'center', gap: '0.5rem', padding: '0.35rem 0.5rem' }}
                >
                  <span aria-hidden="true">{isCorrect ? '✓' : isChosen ? '✕' : '•'}</span>
                  <span>{option.label}</span>
                  {isCorrect ? <Badge tone="success">Correct answer</Badge> : null}
                  {isChosen ? (
                    <Badge tone={isCorrect ? 'success' : 'danger'}>Your answer</Badge>
                  ) : null}
                </li>
              );
            })}
          </ul>
          {!question.selected_option_id ? (
            <p className="muted small">You did not answer this question.</p>
          ) : null}
          {question.explanation ? (
            <Alert tone="info">
              <strong>Explanation:</strong> {question.explanation}
            </Alert>
          ) : null}
        </Card>
      ))}

      <div className="row">
        <Link className="btn" to={`/student/attempts/${attemptId}/result`}>
          Back to result
        </Link>
        <Link className="btn" to="/student/history">
          Examination history
        </Link>
      </div>
    </div>
  );
}
