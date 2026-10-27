import { WORD_HINT_MAP } from '../wordHints';
import { useEffect, useMemo, useState } from 'react';
import { Alert, Button } from '../../../../components/ui';

const WORDS = [
  'apple','beach','blame','block','bread','brick','bring','brown','chart','chess','child','clean','clock','cloud','count','craft','cream','crime','cross','crowd',
  'dance','doubt','draft','dream','dress','drink','drive','earth','enjoy','enter','equal','error','event','faith','field','final','flame','flash','float','floor',
  'focus','force','frame','fresh','front','fruit','glass','globe','grace','grade','grant','grass','great','green','group','guard','guess','guide','happy','heart',
  'heavy','house','human','image','input','issue','joint','judge','knife','laugh','learn','level','light','limit','local','logic','lucky','lunch','major','march',
  'match','maybe','metal','model','money','month','moral','motor','mount','mouse','mouth','music','never','night','noise','north','novel','nurse','offer','order',
  'other','owner','paint','panel','paper','party','peace','phone','pilot','pitch','place','plain','plane','plant','plate','point','power','press','price','print',
  'prize','proof','proud','prove','quick','quiet','quite','radio','raise','range','rapid','ratio','reach','ready','refer','relax','reply','right','river','rough',
  'round','route','royal','rural','scale','scene','score','sense','serve','shade','shake','shall','shape','share','sharp','sheet','shelf','shine','shirt','shock',
  'shoot','short','shout','show','sight','since','skill','sleep','slide','small','smart','smell','smile','smoke','solid','solve','sound','south','space','spare',
  'speak','speed','spell','spend','spice','spite','split','sport','spot','spray','stack','staff','stage','stain','stair','stake','stand','start','state','steam',
  'steel','stick','still','stock','stone','stop','store','storm','story','strip','study','stuff','style','sugar','suite','super','sweet','table','taste','teach',
  'teeth','thank','theme','there','thick','thing','think','third','throw','tight','tired','title','today','tooth','topic','total','touch','tough','tower','track',
  'trade','train','treat','trend','trial','trick','trip','truck','trust','truth','twice','uncle','under','union','unity','until','upper','upset','urban','usage',
  'usual','valid','value','video','virus','visit','voice','voter','waste','watch','water','wave','wear','wheel','where','which','while','white','whole','whose',
  'woman','world','worry','worse','worst','worth','would','write','wrong','yield','young','youth'
];

const KEYBOARD = [
  ['q','w','e','r','t','y','u','i','o','p'],
  ['a','s','d','f','g','h','j','k','l'],
  ['Enter','z','x','c','v','b','n','m','Backspace'],
];

function pickWord() {
  const candidates = WORDS.filter((w) => WORD_HINT_MAP.has(w.toUpperCase()));
  const pool = candidates.length > 0 ? candidates : WORDS;
  return pool[Math.floor(Math.random() * pool.length)].toUpperCase();
}

interface WordState {
  solution: string;
  guesses: string[];
  current: string;
  status: 'playing' | 'won' | 'lost';
  hintShown?: boolean;
}

function getState(): WordState | null {
  try {
    const raw = localStorage.getItem('exavyn.wordguess.state');
    if (!raw) return null;
    const parsed = JSON.parse(raw) as WordState;
    return parsed;
  } catch {
    return null;
  }
}

function saveState(state: WordState) {
  try {
    localStorage.setItem('exavyn.wordguess.state', JSON.stringify(state));
  } catch {
    // ignore
  }
}

