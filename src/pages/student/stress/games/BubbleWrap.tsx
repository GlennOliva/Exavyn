import { useEffect, useRef, useState } from 'react';
import { Button } from '../../../../components/ui';

const ROWS = 8;
const COLS = 10;

function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(mq.matches);
    const handler = () => setReduced(mq.matches);
    mq.addEventListener?.('change', handler);
    return () => mq.removeEventListener?.('change', handler);
  }, []);
  return reduced;
}

export default function BubbleWrap() {
  const reduced = useReducedMotion();
  const [grid, setGrid] = useState<boolean[][]>(() => Array(ROWS).fill(0).map(() => Array(COLS).fill(true)));
  const [popped, setPopped] = useState(0);
  const [muted, setMuted] = useState(true);
  const audioCtx = useRef<AudioContext | null>(null);

  const pop = (r: number, c: number) => {
    if (!grid[r][c]) return;
    setGrid((g) => {
      const ng = g.map((row) => row.slice());
      ng[r][c] = false;
      return ng;
    });
    setPopped((p) => p + 1);
    if (!muted) {
      try {
        if (!audioCtx.current) {
          const AudioCtx = (window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext);
          if (!AudioCtx) return;
          audioCtx.current = new AudioCtx();
        }
        const ctx = audioCtx.current;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.frequency.value = reduced ? 200 : 420;
        gain.gain.setValueAtTime(0.05, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.08);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.08);
      } catch {
        // ignore
      }
    }
  };

  const reset = () => {
    setGrid(Array(ROWS).fill(0).map(() => Array(COLS).fill(true)));
    setPopped(0);
  };

  useEffect(() => {
    return () => {
      try {
        void audioCtx.current?.close();
      } catch {
        // ignore
      }
    };
  }, []);

  return (
    <div className="stack">
      <div className="row-between">
        <div>
          <h2>Bubble Pop</h2>
          <p className="muted small">Click or tap bubbles. Sound is off by default.</p>
        </div>
        <div className="row">
          <span className="small muted">Popped: {popped}</span>
          <Button size="sm" onClick={() => setMuted((m) => !m)}>{muted ? 'Unmute' : 'Mute'}</Button>
          <Button size="sm" onClick={reset}>Reset sheet</Button>
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${COLS}, minmax(0, 1fr))`, gap: 6 }}>
        {grid.map((row, r) =>
          row.map((active, c) => (
            <button
              key={`${r}-${c}`}
              type="button"
              onClick={() => pop(r, c)}
              disabled={!active}
              aria-label={active ? `Pop bubble ${r + 1}-${c + 1}` : 'Popped bubble'}
              style={{
                width: '100%',
                aspectRatio: '1',
                borderRadius: '50%',
                border: '1px solid var(--border)',
                background: active ? 'radial-gradient(circle at 30% 30%, var(--primary-soft), var(--surface-2))' : 'var(--surface-2)',
                boxShadow: active && !reduced ? 'inset 0 2px 4px rgba(255,255,255,0.3)' : 'none',
                transition: reduced ? 'none' : 'transform 80ms ease',
                transform: active ? 'scale(1)' : 'scale(0.7)',
                opacity: active ? 1 : 0.4,
                cursor: active ? 'pointer' : 'default',
              }}
            />
          )),
        )}
      </div>
    </div>
  );
}
