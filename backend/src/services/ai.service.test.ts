import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';
import { AddressInfo } from 'net';
import {
  AiServiceError,
  analyzeResume,
  analyzeMatchResults,
  analyzeResumeJobMatch,
  analyzeSemanticMatch,
  checkAiServiceHealth,
  extractResumeSections,
  extractJobRequirements,
  extractResumeSkills,
  generateRecommendations,
  preprocessJobDescription,
  preprocessResumeText,
} from './ai.service';

type Handler = (req: http.IncomingMessage, body: string, res: http.ServerResponse) => void;

let handler: Handler;
let server: http.Server;
let baseUrl: string;

const sendJson = (res: http.ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
};

before(async () => {
  server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => handler(req, body, res));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => {
  server.closeAllConnections();
  server.close();
});

beforeEach(() => {
  process.env.AI_SERVICE_URL = baseUrl;
  delete process.env.AI_SERVICE_TIMEOUT_MS;
  delete process.env.INTERNAL_API_KEY;
});

const assertAiError = async (promise: Promise<unknown>, statusCode: number, code: string) => {
  await assert.rejects(promise, (err: unknown) => {
    assert.ok(err instanceof AiServiceError);
    assert.equal(err.statusCode, statusCode);
    assert.equal(err.code, code);
    return true;
  });
};

test('preprocessResumeText sends resume_id and text and returns cleaned data', async () => {
  let received: any;
  handler = (req, body, res) => {
    received = { method: req.method, url: req.url, contentType: req.headers['content-type'], body: JSON.parse(body) };
    sendJson(res, 200, {
      success: true,
      message: 'Resume text preprocessed successfully',
      data: { resumeId: 'r1', text: 'John Doe' },
    });
  };

  const result = await preprocessResumeText('r1', '  John   Doe  ');

  assert.deepEqual(result, { resumeId: 'r1', text: 'John Doe' });
  assert.equal(received.method, 'POST');
  assert.equal(received.url, '/api/resume/preprocess');
  assert.equal(received.contentType, 'application/json');
  assert.deepEqual(received.body, { resume_id: 'r1', text: '  John   Doe  ' });
});

test('sends the internal API key header only when configured', async () => {
  const seen: (string | undefined)[] = [];
  handler = (req, _body, res) => {
    seen.push(req.headers['x-internal-api-key'] as string | undefined);
    sendJson(res, 200, { success: true, message: 'ok', data: { resumeId: 'r1', text: 'x' } });
  };

  await preprocessResumeText('r1', 'x');
  process.env.INTERNAL_API_KEY = 'secret';
  await preprocessResumeText('r1', 'x');

  assert.deepEqual(seen, [undefined, 'secret']);
});

test('tolerates a trailing slash in AI_SERVICE_URL', async () => {
  let url: string | undefined;
  handler = (req, _body, res) => {
    url = req.url;
    sendJson(res, 200, { success: true, message: 'ok', data: { status: 'healthy' } });
  };
  process.env.AI_SERVICE_URL = `${baseUrl}/`;

  assert.equal(await checkAiServiceHealth(), true);
  assert.equal(url, '/api/health');
});

test('passes through EMPTY_RESUME_TEXT and RESUME_TEXT_TOO_LARGE', async () => {
  handler = (_req, _body, res) =>
    sendJson(res, 400, { success: false, message: 'Resume text cannot be empty', error: { code: 'EMPTY_RESUME_TEXT', details: null } });
  await assertAiError(preprocessResumeText('r1', ' '), 422, 'EMPTY_RESUME_TEXT');

  handler = (_req, _body, res) =>
    sendJson(res, 413, { success: false, message: 'Resume text is too large', error: { code: 'RESUME_TEXT_TOO_LARGE', details: null } });
  await assertAiError(preprocessResumeText('r1', 'x'), 413, 'RESUME_TEXT_TOO_LARGE');
});

test('maps other AI service errors to a generic 502', async () => {
  handler = (_req, _body, res) =>
    sendJson(res, 500, { success: false, message: 'Internal Server Error', error: { code: 'INTERNAL_ERROR', details: null } });
  await assertAiError(preprocessResumeText('r1', 'x'), 502, 'AI_SERVICE_ERROR');

  handler = (_req, _body, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<html>not json</html>');
  };
  await assertAiError(preprocessResumeText('r1', 'x'), 502, 'AI_SERVICE_ERROR');
});

test('rejects a malformed success payload', async () => {
  handler = (_req, _body, res) => sendJson(res, 200, { success: true, message: 'ok', data: { resumeId: 'r1' } });
  await assertAiError(preprocessResumeText('r1', 'x'), 502, 'AI_SERVICE_ERROR');
});

