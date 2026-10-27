import { Alert, Button, Card } from '../../../../components/ui';
import { useCallback, useEffect, useRef, useState } from 'react';

const COLS = 10;
const ROWS = 20;
const EMPTY = 0;

const SHAPES = [
  [[1,1,1,1]], // I
  [[1,1],[1,1]], // O
  [[0,1,0],[1,1,1]], // T
  [[0,1,1],[1,1,0]], // S
  [[1,1,0],[0,1,1]], // Z
  [[1,0,0],[1,1,1]], // J
  [[0,0,1],[1,1,1]], // L
];

function randomShape() {
  const shape = SHAPES[Math.floor(Math.random() * SHAPES.length)].map(row => [...row]);
  return { shape, x: Math.floor((COLS - shape[0].length) / 2), y: 0 };
}

function rotate(matrix: number[][]) {
  const N = matrix.length;
  const M = matrix[0].length;
  const result = Array(M).fill(0).map(() => Array(N).fill(0));
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < M; x++) {
      result[x][N - 1 - y] = matrix[y][x];
    }
  }
  return result;
}

export default function FallingBlocks() {
  const [board, setBoard] = useState<number[][]>(() => Array(ROWS).fill(0).map(() => Array(COLS).fill(EMPTY)));
  const [piece, setPiece] = useState(() => randomShape());
  const [nextPiece, setNextPiece] = useState(() => randomShape());
  const [score, setScore] = useState(0);
  const [lines, setLines] = useState(0);
  const [gameOver, setGameOver] = useState(false);
  const [paused, setPaused] = useState(false);
  const dropInterval = useRef<number>(800);
  const lastDrop = useRef<number>(Date.now());
  const raf = useRef<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const isValid = useCallback((shape: number[][], x: number, y: number, testBoard?: number[][]) => {
    const tb = testBoard !== undefined ? testBoard : board;
    for (let r = 0; r < shape.length; r++) {
      for (let c = 0; c < shape[r].length; c++) {
        if (shape[r][c]) {
          const nx = x + c;
          const ny = y + r;
          if (nx < 0 || nx >= COLS || ny >= ROWS) return false;
          if (ny >= 0 && tb[ny][nx]) return false;
        }
      }
    }
    return true;
  }, [board]);

  const mergePiece = useCallback((currentPiece: any, currentBoard: number[][]) => {
    const newBoard = currentBoard.map(row => [...row]);
    for (let r = 0; r < currentPiece.shape.length; r++) {
      for (let c = 0; c < currentPiece.shape[r].length; c++) {
        if (currentPiece.shape[r][c]) {
          if (currentPiece.y + r < 0) {
            setGameOver(true);
            return currentBoard;
          }
          newBoard[currentPiece.y + r][currentPiece.x + c] = 1;
        }
      }
    }
    let cleared = 0;
    const filtered = newBoard.filter(row => {
      if (row.every(cell => cell === 1)) {
        cleared++;
        return false;
      }
      return true;
    });
    while (filtered.length < ROWS) {
      filtered.unshift(Array(COLS).fill(EMPTY));
    }
    if (cleared > 0) {
      setLines(l => l + cleared);
      setScore(s => s + cleared * 100 * cleared);
    }
    return filtered;
  }, []);

  const lockPiece = useCallback(() => {
    const merged = mergePiece(piece, board) as number[][];
    setBoard(merged);
    const newP = nextPiece;
    setNextPiece(randomShape());
    if (!isValid(newP.shape, newP.x, newP.y, merged)) {
      setGameOver(true);
      return;
    }
    setPiece(newP);
  }, [piece, board, nextPiece, isValid, mergePiece]);

  const move = useCallback((dir: -1 | 1) => {
    if (gameOver || paused) return;
    if (isValid(piece.shape, piece.x + dir, piece.y)) {
      setPiece(p => ({ ...p, x: p.x + dir }));
    }
  }, [gameOver, paused, piece, isValid]);

  const rotatePiece = useCallback(() => {
    if (gameOver || paused) return;
    const rotated = rotate(piece.shape);
    if (isValid(rotated, piece.x, piece.y)) {
      setPiece(p => ({ ...p, shape: rotated }));
    }
  }, [gameOver, paused, piece, isValid]);

  const drop = useCallback(() => {
    if (gameOver || paused) return;
    if (isValid(piece.shape, piece.x, piece.y + 1)) {
      setPiece(p => ({ ...p, y: p.y + 1 }));
    } else {
      lockPiece();
    }
  }, [gameOver, paused, piece, isValid, lockPiece]);

  const hardDrop = useCallback(() => {
    if (gameOver || paused) return;
    let y = piece.y;
    while (isValid(piece.shape, piece.x, y + 1)) {
      y++;
    }
    setPiece(p => ({ ...p, y }));
    setTimeout(() => lockPiece(), 0);
  }, [gameOver, paused, piece, isValid, lockPiece]);

  const restart = useCallback(() => {
    setBoard(Array(ROWS).fill(0).map(() => Array(COLS).fill(EMPTY)));
    setPiece(randomShape());
    setNextPiece(randomShape());
    setScore(0);
    setLines(0);
    setGameOver(false);
    setPaused(false);
  }, []);

  useEffect(() => {
    const loop = () => {
      const now = Date.now();
      if (!gameOver && !paused && now - lastDrop.current > dropInterval.current) {
        drop();
        lastDrop.current = now;
      }
      raf.current = requestAnimationFrame(loop);
    };
    raf.current = requestAnimationFrame(loop);
    return () => {
      if (raf.current !== null) cancelAnimationFrame(raf.current);
    };
  }, [drop, gameOver, paused]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (document.hidden) return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;
      if (containerRef.current && !containerRef.current.contains(e.target as Node) && e.target !== document.body) {
        // Only handle if focused within game
      }
      if (!containerRef.current?.contains(document.activeElement) && document.activeElement !== containerRef.current) {
        // Still allow if container focused
      }
      if (e.key === 'ArrowLeft') { e.preventDefault(); move(-1); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); move(1); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); drop(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); rotatePiece(); }
      else if (e.key === ' ') { e.preventDefault(); hardDrop(); }
      else if (e.key === 'p' || e.key === 'P') { e.preventDefault(); setPaused(p => !p); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [move, rotatePiece, drop, hardDrop]);

  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden) setPaused(true);
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  const renderBoard = () => {
    const display = board.map(row => [...row]);
    // Draw piece
    for (let r = 0; r < piece.shape.length; r++) {
      for (let c = 0; c < piece.shape[r].length; c++) {
        if (piece.shape[r][c]) {
          if (piece.y + r >= 0 && piece.y + r < ROWS && piece.x + c >= 0 && piece.x + c < COLS) {
            display[piece.y + r][piece.x + c] = 2;
          }
        }
      }
    }
    return display;
  };

  const display = renderBoard();

  return (
    <div className="stack" ref={containerRef} tabIndex={0} role="application" aria-label="Falling Blocks game">
      <div className="row-between">
        <div>
          <h2>Stack Blocks</h2>
          <p className="muted small">Arrows to move/rotate, Space for hard drop, P to pause.</p>
        </div>
        <div className="row">
          <span className="small muted">Score: {score} | Lines: {lines}</span>
          <Button size="sm" onClick={() => setPaused(p => !p)}>{paused ? 'Resume' : 'Pause'}</Button>
          <Button size="sm" onClick={restart}>Restart</Button>
        </div>
      </div>
      {gameOver ? <Alert tone="warning">Game Over</Alert> : null}
      {paused && !gameOver ? <Alert tone="info">Paused</Alert> : null}
      <div className="row" style={{ gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${COLS}, 1fr)`, gap: 1, background: 'var(--border)', padding: 1, width: 220 }}>
          {display.map((row, r) => 
            row.map((cell, c) => (
              <div
                key={`${r}-${c}`}
                style={{
                  width: 21,
                  height: 21,
                  background: cell === 2 ? 'var(--primary)' : cell === 1 ? 'var(--text)' : 'var(--surface)',
                }}
                aria-hidden="true"
              />
            ))
          )}
        </div>
        <div className="stack">
          <Card>
            <p className="small"><strong>Controls</strong></p>
            <ul className="small muted">
              <li>←/→ Move</li>
              <li>↑ Rotate</li>
              <li>↓ Soft drop</li>
              <li>Space Hard drop</li>
              <li>P Pause/Resume</li>
            </ul>
          </Card>
          <Card>
            <p className="small"><strong>Touch controls</strong></p>
            <div className="row">
              <Button size="sm" onClick={() => move(-1)}>←</Button>
              <Button size="sm" onClick={() => rotatePiece}>↻</Button>
              <Button size="sm" onClick={() => move(1)}>→</Button>
            </div>
            <div className="row">
              <Button size="sm" onClick={() => drop}>↓</Button>
              <Button size="sm" onClick={() => hardDrop}>Drop</Button>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}