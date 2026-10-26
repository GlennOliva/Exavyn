import { useEffect, useRef } from 'react';
import { Button } from '../../../components/ui';

interface QuestionItem {
  id: string;
  index: number;
  preview: string;
  answered: boolean;
}

interface Props {
  title: string;
  items: QuestionItem[];
  onJump: (index: number) => void | Promise<void>;
  onUnmark?: (questionId: string) => void;
  showUnmark?: boolean;
  emptyText: string;
  onClose: () => void;
}

export function QuestionJumpPanel({ title, items, onJump, onUnmark, showUnmark, emptyText, onClose }: Props) {
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
      if (e.key === 'Tab' && panelRef.current) {
        const focusable = panelRef.current.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey) {
          if (document.activeElement === first) {
            e.preventDefault();
            last.focus();
          }
        } else {
          if (document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }
      }
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="question-jump-title">
      <div className="modal" ref={panelRef} style={{ maxWidth: 520, maxHeight: '80vh', overflow: 'auto' }}>
        <div className="row-between">
          <h2 id="question-jump-title">{title}</h2>
          <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close panel" autoFocus>✕</Button>
        </div>
        {items.length === 0 ? (
          <p className="muted">{emptyText}</p>
        ) : (
          <div className="stack" style={{ gap: 8 }}>
            {items.map((item) => (
              <div key={item.id} className="row-between" style={{ alignItems: 'flex-start', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '8px 10px' }}>
                <button
                  className="btn btn-ghost"
                  style={{ textAlign: 'left', flex: 1, whiteSpace: 'normal' }}
                  onClick={() => onJump(item.index)}
                >
                  <div className="row" style={{ gap: 8, alignItems: 'center' }}>
                    <strong>Q{item.index + 1}</strong>
                    <span className="small muted">{item.answered ? 'Answered' : 'Unanswered'}</span>
                  </div>
                  <div className="small muted" style={{ marginTop: 4 }}>{item.preview}</div>
                </button>
                {showUnmark && onUnmark ? (
                  <Button size="sm" variant="ghost" onClick={() => onUnmark(item.id)}>Unmark</Button>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