test('times out slow responses', async () => {
  process.env.AI_SERVICE_TIMEOUT_MS = '50';
  handler = (_req, _body, res) => {
    setTimeout(() => sendJson(res, 200, { success: true, message: 'ok', data: { status: 'healthy' } }), 300);
  };
  await assertAiError(preprocessResumeText('r1', 'x'), 504, 'AI_SERVICE_TIMEOUT');
});

test('reports unavailable when the AI service is unreachable', async () => {
  process.env.AI_SERVICE_URL = 'http://127.0.0.1:1';
  await assertAiError(preprocessResumeText('r1', 'x'), 503, 'AI_SERVICE_UNAVAILABLE');
  assert.equal(await checkAiServiceHealth(), false);
});

test('checkAiServiceHealth is true only for a healthy response', async () => {
  handler = (_req, _body, res) => sendJson(res, 200, { success: true, message: 'ok', data: { status: 'healthy' } });
  assert.equal(await checkAiServiceHealth(), true);

  handler = (_req, _body, res) => sendJson(res, 500, { success: false, message: 'down', error: { code: 'X', details: null } });
  assert.equal(await checkAiServiceHealth(), false);
});

test('extractResumeSkills sends the resume text and returns categorized skills', async () => {
  let received: any;
  handler = (req, body, res) => {
    received = { method: req.method, url: req.url, body: JSON.parse(body) };
    sendJson(res, 200, {
      success: true,
      message: 'Resume skills extracted successfully',
      data: {
        resumeId: 'r1',
        skills: { programming_languages: ['Python'], frontend: ['React'], databases: ['MySQL'] },
        totalSkills: 3,
      },
    });
  };

  const result = await extractResumeSkills('r1', 'Python, React and MySQL');

  assert.deepEqual(result, {
    resumeId: 'r1',
    skills: { programming_languages: ['Python'], frontend: ['React'], databases: ['MySQL'] },
    totalSkills: 3,
  });
  assert.equal(received.method, 'POST');
  assert.equal(received.url, '/api/resume/extract-skills');
  assert.deepEqual(received.body, { resume_id: 'r1', text: 'Python, React and MySQL' });
});

test('extractResumeSkills accepts an empty result', async () => {
  handler = (_req, _body, res) =>
    sendJson(res, 200, { success: true, message: 'ok', data: { resumeId: 'r1', skills: {}, totalSkills: 0 } });
  assert.deepEqual(await extractResumeSkills('r1', 'gardening'), { resumeId: 'r1', skills: {}, totalSkills: 0 });
});

test('extractResumeSkills recomputes totalSkills instead of trusting the AI service', async () => {
  handler = (_req, _body, res) =>
    sendJson(res, 200, { success: true, message: 'ok', data: { resumeId: 'r1', skills: { tools: ['Git'] }, totalSkills: 99 } });
  assert.equal((await extractResumeSkills('r1', 'Git')).totalSkills, 1);
});

test('extractResumeSkills rejects malformed skills payloads', async () => {
  const badSkills = [null, ['Python'], { tools: 'Git' }, { tools: [42] }, { tools: [''] }, { tools: ['x'.repeat(101)] }];
  for (const skills of badSkills) {
    handler = (_req, _body, res) =>
      sendJson(res, 200, { success: true, message: 'ok', data: { resumeId: 'r1', skills, totalSkills: 1 } });
    await assertAiError(extractResumeSkills('r1', 'x'), 502, 'AI_SERVICE_ERROR');
  }
});

test('extractResumeSkills passes through EMPTY_RESUME_TEXT', async () => {
  handler = (_req, _body, res) =>
    sendJson(res, 400, { success: false, message: 'Resume text cannot be empty', error: { code: 'EMPTY_RESUME_TEXT', details: null } });
  await assertAiError(extractResumeSkills('r1', ' '), 422, 'EMPTY_RESUME_TEXT');
});

test('extractResumeSections sends the resume text and returns sections', async () => {
  let received: any;
  handler = (req, body, res) => {
    received = { method: req.method, url: req.url, body: JSON.parse(body) };
    sendJson(res, 200, {
      success: true,
      message: 'Resume sections extracted successfully',
      data: {
        resumeId: 'r1',
        sections: {
          summary: 'Developer.',
          skills: 'Python\nReact',
          other_sections: { publications: 'Paper' },
        },
      },
    });
  };

  const result = await extractResumeSections('r1', 'SUMMARY\nDeveloper.');

  assert.deepEqual(result, {
    resumeId: 'r1',
    sections: { other_sections: { publications: 'Paper' }, summary: 'Developer.', skills: 'Python\nReact' },
  });
  assert.equal(received.method, 'POST');
  assert.equal(received.url, '/api/resume/extract-sections');
  assert.deepEqual(received.body, { resume_id: 'r1', text: 'SUMMARY\nDeveloper.' });
});

