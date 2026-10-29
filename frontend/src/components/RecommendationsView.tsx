"use client";

// Shape of `data.recommendations` from POST /api/resumes/:resumeId/match/:jobDescriptionId (Step 7B).

type Priority = 'high' | 'medium' | 'low';
type Category = 'required_skill' | 'preferred_skill' | 'experience' | 'projects' | 'education' | 'resume_content' | 'data_quality';

export interface ResumeRecommendation {
  id: string;
  category: Category;
  priority: Priority;
  title: string;
  issue: string;
  reason: string;
  action: string;
  relatedSkills: string[];
  evidence: string | null;
}

export interface ResumeRecommendations {
  items: ResumeRecommendation[];
  total: number;
  limitations: string[];
  message: string | null;
}

const PRIORITY_STYLES: Record<Priority, string> = {
  high: 'bg-red-50 text-red-700 border-red-200',
  medium: 'bg-amber-50 text-amber-800 border-amber-200',
  low: 'bg-gray-50 text-gray-700 border-gray-200',
};

const CATEGORY_LABELS: Record<Category, string> = {
  required_skill: 'Required skill',
  preferred_skill: 'Preferred skill',
  experience: 'Experience',
  projects: 'Projects',
  education: 'Education',
  resume_content: 'Resume content',
  data_quality: 'Missing information',
};

function Field({ label, children }: { label: string; children: string }) {
  return (
    <div>
      <dt className="text-xs font-medium text-gray-500">{label}</dt>
      <dd className="text-sm text-gray-800 break-words">{children}</dd>
    </div>
  );
}

interface Props {
  recommendations: ResumeRecommendations | null;
  error: { code: string; message: string } | null;
}

export default function RecommendationsView({ recommendations, error }: Props) {
  return (
    <section aria-labelledby="recommendations-heading" className="border border-gray-200 rounded-lg p-3 bg-white space-y-3">
      <h3 id="recommendations-heading" className="text-xs font-semibold uppercase tracking-wide text-gray-500">
        Resume Improvement Recommendations
      </h3>

      {!recommendations ? (
        <p className="text-sm text-gray-500">{error?.message || 'Recommendations are not available.'}</p>
      ) : recommendations.items.length === 0 ? (
        <p className="text-sm text-gray-600">{recommendations.message || 'No specific recommendation could be reliably generated.'}</p>
      ) : (
        <ol className="space-y-3">
          {recommendations.items.map((item) => (
            <li key={item.id} className="border border-gray-100 rounded-md p-3 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`text-xs font-semibold uppercase border rounded px-1.5 py-0.5 ${PRIORITY_STYLES[item.priority]}`}>
                  <span className="sr-only">Priority: </span>
                  {item.priority}
                </span>
                <span className="text-xs text-gray-500">{CATEGORY_LABELS[item.category]}</span>
              </div>
              <p className="font-medium text-gray-900 break-words">{item.title}</p>
              <dl className="space-y-1.5">
                <Field label="Issue">{item.issue}</Field>
                <Field label="Why it matters">{item.reason}</Field>
                <Field label="Suggested action">{item.action}</Field>
              </dl>
              {item.relatedSkills.length > 0 && (
                <p className="text-xs text-gray-600">
                  <span className="font-medium">Related {item.relatedSkills.length === 1 ? 'skill' : 'skills'}:</span>{' '}
                  {item.relatedSkills.join(', ')}
                </p>
              )}
              {item.evidence && <p className="text-xs text-gray-500 break-words">Based on: {item.evidence}</p>}
            </li>
          ))}
        </ol>
      )}

      {recommendations && recommendations.limitations.length > 0 && (
        <div className="text-xs text-gray-500 space-y-0.5">
          <p className="font-medium">Limitations</p>
          {recommendations.limitations.map((limitation) => (
            <p key={limitation}>• {limitation}</p>
          ))}
        </div>
      )}

      <p className="text-xs text-gray-500">
        Recommendations are suggestions only; nothing in your resume is changed. Skills marked &quot;not detected&quot; were not found by the parser,
        which does not mean you lack them. Only add skills and experience you genuinely have.
      </p>
    </section>
  );
}