export default function WordGuess() {
  const saved = getState();
  const [solution, setSolution] = useState<string>(() => saved?.solution || pickWord());
  const [guesses, setGuesses] = useState<string[]>(() => saved?.guesses || []);
  const [current, setCurrent] = useState<string>(() => saved?.current || '');
  const [status, setStatus] = useState<'playing' | 'won' | 'lost'>(() => saved?.status || 'playing');
  const [showRules, setShowRules] = useState(false);
  const [hintShown, setHintShown] = useState<boolean>(() => saved?.hintShown || false);

  useEffect(() => {
    saveState({ solution, guesses, current, status, hintShown });
  }, [solution, guesses, current, status, hintShown]);

  const maxGuesses = 6;
  const isOver = status !== 'playing';

  const addLetter = (letter: string) => {
    if (isOver || current.length >= 5) return;
    setCurrent((c) => c + letter.toUpperCase());
  };

  const removeLetter = () => {
    if (isOver) return;
    setCurrent((c) => c.slice(0, -1));
  };

  const submitGuess = () => {
    if (isOver || current.length !== 5) return;
    const guess = current;
    if (!WORDS.includes(guess.toLowerCase())) {
      // Don't crash, just ignore invalid word silently per rules focus
      return;
    }
    const nextGuesses = [...guesses, guess];
    setGuesses(nextGuesses);
    if (guess === solution) {
      setStatus('won');
      setCurrent('');
      return;
    }
    if (nextGuesses.length >= maxGuesses) {
      setStatus('lost');
      setCurrent('');
      return;
    }
    setCurrent('');
  };

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === 'Enter') {
        e.preventDefault();
        submitGuess();
        return;
      }
      if (e.key === 'Backspace') {
        e.preventDefault();
        removeLetter();
        return;
      }
      if (/^[a-zA-Z]$/.test(e.key)) {
        e.preventDefault();
        addLetter(e.key);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  });

  const keyState = useMemo(() => {
    const map: Record<string, 'correct' | 'present' | 'absent'> = {};
    for (const guess of guesses) {
      for (let i = 0; i < 5; i++) {
        const letter = guess[i];
        let state: 'correct' | 'present' | 'absent' = 'absent';
        if (guess[i] === solution[i]) state = 'correct';
        else if (solution.includes(guess[i])) state = 'present';
        else state = 'absent';
        if (state === 'correct' || (state === 'present' && map[letter] !== 'correct') || !map[letter]) {
          map[letter] = state;
        }
      }
    }
    return map;
  }, [guesses, solution]);

  const newGame = () => {
    const w = pickWord();
    setSolution(w);
    setGuesses([]);
    setCurrent('');
    setStatus('playing');
    setHintShown(false);
    saveState({ solution: w, guesses: [], current: '', status: 'playing', hintShown: false });
  };

  const rows = [...guesses, ...(status === 'playing' ? [current.padEnd(5, ' ')] : [])].slice(0, maxGuesses);

  return (
    <div className="stack">
      <div className="row-between">
        <div>
          <h2>Word Puzzle</h2>
          <p className="muted small">Guess the five-letter word. Scoring is separate from academic grades.</p>
        </div>
        <div className="row">
          <Button size="sm" onClick={() => setShowRules((r) => !r)}>{showRules ? 'Hide rules' : 'Show rules'}</Button>
          <Button size="sm" onClick={() => setHintShown(true)} disabled={hintShown || isOver}>Hint</Button>
          <Button size="sm" onClick={newGame}>New puzzle</Button>
        </div>
      </div>
      {showRules ? (
        <Alert tone="info">
          <strong>Rules:</strong> Guess a five-letter word in up to six tries. Green/correct position, yellow/present elsewhere, gray/absent. Duplicate letters are handled by position. Use the on-screen or physical keyboard. Hint does not consume a guess.
        </Alert>
      ) : null}
      {hintShown ? (
        <Alert tone="info">
          <strong>Hint:</strong> {WORD_HINT_MAP.get(solution) || 'Hint unavailable for this puzzle.'}
        </Alert>
      ) : null}
      {status === 'won' ? <Alert tone="success">Correct! Well done.</Alert> : null}
      {status === 'lost' ? <Alert tone="warning">Out of tries. The word was {solution}.</Alert> : null}
      <div className="stack" style={{ alignItems: 'center' }}>
        {rows.map((guess, ri) => (
          <div key={ri} className="row" style={{ gap: 6 }}>
            {Array(5).fill(0).map((_, i) => {
              const letter = guess[i] === ' ' ? '' : guess[i];
              const isSubmitted = ri < guesses.length;
              let stateClass = '';
              if (isSubmitted && letter) {
                if (guess[i] === solution[i]) stateClass = 'correct';
                else if (solution.includes(guess[i])) stateClass = 'present';
                else stateClass = 'absent';
              }
              return (
                <div
                  key={i}
                  style={{
                    width: 52,
                    height: 52,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    border: '2px solid var(--border)',
                    borderRadius: 6,
                    fontWeight: 700,
                    fontSize: 20,
                    textTransform: 'uppercase',
                    background: isSubmitted && letter ? (stateClass === 'correct' ? 'var(--success)' : stateClass === 'present' ? 'var(--warning)' : 'var(--surface-2)') : 'var(--surface)',
                    color: isSubmitted && letter ? 'var(--on-primary)' : 'var(--text)',
                  }}
                  aria-label={`Row ${ri + 1} column ${i + 1} ${letter || 'empty'} ${isSubmitted && letter ? stateClass : ''}`}
                >
                  {letter}
                </div>
              );
            })}
          </div>
        ))}
      </div>
      <div className="stack" style={{ alignItems: 'center' }}>
        {KEYBOARD.map((row, ri) => (
          <div key={ri} className="row" style={{ gap: 4, flexWrap: 'wrap', justifyContent: 'center' }}>
            {row.map((key) => {
              if (key === 'Enter') {
                return <Button key={key} size="sm" onClick={submitGuess} disabled={isOver || current.length !== 5}>Enter</Button>;
              }
              if (key === 'Backspace') {
                return <Button key={key} size="sm" onClick={removeLetter} disabled={isOver || current.length === 0}>⌫</Button>;
              }
              const st = keyState[key.toUpperCase()];
              return (
                <Button
                  key={key}
                  size="sm"
                  onClick={() => addLetter(key)}
                  disabled={isOver}
                  style={{
                    minWidth: 34,
                    background: st === 'correct' ? 'var(--success)' : st === 'present' ? 'var(--warning)' : st === 'absent' ? 'var(--surface-2)' : undefined,
                    color: st ? 'var(--on-primary)' : undefined,
                  }}
                >
                  {key}
                </Button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}