test('extractResumeSections accepts no sections and drops nulls and unknown keys', async () => {
  handler = (_req, _body, res) =>
    sendJson(res, 200, {
      success: true,
      message: 'ok',
      data: { resumeId: 'r1', sections: { summary: null, unexpected: 'x' } },
    });
  assert.deepEqual(await extractResumeSections('r1', 'plain text'), {
    resumeId: 'r1',
    sections: { other_sections: {} },
  });
});

test('extractResumeSections rejects malformed sections payloads', async () => {
  const badSections = [null, 'text', ['summary'], { summary: 42 }, { other_sections: { publications: 1 } }, { other_sections: [] }];
  for (const sections of badSections) {
    handler = (_req, _body, res) =>
      sendJson(res, 200, { success: true, message: 'ok', data: { resumeId: 'r1', sections } });
    await assertAiError(extractResumeSections('r1', 'x'), 502, 'AI_SERVICE_ERROR');
  }
});

test('extractResumeSections passes through EMPTY_RESUME_TEXT and RESUME_TEXT_TOO_LARGE', async () => {
  handler = (_req, _body, res) =>
    sendJson(res, 400, { success: false, message: 'Resume text cannot be empty', error: { code: 'EMPTY_RESUME_TEXT', details: null } });
  await assertAiError(extractResumeSections('r1', ' '), 422, 'EMPTY_RESUME_TEXT');

  handler = (_req, _body, res) =>
    sendJson(res, 413, { success: false, message: 'Resume text is too large', error: { code: 'RESUME_TEXT_TOO_LARGE', details: null } });
  await assertAiError(extractResumeSections('r1', 'x'), 413, 'RESUME_TEXT_TOO_LARGE');
});

const validAnalysis = () => ({
  resumeId: 'r1',
  resume: {
    personalInformation: {
      name: 'John Doe',
      email: 'john@example.com',
      phone: null,
      location: null,
      linkedin: null,
      github: null,
      portfolio: null,
    },
    summary: 'Developer.',
    experience: [
      {
        title: 'Software Developer',
        company: 'ABC Technologies',
        location: null,
        startDate: 'Jan 2025',
        endDate: null,
        isCurrent: true,
        description: ['Developed REST APIs'],
        rawText: 'Software Developer\nABC Technologies\nJan 2025 - Present',
      },
    ],
    education: [],
    projects: [],
    skills: { programming_languages: ['Python'] },
    certifications: [{ name: 'AWS Certified Cloud Practitioner', issuer: null, date: null }],
    achievements: [],
    languages: [],
    interests: [],
    otherSections: {},
  },
  metadata: {
    totalSkills: 1,
    totalExperienceEntries: 1,
    totalEducationEntries: 0,
    totalProjects: 0,
    totalCertifications: 1,
  },
});

test('analyzeResume sends the resume text and returns the structured analysis', async () => {
  let received: any;
  handler = (req, body, res) => {
    received = { method: req.method, url: req.url, body: JSON.parse(body) };
    sendJson(res, 200, { success: true, message: 'Resume analyzed successfully', data: validAnalysis() });
  };

  const result = await analyzeResume('r1', 'John Doe');

  assert.deepEqual(result, validAnalysis());
  assert.equal(received.method, 'POST');
  assert.equal(received.url, '/api/resume/analyze');
  assert.deepEqual(received.body, { resume_id: 'r1', text: 'John Doe' });
});

test('analyzeResume strips fields outside the contract', async () => {
  const data: any = validAnalysis();
  data.debug = 'internal';
  data.resume.personalInformation.ssn = '123';
  handler = (_req, _body, res) => sendJson(res, 200, { success: true, message: 'ok', data });

  const result: any = await analyzeResume('r1', 'x');
  assert.equal(result.debug, undefined);
  assert.equal(result.resume.personalInformation.ssn, undefined);
});

test('analyzeResume rejects malformed analyses without logging their contents', async () => {
  const mutations: ((d: any) => void)[] = [
    (d) => delete d.resume,
    (d) => (d.metadata.totalSkills = -1),
    (d) => (d.metadata.totalProjects = 'two'),
    (d) => (d.resume.experience = {}),
    (d) => (d.resume.experience[0].isCurrent = 'yes'),
    (d) => (d.resume.skills = { tools: 'Git' }),
    (d) => (d.resume.personalInformation.email = 42),
    (d) => (d.resume.certifications = [{ issuer: null, date: null }]),
  ];
  const logged: string[] = [];
  const originalError = console.error;
  console.error = (...args: unknown[]) => logged.push(args.join(' '));
  try {
    for (const mutate of mutations) {
      const data = validAnalysis();
      mutate(data);
      handler = (_req, _body, res) => sendJson(res, 200, { success: true, message: 'ok', data });
      await assertAiError(analyzeResume('r1', 'x'), 502, 'AI_SERVICE_ERROR');
    }
  } finally {
    console.error = originalError;
  }
  assert.ok(logged.length > 0);
  assert.ok(logged.every((line) => !line.includes('john@example.com') && !line.includes('John Doe')));
});

