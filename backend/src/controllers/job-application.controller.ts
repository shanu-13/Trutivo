import { Request, Response } from 'express';
import { z } from 'zod';
import * as applications from '../services/job-application.service';
import * as insights from '../services/application-insights.service';
import { APPLICATION_STATUSES, EMPLOYMENT_TYPES, INTERVIEW_TYPES, SORTS, type ApplicationFields } from '../services/job-application.service';
import { isValidResumeId as isUuid } from './resume-version.controller';

// Job application tracker (Step 13): plain CRUD on the user's own records, no AI service involved.

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

const unauthorized = (res: Response) =>
  res.status(401).json({ success: false, message: 'Unauthorized', error: { code: 'UNAUTHORIZED', details: null } });
const notFound = (res: Response) =>
  res.status(404).json({ success: false, message: 'Application not found', error: { code: 'NOT_FOUND', details: null } });
const invalidId = (res: Response) =>
  res.status(400).json({ success: false, message: 'Invalid application id', error: { code: 'INVALID_ID', details: null } });
const serverError = (res: Response, message: string) =>
  res.status(500).json({ success: false, message, error: { code: 'SERVER_ERROR', details: null } });
const validationError = (res: Response, issues: { field: string; message: string }[]) =>
  res.status(400).json({ success: false, message: 'Please correct the highlighted fields', error: { code: 'VALIDATION_ERROR', details: issues } });
export const fromZod = (error: z.ZodError) => error.issues.map((i) => ({ field: i.path.join('.') || 'body', message: i.message }));

const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
// Single-line text: whitespace collapsed, empty means "not set".
export const line = (max: number) =>
  z
    .string()
    .refine((s) => !/[\u0000-\u001f\u007f]/.test(s), 'Contains invalid characters')
    .transform((s) => s.replace(/\s+/g, ' ').trim())
    .refine((s) => s.length <= max, `Must be at most ${max} characters`)
    .transform((s) => s || null);
// Multi-line notes: line breaks kept.
export const notes = (max: number) =>
  z
    .string()
    .transform((s) => s.replace(/\r\n?/g, '\n').trim())
    .refine((s) => !CONTROL.test(s), 'Contains invalid characters')
    .refine((s) => s.length <= max, `Must be at most ${max.toLocaleString()} characters`)
    .transform((s) => s || null);
export const required = (max: number, label: string) =>
  line(max).refine((s): s is string => s !== null, `${label} is required`) as unknown as z.ZodType<string>;

// Only real web addresses; javascript:, data: and similar are refused.
const url = z
  .string()
  .trim()
  .max(2048, 'Must be at most 2,048 characters')
  .transform((s) => s || null)
  .refine((s) => {
    if (s === null) return true;
    try {
      const u = new URL(s);
      return (u.protocol === 'http:' || u.protocol === 'https:') && Boolean(u.hostname);
    } catch {
      return false;
    }
  }, 'Must be a full web address starting with http:// or https://');

export const isCalendarDate = (s: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s && s >= '1990-01-01' && s <= '2100-12-31';
};
const date = z.string().refine(isCalendarDate, 'Must be a valid date (YYYY-MM-DD)');
// An application date cannot be in the future (one day of slack for time zones).
const appliedOn = date.refine((s) => s <= new Date(Date.now() + 86_400_000).toISOString().slice(0, 10), 'The application date cannot be in the future');
// A moment with its time zone, stored in UTC.
const dateTime = z
  .string()
  .datetime({ offset: true, message: 'Must be a date and time with a time zone' })
  .transform((s) => new Date(s).toISOString())
  .refine((s) => s >= '1990-01-01' && s <= '2100-12-31T23:59:59.999Z', 'Must be a realistic date');
const email = z
  .string()
  .trim()
  .max(254, 'Must be at most 254 characters')
  .transform((s) => s || null)
  .refine((s) => s === null || z.string().email().safeParse(s).success, 'Must be a valid e-mail address');
const phone = z
  .string()
  .trim()
  .max(50, 'Must be at most 50 characters')
  .transform((s) => s || null)
  .refine((s) => s === null || (/^[+()\d\s./-]+$/.test(s) && s.replace(/\D/g, '').length >= 5), 'Must be a phone number (digits, spaces, + ( ) - . /)');
const link = z.string().refine(isUuid, 'Must be a valid id');

const optional = <T extends z.ZodTypeAny>(schema: T) => schema.nullable().optional();

const fieldSchemas = {
  postingUrl: optional(url),
  status: z.enum(APPLICATION_STATUSES),
  appliedOn: optional(appliedOn),
  location: optional(line(200)),
  employmentType: optional(z.enum(EMPLOYMENT_TYPES)),
  compensationNotes: optional(line(500)),
  contactName: optional(line(200)),
  contactEmail: optional(email),
  contactPhone: optional(phone),
  notes: optional(notes(5000)),
  interviewAt: optional(dateTime),
  interviewType: optional(z.enum(INTERVIEW_TYPES)),
  interviewStage: optional(line(100)),
  interviewerName: optional(line(200)),
  interviewNotes: optional(notes(5000)),
  followUpOn: optional(date),
  followUpNotes: optional(notes(1000)),
  jobDescriptionId: optional(link),
  resumeId: optional(link),
  coverLetterId: optional(link),
};

