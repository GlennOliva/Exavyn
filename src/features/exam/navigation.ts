/**
 * Controlled navigation for marked/unanswered questions.
 * Ensures latest answer state is flushed before navigation.
 */
export interface NavigationState {
  currentIndex: number;
  order: string[];
}

export function computeUnanswered(answers: Record<string, string | null | undefined>, questionIds: string[]): string[] {
  return questionIds.filter((id) => answers[id] === null || answers[id] === undefined || answers[id] === '');
}

export function computeAnsweredCount(answers: Record<string, string | null | undefined>, questionIds: string[]): number {
  return questionIds.filter((id) => answers[id] !== null && answers[id] !== undefined && answers[id] !== '').length;
}
