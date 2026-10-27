import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Modal } from './ui';
import { useToasts } from './toast/ToastProvider';
import { getFeedbackAttachmentUrl } from '../features/attachments/api';
import { errorMessage } from '../lib/errors';

interface Props {
  attachmentId: string;
  feedbackId: string;
  originalName: string;
  onClose: () => void;
}

export function AttachmentViewer({ attachmentId, feedbackId, originalName, onClose }: Props) {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToasts();
  const fetchIdRef = useRef(0);

  const load = async () => {
    const fetchId = ++fetchIdRef.current;
    setLoading(true);
    setError(null);
    try {
      const signedUrl = await getFeedbackAttachmentUrl({ attachmentId, feedbackId });
      if (fetchId !== fetchIdRef.current) return;
      setUrl(signedUrl);
      if (fetchId !== fetchIdRef.current) return;
      setLoading(false);
      return;
    } catch (err) {
      if (fetchId !== fetchIdRef.current) return;
      const msg = errorMessage(err);
      setError(msg || 'Unable to open attachment.');
      toast({ tone: 'error', message: 'Unable to open attachment.' });
      if (fetchId !== fetchIdRef.current) return;
      setLoading(false);
      return;
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attachmentId, feedbackId]);

  const download = async () => {
    try {
      const signedUrl = url || await getFeedbackAttachmentUrl({ attachmentId, feedbackId });
      if (!signedUrl) throw new Error('no url');
      const link = document.createElement('a');
      link.href = signedUrl;
      link.download = originalName;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch {
      toast({ tone: 'error', message: 'Unable to download attachment.' });
    }
  };

  return (
    <Modal title={originalName} onClose={onClose}>
      <div className="stack">
        {loading ? <p className="muted">Loading attachment…</p> : null}
        {error ? (
          <Alert tone="danger">
            <div className="stack">
              <span>{error}</span>
              <Button size="sm" onClick={() => void load()}>Retry</Button>
            </div>
          </Alert>
        ) : null}
        {url && !error ? (
          <div style={{ maxWidth: '100%', overflow: 'auto' }}>
            <img
              src={url}
              alt={originalName}
              style={{ maxWidth: '100%', maxHeight: '70vh', height: 'auto', display: 'block', margin: '0 auto' }}
              onError={() => {
                setError('Failed to load image. It may be missing or expired.');
                toast({ tone: 'error', message: 'Failed to load image.' });
              }}
            />
          </div>
        ) : null}
        <div className="row">
          <Button onClick={() => void download()}>Download</Button>
          <Button variant="ghost" onClick={onClose}>Close</Button>
        </div>
      </div>
    </Modal>
  );
}
