import { useCallback, useEffect, useState } from 'react';
import { FeedbackForm } from '../features/feedback/FeedbackForm';
import {
  getMyFeedbackPage,
  getStaffFeedbackPage,
  markFeedbackRead,
  markMyFeedbackRead,
  updateFeedback,
  type FeedbackItem,
  type FeedbackPageResult,
} from '../features/feedback/api';
import { useAuth } from '../features/auth/AuthContext';
import { Pagination } from '../components/Pagination';
import { Alert, Badge, Button, Card, EmptyState, Field, PageSpinner, Select, TextArea, TextInput } from '../components/ui';
import { useClampPage, usePageState } from '../lib/pagination';
import { formatDateTime } from '../lib/format';
import { errorMessage } from '../lib/errors';
import type { FeedbackRecipient, FeedbackStatus } from '../lib/database.types';
import { useToasts } from '../components/toast/ToastProvider';
import { AttachmentViewer } from '../components/AttachmentViewer';

export function FeedbackPage() {
  const { user } = useAuth();
  const pageState = usePageState('feedback-');
  const status = pageState.getFilter('status');
  const recipient = pageState.getFilter('recipient') as '' | FeedbackRecipient;
  const unreadOnly = pageState.getFilter('unread') === '1';
  const isStaff = user?.role === 'admin' || user?.role === 'teacher';
  const [view, setView] = useState<'mine' | 'staff'>(isStaff ? 'staff' : 'mine');
  const [result, setResult] = useState<FeedbackPageResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const reload = useCallback(() => setReloadKey((value) => value + 1), []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    const load =
      view === 'staff'
        ? () => getStaffFeedbackPage({
            q: pageState.q,
            status,
            recipient,
            unreadOnly,
            page: pageState.page,
            pageSize: pageState.pageSize,
          })
        : () => getMyFeedbackPage({
            q: pageState.q,
            status,
            page: pageState.page,
            pageSize: pageState.pageSize,
          });
    void load()
      .then((data) => {
        if (active) {
          setResult(data);
          setError(null);
        }
      })
      .catch((err) => active && setError(errorMessage(err)))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [pageState.page, pageState.pageSize, pageState.q, recipient, reloadKey, status, unreadOnly, view]);

  useClampPage(pageState.page, pageState.pageSize, result?.total ?? 0, pageState.setPage);

  const markRead = async (item: FeedbackItem) => {
    try {
      if (view === 'staff') await markFeedbackRead(item.id);
      else await markMyFeedbackRead(item.id);
      reload();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  return (
    <div className="stack">
      <div className="row-between">
        <div><h1>Feedback</h1><p className="muted">Submissions are linked to your account and are not anonymous.</p></div>
        {isStaff ? (
          <div className="row" role="group" aria-label="Feedback view">
            <Button variant={view === 'staff' ? 'primary' : 'outline'} onClick={() => { setView('staff'); pageState.setPage(1); }}>Staff queue</Button>
            <Button variant={view === 'mine' ? 'primary' : 'outline'} onClick={() => { setView('mine'); pageState.setPage(1); }}>My submissions</Button>
          </div>
        ) : null}
      </div>

      {view === 'mine' ? <Card><h2>Send feedback</h2><FeedbackForm onSubmitted={reload} /></Card> : null}

      <Card>
        <div className="row-between">
          <h2>{view === 'staff' ? 'Feedback queue' : 'Submission history'}</h2>
          <div className="row">
            <TextInput aria-label="Search feedback" placeholder="Search feedback" value={pageState.q} onChange={(e) => pageState.setQuery(e.target.value)} />
            <Select aria-label="Filter feedback status" value={status} onChange={(e) => pageState.setFilter('status', e.target.value)}>
              <option value="">All statuses</option>
              <option value="new">New</option>
              <option value="in_review">In review</option>
              <option value="resolved">Resolved</option>
            </Select>
            {view === 'staff' ? (
              <>
                <Select
                  aria-label="Filter feedback recipient"
                  value={recipient}
                  onChange={(e) => pageState.setFilter('recipient', e.target.value)}
                >
                  <option value="">All recipients</option>
                  <option value="administration">Administration</option>
                  <option value="course_teacher">Course teachers</option>
                </Select>
                <label className="row small">
                  <input
                    type="checkbox"
                    checked={unreadOnly}
                    onChange={(e) => pageState.setFilter('unread', e.target.checked ? '1' : '')}
                  />
                  Unread only
                </label>
              </>
            ) : null}
          </div>
        </div>
      {error ? <Alert tone="danger" role="alert">{error}</Alert> : null}
        {loading ? <PageSpinner /> : result?.rows.length ? (
          <div className="stack">
            {result.rows.map((item) => view === 'staff'
              ? <StaffFeedbackCard key={item.id} item={item} onSaved={reload} onRead={() => void markRead(item)} />
              : <FeedbackCard key={item.id} item={item} onRead={() => void markRead(item)} />)}
          </div>
        ) : <EmptyState title="No feedback found" />}
        <Pagination
          page={pageState.page}
          pageSize={pageState.pageSize}
          total={result?.total ?? 0}
          onPageChange={pageState.setPage}
          onPageSizeChange={pageState.setPageSize}
          label="feedback"
        />
      </Card>
    </div>
  );
}

function recipientLabel(item: FeedbackItem): string {
  if (item.recipient_type === 'administration') return 'Administration';
  return item.recipient_teacher_name
    ? `Course teacher (${item.recipient_teacher_name})`
    : 'Course teacher';
}

function FeedbackCard({ item, onRead }: { item: FeedbackItem; onRead: () => void }) {
  return (
    <article className="card">
      <div className="row-between">
        <strong>{item.subject}</strong>
        <div className="row">
          {item.has_unread ? <Badge tone="warning">New response</Badge> : null}
          <Badge tone={item.status === 'resolved' ? 'success' : item.status === 'in_review' ? 'warning' : 'info'}>{item.status.replace('_', ' ')}</Badge>
        </div>
      </div>
      <p className="small muted">
        {item.category.replace('_', ' ')} · {formatDateTime(item.created_at)}
        {item.rating ? ` · ${item.rating}/5` : ''} · To: {recipientLabel(item)}
      </p>
      <p className="pre-wrap">{item.message}</p>
      {item.exam_title || item.course_title ? (
        <p className="small muted">
          Related to: {[item.course_title, item.exam_title].filter(Boolean).join(' · ')}
        </p>
      ) : null}
      {item.response ? (
        <Alert tone="info">
          <strong>Staff response:</strong> <span className="pre-wrap">{item.response}</span>
          {item.has_unread ? (
            <div className="mt-1">
              <Button size="sm" onClick={onRead}>Mark response as read</Button>
            </div>
          ) : null}
        </Alert>
      ) : <p className="small muted">No response yet.</p>}
    </article>
  );
}

function StaffFeedbackCard({
  item,
  onSaved,
  onRead,
}: {
  item: FeedbackItem;
  onSaved: () => void;
  onRead: () => void;
}) {
  const [status, setStatus] = useState<FeedbackStatus>(item.status);
  const [staffNotes, setStaffNotes] = useState(item.staff_notes ?? '');
  const [response, setResponse] = useState(item.response ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    setBusy(true);
    try {
      await updateFeedback({ id: item.id, status, staffNotes, response });
      setError(null);
      onSaved();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <article className="card">
      <div className="row-between">
        <strong>{item.subject}</strong>
        <div className="row">
          {item.has_unread ? <Badge tone="warning">New</Badge> : null}
          <span className="small muted">{item.submitter_name ?? 'Account-linked user'} · {formatDateTime(item.created_at)}</span>
        </div>
      </div>
      <p className="pre-wrap">{item.message}</p>
      <p className="small muted">
        {item.category.replace('_', ' ')} · To: {recipientLabel(item)}
        {item.rating ? ` · ${item.rating}/5` : ''}
      </p>
      {item.course_title || item.exam_title ? (
        <p className="small muted">
          Related: {[item.course_title, item.exam_title].filter(Boolean).join(' · ')}
        </p>
      ) : null}
      <FeedbackAttachments feedbackId={item.id} />
      {item.has_unread ? (
        <div className="mb-2">
          <Button size="sm" onClick={onRead}>Mark as read</Button>
        </div>
      ) : null}
      <FeedbackAttachments feedbackId={item.id} />
      {error ? <Alert tone="danger" role="alert">{error}</Alert> : null}
      <div className="form-grid">
        <Field label="Status" htmlFor={`feedback-status-${item.id}`}>
          <Select id={`feedback-status-${item.id}`} value={status} onChange={(e) => setStatus(e.target.value as FeedbackStatus)}>
            <option value="new">New</option>
            <option value="in_review">In review</option>
            <option value="resolved">Resolved</option>
          </Select>
        </Field>
        <Field label="Response visible to submitter" htmlFor={`feedback-response-${item.id}`}>
          <TextArea id={`feedback-response-${item.id}`} maxLength={5000} value={response} onChange={(e) => setResponse(e.target.value)} />
        </Field>
      </div>
      <Field label="Private staff notes" htmlFor={`feedback-notes-${item.id}`} hint="Never shown to the submitter. Maximum 5000 characters.">
        <TextArea id={`feedback-notes-${item.id}`} maxLength={5000} value={staffNotes} onChange={(e) => setStaffNotes(e.target.value)} />
      </Field>
      <Button onClick={() => void save()} disabled={busy}>{busy ? 'Saving…' : 'Save update'}</Button>
    </article>
  );
}


function FeedbackAttachments({ feedbackId }: { feedbackId: string }) {
  const [attachments, setAttachments] = useState<Array<{id:string;original_name:string;size_bytes:number;mime_type?:string}>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToasts();
  const [viewer, setViewer] = useState<{id:string;name:string} | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const m = await import('../features/attachments/api');
      const rows = await m.listFeedbackAttachments(feedbackId);
      setAttachments(rows);
    } catch {
      setError('Unable to load attachments.');
      toast({ tone: 'error', message: 'Unable to load attachments.' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feedbackId]);

  const viewAttachment = (att: {id:string;original_name:string}) => {
    setViewer({ id: att.id, name: att.original_name });
  };

  if (loading) return null;
  if (error) {
    return (
      <div className="mt-2">
        <div className="small muted">Attachments</div>
        <div className="row">
          <span className="small muted">Failed to load</span>
          <Button size="sm" variant="ghost" onClick={() => void load()}>Retry</Button>
        </div>
      </div>
    );
  }
  if (attachments.length === 0) return null;
  return (
    <div className="mt-2">
      <div className="small muted">Attachments</div>
      <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
        {attachments.map((att) => (
          <Button key={att.id} size="sm" variant="ghost" onClick={() => viewAttachment(att)}>
            {att.original_name} ({Math.round(att.size_bytes / 1024)} KB)
          </Button>
        ))}
      </div>
      {viewer ? (
        <AttachmentViewer
          attachmentId={viewer.id}
          feedbackId={feedbackId}
          originalName={viewer.name}
          onClose={() => setViewer(null)}
        />
      ) : null}
    </div>
  );
}
