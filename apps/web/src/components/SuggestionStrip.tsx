import type { Suggestion } from '../lib/suggestions';

export function SuggestionStrip({ suggestion }: { suggestion: Suggestion | null }) {
  if (!suggestion) return null;
  return (
    <div className={`suggestion-strip suggestion-${suggestion.type}`}>
      <span className="suggestion-text">{suggestion.text}</span>
    </div>
  );
}
