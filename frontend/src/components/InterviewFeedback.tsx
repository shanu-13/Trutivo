import type { Evaluation } from '@/lib/api/interviews.api';

export const SCORE_NOTE =
  'Scores are automated, rule-based estimates of how well an answer covers the points the question expects. They are not an objective measure of interview performance.';

// "72/100" with a text band, so the score never relies on colour alone.
export const scoreBand = (score: number) => (score >= 70 ? 'Strong' : score >= 50 ? 'Developing' : 'Needs work');

function List({ title, items, symbol }: { title: string; items: string[]; symbol: string }) {
  if (items.length === 0) return null;
  return (
    <div>
      <h4 className="font-semibold text-gray-900 text-sm mb-1">{title}</h4>
      <ul className="space-y-1 text-sm text-gray-800">
        {items.map((item) => (
          <li key={item} className="flex gap-2">
            <span aria-hidden="true" className="shrink-0">
              {symbol}
            </span>
            <span className="break-words">{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// Feedback for one submitted answer (Step 16).
export default function InterviewFeedback({ evaluation: e }: { evaluation: Evaluation }) {
  return (
    <section aria-label="Answer feedback" className="border border-gray-200 rounded-lg p-4 space-y-4 bg-gray-50">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 className="font-bold text-gray-900">Automated feedback</h3>
        <p className="text-2xl font-bold tabular-nums text-gray-900">
          {e.score}
          <span className="text-base font-medium text-gray-500">/100</span>
        </p>
        <span className="text-sm font-medium text-gray-700">{scoreBand(e.score)}</span>
      </div>
      <p className="text-xs text-gray-500">{SCORE_NOTE}</p>
      {e.insufficientDetail && (
        <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded px-3 py-2">
          <span aria-hidden="true">⚑ </span>
          This answer does not contain enough information to assess properly, so the score is capped. Add what you actually know or did; do not fill gaps with invented details.
        </p>
      )}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <List title="Strengths" items={e.strengths} symbol="✓" />
        <List title="Missing or underdeveloped" items={e.missingPoints} symbol="–" />
      </div>
      <List title="Suggestions" items={e.suggestions} symbol="→" />
      {e.exampleAnswer && (
        <div>
          <h4 className="font-semibold text-gray-900 text-sm mb-1">How a stronger answer could be structured</h4>
          <p className="text-sm text-gray-800 bg-white border border-gray-200 rounded p-3 whitespace-pre-wrap break-words">{e.exampleAnswer}</p>
          <p className="text-xs text-gray-500 mt-1">Fill the [bracketed] parts only with things that are true for you.</p>
        </div>
      )}
      <List title="Concepts to review" items={e.conceptsToReview} symbol="◇" />
    </section>
  );
}
