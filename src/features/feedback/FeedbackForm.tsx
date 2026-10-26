import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Alert, Button, Field, Select, TextArea, TextInput } from '../../components/ui';
import { errorMessage } from '../../lib/errors';
import type { FeedbackCategory, FeedbackRecipient } from '../../lib/database.types';
import { useAuth } from '../auth/AuthContext';
import { listStudentEnrollmentsPage } from '../courses/api';
import { listStudentExamsPage } from '../exams/api';
import { submitFeedback } from './api';
import { useToasts } from '../../components/toast/ToastProvider';
import { isAllowedMime, MAX_FILES, MAX_SIZE_BYTES, readFileSignature, validateFileName } from '../attachments/validation';
import { confirmFeedbackAttachmentUpload, requestFeedbackAttachmentUpload } from '../attachments/api';

interface CourseOption {
  id: string;
  title: string;
  course_code: string;
}

interface ExamOption {
  id: string;
  title: string;
  course_id: string;
  course_title?: string;
  course_code?: string;
}

interface PendingAttachment {
  id: string;
  file: File;
  preview: string;
  status: 'uploading' | 'uploaded' | 'error';
  error?: string;
  attachmentId?: string;
}

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
  const { user } = useAuth();
  const { toast } = useToasts();
  const isStudent = user?.role === 'student';
  const [category, setCategory] = useState<FeedbackCategory>(postExam ? 'exam_concern' : 'suggestion');
  const [subject, setSubject] = useState(postExam ? 'Exam feedback' : '');
  const [message, setMessage] = useState('');
  const [rating, setRating] = useState<number | ''>('');
  const [relatedCourse, setRelatedCourse] = useState(courseId ?? '');
  const [relatedExam, setRelatedExam] = useState(examId ?? '');
  const [recipientType, setRecipientType] = useState<FeedbackRecipient>(
    postExam || courseId ? 'course_teacher' : 'administration',
  );
  const [courses, setCourses] = useState<CourseOption[]>([]);
  const [exams, setExams] = useState<ExamOption[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const requestId = useRef(crypto.randomUUID());
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [, setCreatedFeedbackId] = useState<string | null>(null);

  useEffect(() => {
    if (!isStudent || postExam) return;
    let active = true;
    void Promise.all([
      listStudentEnrollmentsPage({ page: 1, pageSize: 50, q: '' }),
      listStudentExamsPage({ page: 1, pageSize: 50, q: '' }),
    ])
      .then(([enrollmentPage, examPage]) => {
        if (!active) return;
        setCourses(
          enrollmentPage.rows
            .filter((row) => row.status === 'approved' && row.course)
            .map((row) => ({
              id: row.course!.id,
              title: row.course!.title,
              course_code: row.course!.course_code,
            })),
        );
        setExams(
          examPage.rows.map((row) => ({
            id: row.id,
            title: row.title,
            course_id: row.course_id,
            course_title: row.course?.title,
            course_code: row.course?.course_code,
          })),
        );
      })
      .catch(() => {
        /* The optional selector should not block feedback submission. */
      });
    return () => {
      active = false;
    };
  }, [isStudent, postExam]);

  const canAddressTeacher = Boolean(relatedCourse || relatedExam || examId || courseId);

  useEffect(() => {
    if (!canAddressTeacher && recipientType === 'course_teacher') {
      setRecipientType('administration');
    }
  }, [canAddressTeacher, recipientType]);

  const chooseCourse = (value: string) => {
    setRelatedCourse(value);
    if (relatedExam) {
      const exam = exams.find((item) => item.id === relatedExam);
      if (exam && value && exam.course_id !== value) setRelatedExam('');
    }
  };

  const chooseExam = (value: string) => {
    setRelatedExam(value);
    const exam = exams.find((item) => item.id === value);
    if (exam?.course_id) setRelatedCourse(exam.course_id);
  };

  const addAttachments = async (files: FileList | null) => {
    if (!files) return;
    if (attachments.length >= MAX_FILES) {
      setError('Maximum 3 screenshots allowed.');
      return;
    }
    const list = Array.from(files).slice(0, MAX_FILES - attachments.length);
    for (const file of list) {
      if (file.size > MAX_SIZE_BYTES) {
        setError('Each screenshot must be 5 MB or smaller.');
        toast({ tone: 'error', message: 'Screenshot upload failed: file too large (max 5 MB).' });
        continue;
      }
      if (!validateFileName(file.name) || !isAllowedMime(file.type)) {
        setError('Only PNG, JPEG, and WebP images are allowed. SVG and executables are rejected.');
        toast({ tone: 'error', message: 'Screenshot upload failed: unsupported file type.' });
        continue;
      }
      const sigOk = await readFileSignature(file);
      if (!sigOk) {
        setError('File signature validation failed. Only valid PNG, JPEG, or WebP images are allowed.');
        toast({ tone: 'error', message: 'Screenshot upload failed: invalid image signature.' });
        continue;
      }
      const id = crypto.randomUUID();
      const preview = URL.createObjectURL(file);
      setAttachments((prev) => [...prev, { id, file, preview, status: 'uploading' }]);
    }
  };

  const removeAttachment = (id: string) => {
    setAttachments((prev) => {
      const att = prev.find((p) => p.id === id);
      if (att) URL.revokeObjectURL(att.preview);
      return prev.filter((p) => p.id !== id);
    });
  };

  const uploadAttachmentsForFeedback = async (feedbackId: string) => {
    for (const att of attachments) {
      if (att.status === 'uploaded' && att.attachmentId) continue;
      try {
        const req = await requestFeedbackAttachmentUpload({
          feedbackId,
          fileName: att.file.name,
          mimeType: att.file.type,
          sizeBytes: att.file.size,
          contentType: att.file.type,
        });
        // Upload via signed URL if provided; fallback to direct upload not possible with private bucket
        // Try PUT to upload_url
        const putRes = await fetch(req.upload_url, {
          method: 'PUT',
          headers: { 'Content-Type': att.file.type },
          body: att.file,
        });
        if (!putRes.ok) throw new Error('upload_failed');
        await confirmFeedbackAttachmentUpload({ attachmentId: req.attachment_id, feedbackId });
        setAttachments((prev) => prev.map((p) => (p.id === att.id ? { ...p, status: 'uploaded', attachmentId: req.attachment_id } : p)));
        toast({ tone: 'success', message: 'Screenshot attached.' });
      } catch {
        setAttachments((prev) => prev.map((p) => (p.id === att.id ? { ...p, status: 'error', error: 'Upload failed' } : p)));
        toast({ tone: 'error', message: 'Screenshot upload failed.' });
      }
    }
  };

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
    const recipient: FeedbackRecipient =
      canAddressTeacher && recipientType === 'course_teacher'
        ? 'course_teacher'
        : 'administration';
    setBusy(true);
    try {
      const feedbackId = await submitFeedback({
        category,
        subject: subject.trim(),
        message: message.trim(),
        rating: rating === '' ? null : rating,
        courseId: relatedCourse || null,
        examId: relatedExam || examId || null,
        questionId,
        recipientType: recipient,
        requestId: requestId.current,
      });
      requestId.current = crypto.randomUUID();
      if (attachments.length > 0) {
        await uploadAttachmentsForFeedback(feedbackId);
      }
      setMessage('');
      setSubject(postExam ? 'Exam feedback' : '');
      setRating('');
      // Clear attachments only after confirmation of success
      attachments.forEach((a) => URL.revokeObjectURL(a.preview));
      setAttachments([]);
      setCreatedFeedbackId(null);
      setNotice(
        recipient === 'course_teacher'
          ? 'Feedback submitted successfully. It is linked to your account so you can track the response.'
          : 'Feedback submitted successfully. It is linked to your account so you can track the response.',
      );
      toast({ tone: 'success', message: 'Feedback submitted successfully.' });
      onSubmitted?.();
    } catch (err) {
      setError(errorMessage(err));
      toast({ tone: 'error', message: 'Feedback submission failed.' });
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
      <Field
        label="Send to"
        htmlFor="feedback-recipient"
        hint="Course-teacher feedback goes only to the teacher who owns the selected course."
      >
        <Select
          id="feedback-recipient"
          value={recipientType}
          disabled={!canAddressTeacher}
          onChange={(e) => setRecipientType(e.target.value as FeedbackRecipient)}
        >
          <option value="administration">Administration</option>
          <option value="course_teacher" disabled={!canAddressTeacher}>Course teacher</option>
        </Select>
      </Field>
      {isStudent && !postExam ? (
        <div className="form-grid">
          <Field label="Related course (optional)" htmlFor="feedback-course">
            <Select id="feedback-course" value={relatedCourse} onChange={(e) => chooseCourse(e.target.value)}>
              <option value="">No course</option>
              {courses.map((course) => (
                <option key={course.id} value={course.id}>
                  {course.course_code} — {course.title}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Related exam (optional)" htmlFor="feedback-exam">
            <Select id="feedback-exam" value={relatedExam} onChange={(e) => chooseExam(e.target.value)}>
              <option value="">No exam</option>
              {exams
                .filter((exam) => !relatedCourse || exam.course_id === relatedCourse)
                .map((exam) => (
                  <option key={exam.id} value={exam.id}>
                    {exam.title}
                    {exam.course_code ? ` — ${exam.course_code}` : ''}
                  </option>
                ))}
            </Select>
          </Field>
        </div>
      ) : null}
      <Field label="Subject" htmlFor="feedback-subject">
        <TextInput id="feedback-subject" value={subject} maxLength={160} required onChange={(e) => setSubject(e.target.value)} />
      </Field>
      <Field label="Message" htmlFor="feedback-message" hint="10–5000 characters">
        <TextArea id="feedback-message" value={message} minLength={10} maxLength={5000} required rows={5} onChange={(e) => setMessage(e.target.value)} />
      </Field>
      {isStudent ? (
        <Field label="Screenshots (optional)" htmlFor="feedback-attachments" hint="PNG, JPEG, or WebP. Max 3 files, 5 MB each. Avoid passwords, recovery links, or unrelated personal information.">
          <input
            id="feedback-attachments"
            type="file"
            accept="image/png,image/jpeg,image/webp"
            multiple
            onChange={(e) => void addAttachments(e.target.files)}
            disabled={attachments.length >= MAX_FILES}
          />
          {attachments.length > 0 ? (
            <div className="row" style={{ flexWrap: 'wrap', gap: 10, marginTop: 10 }}>
              {attachments.map((att) => (
                <div key={att.id} style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: 8, width: 200 }}>
                  <img src={att.preview} alt="Screenshot preview" style={{ width: '100%', height: 120, objectFit: 'cover', borderRadius: 6 }} />
                  <div className="small muted">{(att.file.size / 1024 / 1024).toFixed(2)} MB</div>
                  <div className="small">{att.status === 'uploading' ? 'Uploading…' : att.status === 'uploaded' ? 'Attached' : att.error ?? 'Error'}</div>
                  <Button size="sm" variant="ghost" onClick={() => removeAttachment(att.id)} disabled={busy && att.status === 'uploading'}>Remove</Button>
                </div>
              ))}
            </div>
          ) : null}
        </Field>
      ) : null}
      <Button type="submit" variant="primary" disabled={busy}>{busy ? 'Submitting…' : 'Submit feedback'}</Button>
    </form>
  );
}