test('analyzeResume passes through analysis and validation errors', async () => {
  handler = (_req, _body, res) =>
    sendJson(res, 500, { success: false, message: 'Resume analysis failed', error: { code: 'RESUME_ANALYSIS_FAILED', details: null } });
  await assertAiError(analyzeResume('r1', 'x'), 500, 'RESUME_ANALYSIS_FAILED');

  handler = (_req, _body, res) =>
    sendJson(res, 400, { success: false, message: 'Resume text cannot be empty', error: { code: 'EMPTY_RESUME_TEXT', details: null } });
  await assertAiError(analyzeResume('r1', ' '), 422, 'EMPTY_RESUME_TEXT');
});

test('preprocessJobDescription sends the job description text and returns processed text', async () => {
  let received: any;
  handler = (req, body, res) => {
    received = { method: req.method, url: req.url, body: JSON.parse(body) };
    sendJson(res, 200, {
      success: true,
      message: 'Job description processed successfully',
      data: { jobDescriptionId: 'jd1', processedText: 'Requirements:\n- React' },
    });
  };

  const result = await preprocessJobDescription('jd1', 'Requirements:\r\n\r\n\r\n-   React');

  assert.deepEqual(result, { jobDescriptionId: 'jd1', processedText: 'Requirements:\n- React' });
  assert.equal(received.method, 'POST');
  assert.equal(received.url, '/api/job-description/preprocess');
  assert.deepEqual(received.body, { job_description_id: 'jd1', text: 'Requirements:\r\n\r\n\r\n-   React' });
});

test('preprocessJobDescription maps AI text errors to JOB_DESCRIPTION_PROCESSING_ERROR', async () => {
  for (const [status, code] of [[400, 'EMPTY_JOB_DESCRIPTION_TEXT'], [413, 'JOB_DESCRIPTION_TEXT_TOO_LARGE']] as const) {
    handler = (_req, _body, res) => sendJson(res, status, { success: false, message: 'x', error: { code, details: null } });
    await assertAiError(preprocessJobDescription('jd1', 'x'), 422, 'JOB_DESCRIPTION_PROCESSING_ERROR');
  }
});

test('preprocessJobDescription rejects malformed responses and reports outages', async () => {
  handler = (_req, _body, res) => sendJson(res, 200, { success: true, message: 'ok', data: { jobDescriptionId: 'jd1' } });
  await assertAiError(preprocessJobDescription('jd1', 'x'), 502, 'AI_SERVICE_ERROR');

  handler = (_req, _body, res) =>
    sendJson(res, 500, { success: false, message: 'Internal Server Error', error: { code: 'INTERNAL_ERROR', details: null } });
  await assertAiError(preprocessJobDescription('jd1', 'x'), 502, 'AI_SERVICE_ERROR');

  process.env.AI_SERVICE_URL = 'http://127.0.0.1:1';
  await assertAiError(preprocessJobDescription('jd1', 'x'), 503, 'AI_SERVICE_UNAVAILABLE');
});

const validRequirements = () => ({
  jobTitle: 'Frontend Developer',
  location: null,
  employmentType: 'Full-time',
  workMode: null,
  requiredSkills: ['React', 'TypeScript'],
  preferredSkills: ['Next.js'],
  mentionedSkills: [],
  experienceRequirements: [{ minimumYears: 2, maximumYears: null, areas: ['React'], preferred: false, text: '2+ years of React' }],
  educationRequirements: [{ degree: "Bachelor's degree", fields: ['Computer Science'], preferred: false, text: 'x' }],
  responsibilities: ['Build React applications'],
});

test('extractJobRequirements sends text and stored title, returns requirements', async () => {
  let received: any;
  handler = (req, body, res) => {
    received = { url: req.url, body: JSON.parse(body) };
    sendJson(res, 200, {
      success: true,
      message: 'Job requirements extracted successfully',
      data: { jobDescriptionId: 'jd1', requirements: validRequirements() },
    });
  };

  const result = await extractJobRequirements('jd1', 'Requirements: React', 'Frontend Developer');

  assert.deepEqual(result, validRequirements());
  assert.equal(received.url, '/api/job-description/extract-requirements');
  assert.deepEqual(received.body, { job_description_id: 'jd1', text: 'Requirements: React', job_title: 'Frontend Developer' });
});

test('extractJobRequirements strips unknown fields', async () => {
  const requirements: any = { ...validRequirements(), internal: 'x' };
  requirements.experienceRequirements[0].debug = true;
  handler = (_req, _body, res) =>
    sendJson(res, 200, { success: true, message: 'ok', data: { jobDescriptionId: 'jd1', requirements } });
  const result: any = await extractJobRequirements('jd1', 'x', null);
  assert.equal(result.internal, undefined);
  assert.equal(result.experienceRequirements[0].debug, undefined);
});

