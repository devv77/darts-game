import type { Suggestion } from '../lib/suggestions';

const phaseLabels: Record<string, string> = {
  scoring: 'Score',
  setup: 'Setup',
  checkout: 'Checkout',
  safety: 'Safety',
};

export function SuggestionStrip({ suggestion }: { suggestion: Suggestion | null }) {
  if (!suggestion) return null;
  return (
    <div className={`suggestion-strip suggestion-${suggestion.type}`}>
      <span className="suggestion-phase">{phaseLabels[suggestion.type] ?? suggestion.type}</span>
      <span className="suggestion-text">{suggestion.text}</span>
    </div>
  );
}
