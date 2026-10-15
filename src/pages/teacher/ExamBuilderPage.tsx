import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useAsync } from '../../lib/useAsync';
import {
  loadExamDraft,
  publishExam,
  saveExamDraft,
  updateExamSettings,
} from '../../features/exams/api';
import { validateExamDraft } from '../../features/exams/validation';
import { emptyQuestion, type ExamDraftInput, type ExamDraftQuestion } from '../../features/exams/types';
import {
  Alert,
  Badge,
  Button,
  Card,
  Field,
  Modal,
  PageSpinner,
  Select,
  TextArea,
  TextInput,
} from '../../components/ui';
import { errorMessage } from '../../lib/errors';
import { formatDateTimeWithZone } from '../../lib/format';
import { isoToLocalInput, localInputToIso } from '../../lib/datetime';
import { ImportTxtDialog } from './ImportTxtDialog';

const EMPTY: ExamDraftInput = {
  course_id: '',
  title: '',
  instructions: '',
  duration_minutes: 60,
  opens_at: isoToLocalInput(new Date().toISOString()),
  closes_at: isoToLocalInput(new Date(Date.now() + 7 * 864e5).toISOString()),
  question_randomization: false,
  option_randomization: false,
  result_release: 'immediate',
  max_attempts: 1,
  result_policy: 'latest',
  answer_review: 'immediate',
  pass_threshold: null,
  questions: [emptyQuestion()],
};

const ANSWER_REVIEW_LABELS: Record<ExamDraftInput['answer_review'], string> = {
  immediate: 'Immediately (as soon as the score is released)',
  after_attempts: 'After all attempts are used (or the exam closes)',
  after_close: 'After the exam closes',
  never: 'Never (hide correct answers)',
};

export function ExamBuilderPage() {
  const { examId } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const courseIdFromQuery = searchParams.get('course') ?? '';

  const isNew = !examId;
  const loaded = useAsync(
    async () => (isNew ? null : loadExamDraft(examId as string)),
    [examId],
  );

  if (!isNew && loaded.loading) return <PageSpinner />;
  if (!isNew && loaded.error) return <Alert tone="danger" role="alert">{loaded.error}</Alert>;

  const initial: ExamDraftInput = isNew
    ? { ...EMPTY, course_id: courseIdFromQuery }
    : {
        course_id: loaded.data!.exam.course_id,
        title: loaded.data!.exam.title,
        instructions: loaded.data!.exam.instructions,
        duration_minutes: loaded.data!.exam.duration_minutes,
        opens_at: isoToLocalInput(loaded.data!.exam.opens_at),
        closes_at: isoToLocalInput(loaded.data!.exam.closes_at),
        question_randomization: loaded.data!.exam.question_randomization,
        option_randomization: loaded.data!.exam.option_randomization,
        result_release: loaded.data!.exam.result_release,
        max_attempts: loaded.data!.exam.max_attempts,
        result_policy: loaded.data!.exam.result_policy,
        answer_review: loaded.data!.exam.answer_review,
        pass_threshold: loaded.data!.exam.pass_threshold,
        questions: loaded.data!.questions,
      };

  if (!isNew && loaded.data && loaded.data.exam.state !== 'draft') {
    return (
      <ExamSettingsForm
        examId={examId as string}
        initial={initial}
        state={loaded.data.exam.state}
      />
    );
  }

  return (
    <ExamBuilderForm
      examId={examId ?? null}
      initial={initial}
      onSaved={(id, message) => navigate(message === 'published' ? `/teacher/exams/${id}/results` : `/teacher/exams/${id}/edit`, { replace: true })}
    />
  );
}