test('extractJobRequirements rejects malformed requirements', async () => {
  const mutations: ((r: any) => void)[] = [
    (r) => delete r.requiredSkills,
    (r) => (r.requiredSkills = 'React'),
    (r) => (r.preferredSkills = [1]),
    (r) => (r.experienceRequirements[0].minimumYears = -1),
    (r) => (r.experienceRequirements[0].minimumYears = '2'),
    (r) => (r.educationRequirements[0].fields = null),
    (r) => (r.responsibilities = {}),
  ];
  const originalError = console.error;
  console.error = () => {};
  try {
    for (const mutate of mutations) {
      const requirements = validRequirements();
      mutate(requirements);
      handler = (_req, _body, res) =>
        sendJson(res, 200, { success: true, message: 'ok', data: { jobDescriptionId: 'jd1', requirements } });
      await assertAiError(extractJobRequirements('jd1', 'x', null), 502, 'AI_SERVICE_ERROR');
    }
  } finally {
    console.error = originalError;
  }
});

test('extractJobRequirements maps AI failures to JOB_DESCRIPTION_PROCESSING_ERROR', async () => {
  handler = (_req, _body, res) =>
    sendJson(res, 400, { success: false, message: 'x', error: { code: 'EMPTY_JOB_DESCRIPTION_TEXT', details: null } });
  await assertAiError(extractJobRequirements('jd1', 'x', null), 422, 'JOB_DESCRIPTION_PROCESSING_ERROR');

  handler = (_req, _body, res) =>
    sendJson(res, 500, { success: false, message: 'x', error: { code: 'JOB_REQUIREMENT_EXTRACTION_FAILED', details: null } });
  await assertAiError(extractJobRequirements('jd1', 'x', null), 500, 'JOB_DESCRIPTION_PROCESSING_ERROR');

  process.env.AI_SERVICE_URL = 'http://127.0.0.1:1';
  await assertAiError(extractJobRequirements('jd1', 'x', null), 503, 'AI_SERVICE_UNAVAILABLE');
});

const scoreComponent = (score: number | null, weight: number) => ({
  score,
  weight,
  effectiveWeight: score === null ? null : weight,
  contribution: score === null ? null : (score * weight) / 100,
  status: score === null ? 'not_applicable' : 'calculated',
  reason: score === null ? 'The job lists none' : null,
});

const validMatching = () => ({
  resumeId: 'r1',
  jobDescriptionId: 'j1',
  overallScore: 77.5,
  scoreStatus: 'calculated',
  components: {
    requiredSkills: scoreComponent(75, 60),
    preferredSkills: scoreComponent(50, 15),
    experience: scoreComponent(100, 15),
    education: scoreComponent(100, 10),
  },
  scoreMetadata: {
    scoringMethod: 'weighted_deterministic',
    version: '1.0',
    weights: { requiredSkills: 60, preferredSkills: 15, experience: 15, education: 10 },
  },
  skills: {
    required: {
      matched: ['React', 'JavaScript', 'Git'],
      missing: ['TypeScript'],
      coverage: 75,
      byCategory: { frontend: { matched: ['React'], missing: [] } },
    },
    preferred: { matched: [], missing: [], coverage: null, byCategory: {} },
  },
  experience: {
    status: 'compared',
    requiredYears: 2,
    candidateYears: 3,
    candidateYearsReason: null,
    meetsRequirement: true,
    requirements: [
      { minimumYears: 2, maximumYears: null, preferred: false, text: '2+ years', candidateYears: 3, meetsRequirement: true, areas: [] },
    ],
  },
  education: { status: 'not_applicable', requirements: [] },
  summary: {
    requiredSkillCount: 4,
    matchedRequiredSkillCount: 3,
    missingRequiredSkillCount: 1,
    preferredSkillCount: 0,
    matchedPreferredSkillCount: 0,
    missingPreferredSkillCount: 0,
  },
});

const matchInputs = (): Parameters<typeof analyzeResumeJobMatch> =>
  [
    'r1',
    'j1',
    { skills: { frontend: ['React'] }, experience: [{ startDate: 'Jan 2021', endDate: null, isCurrent: true, text: 'React' }], education: [] },
    { requiredSkills: ['React'], preferredSkills: [], experienceRequirements: [], educationRequirements: [] },
  ];

