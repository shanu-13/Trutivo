// Display names for the AI service's skill category keys.
const CATEGORY_LABELS: Record<string, string> = {
  programming_languages: 'Programming',
  frontend: 'Frontend',
  backend: 'Backend',
  databases: 'Database',
  cloud: 'Cloud & DevOps',
  tools: 'Tools',
  ai_ml: 'AI / ML',
  other: 'Other',
};

export const skillCategoryLabel = (key: string) =>
  CATEGORY_LABELS[key] ?? key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
