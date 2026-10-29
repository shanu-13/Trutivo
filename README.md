# AI Resume Analyzer & Job Matching Platform

## 1. Project Overview
A platform for analysing resumes and matching them to job descriptions. Users upload PDF resumes, see extracted text, skills and sections, compare resumes with saved job descriptions (rule-based and semantic matching with explanations and recommendations), keep match history and dashboard analytics, manage resume versions and job-specific tailoring, export to PDF and DOCX, check ATS readiness, write cover letters, track job applications, and keep reminders and application insights. Sections 10–26 and 28 describe each feature.

All "AI" features are deterministic rules plus a local embedding model (`sentence-transformers/all-MiniLM-L6-v2`) for semantic matching. No external LLM or paid AI API is used.

## 2. Architecture and tech stack
```
Browser ──► Frontend (Next.js 16, React 19, Tailwind)        port 3000
              │  fetch with credentials (HTTP-only session cookie)
              ▼
            Backend (Node.js, Express, TypeScript)            port 5000 ──► MySQL 8
              │  X-Internal-API-Key                                      └─► private file storage (UPLOAD_DIR)
              ▼
            AI service (Python 3.11, FastAPI)                 port 8000   (never called by the browser)
```
- The backend owns authentication (JWT in an HTTP-only cookie), every ownership check and all database access.
- The AI service is stateless and is only called by the backend, with a shared key.

## 3. Folder Structure
- `frontend/`: Next.js application (`src/app` routes, `src/components`, `src/lib/api` for the API client)
- `backend/`: Express API (`src/routes`, `src/controllers`, `src/services`, `src/config/env.ts` for startup configuration, `src/scripts/migrate.ts` for the migration runner)
- `ai-service/`: FastAPI service (`app/routes`, `app/services`, `tests`)
- `database/migrations/`: numbered SQL migrations `001`–`015`
- `docker-compose.yml`, `*/Dockerfile`, `.env.example` files

## 4. Local Setup

### Prerequisites
- Node.js **20.9 or newer** (Next.js 16 requirement; tested with Node 22)
- Python **3.10+** with `venv` (on Debian/Ubuntu: `sudo apt install python3-venv`)
- MySQL **8.0**
- Docker with Compose v2 (only for the container setup in section 9)

### First run
```bash
# 1. Database (MySQL running locally)
mysql -u root -p -e "CREATE DATABASE ai_resume_analyzer"

# 2. Backend
cd backend
cp .env.example .env            # set DB_PASSWORD and JWT_SECRET (openssl rand -hex 32)
npm install
npm run migrate:dev             # applies database/migrations in order (see "Migrations")
npm run dev                     # http://localhost:5000

# 3. AI service (another terminal)
cd ai-service
python3 -m venv venv
venv/bin/pip install -r requirements.txt   # CPU-only PyTorch, see section 13
cp .env.example .env
venv/bin/python -m uvicorn app.main:app --reload --port 8000

# 4. Frontend (another terminal)
cd frontend
cp .env.example .env.local      # NEXT_PUBLIC_API_URL=http://localhost:5000/api
npm install
npm run dev                     # http://localhost:3000
```
If `source venv/bin/activate` fails, `python3-venv` is missing. Install it, or call `venv/bin/python` directly as above.

### Migrations
SQL files in `database/migrations/` are applied by the backend's runner, which records each file in a `schema_migrations` table so it runs exactly once:

| Command (in `backend/`) | Purpose |
|---|---|
| `npm run migrate:dev` | Apply pending migrations (TypeScript source, for development) |
| `npm run build && npm run migrate` | Same, from the compiled build (production) |
| `npm run migrate -- --status` | List applied and pending files |
| `npm run migrate -- --baseline 010` | Record 001–010 as already applied, without running them |

- **Databases migrated by hand.** If you applied migrations with `mysql < file.sql` before this runner existed, run `--baseline` with the last file you applied first, then `migrate`. Otherwise the runner tries 001 again; 003 then fails with "Duplicate column" and nothing further is changed.
- **Connection and other databases.** The runner uses the backend's `DB_*` settings and ignores the `USE ai_resume_analyzer;` line in each file, so it works for any database name.
- **No undo.** It never drops anything, and there are no down-migrations. MySQL commits DDL immediately, so take a backup before migrating a database that holds real data.
- **Manual use still works:** `mysql -u <user> -p < database/migrations/NNN_name.sql`, in number order.

## 5. Environment Variables
Every service reads its own settings. Each `.env.example` lists all variables with placeholder values only. Never commit real `.env` files (they are git-ignored), and in production set the values in the hosting platform's secret settings.

