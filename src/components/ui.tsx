import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from 'react';

type Variant = 'primary' | 'danger' | 'outline' | 'ghost';

export function Button({
  variant = 'outline',
  size,
  block,
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: 'sm';
  block?: boolean;
}) {
  const classes = [
    'btn',
    `btn-${variant}`,
    size === 'sm' ? 'btn-sm' : '',
    block ? 'btn-block' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');
  return <button className={classes} {...props} />;
}

export function Field({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string;
  htmlFor?: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="field">
      <label htmlFor={htmlFor}>{label}</label>
      {children}
      {hint ? <span className="muted small">{hint}</span> : null}
    </div>
  );
}

export function TextInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} />;
}

export function TextArea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} />;
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} />;
}

export function Card({
  children,
  className = '',
  as: Tag = 'section',
}: {
  children: ReactNode;
  className?: string;
  as?: 'section' | 'div' | 'article';
}) {
  return <Tag className={`card ${className}`}>{children}</Tag>;
}

export function Badge({
  children,
  tone = 'default',
}: {
  children: ReactNode;
  tone?: 'default' | 'success' | 'warning' | 'danger' | 'info';
}) {
  return <span className={`badge ${tone === 'default' ? '' : `badge-${tone}`}`}>{children}</span>;
}

const STATUS_TONE: Record<string, 'default' | 'success' | 'warning' | 'danger' | 'info'> = {
  draft: 'default',
  published: 'success',
  archived: 'warning',
  pending: 'warning',
  approved: 'success',
  rejected: 'danger',
  withdrawn: 'default',
  active: 'success',
  suspended: 'danger',
  in_progress: 'info',
  submitted: 'success',
};

export function StatusBadge({ status }: { status: string }) {
  const label = status.replace(/_/g, ' ');
  return <Badge tone={STATUS_TONE[status] ?? 'default'}>{label}</Badge>;
}

export function Alert({
  tone = 'info',
  children,
  role = 'status',
}: {
  tone?: 'info' | 'success' | 'warning' | 'danger';
  children: ReactNode;
  role?: 'status' | 'alert';
}) {
  return (
    <div className={`alert alert-${tone}`} role={role}>
      {children}
    </div>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <span className="row" role="status" aria-live="polite">
      <span className="spinner" />
      {label ? <span className="muted">{label}</span> : <span className="sr-only">Loading</span>}
    </span>
  );
}

export function PageSpinner() {
  return (
    <div className="skeleton-page" role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">Loading…</span>
      <div className="skeleton-bar skeleton-title" aria-hidden="true" />
      <div className="skeleton-bar skeleton-subtitle" aria-hidden="true" />
      <div className="skeleton-panel" aria-hidden="true" />
      <div className="skeleton-rows" aria-hidden="true">
        <div className="skeleton-bar skeleton-row" />
        <div className="skeleton-bar skeleton-row" />
        <div className="skeleton-bar skeleton-row" />
      </div>
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <span className="empty-mark" aria-hidden="true">
        <svg viewBox="0 0 24 24" focusable="false">
          <path
            d="M4 8.5 12 4l8 4.5v7L12 20l-8-4.5Z"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          />
          <path d="m8 11 2.4 2.4L16 8.8" fill="none" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      </span>
      <h3>{title}</h3>
      {children}
    </div>
  );
}

export function StatCard({ label, value }: { label: string; value: ReactNode }) {
  return (
    <Card className="stat">
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
    </Card>
  );
}

export function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={onClose}
    >
      <div className="modal" onClick={(event) => event.stopPropagation()}>
        <div className="row-between">
          <h2>{title}</h2>
          <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close dialog">
            ✕
          </Button>
        </div>
        {children}
      </div>
    </div>
  );
}
