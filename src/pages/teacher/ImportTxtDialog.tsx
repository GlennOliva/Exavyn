import { useState } from 'react';
import { Alert, Badge, Button, Modal } from '../../components/ui';
import { parseTxtQuestionnaire } from '../../features/exams/txtImport';
import type { ExamDraftQuestion } from '../../features/exams/types';

export interface ImportTxtDialogProps {
  onCancel: () => void;
  onConfirm: (questions: ExamDraftQuestion[]) => void;
}

export function ImportTxtDialog({ onCancel, onConfirm }: ImportTxtDialogProps) {
  const [text, setText] = useState('');
  const [fileName, setFileName] = useState<string | null>(null);
  const [readError, setReadError] = useState<string | null>(null);

  const result = parseTxtQuestionnaire(text);

  const loadFile = async (file: File | undefined) => {
    if (!file) return;
    setReadError(null);
    try {
      const content = await file.text();
      setText(content);
      setFileName(file.name);
    } catch {
      setReadError('Could not read that file. Paste the questionnaire text instead.');
    }
  };

  return (
    <Modal title="Import questions from TXT" onClose={onCancel}>
      <p className="muted small">
        Upload or paste a plain-text questionnaire. An asterisk before a choice marks the correct
        answer; it is removed from the visible option text. Exactly four choices and one marked
        answer are required per question.
      </p>
      <pre className="instructions small">{`1. Which of the following is a prime number?
a) 4
*b) 5
c) 6
d) 8`}</pre>

      <div className="row" style={{ gap: '1rem', alignItems: 'flex-end' }}>
        <label className="row small" style={{ gap: '0.5rem' }}>
          <span>Questionnaire file (.txt)</span>
          <input
            type="file"
            accept=".txt,text/plain"
            onChange={(event) => void loadFile(event.target.files?.[0])}
          />
        </label>
        {fileName ? <span className="small muted">{fileName}</span> : null}
      </div>

      <label className="small muted" htmlFor="importTxtArea">
        …or paste the questionnaire
      </label>
      <textarea
        id="importTxtArea"
        rows={8}
        value={text}
        onChange={(event) => setText(event.target.value)}
        placeholder={'1. Question?\na) choice\n*b) choice\nc) choice\nd) choice'}
        style={{ width: '100%', marginTop: '0.25rem', fontFamily: 'monospace' }}
      />

      {readError ? <Alert tone="danger" role="alert">{readError}</Alert> : null}

      {text.trim().length === 0 ? (
        <p className="muted small">
          Choose a .txt file or paste the questionnaire above to see a parsed preview.
        </p>
      ) : (
        <div className="stack" style={{ marginTop: '0.75rem' }}>
          <p>
            <Badge tone={result.ok ? 'success' : 'danger'}>
              {result.questions.length} question(s) parsed
            </Badge>{' '}
            {result.ok ? (
              <Badge tone="success">valid</Badge>
            ) : (
              <Badge tone="danger">{result.issues.length} problem(s)</Badge>
            )}
          </p>

          {result.issues.length > 0 ? (
            <Alert tone="danger" role="alert">
              <strong>Fix these before importing:</strong>
              <ul>
                {result.issues.map((issue, index) => (
                  <li key={`${issue.line}-${index}`}>{issue.message}</li>
                ))}
              </ul>
            </Alert>
          ) : null}

          {result.questions.length > 0 ? (
            <div>
              <h3>Preview</h3>
              <p className="muted small">
                Importing replaces the current question list. The marked answer is shown here for
                you only and is never exposed to students.
              </p>
              <ol>
                {result.questions.map((question, index) => (
                  <li key={index} className="mt-1">
                    <div>{question.prompt}</div>
                    <ul>
                      {question.options.map((option, optionIndex) => (
                        <li key={optionIndex}>
                          {option}{' '}
                          {optionIndex === question.correctIndex ? (
                            <Badge tone="success">marked answer</Badge>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ol>
            </div>
          ) : null}
        </div>
      )}

      <div className="row-between mt-2">
        <Button onClick={onCancel}>Cancel</Button>
        <Button
          variant="primary"
          disabled={!result.ok}
          onClick={() => onConfirm(result.questions)}
        >
          Import {result.questions.length} question(s)
        </Button>
      </div>
    </Modal>
  );
}