| Service | File | Required in production |
|---|---|---|
| Backend | `backend/.env.example` | `NODE_ENV=production`, `JWT_SECRET` (32+ chars), `FRONTEND_URL` (https), `DB_HOST`/`DB_PORT`/`DB_NAME`/`DB_USER`/`DB_PASSWORD`, `AI_SERVICE_URL`, `INTERNAL_API_KEY` (32+ chars), `UPLOAD_DIR` (persistent storage) |
| AI service | `ai-service/.env.example` | `ENVIRONMENT=production`, `INTERNAL_API_KEY` (same value as the backend's) |
| Frontend | `frontend/.env.example` | `NEXT_PUBLIC_API_URL` (public backend URL ending in `/api`, **needed at build time**) |
| Docker Compose | `.env.example` (root) | `MYSQL_ROOT_PASSWORD`, `DB_PASSWORD`, `JWT_SECRET`, `INTERNAL_API_KEY` |

**Startup checks.**
- **Backend.** With `NODE_ENV=production`, the backend refuses to start, naming the problem but never the value, when any of these hold:
  - `JWT_SECRET` is missing, a placeholder, or shorter than 32 characters;
  - `FRONTEND_URL` is missing or not https (http is allowed only for `localhost`);
  - `INTERNAL_API_KEY` or `DB_PASSWORD` is missing or a placeholder;
  - `COOKIE_SECURE` is false;
  - `COOKIE_SAMESITE`, `TRUST_PROXY` or `JWT_EXPIRES_IN` is invalid.

  In development the same problems are warnings, and local defaults apply.
- **AI service.** With `ENVIRONMENT=production`, it refuses to start without an `INTERNAL_API_KEY` of 32+ characters, and its `/docs` pages are turned off.
- **Frontend.** `next build` fails if `NEXT_PUBLIC_API_URL` is not set, so a production bundle can never fall back to `http://localhost:5000`.

**Cookies and CORS.**
- **Session cookie.** `token` is HTTP-only, `Secure` in production, `SameSite=Lax` by default, and lasts `JWT_EXPIRES_IN` (default 7 days).
- **Same site (recommended).** Host the frontend and API on one site, for example `app.example.com` and `api.example.com`.
- **Different sites.** Otherwise set `COOKIE_SAMESITE=none` (requires `COOKIE_SECURE=true`). Some browsers block third-party cookies, so same-site hosting is more reliable.
- **CORS.** Only the origins listed in `FRONTEND_URL` (comma-separated) may call the API with credentials.

## 6. How to run frontend
```bash
cd frontend && npm install && npm run dev          # development
NEXT_PUBLIC_API_URL=https://api.example.com/api npm run build && npm start   # production
```

## 7. How to run backend
```bash
cd backend && npm install && npm run dev           # development (ts-node, reloads on change)
npm run build && npm run migrate && npm start      # production (NODE_ENV=production and the variables above)
```
Health checks: `GET /api/health` (process), `GET /api/health/db` (database), `GET /api/health/ai` (AI service reachable with the key).

## 8. How to run AI service
```bash
cd ai-service
venv/bin/python -m uvicorn app.main:app --reload --port 8000                                       # development
ENVIRONMENT=production INTERNAL_API_KEY=... venv/bin/python -m uvicorn app.main:app --host 0.0.0.0 --port 8000   # production
```
Health check: `GET /api/health`. The embedding model needs about 1 GB of memory and loads in the background at startup (section 13).

## 9. How to run with Docker
```bash
cp .env.example .env        # replace every placeholder (openssl rand -hex 32 for secrets)
docker compose up --build   # http://localhost:3000
```
Services:
- `mysql`: MySQL 8 with a persistent volume, not published to the host.
- `migrate`: a one-off run of the migration runner, after MySQL is healthy.
- `ai_service`: internal only, production mode.
- `backend`: production mode, private uploads on the `uploads` volume.
- `frontend`: a standalone Next.js server, built with `PUBLIC_API_URL`.

Images run as non-root users and have health checks. No image contains `.env` files or uploaded resumes; `.dockerignore` files exclude them.

The frontend's API address is compiled in at build time, so change `PUBLIC_API_URL` and rebuild if the backend is not at `http://localhost:5000/api`. To migrate again after adding a migration: `docker compose run --rm migrate`. The Docker setup was written and checked statically; it has not been built here because Docker was not available (see section 27).

## 10. AI Service (Step 4A — text preprocessing)
The frontend never calls the AI service directly: `Frontend → Node backend → FastAPI`.

| Service | Endpoint | Description |
|---|---|---|
| Backend | `POST /api/resumes/:id/preprocess` | Auth + ownership check, sends the stored `text_content` to the AI service, returns cleaned text |
| Backend | `GET /api/health/ai` | Checks the backend can reach the AI service |
| AI service | `POST /api/resume/preprocess` | `{ "resume_id", "text" }` → cleaned text |
| AI service | `GET /api/health` | Liveness |

Config: `MAX_RESUME_TEXT_LENGTH` (ai-service, default 100000), `AI_SERVICE_URL` / `AI_SERVICE_TIMEOUT_MS` (backend), and the shared `INTERNAL_API_KEY` set in both (required in production).

## 11. Tests
```bash
# Backend: unit tests (database tests are skipped unless enabled)
cd backend && npm test
# Backend with SQL tests, against a dedicated test database migrated with the runner
mysql -u root -p -e "CREATE DATABASE resume_test"
DB_NAME=resume_test npm run migrate:dev
DASHBOARD_DB_TESTS=1 DB_NAME=resume_test npm test
npx tsc --noEmit                                    # type check

# AI service
cd ai-service && venv/bin/pip install -r requirements-dev.txt && venv/bin/python -m pytest

# Frontend
cd frontend && npx tsc --noEmit && npm run lint && npm run build
```
- **Isolated database.** The SQL tests create and delete their own users. Never point them at a database with real data.
- **No backend linter.** The backend has no lint configuration.
- **Known lint problems.** `npm run lint` in the frontend currently reports 13 problems that predate Step 15, listed in section 27.

## 12. Matching Score

The application calculates a deterministic resume-job matching score using:

- Required skill coverage — 60%
- Preferred skill coverage — 15%
- Experience — 15%
- Education — 10%

Weights are configurable and only applicable components are included in the final normalized score.

**Where it lives.** Step 6A (`resume_job_matcher.py`, `experience_matcher.py`, `education_matcher.py`) produces the factual comparison. `ai-service/app/services/match_score_calculator.py` turns it into the score. Weights, the scoring method name and the score version are defined once in `ai-service/app/data/matching_weights.py` (they must be non-negative and sum to 1).

**Component scores (0–100).**

| Component | Score | Not counted when |
|---|---|---|
| Required skills | matched required ÷ required × 100 | the job lists no required skills (`not_applicable`) |
| Preferred skills | matched preferred ÷ preferred × 100 | the job lists no preferred skills (`not_applicable`) |
| Experience | min(candidate years ÷ required years × 100, 100) | no numeric requirement (`not_applicable`); resume years not reliably calculable, or only skill-specific requirements such as "3+ years of React" (`insufficient_data`) |
| Education | 100 if the degree requirement is met, 0 if not | no education requirement (`not_applicable`); degree level unknown on either side (`insufficient_data`) |

**Formula.** Only `calculated` components count; their weights are rescaled to sum to 100%:

```text
overallScore = Σ(score_i × weight_i) / Σ(weight_i)      over calculated components only
contribution_i = score_i × weight_i / Σ(weight_i)        (contributions add up to overallScore)
```

A job that does not state a requirement neither helps nor penalises the candidate. If no component can be calculated, `overallScore` is `null` and `scoreStatus` is `insufficient_data`, never 0. All values are rounded to two decimals.

Example: required 80, preferred 75, experience 100, education 100 → 80×0.60 + 75×0.15 + 100×0.15 + 100×0.10 = **84.25**. Without preferred skills and education: (80×60 + 100×15) / 75 = **84**.

**Version.** `scoreMetadata.version` is currently `1.0` (`scoringMethod: "weighted_deterministic"`). Bump it whenever the weights or rules change.

**API.** `POST /api/resumes/:resumeId/match/:jobDescriptionId` (backend; both records must belong to the signed-in user) returns `data.matching` with the Step 6A comparison plus:

```json
{
  "overallScore": 84.25,
  "scoreStatus": "calculated",
  "components": {
    "requiredSkills":  { "score": 80,  "weight": 60, "effectiveWeight": 60, "contribution": 48,    "status": "calculated", "reason": null },
    "preferredSkills": { "score": 75,  "weight": 15, "effectiveWeight": 15, "contribution": 11.25, "status": "calculated", "reason": null },
    "experience":      { "score": 100, "weight": 15, "effectiveWeight": 15, "contribution": 15,    "status": "calculated", "reason": null },
    "education":       { "score": 100, "weight": 10, "effectiveWeight": 10, "contribution": 10,    "status": "calculated", "reason": null }
  },
  "scoreMetadata": {
    "scoringMethod": "weighted_deterministic",
    "version": "1.0",
    "weights": { "requiredSkills": 60, "preferredSkills": 15, "experience": 15, "education": 10 }
  },
  "skills": { "required": { "matched": [], "missing": [], "coverage": 80, "byCategory": {} }, "preferred": { "...": "..." } },
  "experience": { "...": "Step 6A comparison" },
  "education": { "...": "Step 6A comparison" },
  "summary": { "...": "skill counts" }
}
```

The score reflects only these configured criteria; it is not a prediction of hiring success.

## 13. Semantic Matching

The application supplements deterministic resume-job matching with semantic similarity using embeddings.

Embedding model:
all-MiniLM-L6-v2

Similarity method:
Cosine similarity

Semantic similarity currently provides additional analysis and does not replace the deterministic match score.

**Model.** [`sentence-transformers/all-MiniLM-L6-v2`](https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2), run locally on CPU inside the AI service (384-dimensional vectors, ~90 MB). No external API is called and no data leaves the AI service. Configure with `EMBEDDING_MODEL_NAME` (a Hugging Face model id) in `ai-service/.env`.

**Architecture.** `Frontend → Node backend → FastAPI → embedding model`. `POST /api/resumes/:resumeId/match/:jobDescriptionId` (backend, ownership-checked) runs the deterministic match and an internal `POST /api/matching/semantic` call in parallel and returns `data.matching` (Steps 6A/6B, unchanged), `data.semanticMatch` and `data.semanticError`. If semantic matching fails, the deterministic result is still returned and `semanticError` says why (`EMBEDDING_MODEL_UNAVAILABLE`, …).

| File | Responsibility |
|---|---|
| `app/services/embedding_service.py` | Loads the model once, batches embeddings, caches them, cosine similarity |
| `app/services/semantic_text_builder.py` | Structured resume/job → plain text per section; chunking |
| `app/services/semantic_matcher.py` | The four comparisons below |

**Loading.** The model is loaded once per process: in a background thread at startup (`PRELOAD_EMBEDDING_MODEL=true`, default), so the service accepts requests immediately, or on the first semantic request otherwise. Requests never reload it. If loading fails, semantic requests return `503 EMBEDDING_MODEL_UNAVAILABLE` and loading is retried at most once a minute. The Docker image downloads the model at build time and runs with `HF_HUB_OFFLINE=1`.

**What is compared.** Only professional content from the structured analysis: summary, experience (title, company, description), projects, skills and education for the resume; title, responsibilities, skills, requirements and description for the job. Personal details, ids and file paths are never part of the text.

| Similarity | Resume | Job |
|---|---|---|
| `overallSemanticSimilarity` | whole resume text | whole job text |
| `experienceSemanticSimilarity` | experience | responsibilities + experience requirements |
| `projectSemanticSimilarity` | projects | responsibilities + required skills |
| `skillsSemanticSimilarity` | skills | required + preferred skills |

**Calculation.** `cosine(A, B) = A·B / (‖A‖‖B‖)`, shown as `cosine × 100` clamped to 0–100 and rounded to two decimals. Sections longer than the model's 256-token input are split into chunks of ≤120 words; a section's vector is the normalised mean of its chunk vectors. All chunks of a request are embedded in one batch, and repeated texts are served from a process-local LRU cache (2048 entries, keyed by `sha256(model + text)`; vectors are never stored on disk, logged or returned by the API). A comparison with an empty side is `not_available`, not 0.

**Limitations.** Similarity values are not calibrated: related texts often score 50–80 and unrelated ones 10–30, so compare them relative to each other rather than as absolute grades. They are not a probability of being hired. The model is English-only and general-purpose; it does not know that two specific technologies are interchangeable, and very long sections beyond 64 chunks are truncated (reported as `truncated: true`). Semantic similarity does not affect `overallScore`.

**Installation.** `pip install -r ai-service/requirements.txt` installs CPU-only PyTorch (via the PyTorch CPU index in `requirements.txt`), `sentence-transformers` and `numpy` (~1.3 GB in the venv). The model (~90 MB) is downloaded from Hugging Face on first load and cached in `~/.cache/huggingface`. Backend: `AI_SEMANTIC_TIMEOUT_MS` (default 30000) bounds semantic calls separately from other AI calls.

## 14. Match Analysis

The matching system provides structured analysis using:

- Deterministic skill matching
- Weighted matching scores
- Semantic similarity
- Experience comparison
- Education comparison
- Evidence-based strengths
- Evidence-based gaps
- Data-quality indicators

The analysis describes similarity and requirement coverage. It does not predict hiring outcomes.

**How it works.** `ai-service/app/services/match_analysis_service.py` is rule-based (no LLM). It receives the results already produced by Step 6A (comparison), 6B (score) and 6C (semantic similarity) and explains them; it never re-runs matching. The backend calls it through the internal `POST /api/matching/analysis` after the other two calls, and the public `POST /api/resumes/:resumeId/match/:jobDescriptionId` returns it as `data.analysis` (with `data.analysisError` if it could not be produced; the rest of the result is still returned).

**Levels** (thresholds in `ai-service/app/data/analysis_rules.py`) describe measurements, never the candidate:

| Measurement | Levels |
|---|---|
| Required/preferred skill coverage | `complete` 100 · `strong` 80–99.99 · `partial` 50–79.99 · `limited` >0–49.99 · `none` 0 |
| Semantic similarity | `very_high` ≥90 · `high` 75–89.99 · `moderate` 50–74.99 · `low` 25–49.99 · `very_low` <25 |

**Output** (`data.analysis`): `overall` (the unchanged Step 6B score, a factual summary sentence and one highlight per category), `skills`, `experience` (`satisfied` / `below_requirement` / `not_applicable` / `insufficient_data`), `education` (`satisfied` / `not_satisfied` / `not_applicable` / `insufficient_data`), `semanticSimilarity` (levels plus a neutral note when exact skill coverage and semantic skill similarity differ by 25+ points), `dataQuality`, `strengths` (≤5) and `gaps` (≤5, with `additionalGapCount`).

**Rules.** A strength needs positive evidence (e.g. ≥80% required coverage, an experience or education requirement met, preferred coverage ≥50%, high semantic similarity). Every missing required skill is a gap (grouped into one when more than three); missing preferred skills are a single, non-critical gap. Semantic similarity never turns a missing skill into a match. Requirements the job does not state are `not_applicable` and listed under `dataQuality.notApplicable`; they never count against data quality or the candidate. Information that could not be evaluated (e.g. year-only job dates) is reported as such, never as a negative result.

## 15. Resume Improvement Recommendations

The application generates deterministic, job-specific recommendations
using existing resume analysis, job requirements, matching results,
and data-quality indicators.

Recommendations are evidence-based and do not invent qualifications
or guarantee hiring outcomes.

**How it works.** `ai-service/app/services/resume_recommendation_service.py` (rule-based, no LLM) consumes the Step 6A comparison and 6B score, the Step 7A analysis (which includes 6C semantic similarity) and the role and project entries of the structured resume. The backend calls the internal `POST /api/matching/recommendations` after the analysis; `POST /api/resumes/:resumeId/match/:jobDescriptionId` returns the result as `data.recommendations` (`items`, `total`, `limitations`, `message`) and `data.recommendationsError`. Nothing is stored and the match score is not changed.

**Categories:** `required_skill`, `preferred_skill`, `experience`, `projects`, `education`, `resume_content`, `data_quality`. Each item has `id`, `category`, `priority`, `title`, `issue`, `reason`, `action`, `relatedSkills` and a short `evidence` pointer.

**Priority** reflects how directly an item relates to the job's stated requirements, never the candidate:

| Priority | Used for |
|---|---|
| high | required skills not detected (more than three are grouped); an explicit experience requirement not met by reliably calculated years; an education requirement not met; a skill-specific experience requirement whose skill was not detected |
| medium | relevant projects with no, brief or unclear descriptions; skills present but with too little dated evidence for a skill-specific requirement; incomplete dates or an undetected degree that block an explicit requirement; terminology differences flagged by Step 7A; preferred skills when most of the list was not detected |
| low | preferred skills when most were detected; required skills listed but not shown in any role or project; roles without descriptions |

Items are sorted by priority, then by rule (missing required skills → explicit gaps → unclear existing evidence → preferred skills → other content), de-duplicated and capped at 8 (`ai-service/app/data/recommendation_rules.py`).

**Missing information.** Skills are reported as *not detected* (the parser did not find them), never as absent. Every skill action separates documenting real experience from learning the skill. Semantic similarity is never treated as proof that a skill is present. Incomplete dates lead to a request to review them, never to an estimate. Requirements the job does not state produce no recommendation, and limitations that are not the user's to fix (an ambiguous job requirement, an unavailable service, skill-specific experience that cannot be measured) are listed under `limitations` instead. With nothing actionable, `items` is empty and `message` says so.

**Why nothing is applied automatically.** Only the user knows which suggested skills and experience are genuinely theirs, so recommendations are advice: the uploaded resume and its stored text are never modified.

**Tests.** `cd ai-service && venv/bin/python -m pytest tests/test_recommendations.py` (rules, prioritisation, de-duplication, limits, validation, privacy, endpoint) and `cd backend && npm test` (response contract). No extra setup or migration is needed.

## 16. Match History

The application saves successful resume-job matching analyses so users
can review their previous results.

Each saved result includes a snapshot of the matching score, analysis,
semantic similarity, and improvement recommendations where available.

Opening a saved result does not rerun matching.

Users can view and delete their own history. Match history is isolated
by authenticated user, and deleting a source resume or job description
also deletes its dependent history records.

**When a result is saved.** `POST /api/resumes/:resumeId/match/:jobDescriptionId` saves the result after the existing pipeline (6A → 6B → 6C → 7A → 7B) finishes, and adds `data.matchId` to its normal response. A result is saved when matching, analysis and recommendations all succeeded; semantic similarity is optional and is saved as unavailable (with its reason) when the embedding model was down. An incomplete result is still returned with `matchId: null` and `data.historyError`. If saving fails, the request fails (`500 MATCH_HISTORY_SAVE_FAILED`) rather than reporting success.

**What is stored** (`resume_job_matches.result_json`): `matching` (Step 6A comparison with the Step 6B score and breakdown), `semanticMatch`/`semanticError`, `analysis` and `recommendations`, plus `snapshotVersion`. The resume filename, job title and company name are copied into their own columns so history keeps its labels, and `overall_score` holds the Step 6B score (`NULL` when none was calculated). No PDF, file path, raw resume or job-description text, or embedding vectors are stored; email addresses, phone numbers and filesystem paths are additionally redacted from the snapshot. A saved result reflects the analysis when it ran: later edits do not change it.

**Migration.** `database/migrations/007_create_resume_job_matches.sql`. Apply it like the others, in order:

```bash
mysql -u <user> -p < database/migrations/007_create_resume_job_matches.sql
```

**Deletion policy.** `ON DELETE CASCADE` from `users`, `resumes` and `job_descriptions`: deleting a resume or job description deletes the saved matches that used it. Deleting a saved match deletes nothing else.

**API** (all require the session cookie and only ever see the signed-in user's records):

| Endpoint | Response |
|---|---|
| `GET /api/match-history?page=1&limit=10` | `data.items` (summaries: `id`, `resumeId`, `jobDescriptionId`, `resumeFilename`, `jobTitle`, `companyName`, `overallScore`, `createdAt`; no snapshots) and `data.pagination` (`page`, `limit`, `total`, `totalPages`) |
| `GET /api/match-history/:id` | `data.matchHistory`: the summary fields plus `result`, the stored snapshot |
| `DELETE /api/match-history/:id` | Deletes that saved result only |

**Pagination.** Newest first (`created_at DESC, id DESC`), default `limit` 10, maximum 50. `page` and `limit` must be whole numbers (`page` ≥ 1, `limit` 1–50), otherwise `400 VALIDATION_ERROR`; a page past the end returns an empty `items` list. Ids must be UUIDs (`400 INVALID_MATCH_HISTORY_ID`); a missing id, or one belonging to another user, returns `404 MATCH_HISTORY_NOT_FOUND`.

**Frontend.** `/dashboard/match-history` lists saved results (view, delete with confirmation, pagination); `/dashboard/match-history/[id]` shows a saved result with the same components as a fresh match. After a match, the dashboard links to the saved result.

**Tests.** `cd backend && npm test` covers the snapshot builder (fields kept, raw text excluded, redaction, size limit) and id/pagination validation.

## 17. Dashboard Analytics

The dashboard summarizes saved resume-job matching analyses.

Metrics include total analyses, average and highest valid match scores,
score distribution, recent activity, and strongest saved matches.

Analytics use the official deterministic match score stored with each
history record (`resume_job_matches.overall_score`, the Step 6B score).
Semantic similarity is shown separately on each analysis and is not part
of any dashboard metric.

The dashboard provides descriptive insights only and does not predict
hiring outcomes.

**API.** `GET /api/dashboard/analytics` (session cookie required; always the signed-in user's own records, no user id is accepted from the request). Nothing is recalculated and the AI service is not called: the endpoint reads saved match history only.

```json
{
  "success": true,
  "message": "Dashboard analytics retrieved successfully",
  "data": {
    "summary": {
      "totalAnalyses": 5, "scoredAnalyses": 3,
      "averageMatchScore": 36.5, "highestMatchScore": 77.5,
      "analysesAtOrAboveThreshold": 0, "scoreThreshold": 80
    },
    "scoreDistribution": [{ "label": "0–39%", "min": 0, "max": 39.99, "count": 2 }, "…"],
    "latestAnalysis": { "id": "…", "resumeFilename": "…", "jobTitle": "…", "companyName": "…", "overallScore": 16, "createdAt": "2026-10-26T07:20:01.123Z" },
    "recentActivity": ["… up to 5 summaries, newest first"],
    "strongestMatches": ["… up to 5 summaries, highest score first"]
  }
}
```

Items have the same summary fields as `GET /api/match-history` (no snapshot). Timestamps are the stored `created_at` values in ISO 8601 UTC and are formatted in the viewer's locale on the frontend.

**Calculation rules** (`backend/src/services/dashboard-analytics.service.ts`; summary and distribution come from one SQL aggregate query):

| Metric | Rule |
|---|---|
| `totalAnalyses` | All saved records, including those without a valid score |
| `scoredAnalyses` | Records whose score is not `NULL` and within 0–100 (a *valid* score) |
| `averageMatchScore` | Mean of valid scores, rounded to 2 decimals; `null` (not 0) when there are none |
| `highestMatchScore` | Highest valid score; `null` when there are none |
| `analysesAtOrAboveThreshold` | Valid scores ≥ `SCORE_THRESHOLD` (80) |
| `scoreDistribution` | Valid scores in `0 ≤ s < 40`, `40 ≤ s < 60`, `60 ≤ s < 80`, `80 ≤ s ≤ 100`; all four buckets are always returned |
| `latestAnalysis` / `recentActivity` | Newest 5 records (`created_at DESC, id DESC`); an invalid score is shown as `null` |
| `strongestMatches` | Top 5 valid scores (`overall_score DESC, created_at DESC, id DESC`) |

The threshold, bucket bounds and list sizes are named constants at the top of the service. The frontend renders the buckets returned by the API, so the two cannot drift apart.

**Frontend.** The "Matching Overview" section at the top of `/dashboard` (`frontend/src/components/DashboardAnalytics.tsx`) shows the summary cards, a CSS bar chart with the count written next to each bar, the highest-scoring and the recent analyses (each linking to its saved result), and a link to the full match history. It has loading, empty, no-valid-score and error (with retry) states, and refreshes after a match run on the dashboard is saved.

**Tests.**

```bash
cd backend && npm test   # unit tests; the SQL tests are skipped
# SQL aggregation tests against a MySQL database with migrations 001–007 applied:
DASHBOARD_DB_TESTS=1 DB_NAME=<test database> DB_PASSWORD=<password> npm test
```

The SQL tests insert their own users and records (bucket boundaries 0/39.99/40/59.99/60/79.99/80/100, `NULL` and out-of-range scores, ties, a second user) and delete them afterwards. No new migration is needed for this step.

## 18. Resume and Job Description Management

Users can view and manage their uploaded resumes and saved job
descriptions through authenticated dashboard pages.

The management interface reuses the existing upload, extraction,
CRUD, and matching APIs. Resource ownership is enforced by the backend.

**Pages.**

| Route | Purpose |
|---|---|
| `/dashboard/resumes` | Your resumes: filename, upload date, size, type, extraction status, whether skills were extracted; search by filename; view, match, delete |
| `/dashboard/resumes/[id]` | One resume: details and status (refreshed while extraction runs, retry after a failure), skills, sections, structured analysis, matching |
| `/resume/upload` | Upload (PDF only, max 5 MB, as enforced by the backend); after the server confirms, shows the extraction status and links to the resume |
| `/job-descriptions` | Your job descriptions: title, company, dates, requirements status; search by title or company; view, edit, match, delete |
| `/dashboard/match` | Choose one of your resumes (text extraction completed) and a job description, then run the existing match. `?resumeId=` and `?jobDescriptionId=` preselect items, but only the user's own |

Job-description create, view and edit pages (`/job-descriptions/create`, `/job-descriptions/[id]`, `/job-descriptions/[id]/edit`) are unchanged apart from the delete dialog and a "Match Resume" link.

**Statuses** are the stored values, renamed for display only: resume `extraction_status` `pending` → Uploaded, `processing` → Processing, `completed` → Completed, `no_text` → No readable text, `failed` → Failed. Job descriptions show "Requirements extracted" when stored requirements exist, otherwise "Requirements not extracted". Failed requirement extractions are not stored, so the list has no "failed" state; the job description page shows the error when extraction is run there.

**API change.** `GET /api/job-descriptions` items gain `requirementsExtractedAt` (the stored requirements' `updated_at`, or `null`). No other endpoints were added or changed.

**Deletion.** Deleting asks for confirmation in a dialog that names the item and its consequences (per the `ON DELETE CASCADE` rules): deleting a resume also deletes its extracted skills and the saved match results that used it; deleting a job description also deletes its requirements and the saved match results that used it. The list changes only after the server confirms.

**Search** filters the already loaded list in the browser. The resume and job-description list endpoints are not paginated.

**Tests.**

```bash
cd backend && npm test
# includes the SQL test for requirementsExtractedAt (needs a migrated test database):
DASHBOARD_DB_TESTS=1 DB_NAME=<test database> DB_PASSWORD=<password> npm test
cd frontend && npx tsc --noEmit && npm run lint && npm run build
```

## 19. Resume Versions

A resume can have several versions. Each upload stays its own resume record (file, extracted text, skills and saved match results are kept); versions of the same resume share a **version group** (`resume_groups`). A first upload starts a new group as version 1; only "Upload New Version" adds to an existing group, so unrelated resumes are never merged.

**Current version.** The newest version whose text extraction completed becomes current automatically. A version that is still processing or failed (`failed`, `no_text`) never becomes current, so the previous current version stays in use. Users can make any processed version current; re-extracting an older version later does not take over. Deleting the current version makes the newest remaining processed version current; deleting the last version removes the group.

**Comparison** (no matching is run, nothing is saved):

| Part | Source |
|---|---|
| Skills | Stored skills when both versions have them, otherwise the skills found by the structured analysis of both (never mixed). Case and spacing are ignored. |
| Work experience, education, projects, certifications | The existing rule-based analysis of each version's stored text (computed when comparing; not stored). Entries are matched by title + company, degree + field + institution, project name, certificate name + issuer. |
| Extracted text | Whether it changed, with line and word counts; the text itself is not returned. |
| Saved match scores | The official (Step 6B) score of the latest saved analysis of each version, for job descriptions analysed with **both** versions only. |

A part is reported as unavailable (never as "everything removed") when one version has no data for it, e.g. its text was not extracted, the analysis service is down, or the section was not found in one of the versions.

**API** (session cookie required; ids are UUIDs, `400 INVALID_RESUME_ID` otherwise; another user's resume returns `404 NOT_FOUND`):

| Endpoint | Purpose |
|---|---|
| `POST /api/resumes/:id/versions` | Upload a new version of `:id`'s resume (multipart `resume` file, same PDF/5 MB rules as `POST /api/resumes`; optional `versionLabel`, max 100 characters) |
| `GET /api/resumes/:id/versions` | `data.resumeGroupId` and `data.versions` (summaries, newest first) |
| `PATCH /api/resumes/:id/current` | Make this version current (`409 RESUME_VERSION_NOT_READY` unless its text was extracted) |
| `GET /api/resumes/:id/versions/:otherId/compare` | Compare two versions of the same resume (`olderVersion`, `newerVersion`, `skills`, `sections`, `text`, `matchScoreComparison`, `matchScoreMessage`) |

Resume summaries (`GET /api/resumes`, `GET /api/resumes/:id`) now also include `resumeGroupId`, `versionNumber`, `versionLabel`, `isCurrent` and `versionCount`. `DELETE /api/resumes/:id` deletes that version only (its skills and the saved matches that used it, as before).

**Frontend.** `/dashboard/resumes` shows one row per resume (its current version) with the version count; `/dashboard/resumes/[id]/versions` lists versions, makes one current, deletes one, and picks two to compare at `/dashboard/resumes/[id]/compare/[otherId]`; `/resume/upload?versionOf=<id>` uploads a new version.

**Migration.** `database/migrations/008_create_resume_versions.sql` (run once, after 001–007). It creates `resume_groups`, adds `resume_group_id`, `version_number`, `version_label` and `is_current` to `resumes`, and puts every existing resume in its own group as version 1 (current if its text was extracted). The schema enforces unique version numbers per group, at most one current version per group, and that a group only contains its owner's resumes.

```bash
mysql -u <user> -p < database/migrations/008_create_resume_versions.sql
```

**Tests.**

```bash
cd backend && npm test   # comparison rules and validation
# versioning SQL tests (numbering, concurrency, current version, deletion, isolation):
DASHBOARD_DB_TESTS=1 DB_NAME=<test database with 001-008> DB_PASSWORD=<password> npm test
```

## 20. Resume Tailoring

Users can get job-specific suggestions for one of their processed resumes and a saved job description, review each one, preview the result, and save it as a tailored copy.

**How suggestions are made.** The project has no language-model integration, so tailoring is **rule-based**: fixed rules applied to the resume's stored text, the existing structured analysis, section extraction and deterministic matching (nothing is generated by AI, and the UI says so). Every suggestion replaces one existing line of the resume and is checked to contain no word or number that the original line does not (apart from a fixed list of verb forms), so it can only reorder, shorten or reword what is already there. The job description decides what is relevant; it is never used as evidence about the user. Resume and job text are treated as data only.

| Category | Suggestion |
|---|---|
| Skills | Reorder a skills line so the skills the job asks for come first (same items) |
| Experience / Projects | Concise rewording of a bullet: "Responsible for developing X" → "Developed X" (known verbs only; "helped" or "involved in" are never upgraded), removing "successfully", "various", "very", "in order to" → "to", "utilize" → "use", repeated words |
| Structure and clarity | Remove a bullet that repeats an earlier one word for word; advice that needs the user's input (weak openers such as "Worked with", which project to list first, a summary that omits skills the resume shows) — advice never changes text |

**Requirement coverage** (from the existing matching result): each required/preferred skill, experience and education requirement is *supported* (shown in experience or projects), *partially supported* (e.g. listed in the skills section only) or *not found*. Missing skills are never added; the page explains that something not found in the document may still be true and should be added only if it is.

**Review.** Each suggestion is Pending, Accepted, Edited (the user's own wording, accepted explicitly) or Rejected, and can be undone. Edited text must be a single line of at most 1,000 characters. The preview is the original text with only accepted and edited changes applied, marked as revised or removed.

**Saving.** "Save Tailored Copy" (with confirmation) creates a new version in the resume's version group: `source_type = 'tailored'`, `text/plain`, the tailored text stored as extracted text and as a `.txt` file under `backend/uploads/resumes`. The source resume and its file are not modified, and the copy is **not** made current (automatic current-version selection ignores tailored copies; the user can still choose one in the version history). Saving is once per session (repeated or concurrent requests return the same copy) and runs in one transaction; the file is removed if the transaction fails. A saved session is read-only. The copy can be analysed, matched and compared like any version; it cannot be re-extracted (`409 EXTRACTION_NOT_SUPPORTED`). No PDF is generated.

**API** (session cookie required; ids are UUIDs; another user's resume, job, session or suggestion returns `404`):

| Endpoint | Purpose |
|---|---|
| `POST /api/resumes/:id/tailoring` `{ jobDescriptionId }` | Generate a session (`409` if the resume text or the job's requirements are not available; AI-service failures return its error and store nothing) |
| `GET /api/resumes/:id/tailoring` | Sessions for this resume |
| `GET /api/resumes/:id/tailoring/:sessionId` | Session with `suggestions`, `requirements`, `notes` |
| `PATCH /api/resumes/:id/tailoring/:sessionId/suggestions/:suggestionId` `{ action: accept \| edit \| reject \| reset, editedText? }` | Review one suggestion (`409 TAILORING_ALREADY_SAVED` after saving) |
| `GET /api/resumes/:id/tailoring/:sessionId/preview` | Preview lines (read-only) |
| `POST /api/resumes/:id/tailoring/:sessionId/save` | Save the tailored copy (`201`, or `200` with the existing copy; `409 NO_ACCEPTED_SUGGESTIONS`) |

Resume summaries now include `sourceType` (`upload` or `tailored`).

**Frontend.** `/dashboard/tailor` (choose a resume and a job; earlier sessions), `/dashboard/resumes/[id]/tailoring/[sessionId]` (review, preview, save). Linked from the navbar, the resume list and detail pages and the job description page.

**Migration.** `database/migrations/009_create_resume_tailoring.sql` (after 001–008): adds `resumes.source_type` and the `resume_tailoring_sessions` and `resume_tailoring_suggestions` tables. Sessions are deleted with their user, source resume or job description; a saved copy is kept. No environment variables are needed.

```bash
mysql -u <user> -p < database/migrations/009_create_resume_tailoring.sql
cd backend && npm test   # tailoring rules
DASHBOARD_DB_TESTS=1 DB_NAME=<test database with 001-009> DB_PASSWORD=<password> npm test   # sessions, review, save
```

## 21. PDF Export

Any processed resume version, or a tailoring session's approved draft, can be exported as a professional PDF.

**Content.** The server builds every PDF from stored data only: the version's extracted text, or (with a tailoring session) that text with only the **accepted** and **edited-and-accepted** suggestions applied. Pending and rejected suggestions are never included. The browser sends only a template id and, optionally, the session id; no HTML, text or file path from the browser is used. The text is split into name, contact lines, sections (recognised headings such as Summary, Skills, Experience, Education, Projects, Certifications, or short all-capital headings), entry titles, bullets and paragraphs; lines wrapped in the source PDF (continuing with a lowercase word) are rejoined. Words are never changed, added or removed, and headings with no content are left out.

**Templates** (all single-column, real selectable text, no images or tables; content is identical in every template):

| Id | Layout |
|---|---|
| `classic` | Serif, black only, plain headings, centred name. The most ATS-friendly. |
| `modern` | Sans-serif, one blue accent, a thin line under each heading. |
| `compact` | Condensed type, smaller margins and spacing. |

Pages are A4; long resumes flow onto as many pages as needed, and headings and entry titles are kept with their first lines.

**Library and fonts.** [`pdfkit`](https://pdfkit.org) 0.20.2 draws text directly (no HTML rendering, scripts or remote resources). Fonts come from the `dejavu-fonts-ttf` 2.37.3 package (DejaVu Serif, Sans and Sans Condensed: Latin, Greek, Cyrillic and common symbols), so no system fonts are needed. Characters the fonts lack (for example Tamil or CJK) are listed as a warning on the export page and appear as boxes in the PDF. No environment variables are needed.

**Storage.** "Download PDF" generates the file on demand; nothing is stored. "Save as Version" (an explicit action) stores the PDF as a new version of the resume (`source_type = 'exported'`, `application/pdf`, the approved text as its extracted text), linked to the source version and session. It is never made current automatically, and saving the same content with the same template again returns the existing version. Files are kept in the private `backend/uploads/resumes` directory under generated names and are only served through owner-checked endpoints.

**API** (session cookie required; ids are UUIDs; another user's resume or session returns `404`):

| Endpoint | Response |
|---|---|
| `GET /api/resumes/:id/export/document[?tailoringSessionId=]` | JSON: the structured `document`, `templates`, `unsupportedCharacters`, `staleSuggestionCount` (for the preview) |
| `POST /api/resumes/:id/export/pdf` `{ template, tailoringSessionId? }` | `application/pdf` attachment (`Content-Disposition: attachment; filename="<sanitized>-<template>.pdf"`, `Cache-Control: private, no-store`) |
| `POST /api/resumes/:id/export/save` `{ template, tailoringSessionId? }` | `201` new version, or `200` with the existing one |
| `GET /api/resumes/:id/file` | The stored file of a version (uploaded PDF, tailored text or saved export) |

Errors use the usual JSON contract: `400 VALIDATION_ERROR` (unknown template or field), `409 RESUME_TEXT_NOT_AVAILABLE`, `413 RESUME_TOO_LARGE` (over 60,000 characters or 1,500 lines). The backend exposes `Content-Disposition` to the frontend through CORS.

**Frontend.** `/dashboard/resumes/[id]/export` (`?session=<id>` for a tailored draft): template choice, an on-screen preview drawn from the same structured document, **Download PDF** and **Save as Version**. Linked from the resume page ("Export PDF", "Download File") and the tailoring session page.

**Migration.** `database/migrations/010_add_resume_pdf_exports.sql` (after 001–009).

```bash
cd backend && npm install            # pdfkit, dejavu-fonts-ttf
mysql -u <user> -p < database/migrations/010_add_resume_pdf_exports.sql
cd backend && npm test               # PDF structure, rendering, templates, filenames
DASHBOARD_DB_TESTS=1 DB_NAME=<test database with 001-010> DB_PASSWORD=<password> npm test   # approved content, saving
```

## 22. Word (DOCX) Export

The export page also downloads the resume as an editable Microsoft Word document (`.docx`). It uses exactly the same approved content as the PDF export (section 21): the version's stored text, or a tailoring session's text with only accepted and edited-and-accepted suggestions applied. Pending and rejected suggestions are never included, nothing is invented, and the source resume is not changed.

**Format.** A genuine Office Open XML package built with [`docx`](https://docx.js.org) 9.9.0: the name in the *Title* style, each section as a *Heading 1* paragraph (so Word's navigation pane works), bullets as a real Word bulleted list, and plain paragraphs for everything else. Single column, no tables, text boxes or images, so it stays ATS-readable and edits normally in Word, LibreOffice or Google Docs. E-mail addresses and `http(s)://` links become clickable without changing their text. Headings and entry titles are kept with the following paragraph; Word decides the page breaks, so pagination can differ from the PDF.

**Templates** match the PDF ones and change formatting only: `classic` (Georgia, centred name, capitalised headings), `modern` (Calibri, blue accent, line under headings), `compact` (Arial, smaller type and margins). The fonts are referenced by name; Word substitutes a similar font if one is missing. Unicode text (including scripts such as Tamil) is stored as-is and displayed with the viewer's fonts.

**API.** `POST /api/resumes/:id/export/docx` with `{ "template": "classic" | "modern" | "compact", "tailoringSessionId"?: "<uuid>" }`. Same authentication, ownership checks, validation and errors as `POST /api/resumes/:id/export/pdf`. The response is the file itself (`Content-Type: application/vnd.openxmlformats-officedocument.wordprocessingml.document`, `Content-Disposition: attachment; filename="<sanitized>-<template>.docx"`, `Cache-Control: private, no-store`). DOCX files are generated on demand and never stored; no migration is needed.

**Setup and tests.**

```bash
cd backend && npm install   # adds docx 9.9.0
cd backend && npm test      # includes resume-docx.service.test.ts (package structure, headings, lists, text, Unicode, links, long resumes, filenames)
```

## 23. ATS Readiness Checker

The resume page has an **ATS Readiness** panel that checks how readable and complete a resume version's extracted text is and gives a 0–100 readiness score with prioritised recommendations. It is separate from the job match score.

> This is an estimate based on the checks listed below. Applicant tracking systems differ, and no score can predict whether a particular employer's system will accept a resume.

**What is checked.** Deterministic rules in `backend/src/services/ats-readiness.service.ts` (no language model). Structure, parsing and contact checks use the extracted text; content checks use the existing rule-based structured analysis from the AI service.

| Category (points) | Checks (points) |
|---|---|
| Resume structure (25) | Name on the first line (5) · recognisable section headings (8) · an experience, projects **or** education section (7) · no empty sections (5) |
| Content quality (35) | Professional summary (5) · roles have descriptions (8) · specific, action-oriented lines rather than "Worked on…/Helped…" (7) · concrete figures where available (5) · job titles and start dates (5) · skills listed under a Skills heading (5) |
| Parsing and formatting (25) | Amount of extracted text (8) · no unreadable characters, split-up letters or large gaps (6) · no paragraphs over 80 words (5) · consistent, valid date formats (6) |
| Contact and links (15) | E-mail address (6) · phone number (4) · well-formed links (5) |

The weights live in `CHECK_WEIGHTS`; categories add up to 100. Each check loses points at most once and produces at most one recommendation (title, category, severity, explanation, why it matters, action, example), sorted by severity. Checks that do not apply cost nothing: no work experience (experience, figures, titles/dates), fewer than four experience lines (figures), no links (links). Lots of keywords cannot raise the score: no check counts keywords.

**Score bands** (guidance for this app, not an industry standard): 85–100 strong readiness indicators · 70–84 good foundation, improvements recommended · 50–69 several improvements recommended · 0–49 significant improvements recommended.

**No score is given** when fewer than 40 words could be extracted (only the extraction problem is reported, not a cascade of failures), or when the structured analysis is unavailable (the text-based checks are still shown, content checks are marked "not evaluated").

**Job relevance (optional).** Choosing a saved job description (with extracted requirements) adds a separate view of which required and preferred skills, experience and education the resume supports, partly shows or does not mention, using the existing matching. Its advice is conditional ("if you have real experience with X… if not, leave it out"); it never changes the readiness score and is not stored.

**Storage and API.** Each run is stored in `resume_ats_checks` (migration `011_create_resume_ats_checks.sql`) for that resume version, with a SHA-256 of the checked text and the rules version; the panel shows the latest result, marks it **out of date** when the text (re-extraction) or the rules changed, and lists earlier runs. E-mail addresses are masked in stored results.

| Endpoint | Purpose |
|---|---|
| `POST /api/resumes/:id/ats-check` `{ jobDescriptionId? }` | Run the checks; `201` with `check` (`score`, `band`, `categories`, `checks`, `strengths`, `recommendations`), `relevance` (or `null`) and `scoring` (weights, bands, disclaimer). `409 RESUME_NOT_READY` while text extraction is running |
| `GET /api/resumes/:id/ats-check` | Latest stored result (`stale` flag), up to 10 earlier runs, `scoring` |

Both require the session cookie and only work on the user's own resume (another user's resume or job description returns `404`).

**Limitations.** Only extracted text and the structured analysis are available, so columns, tables, headers/footers, images and other layout features are **not** detected; their effects show up only indirectly (missing or garbled text). Name, heading and date detection are heuristic and English-centred. Contact checks look for an e-mail address, a phone number and obviously malformed links only; they do not verify that addresses or links work.

```bash
mysql -u <user> -p < database/migrations/011_create_resume_ats_checks.sql
cd backend && npm test   # ats-readiness.service.test.ts (scoring rules, weights, scenarios)
DASHBOARD_DB_TESTS=1 DB_NAME=<test database with 001-011> DB_PASSWORD=<password> npm test   # storage and staleness
```

## 24. Cover Letters

Users can generate an editable cover letter draft from one of their processed resumes (any version) and one of their saved job descriptions, edit it, save it, and come back to it later (**Cover Letters** in the navbar; also linked from resume and job description pages).

**How drafts are written.** The project has no language-model integration, and none was added: drafts are **rule-based**, composed by the AI service (`ai-service/app/services/cover_letter_generator.py`) from fixed, tone-specific sentence frames (`app/data/cover_letter_templates.py`) filled only with facts from the candidate's own resume analysis and the job's extracted requirements. The UI labels them as template-based. In detail:

- The backend sends only structured facts: the candidate's name, skills, roles (title, employer, dates, description lines), projects, education and certifications, and the job's title, company and required/preferred skills. No raw resume or job text and no contact details.
- Only job skills that the resume also lists are named. Missing required skills are listed in a note to the user ("the letter does not claim it; add it only if true"), never in the letter.
- The candidate's own description lines are reused only when they start with a past-tense action verb, rephrased in the first person ("Built X" → "I built X"); other lines are not used.
- What the resume cannot tell (why the candidate wants this employer; a missing name) becomes a clearly bracketed `[placeholder]`.
- Before a draft is returned, it is verified: every skill it names must appear in the resume facts and every number must come from the resume or the job title; otherwise generation fails instead of returning the draft.
- Tones: `professional`, `confident`, `conversational`, `concise`. Lengths: `short`, `standard` (adds a second role, a project and the motivation placeholder), `detailed` (adds more evidence, education and certifications).

**Editing.** The draft is plain text in a text area (never rendered as HTML), with title, word count, unsaved-changes indicator, Save, Copy to Clipboard and Delete. Regenerating over edited text asks first and keeps the replaced text restorable; leaving the page with unsaved changes asks for confirmation (browser warning on reload/close, and a confirmation on in-app links).

**API** (session cookie required; every operation checks ownership; another user's resume, job or letter returns `404`):

| Endpoint | Purpose |
|---|---|
| `POST /api/cover-letters/generate` `{ resumeId, jobDescriptionId, tone, length }` | Generate a draft (not stored). `409` if the resume text or the job's requirements are not available; AI-service errors `503`/`504`/`502`; `429 RATE_LIMITED` after 10 requests per user per minute (`COVER_LETTER_GENERATE_PER_MINUTE`) |
| `GET /api/cover-letters` | The user's letters (no content), newest first |
| `POST /api/cover-letters` `{ title, content, tone, length, roleTitle?, companyName?, resumeId?, jobDescriptionId? }` | Save a letter (content ≤ 10,000 characters of plain text; the referenced resume and job must be the user's) |
| `GET /api/cover-letters/:id` | One letter with its content |
| `PUT /api/cover-letters/:id` | Update any of `title`, `content`, `tone`, `length`, `roleTitle`, `companyName` |
| `DELETE /api/cover-letters/:id` | Delete it |

**Migration.** `database/migrations/012_create_cover_letters.sql` (after 001–011) creates `cover_letters`. Deleting the source resume version or job description keeps the letter (the reference is cleared); deleting the user deletes their letters.

```bash
mysql -u <user> -p < database/migrations/012_create_cover_letters.sql
cd ai-service && venv/bin/python -m pytest tests/test_cover_letter.py
cd backend && npm test   # cover-letter.test.ts; with DASHBOARD_DB_TESTS=1 also cover-letter.service.test.ts
```

**Configuration.** None required. Optional: `COVER_LETTER_GENERATE_PER_MINUTE` (backend, default 10). The rate limit is kept in memory per backend process.

**Limitations.** Drafts are formulaic: they use fixed sentence frames and reuse the candidate's own description lines, so they need personal editing (especially the motivation placeholder) before sending. Lines that do not start with a past-tense verb are skipped, so some experience may not appear. The letter is plain text; there is no rich-text editing or document export for letters.

## 25. Job Application Tracker

**Applications** (navbar) tracks the jobs a user is interested in or has applied to. It uses only the Node backend and MySQL; the AI service is not involved. Applications can also be started from a job description ("Track Application"), which fills in its title, company and link.

**What is stored.** Only the job title and company are required. Optional: posting URL (http/https only), application date (only what the user enters: it is never set automatically, and cannot be in the future), status, location, employment type, compensation notes, contact name/e-mail/phone, notes, the current interview (date and time, type, stage, interviewer, preparation notes), a follow-up date and notes, and links to one of the user's job descriptions, resume versions and cover letters (each checked to belong to the same user; if the linked record is deleted later, the link is cleared and the application kept). Interview times are stored in UTC and shown in the viewer's local time; application and follow-up dates are calendar dates stored exactly as entered.

**Statuses.** `wishlist` (interested, not started) · `preparing` · `applied` · `assessment` · `interview` · `offer` · `rejected` · `withdrawn`. Any status can be set at any time; nothing else changes when it does.

**History.** Every application has an append-only timeline written by the server in the same transaction as the change: created, each status change (from → to, including offers and withdrawals), interview scheduled / updated / removed, follow-up set / removed, and which other fields were edited. It records field names, never the text of notes or contact details. Changing status never removes history; deleting the application deletes it with its history.

**List, board and metrics.** The list shows status, application date, the next dated action (an interview still ahead, or a follow-up from today on) and a follow-up-due flag, with quick status changes, View/Edit/Delete and 20 per page. Filters: status, company and job title (case-insensitive contains), application date range. Sorting: recently updated, application date, company, upcoming interview or follow-up. The board view groups up to 100 applications by status. Metrics, each counting an application at most once:

| Metric | Definition |
|---|---|
| Tracked applications | All applications, any status |
| Applications submitted | Status Applied, Assessment, Interview, Offer or Rejected, plus Withdrawn with an application date |
| Interviews scheduled | Applications with an interview date and time still ahead |
| Offers / Rejections | Current status Offer / Rejected |
| Follow-ups due | Open applications (not Offer, Rejected or Withdrawn) with a follow-up date today or earlier |

"Today" is the viewer's own date (sent as `today=YYYY-MM-DD`, accepted within a day of the server's UTC date).

**API** (session cookie required; every operation is limited to the user's own applications; another user's application, or a link to another user's record, returns `404`):

| Endpoint | Purpose |
|---|---|
| `GET /api/applications?status=applied,interview&company=&title=&appliedFrom=&appliedTo=&sort=updated\|applied\|company\|upcoming&order=asc\|desc&page=1&limit=20` | List (`limit` up to 100) with `pagination` |
| `GET /api/applications/metrics` | Metrics, counts by status and their definitions |
| `POST /api/applications` | Create (`jobTitle` and `companyName` required) |
| `GET /api/applications/:id` | One application with its `history` |
| `GET /api/applications/:id/history` | The history only |
| `PUT /api/applications/:id` | Update any fields, including `status`; `null` clears an optional field |
| `DELETE /api/applications/:id` | Delete the application and its history |

**Migration.** `database/migrations/013_create_job_applications.sql` (after 001–012) creates `job_applications` and `job_application_events`.

```bash
mysql -u <user> -p < database/migrations/013_create_job_applications.sql
cd backend && npm test   # job-application.controller.test.ts; with DASHBOARD_DB_TESTS=1 also job-application.service.test.ts
```

**Limitations.** One current interview per application (earlier interviews remain in the history, but their notes are not kept separately). No notifications (reminders are added in section 26). Filters are applied to the list view; the board shows at most 100 applications.

## 26. Reminders and Application Insights

**Reminders** (navbar) are in-app reminders, linked to one of the user's applications or standalone. Insights (navbar) summarises the saved applications and reminders. Both use only the Node backend and MySQL; the AI service is not involved, and nothing is estimated or predicted.

**What a reminder has.** Title (required, up to 200 characters), optional notes (up to 2,000), type (`follow_up`, `interview`, `assessment`, `recruiter_contact`, `custom`), a due date and time, the time zone it is in, an optional application, and a status: `pending`, `completed` or `dismissed`. "Overdue" is not stored: it is a pending reminder whose due time has passed, worked out each time reminders are read. Completion and dismissal times are recorded; **Reopen** makes a reminder pending again. Completing, dismissing or reopening twice changes nothing.

**How reminders are delivered.** In the app only:
- the Reminders page (Upcoming, Overdue, Done and Dismissed tabs, a due-date filter, 20 per page);
- a panel at the top of the dashboard, with overdue reminders first and then those due in the next 7 days;
- an overdue count on the navbar link, re-read when the page changes;
- a Reminders section on each application's page.

Overdue reminders are highlighted with a red edge and the text "⚠ Overdue". Each reminder links to its application and can be marked done, dismissed, edited or deleted. Showing a reminder never changes it, so nothing is "sent" twice.

**No e-mail, push or background scheduler.** The project has no e-mail provider, job queue or scheduler, so none was added. A timer inside the web server would be lost on restart and duplicated across instances. Adding e-mail later needs:
- a provider (SMTP or an API) configured through environment variables;
- an opt-in setting per user;
- a separate worker or cron job that picks pending reminders past their due time;
- a delivery table with a unique key per reminder and channel, plus status (`pending` / `sent` / `failed`), attempt count and last error, so a failed send can be retried safely and a sent reminder is never sent again;
- recording "sent" only after the provider confirms.

**Time zones.**
- The form starts with the browser's time zone, and the user can choose any other. Chrome lists some legacy names, e.g. `Asia/Calcutta` for `Asia/Kolkata`; both are accepted.
- The server converts the entered local date and time to UTC (`due_at`) using that zone's rules, and keeps the zone (`time_zone`). The zone is never changed automatically.
- A saved reminder is edited in its own zone. Changing only the zone keeps the same local time.
- Lists show the time in the viewer's local time, plus the reminder's own time and zone when the two differ.
- **Daylight saving.** A time skipped when clocks go forward (e.g. 01:30 on the last Sunday of March in London) does not exist and is refused with an explanation. A time that happens twice when clocks go back is saved as the first occurrence. Saving an existing reminder without changing its local time or zone leaves its stored moment alone.
- New reminders, and new due times on existing ones, cannot be in the past. An overdue reminder can still be edited if its time is left as it is.

**Suggested reminders.** Interview and follow-up dates already on an open application (not Offer, Rejected or Withdrawn) are offered as suggestions on the Reminders page and the application's page:
- an interview still ahead, with a choice of lead time (at the time, or 1 hour, 3 hours, 1 day or 2 days before);
- a follow-up date from today on, at a chosen time of day.

Nothing is saved until the user chooses **Add reminder**. The date is always read from the application on the server, never taken from the request.

Each suggestion is saved at most once: a unique key on (application, source date) means a repeat, a double click or concurrent requests return the existing reminder. A dismissed suggested reminder is not offered again; a deleted one is. If the interview is rescheduled, the new date is offered as a new suggestion.

Applications have no assessment-deadline field, so assessment reminders are created by hand.

**When an application changes, reminders are kept and flagged, never deleted silently.** A pending reminder is marked "may no longer be relevant", with the reason, when:
- its application is closed (Offer, Rejected or Withdrawn);
- the interview or follow-up date it was created from was moved or removed;
- its application was deleted. The reminder is then kept, unlinked.

The user can edit, dismiss or delete flagged reminders.

**Insights.** All counts come from the user's own saved data, and each application is counted at most once per metric. The page shows the definitions below.

| Metric | Definition |
|---|---|
| Tracked | All applications, any status |
| Submitted | Status Applied, Assessment, Interview, Offer or Rejected, plus Withdrawn with an application date (same as section 25) |
| In assessment or interview | Current status Assessment or Interview |
| Offers / Rejections | Current status Offer / Rejected |
| Upcoming interviews | Applications with an interview date and time still ahead (the next 5 are listed) |
| Follow-ups due / scheduled | Open applications with a follow-up date today or earlier / after today |
| Status distribution | Every application once, under its current status |
| Monthly: applications submitted | By the application date entered (applications without one are not included) |
| Monthly: added to the tracker | By when the application was added (UTC month) |
| Funnel | Of submitted applications, how many reached Interview and Offer, now or earlier in their history. Percentages are shown only once at least 5 have been submitted |
| Pending / overdue / completed reminders | As above |
| Reminder completion rate | Completed ÷ (completed + pending). Dismissed reminders are not counted. Not shown when there are none |

Charts are labelled horizontal bars with the number written on every row, so they do not rely on colour. The period can be the last 3, 6, 12 or 24 months.

**Suggestions on the insights page.** These are rule-based, from actual data only, and phrased without judgement:
- overdue reminders;
- follow-ups due today or earlier;
- interviews within 72 hours;
- 3 or more pending reminders on the same day in the next 14 days;
- active applications (Applied, Assessment or Interview) with no upcoming interview, no follow-up date and no pending reminder;
- reminders that may no longer be relevant;
- no application added for 14 days or more;
- an account with no applications yet.

No predictions about offers or hiring are made.

**API** (session cookie required). Every operation is limited to the user's own reminders and applications. Another user's reminder, or linking another user's application, returns `404`.

| Endpoint | Purpose |
|---|---|
| `GET /api/reminders?view=upcoming\|overdue\|pending\|completed\|dismissed\|all&from=&to=&applicationId=&type=&page=1&limit=20` | List with `pagination`. `from`/`to` are ISO date-times with an offset, inclusive |
| `GET /api/reminders/summary` | Counts, plus the first 5 overdue and the first 5 due in the next 7 days |
| `POST /api/reminders` | Create: `{ title, dueLocal: "YYYY-MM-DDTHH:mm", timeZone, type?, notes?, applicationId? }` |
| `GET /api/reminders/:id` | One reminder (with `dueAt` in UTC, `dueLocal`, `overdue`, `mayBeOutdated`) |
| `PUT /api/reminders/:id` | Update any of those fields; `null` clears notes or the application link |
| `POST /api/reminders/:id/complete` · `/dismiss` · `/reopen` | Change status (idempotent) |
| `DELETE /api/reminders/:id` | Delete |
| `GET /api/reminders/suggestions?applicationId=&today=` | Suggestions from application dates |
| `POST /api/reminders/suggestions/accept?today=` | Save one: `{ applicationId, kind: "interview"\|"follow_up", timeZone, leadMinutes?, time? }`. `201` when created, `200` with the existing reminder when already saved |
| `GET /api/applications/insights?months=6&today=` | Insights (`months` 1–24) and their definitions |

**Migration.** `database/migrations/014_create_reminders.sql` (after 001–013) creates `reminders`. It has:
- foreign keys to `users` (cascade) and `job_applications` (set null);
- `due_at` in UTC and `time_zone`;
- check constraints on type and status, and that completion and dismissal times match the status;
- the unique key on (`application_id`, `source_key`);
- indexes for listing by user, status and due time.

```bash
mysql -u <user> -p < database/migrations/014_create_reminders.sql
cd backend && npm test   # time-zone, reminder controller and month-range tests; with DASHBOARD_DB_TESTS=1 also reminder.service.test.ts and application-insights.service.test.ts
```

**Limitations.**
- Reminders appear only while the app is open; there is no e-mail, push or browser notification.
- The navbar count refreshes on page changes, not on a timer.
- Overdue status is worked out when reminders are read.
- Assessment deadlines must be entered as reminders, since applications have no deadline field.
- Monthly "added" counts use UTC months.

## 27. Production Deployment and Operations

Nothing has been deployed. This section describes how to deploy the application; it needs your hosting accounts and secrets.

**Recommended hosting.** Four independently configured services:

| Part | Host | Notes |
|---|---|---|
| Frontend | Any Node.js host, or a Next.js platform | Build with `NEXT_PUBLIC_API_URL` set to the public backend URL. The Docker image uses Next's standalone output |
| Backend | A container or VM host with a **persistent disk** | Resumes and saved exports are files under `UPLOAD_DIR`. Ephemeral container filesystems lose them on restart. Run **one instance** (see limitations) |
| AI service | A container host with ≥ 2 GB memory, on a **private network** | Reachable only by the backend; not on the frontend host. The image includes the embedding model (several GB with PyTorch) |
| MySQL 8 | A managed MySQL service with automated backups | Create a dedicated user with rights on the application database only |

Put the frontend and API on the same site (for example `app.example.com` and `api.example.com`) behind HTTPS. Set `TRUST_PROXY=1` (or the number of proxies) so login rate limits see real client addresses.

**Deployment order.**
1. Create the database and user, and take a backup if it holds data.
2. Run migrations: `npm run migrate` in the backend build, or `docker compose run --rm migrate`. For a database migrated by hand earlier, run `--baseline <last applied>` first.
3. Start the AI service and wait for `GET /api/health`.
4. Start the backend and check `GET /api/health`, `/api/health/db` and `/api/health/ai`.
5. Build and start the frontend with the public API URL.
6. Smoke test: register, upload a resume, run a match, export a PDF, log out.

**Storage.**
- **Private files.** Uploaded PDFs and saved exports are written under `UPLOAD_DIR` with generated names. They are never served statically; they are downloaded only through owner-checked endpoints, with `Cache-Control: private, no-store`.
- **Absolute paths.** The database stores each file's absolute path, so keep `UPLOAD_DIR` the same once files exist. If you must move it, move the files and update `resumes.file_path` to match.
- **Not stored.** DOCX files and unsaved PDFs are generated per request.

**Backups and recovery.**
- **Back up together.** Back up the database (`mysqldump --single-transaction`) and the `UPLOAD_DIR` files together; a database row without its file shows as "file missing".
- **Before migrations.** Back up before every migration. There are no down-migrations, so restore the backup if one goes wrong.
- **Test restores** on a separate database.

**Logging and monitoring.**
- **What is logged.** All services log to stdout and stderr. Logs contain request failures and error names only: no resume, job, cover-letter text, passwords or tokens (checked in the Step 15 tests).
- **No error-reporting service** is integrated. Use the hosting platform's log retention and alerts on the health endpoints. An error tracker (for example Sentry) is a possible addition.

**Security measures.**
- **Authentication.** JWT (HS256 only, signature and expiry checked) in an HTTP-only cookie that is `Secure` in production and `SameSite=Lax` by default. Logout expires the cookie immediately.
- **Ownership.** Every resource is scoped to the signed-in user; another user's record returns `404`, and user ids are never accepted from request bodies.
- **SQL.** Parameterized queries throughout.
- **CORS.** Limited to `FRONTEND_URL`.
- **Rate limits** per process:
  - login, 20 per 15 minutes per IP;
  - registration, 10 per hour per IP;
  - cover-letter generation, 10 per minute per user.
- **Uploads.** PDF only, checked by extension, declared type and the file's `%PDF-` signature. 5 MB maximum; empty files refused; generated filenames.
- **Headers.** Security headers are sent and `X-Powered-By` is removed.
- **Error responses** are JSON, without stack traces or server paths.
- **AI service.** Requires the shared key in production and hides its API docs.
- **Development-only test route.** `GET /api/test/db-ops` writes to the users table and is never registered in production.
- **Not a full audit.** These measures come from code review and automated tests, not a penetration test.

**Troubleshooting.**

| Symptom | Likely cause |
|---|---|
| Backend exits with `[config] Invalid configuration` | A required production variable is missing or weak. The message names it |
| `Unable to connect to the server` in the browser | `NEXT_PUBLIC_API_URL` wrong at build time, backend down, or CORS (`FRONTEND_URL` must match the browser origin exactly) |
| Logged in, but every request is 401 | The cookie is not sent: frontend and API on different sites with `COOKIE_SAMESITE=lax`, or HTTPS missing with `Secure` cookies |
| Analysis returns 503 `AI_SERVICE_UNAVAILABLE` | AI service down or `INTERNAL_API_KEY` differs between the services. Check `GET /api/health/ai` |
| Semantic matching 503 shortly after start | The embedding model is still loading (section 13) |
| `Migration failed: 003_… Duplicate column` | The database was migrated by hand. Use `--baseline` |
| Too many login attempts (429) | Rate limit. Behind a proxy, set `TRUST_PROXY` so users are not grouped under one IP |

**Known limitations.**
- **One backend instance.** Rate limits are in memory per process, and text extraction runs inside the backend process. A restart during extraction leaves the resume "processing"; use the extract button again. Several instances would need a shared store and a job queue.
- **Local file storage.** There is no object storage (S3 or similar) yet.
- **No email or push notifications; reminders are in-app only.** There is no password reset or e-mail verification either, because no e-mail provider is configured.
- **Sessions are stateless JWTs.** Logout removes the cookie, but a copied token stays valid until it expires. Lower `JWT_EXPIRES_IN` if needed.
- **Not paginated.** Resume, job-description and cover-letter lists return summaries only, without pagination. Fine for personal use; large accounts would need it.
- **Non-ASCII filenames.** Multer stores non-ASCII upload filenames incorrectly.
- **Fonts.** The bundled DejaVu fonts do not cover Tamil and some other scripts in PDF export.
- **Registration** confirms with a browser `alert()`.
- **Frontend lint.** 13 problems from before Step 15 remain: `any` types and a hook ordering warning in `dashboard/page.tsx`, `login`, `register`, `AuthContext.tsx` and `auth.api.ts`.
- **Docker not built here.** The Docker images and Compose file have not been built in this environment, because Docker was not installed. Build and run them once before relying on them.

## 28. Mock Interviews

**Mock Interviews** (navbar) is for practising answers to questions prepared from one of your resume versions and one of your job descriptions. As with cover letters (section 24), there is no language model: questions and feedback come from fixed rules in the AI service. The app labels every score as an automated estimate.

**Setting up.** Choose:
- a processed resume;
- a job description whose requirements have been extracted;
- the type: technical, behavioral, HR or mixed;
- the difficulty: beginner, intermediate or advanced;
- 1 to `INTERVIEW_MAX_QUESTIONS` questions (default 10). HR interviews have at most 5 distinct questions.

**How questions are chosen.** The same input always gives the same questions.
- **Technical questions** ask about the job's required and preferred skills, starting with those your resume also lists, rotating through each skill's core concepts.
  - If the job names fewer than three skills, your resume's skills are used.
  - A job skill your resume does not list is introduced as such, and you are asked to be honest about your experience.
  - Roles and projects are mentioned only by their names from your resume.
  - If no known skill is found, general questions are used (debugging, code quality, learning).
- **Behavioral questions** ask for a real example structured as STAR (Situation, Task, Action, Result).
- **HR questions** cover motivation, background, strengths, goals and working style.
- **Untrusted input.** Resume and job text is never treated as instructions: only structured facts are used.

**Answering.**
- **Drafts.** Answers are typed into a text editor. **Save Draft** keeps an answer to continue later. Moving to another question saves the current answer first. Your position is remembered.
- **Unsaved changes.** If you try to leave with unsaved changes, the browser asks first.
- **Feedback.** **Submit for Feedback** evaluates the answer. You can revise and resubmit; the latest submission replaces the earlier feedback.
- **When evaluation fails.** If the evaluation service is unavailable, nothing is scored and the answer is kept as a draft. One automatic retry is made when the service cannot be reached.
- **Finishing.** **Finish Interview** (with confirmation) freezes the summary. Finished interviews are read-only.

**Feedback per answer.** Each answer gets:
- a 0–100 score: concept coverage 50, relevance 20, type-specific depth 20, length and specificity 10;
- strengths, missing points, suggestions and concepts to review;
- for weaker answers, an outline of a stronger answer.

Outlines use [bracketed] placeholders for anything personal, so they never invent experience. Very short or off-topic answers are marked as lacking detail and capped at 15 or 25.

**Summary.**
- **Statistics,** calculated exactly from stored scores: questions answered, average (evaluated answers only; none is shown when nothing was evaluated), highest and lowest, drafts not submitted, and results by question type.
- **From the automated feedback,** shown separately: strongest areas (70+), areas needing improvement (below 60), frequently missed concepts, and topics to study next.

**API** (session cookie required). Every operation is limited to your own sessions and questions; anything else returns `404`. Settings and scores are never accepted from the client.

| Endpoint | Purpose |
|---|---|
| `GET /api/interviews?page=&limit=` | List sessions with answered count and average |
| `POST /api/interviews` | Create: `{ resumeId, jobDescriptionId, interviewType, difficulty, questionCount }` (5 per minute per user) |
| `GET /api/interviews/:id` | Session, questions with drafts and feedback, and the summary so far |
| `GET /api/interviews/:id/summary` | Summary, `final: true` once completed |
| `PUT /api/interviews/:id/questions/:questionId/draft` | Save a draft `{ answer }` (may be empty; up to `INTERVIEW_ANSWER_MAX_CHARS`, default 5,000) |
| `POST /api/interviews/:id/questions/:questionId/submit` | Evaluate `{ answer }` (30 per minute per user). AI failures return 502/503/504 with `details.draftSaved` |
| `PATCH /api/interviews/:id/position` | Remember the current question `{ position }` |
| `POST /api/interviews/:id/complete` | Finish and freeze the summary (idempotent). Later changes return `409 INTERVIEW_COMPLETED` |
| `DELETE /api/interviews/:id` | Delete the session and its answers |

AI service (internal, key required): `POST /api/interview/questions` and `POST /api/interview/evaluate`.

**Migration.** `database/migrations/015_create_mock_interviews.sql` creates `interview_sessions` and `interview_questions`. Deleting the resume or job description keeps the session (the link is cleared). Apply it with `npm run migrate` (section 4).

**Limitations.**
- **Rule-based scoring.** Scores reflect whether expected concepts and structure appear, not how correct or convincing an answer is. A fluent but wrong answer can still score well if it uses the right terms.
- **Text only:** no voice or video.
- **Depends on requirement extraction.** Requirement extraction works best on job descriptions with headed sections (for example "Requirements:" with bullet points). Run-on paragraphs may yield few skills, and questions then lean on your resume's skills.
- **Two tabs.** Editing the same answer in two tabs keeps whichever is saved last.