function ExamSettingsForm({
  examId,
  initial,
  state,
}: {
  examId: string;
  initial: ExamDraftInput;
  state: string;
}) {
  const [draft, setDraft] = useState<ExamDraftInput>(initial);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const update = (patch: Partial<ExamDraftInput>) =>
    setDraft((prev) => ({ ...prev, ...patch }));

  const save = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const opens = localInputToIso(draft.opens_at);
      const closes = localInputToIso(draft.closes_at);
      if (!opens || !closes) {
        setError('Enter valid opening and closing times.');
        return;
      }
      if (!Number.isInteger(draft.max_attempts) || draft.max_attempts < 1 || draft.max_attempts > 20) {
        setError('Maximum attempts must be a whole number between 1 and 20.');
        return;
      }
      if (
        draft.pass_threshold !== null &&
        (!Number.isFinite(draft.pass_threshold) ||
          draft.pass_threshold < 0 ||
          draft.pass_threshold > 100)
      ) {
        setError('Pass threshold must be between 0 and 100, or left blank.');
        return;
      }
      await updateExamSettings(examId, {
        title: draft.title,
        instructions: draft.instructions,
        opens_at: opens,
        closes_at: closes,
        duration_minutes: draft.duration_minutes,
        result_release: draft.result_release,
        max_attempts: draft.max_attempts,
        result_policy: draft.result_policy,
        answer_review: draft.answer_review,
        pass_threshold: draft.pass_threshold,
      });
      setNotice('Exam settings saved. Changes apply to future attempts only.');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack">
      <Link to="/teacher/courses" className="small">
        ← Back
      </Link>
      <div className="row-between">
        <div>
          <h1>Exam settings</h1>
          <p className="muted">
            This exam is {state}. Questions and choices are frozen; schedule and
            attempt settings can change prospectively.
          </p>
        </div>
        <div className="row">
          <Link className="btn btn-sm" to={`/teacher/exams/${examId}/results`}>
            Results
          </Link>
          <Button variant="primary" onClick={() => void save()} disabled={busy}>
            Save settings
          </Button>
        </div>
      </div>

      {error ? <Alert tone="danger" role="alert">{error}</Alert> : null}
      {notice ? <Alert tone="success">{notice}</Alert> : null}

      <Card>
        <Field label="Title" htmlFor="sTitle">
          <TextInput
            id="sTitle"
            value={draft.title}
            onChange={(e) => update({ title: e.target.value })}
          />
        </Field>
        <Field label="Instructions" htmlFor="sInstructions">
          <TextArea
            id="sInstructions"
            value={draft.instructions}
            onChange={(e) => update({ instructions: e.target.value })}
          />
        </Field>
        <div className="row">
          <div className="grow">
            <Field label="Opens at" htmlFor="sOpens">
              <TextInput
                id="sOpens"
                type="datetime-local"
                value={draft.opens_at}
                onChange={(e) => update({ opens_at: e.target.value })}
              />
            </Field>
          </div>
          <div className="grow">
            <Field label="Closes at" htmlFor="sCloses">
              <TextInput
                id="sCloses"
                type="datetime-local"
                value={draft.closes_at}
                onChange={(e) => update({ closes_at: e.target.value })}
              />
            </Field>
          </div>
          <div style={{ maxWidth: 160 }}>
            <Field label="Duration (minutes)" htmlFor="sDuration">
              <TextInput
                id="sDuration"
                type="number"
                min={1}
                value={draft.duration_minutes}
                onChange={(e) => update({ duration_minutes: Number(e.target.value) })}
              />
            </Field>
          </div>
        </div>
        <div className="row">
          <div className="grow">
            <Field label="Result release" htmlFor="sRelease">
              <Select
                id="sRelease"
                value={draft.result_release}
                onChange={(e) =>
                  update({ result_release: e.target.value as ExamDraftInput['result_release'] })
                }
              >
                <option value="immediate">Immediately</option>
                <option value="after_close">After exam closes</option>
              </Select>
            </Field>
          </div>
          <div style={{ maxWidth: 200 }}>
            <Field label="Maximum attempts" htmlFor="sMaxAttempts">
              <TextInput
                id="sMaxAttempts"
                type="number"
                min={1}
                max={20}
                value={draft.max_attempts}
                onChange={(e) => update({ max_attempts: Number(e.target.value) })}
              />
            </Field>
          </div>
          <div className="grow">
            <Field label="Result used for multiple attempts" htmlFor="sResultPolicy">
              <Select
                id="sResultPolicy"
                value={draft.result_policy}
                disabled={draft.max_attempts <= 1}
                onChange={(e) =>
                  update({ result_policy: e.target.value as ExamDraftInput['result_policy'] })
                }
              >
                <option value="latest">Latest completed attempt</option>
                <option value="highest">Highest score</option>
              </Select>
            </Field>
          </div>
        </div>
        <div className="row">
          <div className="grow">
            <Field
              label="Answer review"
              htmlFor="sAnswerReview"
              hint="When students may see correct answers. Never before the score is released."
            >
              <Select
                id="sAnswerReview"
                value={draft.answer_review}
                onChange={(e) =>
                  update({ answer_review: e.target.value as ExamDraftInput['answer_review'] })
                }
              >
                {Object.entries(ANSWER_REVIEW_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <div style={{ maxWidth: 200 }}>
            <Field label="Pass threshold (%)" htmlFor="sPassThreshold" hint="Leave blank for none.">
              <TextInput
                id="sPassThreshold"
                type="number"
                min={0}
                max={100}
                step="0.01"
                value={draft.pass_threshold ?? ''}
                onChange={(e) =>
                  update({ pass_threshold: e.target.value === '' ? null : Number(e.target.value) })
                }
              />
            </Field>
          </div>
        </div>
        {draft.answer_review === 'immediate' ? (
          <Alert tone="warning">
            Immediate answer review reveals the correct answers as soon as a student submits. If
            students can retake this exam, consider releasing answers only after all attempts or
            after the exam closes.
          </Alert>
        ) : null}
      </Card>
    </div>
  );
}

function ExamBuilderForm({
  examId,
  initial,
  onSaved,
}: {
  examId: string | null;
  initial: ExamDraftInput;
  onSaved: (id: string, message: string) => void;
}) {
  const [draft, setDraft] = useState<ExamDraftInput>(initial);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [currentId, setCurrentId] = useState(examId);

  const validation = useMemo(() => validateExamDraft(draft), [draft]);

  const update = (patch: Partial<ExamDraftInput>) =>
    setDraft((prev) => ({ ...prev, ...patch }));

  const updateQuestion = (index: number, patch: Partial<ExamDraftQuestion>) =>
    setDraft((prev) => ({
      ...prev,
      questions: prev.questions.map((q, i) => (i === index ? { ...q, ...patch } : q)),
    }));

  const addQuestion = () =>
    setDraft((prev) => ({ ...prev, questions: [...prev.questions, emptyQuestion()] }));

  const removeQuestion = (index: number) =>
    setDraft((prev) => ({
      ...prev,
      questions: prev.questions.filter((_, i) => i !== index),
    }));

  const copyFirst = () => {
    const first = draft.questions[0];
    if (!first) return;
    const copies = Array.from({ length: 49 }, () => ({
      ...first,
      options: [...first.options],
    }));
    setDraft((prev) => ({ ...prev, questions: [first, ...copies] }));
  };

  const persist = async (): Promise<string> => {
    setError(null);
    if (!validation.ok) {
      setError('Fix validation errors before saving.');
      throw new Error('invalid');
    }
    const opens = localInputToIso(draft.opens_at);
    const closes = localInputToIso(draft.closes_at);
    if (!opens || !closes) {
      setError('Enter valid opening and closing times.');
      throw new Error('invalid');
    }
    const payload: ExamDraftInput = {
      ...draft,
      opens_at: opens,
      closes_at: closes,
    };
    const id = await saveExamDraft(currentId, payload);
    setCurrentId(id);
    return id;
  };

  const onSave = async () => {
    setBusy(true);
    try {
      await persist();
      onSaved(currentId ?? '', 'draft');
    } catch (err) {
      if ((err as Error).message !== 'invalid') setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const onPublish = async () => {
    setBusy(true);
    try {
      const id = await persist();
      await publishExam(id);
      onSaved(id, 'published');
    } catch (err) {
      if ((err as Error).message !== 'invalid') setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack">
      <div className="row-between">
        <div>
          <h1>{currentId ? 'Edit exam' : 'New exam'}</h1>
          <p className="muted">
            <Badge tone="info">{validation.itemCount} item(s)</Badge>{' '}
            <Badge tone="info">max {validation.maxScore} point(s)</Badge>{' '}
            {validation.ok ? <Badge tone="success">valid</Badge> : <Badge tone="danger">invalid</Badge>}
          </p>
        </div>
        <div className="row">
          <Button onClick={() => setShowPreview(true)}>Preview</Button>
          <Button onClick={onSave} disabled={busy || !validation.ok}>
            Save draft
          </Button>
          <Button variant="primary" onClick={onPublish} disabled={busy || !validation.ok}>
            Publish
          </Button>
        </div>
      </div>

      {error ? <Alert tone="danger" role="alert">{error}</Alert> : null}
      {!validation.ok ? (
        <Alert tone="warning">
          <ul>
            {validation.errors.slice(0, 6).map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </Alert>
      ) : null}

      <Card>
        <h2>Exam settings</h2>
        <div className="row">
          <div className="grow">
            <Field label="Title" htmlFor="eTitle">
              <TextInput
                id="eTitle"
                value={draft.title}
                onChange={(e) => update({ title: e.target.value })}
              />
            </Field>
          </div>
          <div style={{ maxWidth: 160 }}>
            <Field label="Duration (minutes)" htmlFor="eDuration">
              <TextInput
                id="eDuration"
                type="number"
                min={1}
                value={draft.duration_minutes}
                onChange={(e) => update({ duration_minutes: Number(e.target.value) })}
              />
            </Field>
          </div>
        </div>
        <Field label="Instructions" htmlFor="eInstructions">
          <TextArea
            id="eInstructions"
            value={draft.instructions}
            onChange={(e) => update({ instructions: e.target.value })}
          />
        </Field>
        <div className="row">
          <div className="grow">
            <Field label="Opens at" htmlFor="eOpens">
              <TextInput
                id="eOpens"
                type="datetime-local"
                value={draft.opens_at}
                onChange={(e) => update({ opens_at: e.target.value })}
              />
            </Field>
          </div>
          <div className="grow">
            <Field label="Closes at" htmlFor="eCloses">
              <TextInput
                id="eCloses"
                type="datetime-local"
                value={draft.closes_at}
                onChange={(e) => update({ closes_at: e.target.value })}
              />
            </Field>
          </div>
          <div className="grow">
            <Field label="Result release" htmlFor="eRelease">
              <Select
                id="eRelease"
                value={draft.result_release}
                onChange={(e) =>
                  update({ result_release: e.target.value as ExamDraftInput['result_release'] })
                }
              >
                <option value="immediate">Immediately</option>
                <option value="after_close">After exam closes</option>
              </Select>
            </Field>
          </div>
        </div>
        <div className="row">
          <div style={{ maxWidth: 200 }}>
            <Field label="Maximum attempts" htmlFor="eMaxAttempts">
              <TextInput
                id="eMaxAttempts"
                type="number"
                min={1}
                max={20}
                value={draft.max_attempts}
                onChange={(e) => update({ max_attempts: Number(e.target.value) })}
              />
            </Field>
          </div>
          <div className="grow">
            <Field label="Result used for multiple attempts" htmlFor="eResultPolicy">
              <Select
                id="eResultPolicy"
                value={draft.result_policy}
                disabled={draft.max_attempts <= 1}
                onChange={(e) =>
                  update({ result_policy: e.target.value as ExamDraftInput['result_policy'] })
                }
              >
                <option value="latest">Latest completed attempt</option>
                <option value="highest">Highest score</option>
              </Select>
            </Field>
          </div>
        </div>
        <div className="row">
          <label className="row small">
            <input
              type="checkbox"
              checked={draft.question_randomization}
              onChange={(e) => update({ question_randomization: e.target.checked })}
            />
            Randomize question order
          </label>
          <label className="row small">
            <input
              type="checkbox"
              checked={draft.option_randomization}
              onChange={(e) => update({ option_randomization: e.target.checked })}
            />
            Randomize option order
          </label>
        </div>
        <div className="row">
          <div className="grow">
            <Field
              label="Answer review"
              htmlFor="eAnswerReview"
              hint="When students may see correct answers. Never before the score is released."
            >
              <Select
                id="eAnswerReview"
                value={draft.answer_review}
                onChange={(e) =>
                  update({ answer_review: e.target.value as ExamDraftInput['answer_review'] })
                }
              >
                {Object.entries(ANSWER_REVIEW_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <div style={{ maxWidth: 200 }}>
            <Field label="Pass threshold (%)" htmlFor="ePassThreshold" hint="Leave blank for none.">
              <TextInput
                id="ePassThreshold"
                type="number"
                min={0}
                max={100}
                step="0.01"
                value={draft.pass_threshold ?? ''}
                onChange={(e) =>
                  update({ pass_threshold: e.target.value === '' ? null : Number(e.target.value) })
                }
              />
            </Field>
          </div>
        </div>
        {draft.answer_review === 'immediate' && draft.max_attempts > 1 ? (
          <Alert tone="warning">
            Immediate answer review reveals the correct answers after each attempt, which can help
            students succeed on retakes. Consider “after all attempts” or “after the exam closes”.
          </Alert>
        ) : null}
      </Card>

      <Card>
        <div className="row-between">
          <h2>Questions</h2>
          <div className="row">
            <Button size="sm" onClick={() => setShowImport(true)}>
              Import TXT
            </Button>
            <Button size="sm" onClick={copyFirst} disabled={draft.questions.length !== 1}>
              Fill to 50 items
            </Button>
            <Button size="sm" variant="primary" onClick={addQuestion}>
              Add question
            </Button>
          </div>
        </div>
        {draft.questions.map((question, index) => (
          <div key={index} className="card" style={{ marginTop: '1rem' }}>
            <div className="row-between">
              <strong>Question {index + 1}</strong>
              <div className="row">
                <div style={{ width: 110 }}>
                  <TextInput
                    aria-label={`Points for question ${index + 1}`}
                    type="number"
                    min={1}
                    value={question.points}
                    onChange={(e) =>
                      updateQuestion(index, { points: Number(e.target.value) })
                    }
                  />
                </div>
                <Button
                  size="sm"
                  variant="danger"
                  onClick={() => removeQuestion(index)}
                  disabled={draft.questions.length === 1}
                >
                  Remove
                </Button>
              </div>
            </div>
            <Field label="Prompt" htmlFor={`qPrompt-${index}`}>
              <TextArea
                id={`qPrompt-${index}`}
                value={question.prompt}
                onChange={(e) => updateQuestion(index, { prompt: e.target.value })}
              />
            </Field>
            <fieldset style={{ border: 'none', padding: 0, margin: 0 }}>
              <legend className="small muted">Select the correct option</legend>
              {question.options.map((option, optIndex) => (
                <div className="row" key={optIndex} style={{ marginBottom: '0.4rem' }}>
                  <input
                    type="radio"
                    name={`correct-${index}`}
                    checked={question.correctIndex === optIndex}
                    onChange={() => updateQuestion(index, { correctIndex: optIndex })}
                    aria-label={`Mark option ${optIndex + 1} correct`}
                  />
                  <TextInput
                    aria-label={`Option ${optIndex + 1}`}
                    value={option}
                    onChange={(e) =>
                      updateQuestion(index, {
                        options: question.options.map((o, i) =>
                          i === optIndex ? e.target.value : o,
                        ),
                      })
                    }
                  />
                </div>
              ))}
            </fieldset>
            <Field
              label="Explanation (optional)"
              htmlFor={`qExplanation-${index}`}
              hint="Shown to students with the correct answer during review."
            >
              <TextArea
                id={`qExplanation-${index}`}
                value={question.explanation}
                onChange={(e) => updateQuestion(index, { explanation: e.target.value })}
              />
            </Field>
          </div>
        ))}
      </Card>

      {showImport ? (
        <ImportTxtDialog
          onCancel={() => setShowImport(false)}
          onConfirm={(questions) => {
            update({ questions });
            setShowImport(false);
          }}
        />
      ) : null}

      {showPreview ? (
        <Modal title="Exam preview" onClose={() => setShowPreview(false)}>
          <p className="muted small">
            Preview only. No attempt is created and no monitoring is triggered.
          </p>
          <h3>{draft.title || 'Untitled exam'}</h3>
          <p className="small muted">
            {validation.itemCount} items · {draft.duration_minutes} minutes · opens{' '}
            {formatDateTimeWithZone(localInputToIso(draft.opens_at))}
          </p>
          <pre className="instructions small">{draft.instructions || 'No instructions.'}</pre>
          <ol>
            {draft.questions.map((question, index) => (
              <li key={index} className="mt-1">
                <div>{question.prompt || '(empty prompt)'}</div>
                <ul>
                  {question.options.map((option, optIndex) => (
                    <li key={optIndex}>
                      {option || '(empty)'}{' '}
                      {optIndex === question.correctIndex ? (
                        <Badge tone="success">correct</Badge>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
        </Modal>
      ) : null}
    </div>
  );
}