export const createSchema = z
  .object({ jobTitle: required(200, 'Job title'), companyName: required(200, 'Company name'), ...fieldSchemas, status: fieldSchemas.status.default('wishlist') })
  .strict();
export const updateSchema = z
  .object({ jobTitle: required(200, 'Job title').optional(), companyName: required(200, 'Company name').optional(), ...fieldSchemas, status: fieldSchemas.status.optional() })
  .strict()
  .refine((v) => Object.values(v).some((x) => x !== undefined), 'Nothing to update');

const LINK_LABEL: Record<string, string> = { jobDescriptionId: 'Job description', resumeId: 'Resume', coverLetterId: 'Cover letter' };
const linkError = (res: Response, field: string) =>
  res.status(404).json({
    success: false,
    message: `${LINK_LABEL[field]} not found`,
    error: { code: 'LINKED_RESOURCE_NOT_FOUND', details: [{ field, message: `${LINK_LABEL[field]} not found` }] },
  });

// The client's own calendar day, for follow-up dates; only accepted within a day of the server's UTC date.
export const asOfDate = (value: unknown) => {
  if (typeof value !== 'string' || !isCalendarDate(value)) return undefined;
  const diff = Math.abs(new Date(`${value}T00:00:00Z`).getTime() - new Date(new Date().toISOString().slice(0, 10)).getTime());
  return diff <= 86_400_000 ? value : undefined;
};

type ParsedList = { query: applications.ListQuery } | { issues: { field: string; message: string }[] };

// ?status=applied,interview&company=&title=&appliedFrom=&appliedTo=&sort=updated|applied|company|upcoming&order=asc|desc&page=&limit=&today=
export const parseListQuery = (q: Record<string, unknown>): ParsedList => {
  const issues: { field: string; message: string }[] = [];
  const text = (name: string) => {
    const v = q[name];
    if (v === undefined || v === '') return null;
    if (typeof v !== 'string' || v.length > 200) {
      issues.push({ field: name, message: 'Must be text of at most 200 characters' });
      return null;
    }
    return v.trim() || null;
  };
  const company = text('company');
  const title = text('title');
  const statuses = text('status')?.split(',').map((s) => s.trim()).filter(Boolean) ?? [];
  if (statuses.some((s) => !(APPLICATION_STATUSES as readonly string[]).includes(s))) issues.push({ field: 'status', message: `Must be one or more of: ${APPLICATION_STATUSES.join(', ')}` });
  const appliedFrom = text('appliedFrom');
  const appliedTo = text('appliedTo');
  for (const [name, v] of [['appliedFrom', appliedFrom], ['appliedTo', appliedTo]] as const) if (v && !isCalendarDate(v)) issues.push({ field: name, message: 'Must be a valid date (YYYY-MM-DD)' });
  if (appliedFrom && appliedTo && appliedFrom > appliedTo) issues.push({ field: 'appliedTo', message: 'Must be on or after the start date' });
  const sort = (text('sort') ?? 'updated') as applications.SortKey;
  if (!(sort in SORTS)) issues.push({ field: 'sort', message: `Must be one of: ${Object.keys(SORTS).join(', ')}` });
  const order = text('order') ?? (sort === 'company' || sort === 'upcoming' ? 'asc' : 'desc');
  if (order !== 'asc' && order !== 'desc') issues.push({ field: 'order', message: 'Must be asc or desc' });
  const int = (name: string, fallback: number, max: number) => {
    const v = text(name);
    if (v === null) return fallback;
    if (!/^\d{1,6}$/.test(v) || Number(v) < 1 || Number(v) > max) {
      issues.push({ field: name, message: `Must be a whole number from 1 to ${max}` });
      return fallback;
    }
    return Number(v);
  };
  const page = int('page', 1, 100_000);
  const limit = int('limit', DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
  if (issues.length) return { issues };
  return {
    query: {
      statuses: statuses as applications.ListQuery['statuses'],
      company,
      title,
      appliedFrom,
      appliedTo,
      sort,
      order: order as 'asc' | 'desc',
      page,
      limit,
      asOf: asOfDate(q.today) ?? new Date().toISOString().slice(0, 10),
    },
  };
};

const withDefaults = (data: Partial<ApplicationFields>): ApplicationFields => {
  const out = {} as Record<string, unknown>;
  for (const key of Object.keys(fieldSchemas)) out[key] = (data as Record<string, unknown>)[key] ?? null;
  return { ...(out as unknown as ApplicationFields), jobTitle: data.jobTitle!, companyName: data.companyName!, status: data.status ?? 'wishlist' };
};

// POST /api/applications
export const createApplication = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) return unauthorized(res);
    const body = createSchema.safeParse(req.body ?? {});
    if (!body.success) return validationError(res, fromZod(body.error));
    const result = await applications.createApplication(userId, withDefaults(body.data as Partial<ApplicationFields>));
    if (result === 'not_found') return notFound(res);
    if ('invalidLink' in result) return linkError(res, result.invalidLink);
    const application = await applications.getApplication(result.id, userId, asOfDate(req.query.today));
    res.status(201).json({ success: true, message: 'Application saved successfully', data: { application } });
  } catch (error) {
    serverError(res, 'Failed to save the application');
  }
};

