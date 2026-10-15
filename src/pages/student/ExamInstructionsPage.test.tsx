import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ExamInstructionsPage } from './ExamInstructionsPage';
import { getExamVersion, getStudentExam } from '../../features/exams/api';
import { getMyExamAttempts } from '../../features/attempts/api';

vi.mock('../../features/exams/api', () => ({
  getStudentExam: vi.fn(),
  getExamVersion: vi.fn(),
}));
vi.mock('../../features/attempts/api', () => ({
  startAttempt: vi.fn(),
  getMyExamAttempts: vi.fn(),
}));
vi.mock('../../features/attempts/storage', () => ({
  getAttemptIdForExam: vi.fn(() => null),
  getControllerToken: vi.fn(() => null),
  setAttemptIdForExam: vi.fn(),
  setControllerToken: vi.fn(),
}));

const HOUR = 60 * 60 * 1000;

function makeExam(opensInMs: number, closesInMs: number) {
  const now = Date.now();
  return {
    id: 'exam-1',
    course_id: 'course-1',
    title: 'Midterm Exam',
    instructions: 'Answer everything.',
    duration_minutes: 60,
    opens_at: new Date(now + opensInMs).toISOString(),
    closes_at: new Date(now + closesInMs).toISOString(),
    current_version_id: 'v1',
    result_release: 'immediate',
  };
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/student/exams/exam-1']}>
      <Routes>
        <Route path="/student/exams/:examId" element={<ExamInstructionsPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('ExamInstructionsPage availability', () => {
  beforeEach(() => {
    vi.mocked(getExamVersion).mockResolvedValue({ item_count: 3 } as never);
    vi.mocked(getMyExamAttempts).mockResolvedValue({
      max_attempts: 1,
      used: 0,
      remaining: 1,
      result_policy: 'latest',
      answer_review: 'immediate',
      pass_threshold: null,
      active_attempt_id: null,
      attempts: [],
      summary: null,
    });
    // jsdom does not implement the Fullscreen API; make the page believe it is
    // supported so the start button's availability gating is what we test.
    Object.defineProperty(document, 'fullscreenEnabled', { value: true, configurable: true });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it('explains that an upcoming exam has not opened yet and blocks starting', async () => {
    vi.mocked(getStudentExam).mockResolvedValue(makeExam(HOUR, 2 * HOUR) as never);
    renderPage();

    expect(await screen.findByText('This exam has not opened yet.')).toBeInTheDocument();
    const start = screen.getByRole('button', { name: /enter fullscreen & start/i });
    await userEvent.click(screen.getByRole('checkbox'));
    expect(screen.getByText(/has not opened yet/i)).toBeInTheDocument();
    expect(start).toBeDisabled();
  });

  it('shows the opening time with an explicit timezone', async () => {
    vi.stubEnv('TZ', 'Asia/Manila');
    vi.mocked(getStudentExam).mockResolvedValue(makeExam(HOUR, 2 * HOUR) as never);
    renderPage();
    expect(await screen.findByText(/has not opened yet/i)).toBeInTheDocument();
    expect(screen.getAllByText(/Asia\/Manila/).length).toBeGreaterThan(0);
  });

  it('blocks the start button once the exam has closed', async () => {
    vi.mocked(getStudentExam).mockResolvedValue(makeExam(-2 * HOUR, -HOUR) as never);
    renderPage();
    expect(await screen.findByText('This exam has closed.')).toBeInTheDocument();
    const button = screen.getByRole('button', { name: /enter fullscreen & start/i });
    await userEvent.click(screen.getByRole('checkbox'));
    expect(button).toBeDisabled();
  });

  it('enables the start button once acknowledged for an open exam', async () => {
    vi.mocked(getStudentExam).mockResolvedValue(makeExam(-HOUR, HOUR) as never);
    renderPage();
    const button = await screen.findByRole('button', { name: /enter fullscreen & start/i });
    expect(button).toBeDisabled();
    await userEvent.click(screen.getByRole('checkbox'));
    expect(button).toBeEnabled();
  });

  it('shows remaining attempts and blocks starting when attempts are exhausted', async () => {
    vi.mocked(getStudentExam).mockResolvedValue(makeExam(-HOUR, HOUR) as never);
    vi.mocked(getMyExamAttempts).mockResolvedValue({
      max_attempts: 2,
      used: 2,
      remaining: 0,
      result_policy: 'highest',
      answer_review: 'immediate',
      pass_threshold: null,
      active_attempt_id: null,
      attempts: [],
      summary: null,
    });
    renderPage();

    expect(await screen.findByText('No attempts remaining.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('checkbox'));
    const button = screen.getByRole('button', { name: /start attempt 3/i });
    expect(button).toBeDisabled();
  });
});