test('analyzeResumeJobMatch sends only structured data and returns the matching result', async () => {
  let received: any;
  handler = (req, body, res) => {
    received = { url: req.url, body: JSON.parse(body) };
    sendJson(res, 200, { success: true, message: 'ok', data: { matching: validMatching() } });
  };

  const result = await analyzeResumeJobMatch(...matchInputs());

  assert.deepEqual(result, validMatching());
  assert.equal(received.url, '/api/matching/analyze');
  assert.deepEqual(Object.keys(received.body).sort(), ['job_description_id', 'job_requirements', 'resume', 'resume_id']);
  assert.deepEqual(Object.keys(received.body.resume).sort(), ['education', 'experience', 'skills']);
});

test('analyzeResumeJobMatch rejects malformed results', async () => {
  const mutations: ((m: any) => void)[] = [
    (m) => delete m.skills,
    (m) => (m.skills.required.coverage = 120),
    (m) => (m.skills.required.matched = 'React'),
    (m) => (m.experience.status = 'great'),
    (m) => (m.experience.meetsRequirement = 'yes'),
    (m) => (m.summary.requiredSkillCount = -1),
    (m) => delete m.overallScore,
    (m) => (m.overallScore = 101),
    (m) => (m.scoreStatus = 'excellent'),
    (m) => delete m.components.education,
    (m) => (m.components.experience.status = 'guessed'),
    (m) => (m.components.requiredSkills.contribution = -5),
    (m) => delete m.scoreMetadata.weights,
  ];
  const originalError = console.error;
  console.error = () => {};
  try {
    for (const mutate of mutations) {
      const matching = validMatching();
      mutate(matching);
      handler = (_req, _body, res) => sendJson(res, 200, { success: true, message: 'ok', data: { matching } });
      await assertAiError(analyzeResumeJobMatch(...matchInputs()), 502, 'AI_SERVICE_ERROR');
    }
  } finally {
    console.error = originalError;
  }

  // Fields outside the contract (such as a rating label) are stripped.
  const extra: any = { ...validMatching(), rating: 'Excellent' };
  handler = (_req, _body, res) => sendJson(res, 200, { success: true, message: 'ok', data: { matching: extra } });
  assert.equal(((await analyzeResumeJobMatch(...matchInputs())) as any).rating, undefined);
});

test('analyzeResumeJobMatch accepts a result with no calculable score', async () => {
  const matching: any = validMatching();
  matching.overallScore = null;
  matching.scoreStatus = 'insufficient_data';
  for (const name of ['requiredSkills', 'preferredSkills', 'experience', 'education']) {
    matching.components[name] = scoreComponent(null, matching.components[name].weight);
  }
  handler = (_req, _body, res) => sendJson(res, 200, { success: true, message: 'ok', data: { matching } });
  const result = await analyzeResumeJobMatch(...matchInputs());
  assert.equal(result.overallScore, null);
  assert.equal(result.components.education.status, 'not_applicable');
});

test('analyzeResumeJobMatch maps matcher failures and outages', async () => {
  handler = (_req, _body, res) =>
    sendJson(res, 500, { success: false, message: 'x', error: { code: 'MATCHING_FAILED', details: null } });
  await assertAiError(analyzeResumeJobMatch(...matchInputs()), 500, 'MATCHING_ERROR');

  process.env.AI_SERVICE_URL = 'http://127.0.0.1:1';
  await assertAiError(analyzeResumeJobMatch(...matchInputs()), 503, 'AI_SERVICE_UNAVAILABLE');
});

const semanticComponent = (similarity: number | null) => ({
  similarity,
  status: similarity === null ? 'not_available' : 'calculated',
  reason: similarity === null ? 'The resume lists no projects' : null,
  truncated: false,
});

const validSemantic = () => ({
  resumeId: 'r1',
  jobDescriptionId: 'j1',
  overallSemanticSimilarity: semanticComponent(77.41),
  experienceSemanticSimilarity: semanticComponent(63.82),
  projectSemanticSimilarity: semanticComponent(null),
  skillsSemanticSimilarity: semanticComponent(79.65),
  metadata: { model: 'sentence-transformers/all-MiniLM-L6-v2', method: 'cosine_similarity' },
});

const semanticInputs = (): Parameters<typeof analyzeSemanticMatch> => [
  'r1',
  'j1',
  {
    summary: 'Backend developer',
    experience: [{ title: 'Developer', company: 'ABC', description: ['Built APIs'], rawText: '' }],
    projects: [],
    skills: { backend: ['Node.js'] },
    education: [],
  },
  {
    title: 'Backend Developer',
    description: 'We build APIs',
    responsibilities: ['Build APIs'],
    requiredSkills: ['Node.js'],
    preferredSkills: [],
    experienceRequirements: [],
    educationRequirements: [],
  },
];

