import { Badge } from './ui';
import { classifyScore, type ClassifyScoreInput } from '../features/results/score';

export function ScoreBadge(input: ClassifyScoreInput) {
  const classification = classifyScore(input);
  return (
    <Badge tone={classification.tone}>
      <span aria-hidden="true">{classification.icon}</span> {classification.label}
    </Badge>
  );
}
