import { useRef, useState, type FormEvent } from 'react';
import { Alert, Button, Field, Select, TextArea, TextInput } from '../../components/ui';
import { errorMessage } from '../../lib/errors';
import type { FeedbackCategory } from '../../lib/database.types';
import { submitFeedback } from './api';

export function FeedbackForm({
  examId = null,
  courseId = null,
  questionId = null,
  postExam = false,
  onSubmitted,
}: {
  examId?: string | null;
  courseId?: string | null;
  questionId?: string | null;
  postExam?: boolean;
  onSubmitted?: () => void;
}) {
  const [category, setCategory] = useState<FeedbackCategory>(postExam ? 'exam_concern' : 'suggestion');
  const [subject, setSubject] = useState(postExam ? 'Exam feedback' : '');
  const [message, setMessage] = useState('');
  const [rating, setRating] = useState<number | ''>('');
  const [relatedCourse, setRelatedCourse] = useState(courseId ?? '');
  const [relatedExam, setRelatedExam] = useState(examId ?? '');
  const [relatedQuestion, setRelatedQuestion] = useState(questionId ?? '');
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const requestId = useRef(crypto.randomUUID());

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setNotice(null);
    if (subject.trim().length < 3 || subject.trim().length > 160) {
      setError('Subject must be between 3 and 160 characters.');
      return;
    }
    if (message.trim().length < 10 || message.trim().length > 5000) {
      setError('Message must be between 10 and 5000 characters.');
      return;
    }
    setBusy(true);
    try {
      await submitFeedback({
        category,
        subject: subject.trim(),
        message: message.trim(),
        rating: rating === '' ? null : rating,
        courseId: relatedCourse || null,
        examId: relatedExam || null,
        questionId: relatedQuestion || null,
        requestId: requestId.current,
      });
      requestId.current = crypto.randomUUID();
      setMessage('');
      setNotice('Feedback submitted. It is linked to your account so you can track the response.');
      onSubmitted?.();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="stack" onSubmit={submit}>
      {notice ? <Alert tone="success">{notice}</Alert> : null}
      {error ? <Alert tone="danger" role="alert">{error}</Alert> : null}
      <div className="form-grid">
        <Field label="Category" htmlFor="feedback-category">
          <Select id="feedback-category" value={category} onChange={(e) => setCategory(e.target.value as FeedbackCategory)}>
            <option value="bug">Bug</option>
            <option value="suggestion">Suggestion</option>
            <option value="exam_concern">Exam/question concern</option>
            <option value="other">Other</option>
          </Select>
        </Field>
        <Field label="Rating (optional)" htmlFor="feedback-rating">
          <Select id="feedback-rating" value={rating} onChange={(e) => setRating(e.target.value ? Number(e.target.value) : '')}>
            <option value="">No rating</option>
            {[1, 2, 3, 4, 5].map((value) => <option key={value} value={value}>{value}</option>)}
          </Select>
        </Field>
      </div>
      <Field label="Subject" htmlFor="feedback-subject">
        <TextInput id="feedback-subject" value={subject} maxLength={160} required onChange={(e) => setSubject(e.target.value)} />
      </Field>
      <Field label="Message" htmlFor="feedback-message" hint="10-5000 characters">
        <TextArea id="feedback-message" value={message} minLength={10} maxLength={5000} required rows={5} onChange={(e) => setMessage(e.target.value)} />
      </Field>
      {!postExam ? (
        <details>
          <summary>Related record (optional)</summary>
          <div className="form-grid mt-2">
            <Field label="Course ID" htmlFor="feedback-course"><TextInput id="feedback-course" value={relatedCourse} onChange={(e) => setRelatedCourse(e.target.value.trim())} /></Field>
            <Field label="Exam ID" htmlFor="feedback-exam"><TextInput id="feedback-exam" value={relatedExam} onChange={(e) => setRelatedExam(e.target.value.trim())} /></Field>
            <Field label="Question ID" htmlFor="feedback-question"><TextInput id="feedback-question" value={relatedQuestion} onChange={(e) => setRelatedQuestion(e.target.value.trim())} /></Field>
          </div>
        </details>
      ) : null}
      <Button type="submit" variant="primary" disabled={busy}>{busy ? 'Submitting...' : 'Submit feedback'}</Button>
    </form>
  );
}