test('analyzeSemanticMatch sends professional content only and returns similarities', async () => {
  let received: any;
  handler = (req, body, res) => {
    received = { url: req.url, body: JSON.parse(body) };
    sendJson(res, 200, { success: true, message: 'ok', data: { semanticMatch: validSemantic() } });
  };
  const result = await analyzeSemanticMatch(...semanticInputs());
  assert.deepEqual(result, validSemantic());
  assert.equal(received.url, '/api/matching/semantic');
  assert.deepEqual(Object.keys(received.body).sort(), ['job', 'job_description_id', 'resume', 'resume_id']);
  assert.deepEqual(Object.keys(received.body.resume).sort(), ['education', 'experience', 'projects', 'skills', 'summary']);
});

test('analyzeSemanticMatch uses its own, longer timeout', async () => {
  process.env.AI_SERVICE_TIMEOUT_MS = '50';
  process.env.AI_SEMANTIC_TIMEOUT_MS = '1000';
  handler = (_req, _body, res) => {
    setTimeout(() => sendJson(res, 200, { success: true, message: 'ok', data: { semanticMatch: validSemantic() } }), 200);
  };
  try {
    assert.equal((await analyzeSemanticMatch(...semanticInputs())).overallSemanticSimilarity.similarity, 77.41);
    process.env.AI_SEMANTIC_TIMEOUT_MS = '50';
    await assertAiError(analyzeSemanticMatch(...semanticInputs()), 504, 'AI_SERVICE_TIMEOUT');
  } finally {
    delete process.env.AI_SEMANTIC_TIMEOUT_MS;
  }
});

test('analyzeSemanticMatch passes through semantic errors', async () => {
  for (const [status, code, expected] of [
    [503, 'EMBEDDING_MODEL_UNAVAILABLE', 503],
    [422, 'EMPTY_RESUME_CONTENT', 422],
    [422, 'EMPTY_JOB_CONTENT', 422],
    [500, 'SEMANTIC_MATCHING_FAILED', 500],
  ] as const) {
    handler = (_req, _body, res) => sendJson(res, status, { success: false, message: 'x', error: { code, details: null } });
    await assertAiError(analyzeSemanticMatch(...semanticInputs()), expected, code);
  }
});

test('analyzeSemanticMatch rejects malformed results and never passes embeddings on', async () => {
  const mutations: ((m: any) => void)[] = [
    (m) => delete m.metadata,
    (m) => (m.metadata.method = 'dot_product'),
    (m) => (m.overallSemanticSimilarity.similarity = 140),
    (m) => (m.skillsSemanticSimilarity.status = 'guessed'),
  ];
  const originalError = console.error;
  console.error = () => {};
  try {
    for (const mutate of mutations) {
      const semantic = validSemantic();
      mutate(semantic);
      handler = (_req, _body, res) => sendJson(res, 200, { success: true, message: 'ok', data: { semanticMatch: semantic } });
      await assertAiError(analyzeSemanticMatch(...semanticInputs()), 502, 'AI_SERVICE_ERROR');
    }
  } finally {
    console.error = originalError;
  }
  const withVectors: any = { ...validSemantic(), embeddings: [[0.1, 0.2]] };
  handler = (_req, _body, res) => sendJson(res, 200, { success: true, message: 'ok', data: { semanticMatch: withVectors } });
  assert.equal(((await analyzeSemanticMatch(...semanticInputs())) as any).embeddings, undefined);
});

const validMatchAnalysis = () => ({
  overall: {
    matchScore: 77.5,
    scoreAvailable: true,
    summary: '3 of 4 required skills were identified (partial coverage).',
    highlights: [{ category: 'required_skills', message: 'Some required skills were identified; several were not detected.' }],
  },
  skills: {
    required: { status: 'calculated', matched: ['React'], missing: ['Go'], coverage: 50, coverageLevel: 'partial' },
    preferred: { status: 'not_applicable', matched: [], missing: [], coverage: null, coverageLevel: null },
  },
  experience: { status: 'not_applicable', requiredYears: null, candidateYears: null, score: null, reason: 'x', skillSpecific: [] },
  education: { status: 'not_applicable', requiredDegree: null, requiredFields: [], candidateDegree: null, fieldMatch: null, reason: 'x' },
  semanticSimilarity: {
    status: 'unavailable',
    overall: null,
    experience: null,
    projects: null,
    skills: null,
    reason: 'Semantic matching service is currently unavailable.',
    signalComparison: null,
  },
  dataQuality: { status: 'mostly_complete', issues: ['Semantic similarity could not be calculated'], notApplicable: [] },
  strengths: [],
  gaps: [{ category: 'required_skill', message: 'Go is listed as a required skill but was not detected in the resume.' }],
  additionalGapCount: 0,
});

