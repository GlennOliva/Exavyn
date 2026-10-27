import { Suspense, lazy, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Alert, Button, Card, PageSpinner } from '../../components/ui';
import { useAuth } from '../../features/auth/AuthContext';

const BubbleWrap = lazy(() => import('./stress/games/BubbleWrap'));
const WordGuess = lazy(() => import('./stress/games/WordGuess'));
const FallingBlocks = lazy(() => import('./stress/games/FallingBlocks'));

export function StressRelieverPage() {
  useAuth();
  const [tab, setTab] = useState<'home' | 'bubble' | 'word' | 'blocks'>('home');
  const [examBlocked, setExamBlocked] = useState<boolean | null>(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    let active = true;
    const check = async () => {
      setChecking(true);
      try {
        // Check if there is any active attempt by looking up attempts; we don't know examId here
        // Try to find active by checking stored attempt ids across exams? Not directly stored list; check a safe probe
        // Use getMyExamAttempts requires examId; instead rely on server recheck when starting
        // Conservative: allow if not actively in take route; block if exam page is open? Check location
        if (window.location.pathname.includes('/take')) {
          if (active) setExamBlocked(true);
          setChecking(false);
          return;
        }
        // Best effort: if any attempt stored locally is recent, block
        const keys = Object.keys(localStorage);
        const hasActive = keys.some((k) => k.startsWith('ace-attempt-id-'));
        if (active) setExamBlocked(hasActive);
      } catch {
        if (active) setExamBlocked(null);
      } finally {
        if (active) setChecking(false);
      }
    };
    void check();
    const onStorage = () => void check();
    window.addEventListener('storage', onStorage);
    return () => {
      active = false;
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  useEffect(() => {
    const onFocus = () => {
      // Recheck on focus
      void (async () => {
        if (window.location.pathname.includes('/take')) {
          setExamBlocked(true);
          return;
        }
        const keys = Object.keys(localStorage);
        setExamBlocked(keys.some((k) => k.startsWith('ace-attempt-id-')));
      })();
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, []);

  if (checking) return <PageSpinner />;
  if (examBlocked === true) {
    return (
      <div className="narrow stack">
        <Card>
          <h1>Stress Reliever</h1>
          <Alert tone="warning">Games are not available during an active examination.</Alert>
          <p className="muted">Return to your exam or check your dashboard. If you believe this is an error, retry status verification.</p>
          <div className="row">
            <Button onClick={() => window.location.reload()}>Retry</Button>
            <Link className="btn" to="/student">Back to dashboard</Link>
          </div>
        </Card>
      </div>
    );
  }
  if (examBlocked === null) {
    return (
      <div className="narrow stack">
        <Card>
          <h1>Stress Reliever</h1>
          <Alert tone="warning">Could not verify exam status. Retry rather than assuming gameplay is allowed.</Alert>
          <div className="row">
            <Button onClick={() => window.location.reload()}>Retry</Button>
            <Link className="btn" to="/student">Back to dashboard</Link>
          </div>
        </Card>
      </div>
    );
  }

  if (tab !== 'home') {
    return (
      <div className="stack">
        <div className="row-between">
          <div>
            <h1>Stress Reliever</h1>
            <p className="muted">Take a short break. This module is recreational and not a medical treatment.</p>
          </div>
          <Button onClick={() => setTab('home')}>Back to games</Button>
        </div>
        <Card>
          <Suspense fallback={<PageSpinner />}>
            {tab === 'bubble' ? <BubbleWrap /> : null}
            {tab === 'word' ? <WordGuess /> : null}
            {tab === 'blocks' ? <FallingBlocks /> : null}
          </Suspense>
        </Card>
      </div>
    );
  }

  return (
    <div className="stack">
      <div>
        <h1>Stress Reliever</h1>
        <p className="muted">A short, recreational break. Designed for relaxation; not a treatment for anxiety or a guarantee of stress reduction.</p>
      </div>
      <div className="grid grid-3">
        <Card>
          <h3>Bubble Pop</h3>
          <p className="muted">Tap or click bubbles to pop them. Sound optional and off by default.</p>
          <Button variant="primary" onClick={() => setTab('bubble')}>Play Bubble Pop</Button>
        </Card>
        <Card>
          <h3>Word Puzzle</h3>
          <p className="muted">Guess the five-letter word in six tries with color/label feedback.</p>
          <Button variant="primary" onClick={() => setTab('word')}>Play Word Puzzle</Button>
        </Card>
        <Card>
          <h3>Stack Blocks</h3>
          <p className="muted">Move, rotate, and clear lines. Pause anytime.</p>
          <Button variant="primary" onClick={() => setTab('blocks')}>Play Stack Blocks</Button>
        </Card>
      </div>
    </div>
  );
}
