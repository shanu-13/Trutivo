import { QUESTION_TYPE_INFO, type InterviewSummary as Summary, type QuestionType } from '@/lib/api/interviews.api';
import { SCORE_NOTE } from './InterviewFeedback';

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-gray-200 rounded-lg p-3 bg-gray-50">
      <dt className="text-xs text-gray-600">{label}</dt>
      <dd className="text-xl font-bold text-gray-900 tabular-nums">
        {value}
        {value === '—' && <span className="sr-only">Not available</span>}
      </dd>
    </div>
  );
}

const show = (n: number | null) => (n === null ? '—' : String(n));

// Session summary (Step 16): exact statistics first, then what the automated feedback points to.
export default function InterviewSummary({ summary: s, final }: { summary: Summary; final: boolean }) {
  const st = s.statistics;
  const f = s.feedback;
  return (
    <section aria-labelledby="summary-title" className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 md:p-6 space-y-6">
      <div>
        <h2 id="summary-title" className="text-xl font-bold text-gray-900">
          {final ? 'Session summary' : 'Progress so far'}
        </h2>
        {!final && <p className="text-sm text-gray-600">The final summary is saved when you finish the interview.</p>}
      </div>

      <div>
        <h3 className="font-semibold text-gray-900 mb-1">Statistics</h3>
        <p className="text-xs text-gray-500 mb-3">Calculated exactly from your evaluated answers.</p>
        <dl className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Stat label="Questions answered" value={`${st.evaluated} of ${st.totalQuestions}`} />
          <Stat label="Average score" value={st.averageScore === null ? '—' : `${st.averageScore}/100`} />
          <Stat label="Highest / lowest" value={st.highestScore === null ? '—' : `${st.highestScore} / ${st.lowestScore}`} />
          <Stat label="Drafts not submitted" value={String(st.draftOnly)} />
        </dl>
        {st.averageScore === null && <p className="text-sm text-gray-600 mt-2">No answers have been evaluated, so there is no average score.</p>}
        {Object.keys(st.byType).length > 1 && (
          <table className="mt-3 text-sm w-full max-w-md">
            <caption className="sr-only">Scores by question type</caption>
            <thead>
              <tr className="text-left text-gray-600">
                <th className="font-medium py-1">Type</th>
                <th className="font-medium py-1">Answered</th>
                <th className="font-medium py-1">Average</th>
              </tr>
            </thead>
            <tbody>
              {(Object.entries(st.byType) as [QuestionType, { questions: number; evaluated: number; averageScore: number | null }][]).map(([type, t]) => (
                <tr key={type} className="border-t border-gray-100">
                  <td className="py-1">{QUESTION_TYPE_INFO[type].label}</td>
                  <td className="py-1 tabular-nums">
                    {t.evaluated} of {t.questions}
                  </td>
                  <td className="py-1 tabular-nums">{show(t.averageScore)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="space-y-4">
        <div>
          <h3 className="font-semibold text-gray-900">From the automated feedback</h3>
          <p className="text-xs text-gray-500">{SCORE_NOTE}</p>
        </div>
        {st.evaluated === 0 ? (
          <p className="text-sm text-gray-600">Submit answers for feedback to see strengths and topics to study.</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
            <div>
              <h4 className="font-semibold text-gray-900 mb-1">Strongest areas</h4>
              {f.strongestAreas.length ? (
                <ul className="space-y-1">
                  {f.strongestAreas.map((a) => (
                    <li key={a.focus}>
                      <span aria-hidden="true">✓ </span>
                      {a.focus} <span className="text-gray-500">({a.score}/100)</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-gray-600">No answer scored 70 or more yet.</p>
              )}
            </div>
            <div>
              <h4 className="font-semibold text-gray-900 mb-1">Areas needing improvement</h4>
              {f.areasToImprove.length ? (
                <ul className="space-y-1">
                  {f.areasToImprove.map((a) => (
                    <li key={a.focus}>
                      <span aria-hidden="true">– </span>
                      {a.focus} <span className="text-gray-500">({a.score}/100)</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-gray-600">No answer scored below 60.</p>
              )}
            </div>
            <div>
              <h4 className="font-semibold text-gray-900 mb-1">Frequently missed concepts</h4>
              {f.frequentlyMissedConcepts.length ? (
                <ul className="space-y-1">
                  {f.frequentlyMissedConcepts.map((c) => (
                    <li key={c.concept}>
                      <span aria-hidden="true">◇ </span>
                      {c.concept}
                      {c.count > 1 && <span className="text-gray-500"> (missed in {c.count} answers)</span>}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-gray-600">None.</p>
              )}
            </div>
            <div>
              <h4 className="font-semibold text-gray-900 mb-1">Topics to study next</h4>
              {f.studyNext.length ? (
                <ol className="list-decimal list-inside space-y-1">
                  {f.studyNext.map((t) => (
                    <li key={t}>{t}</li>
                  ))}
                </ol>
              ) : (
                <p className="text-gray-600">Nothing specific; keep practising with new questions.</p>
              )}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
