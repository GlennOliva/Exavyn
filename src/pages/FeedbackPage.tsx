import { useCallback, useEffect, useState } from 'react';
import { FeedbackForm } from '../features/feedback/FeedbackForm';
import {
  getMyFeedbackPage,
  getStaffFeedbackPage,
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
import type { FeedbackStatus } from '../lib/database.types';

export function FeedbackPage() {
  const { user } = useAuth();
  const pageState = usePageState('feedback-');
  const status = pageState.getFilter('status');
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
    const load = view === 'staff' ? getStaffFeedbackPage : getMyFeedbackPage;
    void load({ q: pageState.q, status, page: pageState.page, pageSize: pageState.pageSize })
      .then((data) => {
        if (active) {
          setResult(data);
          setError(null);
        }
      })
      .catch((err) => active && setError(errorMessage(err)))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [pageState.page, pageState.pageSize, pageState.q, reloadKey, status, view]);

  useClampPage(pageState.page, pageState.pageSize, result?.total ?? 0, pageState.setPage);

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
          </div>
        </div>
        {error ? <Alert tone="danger" role="alert">{error}</Alert> : null}
        {loading ? <PageSpinner /> : result?.rows.length ? (
          <div className="stack">
            {result.rows.map((item) => view === 'staff'
              ? <StaffFeedbackCard key={item.id} item={item} onSaved={reload} />
              : <FeedbackCard key={item.id} item={item} />)}
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

function FeedbackCard({ item }: { item: FeedbackItem }) {
  return (
    <article className="card">
      <div className="row-between"><strong>{item.subject}</strong><Badge tone={item.status === 'resolved' ? 'success' : item.status === 'in_review' ? 'warning' : 'info'}>{item.status.replace('_', ' ')}</Badge></div>
      <p className="small muted">{item.category.replace('_', ' ')} · {formatDateTime(item.created_at)}{item.rating ? ` · ${item.rating}/5` : ''}</p>
      <p className="pre-wrap">{item.message}</p>
      {item.exam_title || item.course_title ? <p className="small muted">Related to: {item.exam_title ?? item.course_title}</p> : null}
      {item.response ? <Alert tone="info"><strong>Staff response:</strong> {item.response}</Alert> : null}
    </article>
  );
}

function StaffFeedbackCard({ item, onSaved }: { item: FeedbackItem; onSaved: () => void }) {
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
      <div className="row-between"><strong>{item.subject}</strong><span className="small muted">{item.submitter_name ?? 'Account-linked user'} · {formatDateTime(item.created_at)}</span></div>
      <p className="pre-wrap">{item.message}</p>
      <p className="small muted">{item.category.replace('_', ' ')}{item.exam_title || item.course_title ? ` · ${item.exam_title ?? item.course_title}` : ''}</p>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <div className="form-grid">
        <Field label="Status"><Select value={status} onChange={(e) => setStatus(e.target.value as FeedbackStatus)}><option value="new">New</option><option value="in_review">In review</option><option value="resolved">Resolved</option></Select></Field>
        <Field label="Response visible to submitter"><TextArea value={response} onChange={(e) => setResponse(e.target.value)} /></Field>
      </div>
      <Field label="Private staff notes" hint="Never shown to the submitter"><TextArea value={staffNotes} onChange={(e) => setStaffNotes(e.target.value)} /></Field>
      <Button onClick={() => void save()} disabled={busy}>{busy ? 'Saving...' : 'Save update'}</Button>
    </article>
  );
}