test('analyzeMatchResults sends the existing results and returns the analysis', async () => {
  let received: any;
  handler = (req, body, res) => {
    received = { url: req.url, body: JSON.parse(body) };
    sendJson(res, 200, { success: true, message: 'ok', data: { analysis: validMatchAnalysis() } });
  };
  const semanticError = { code: 'EMBEDDING_MODEL_UNAVAILABLE', message: 'Semantic matching service is currently unavailable.' };
  const result = await analyzeMatchResults(validMatching() as any, null, semanticError);
  assert.deepEqual(result, validMatchAnalysis());
  assert.equal(received.url, '/api/matching/analysis');
  assert.deepEqual(received.body, { matching: validMatching(), semanticMatch: null, semanticError });
});

test('analyzeMatchResults rejects malformed analyses and rating labels', async () => {
  const mutations: ((a: any) => void)[] = [
    (a) => delete a.overall,
    (a) => (a.skills.required.coverageLevel = 'excellent'),
    (a) => (a.experience.status = 'probably_fine'),
    (a) => (a.strengths = [{ category: 'personality', message: 'Talented' }]),
    (a) => (a.gaps = Array(6).fill(validMatchAnalysis().gaps[0])),
    (a) => (a.dataQuality.status = 'good'),
  ];
  const originalError = console.error;
  console.error = () => {};
  try {
    for (const mutate of mutations) {
      const analysis = validMatchAnalysis();
      mutate(analysis);
      handler = (_req, _body, res) => sendJson(res, 200, { success: true, message: 'ok', data: { analysis } });
      await assertAiError(analyzeMatchResults(validMatching() as any, null, null), 502, 'AI_SERVICE_ERROR');
    }
  } finally {
    console.error = originalError;
  }
});

test('analyzeMatchResults passes through analysis failures', async () => {
  handler = (_req, _body, res) =>
    sendJson(res, 500, { success: false, message: 'Match analysis failed', error: { code: 'MATCH_ANALYSIS_FAILED', details: null } });
  await assertAiError(analyzeMatchResults(validMatching() as any, null, null), 500, 'MATCH_ANALYSIS_FAILED');
});

const validRecommendations = () => ({
  items: [
    {
      id: 'rec-001',
      category: 'required_skill',
      priority: 'high',
      title: 'Review the Docker requirement',
      issue: 'Docker was not detected in the resume.',
      reason: 'Docker is listed as a required skill for this position.',
      action: 'If you have used Docker, describe where and how you used it.',
      relatedSkills: ['Docker'],
      evidence: 'Job requirements list Docker as required; the resume parser did not detect it.',
    },
  ],
  total: 1,
  limitations: [],
  message: null,
});

const recommendationResume = () => ({
  experience: [{ title: 'Developer', company: 'ABC', startDate: 'Jan 2022', endDate: null, isCurrent: true, description: ['Built APIs'] }],
  projects: [{ name: 'Shop App', description: [], technologies: ['React'] }],
});

test('generateRecommendations sends the existing results and role/project entries only', async () => {
  let received: any;
  handler = (req, body, res) => {
    received = { url: req.url, body: JSON.parse(body) };
    sendJson(res, 200, { success: true, message: 'ok', data: { recommendations: validRecommendations() } });
  };
  const result = await generateRecommendations(validMatching() as any, validMatchAnalysis() as any, recommendationResume());
  assert.deepEqual(result, validRecommendations());
  assert.equal(received.url, '/api/matching/recommendations');
  assert.deepEqual(Object.keys(received.body).sort(), ['analysis', 'matching', 'resume']);
  assert.deepEqual(Object.keys(received.body.resume).sort(), ['experience', 'projects']);
});

test('generateRecommendations rejects malformed recommendations', async () => {
  const mutations: ((r: any) => void)[] = [
    (r) => (r.items[0].category = 'personality'),
    (r) => (r.items[0].priority = 'urgent'),
    (r) => (r.items[0].id = '1'),
    (r) => (r.items[0].action = ''),
    (r) => (r.items = Array(9).fill(r.items[0])),
    (r) => (r.total = 5),
    (r) => delete r.limitations,
  ];
  const originalError = console.error;
  console.error = () => {};
  try {
    for (const mutate of mutations) {
      const recommendations = validRecommendations();
      mutate(recommendations);
      handler = (_req, _body, res) => sendJson(res, 200, { success: true, message: 'ok', data: { recommendations } });
      await assertAiError(
        generateRecommendations(validMatching() as any, validMatchAnalysis() as any, recommendationResume()),
        502,
        'AI_SERVICE_ERROR'
      );
    }
  } finally {
    console.error = originalError;
  }
});

test('generateRecommendations passes through failures', async () => {
  handler = (_req, _body, res) =>
    sendJson(res, 500, { success: false, message: 'Recommendation generation failed', error: { code: 'RECOMMENDATIONS_FAILED', details: null } });
  await assertAiError(
    generateRecommendations(validMatching() as any, validMatchAnalysis() as any, recommendationResume()),
    500,
    'RECOMMENDATIONS_FAILED'
  );
});