// GET /api/applications
export const listApplications = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) return unauthorized(res);
    const parsed = parseListQuery(req.query as Record<string, unknown>);
    if ('issues' in parsed) return validationError(res, parsed.issues);
    const data = await applications.listApplications(userId, parsed.query);
    res.json({ success: true, message: 'Applications retrieved successfully', data });
  } catch (error) {
    serverError(res, 'Failed to retrieve applications');
  }
};

// GET /api/applications/metrics
export const getMetrics = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) return unauthorized(res);
    const metrics = await applications.getMetrics(userId, asOfDate(req.query.today));
    res.json({
      success: true,
      message: 'Application metrics retrieved successfully',
      data: {
        metrics,
        definitions: {
          total: 'All applications you track, in any status.',
          submitted: 'Applications with status Applied, Assessment, Interview, Offer or Rejected, plus withdrawn ones that have an application date.',
          upcomingInterviews: 'Applications with an interview date and time still ahead.',
          offers: 'Applications whose current status is Offer.',
          rejections: 'Applications whose current status is Rejected.',
          followUpsDue: 'Open applications (not Offer, Rejected or Withdrawn) whose follow-up date is today or earlier.',
        },
      },
    });
  } catch (error) {
    serverError(res, 'Failed to retrieve application metrics');
  }
};

// GET /api/applications/:id (with its history)
export const getApplication = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) return unauthorized(res);
    if (!isUuid(req.params.id)) return invalidId(res);
    const application = await applications.getApplication(req.params.id, userId, asOfDate(req.query.today));
    if (!application) return notFound(res);
    const history = await applications.getHistory(req.params.id, userId);
    res.json({ success: true, message: 'Application retrieved successfully', data: { application, history } });
  } catch (error) {
    serverError(res, 'Failed to retrieve the application');
  }
};

// GET /api/applications/:id/history
export const getHistory = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) return unauthorized(res);
    if (!isUuid(req.params.id)) return invalidId(res);
    if (!(await applications.getApplication(req.params.id, userId))) return notFound(res);
    res.json({ success: true, message: 'Application history retrieved successfully', data: { history: await applications.getHistory(req.params.id, userId) } });
  } catch (error) {
    serverError(res, 'Failed to retrieve the application history');
  }
};

// PUT /api/applications/:id (any subset of fields; null clears an optional field)
export const updateApplication = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) return unauthorized(res);
    if (!isUuid(req.params.id)) return invalidId(res);
    const body = updateSchema.safeParse(req.body ?? {});
    if (!body.success) return validationError(res, fromZod(body.error));
    const result = await applications.updateApplication(userId, req.params.id, body.data as Partial<ApplicationFields>);
    if (result === 'not_found') return notFound(res);
    if ('invalidLink' in result) return linkError(res, result.invalidLink);
    const application = await applications.getApplication(req.params.id, userId, asOfDate(req.query.today));
    res.json({ success: true, message: 'Application updated successfully', data: { application } });
  } catch (error) {
    serverError(res, 'Failed to update the application');
  }
};

// DELETE /api/applications/:id (the application and its history)
export const deleteApplication = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) return unauthorized(res);
    if (!isUuid(req.params.id)) return invalidId(res);
    if (!(await applications.deleteApplication(req.params.id, userId))) return notFound(res);
    res.json({ success: true, message: 'Application deleted successfully', data: null });
  } catch (error) {
    serverError(res, 'Failed to delete the application');
  }
};

// GET /api/applications/insights?months=&today= (Step 14)
export const getInsights = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) return unauthorized(res);
    const raw = req.query.months;
    let months = insights.DEFAULT_MONTHS;
    if (raw !== undefined) {
      if (typeof raw !== 'string' || !/^\d{1,2}$/.test(raw) || Number(raw) < 1 || Number(raw) > insights.MAX_MONTHS) {
        return validationError(res, [{ field: 'months', message: `Must be a whole number from 1 to ${insights.MAX_MONTHS}` }]);
      }
      months = Number(raw);
    }
    const asOf = asOfDate(req.query.today) ?? new Date().toISOString().slice(0, 10);
    const data = await insights.getInsights(userId, { asOf, months });
    res.json({ success: true, message: 'Application insights retrieved successfully', data: { insights: data, definitions: insights.DEFINITIONS } });
  } catch (error) {
    serverError(res, 'Failed to retrieve application insights');
  }
};
