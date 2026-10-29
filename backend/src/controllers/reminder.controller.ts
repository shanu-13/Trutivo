import { Request, Response } from 'express';
import { z } from 'zod';
import * as reminders from '../services/reminder.service';
import { INTERVIEW_LEADS, REMINDER_TYPES, TITLE_MAX, VIEWS, type ReminderInput } from '../services/reminder.service';
import { isLocalDateTime, isValidTimeZone } from '../utils/time-zone';
import { asOfDate, fromZod, line, notes, required, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from './job-application.controller';
import { isValidResumeId as isUuid } from './resume-version.controller';

// Reminders (Step 14): in-app only. No e-mail, push or background job is involved.

export const NOTES_MAX = 2000;

const unauthorized = (res: Response) =>
  res.status(401).json({ success: false, message: 'Unauthorized', error: { code: 'UNAUTHORIZED', details: null } });
const notFound = (res: Response) =>
  res.status(404).json({ success: false, message: 'Reminder not found', error: { code: 'NOT_FOUND', details: null } });
const invalidId = (res: Response) =>
  res.status(400).json({ success: false, message: 'Invalid reminder id', error: { code: 'INVALID_ID', details: null } });
const serverError = (res: Response, message: string) =>
  res.status(500).json({ success: false, message, error: { code: 'SERVER_ERROR', details: null } });
const validationError = (res: Response, issues: { field: string; message: string }[]) =>
  res.status(400).json({ success: false, message: 'Please correct the highlighted fields', error: { code: 'VALIDATION_ERROR', details: issues } });
const applicationNotFound = (res: Response) =>
  res.status(404).json({
    success: false,
    message: 'Application not found',
    error: { code: 'LINKED_RESOURCE_NOT_FOUND', details: [{ field: 'applicationId', message: 'Application not found' }] },
  });

// "YYYY-MM-DDTHH:mm", as entered in the chosen time zone.
const dueLocal = z
  .string()
  .refine((s) => isLocalDateTime(s), 'Must be a valid date and time (YYYY-MM-DDTHH:mm)')
  .refine((s) => s >= '2000-01-01' && s <= '2100-12-31T23:59', 'Must be a realistic date');
const timeZone = z.string().refine((s) => isValidTimeZone(s), 'Must be a valid time zone (for example Europe/London)');
const id = z.string().refine(isUuid, 'Must be a valid id');

const fields = {
  type: z.enum(REMINDER_TYPES),
  title: required(TITLE_MAX, 'Title'),
  notes: notes(NOTES_MAX).nullable().optional(),
  dueLocal,
  timeZone,
  applicationId: id.nullable().optional(),
};
export const createSchema = z.object({ ...fields, type: fields.type.default('custom') }).strict();
export const updateSchema = z
  .object({ type: fields.type.optional(), title: fields.title.optional(), notes: fields.notes, dueLocal: dueLocal.optional(), timeZone: timeZone.optional(), applicationId: fields.applicationId })
  .strict()
  .refine((v) => Object.values(v).some((x) => x !== undefined), 'Nothing to update');

export const acceptSchema = z
  .object({
    applicationId: id,
    kind: z.enum(['interview', 'follow_up']),
    timeZone,
    leadMinutes: z
      .number()
      .int()
      .refine((n) => (INTERVIEW_LEADS as readonly number[]).includes(n), `Must be one of: ${INTERVIEW_LEADS.join(', ')}`)
      .default(1440),
    time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Must be a time (HH:mm)').default('09:00'),
  })
  .strict();

const writeError = (res: Response, result: 'not_found' | 'application_not_found' | 'nonexistent_time' | 'in_past') => {
  if (result === 'not_found') return notFound(res);
  if (result === 'application_not_found') return applicationNotFound(res);
  if (result === 'in_past') return validationError(res, [{ field: 'dueLocal', message: 'Must not be in the past' }]);
  return validationError(res, [{ field: 'dueLocal', message: 'This time does not exist in the chosen time zone (the clocks skip it for daylight saving). Choose another time.' }]);
};

const now = () => Date.now();

// POST /api/reminders
export const createReminder = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) return unauthorized(res);
    const body = createSchema.safeParse(req.body ?? {});
    if (!body.success) return validationError(res, fromZod(body.error));
    const input: ReminderInput = { ...body.data, notes: body.data.notes ?? null, applicationId: body.data.applicationId ?? null };
    const result = await reminders.createReminder(userId, input);
    if (typeof result === 'string') return writeError(res, result);
    const reminder = await reminders.getReminder(userId, result.id, now());
    res.status(201).json({ success: true, message: 'Reminder saved successfully', data: { reminder } });
  } catch (error) {
    serverError(res, 'Failed to save the reminder');
  }
};

type ParsedList = { query: reminders.ListQuery } | { issues: { field: string; message: string }[] };

// ?view=upcoming|overdue|pending|completed|dismissed|all&from=&to=&applicationId=&type=&page=&limit=
// from/to are ISO date-times with a time zone (the client sends the start and end of the local days).
export const parseListQuery = (q: Record<string, unknown>): ParsedList => {
  const issues: { field: string; message: string }[] = [];
  const text = (name: string) => {
    const v = q[name];
    if (v === undefined || v === '') return null;
    if (typeof v !== 'string' || v.length > 100) {
      issues.push({ field: name, message: 'Must be text of at most 100 characters' });
      return null;
    }
    return v.trim() || null;
  };
  const view = (text('view') ?? 'upcoming') as reminders.View;
  if (!(VIEWS as readonly string[]).includes(view)) issues.push({ field: 'view', message: `Must be one of: ${VIEWS.join(', ')}` });
  const moment = (name: string) => {
    const v = text(name);
    if (v === null) return null;
    const parsed = z.string().datetime({ offset: true }).safeParse(v);
    const iso = parsed.success ? new Date(v).toISOString() : null;
    if (!iso || iso < '2000-01-01' || iso > '2101') {
      issues.push({ field: name, message: 'Must be a date and time with a time zone' });
      return null;
    }
    return iso;
  };
  const from = moment('from');
  const to = moment('to');
  if (from && to && from > to) issues.push({ field: 'to', message: 'Must be on or after the start' });
  const applicationId = text('applicationId');
  if (applicationId && !isUuid(applicationId)) issues.push({ field: 'applicationId', message: 'Must be a valid id' });
  const type = text('type');
  if (type && !(REMINDER_TYPES as readonly string[]).includes(type)) issues.push({ field: 'type', message: `Must be one of: ${REMINDER_TYPES.join(', ')}` });
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
  return { query: { view, from, to, applicationId, type: type as reminders.ReminderType | null, page, limit } };
};

// GET /api/reminders
export const listReminders = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) return unauthorized(res);
    const parsed = parseListQuery(req.query as Record<string, unknown>);
    if ('issues' in parsed) return validationError(res, parsed.issues);
    const data = await reminders.listReminders(userId, parsed.query, now());
    res.json({ success: true, message: 'Reminders retrieved successfully', data });
  } catch (error) {
    serverError(res, 'Failed to retrieve reminders');
  }
};

// GET /api/reminders/summary: counts plus the first overdue and upcoming reminders (read-only).
export const getSummary = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) return unauthorized(res);
    const summary = await reminders.getSummary(userId, now());
    res.json({ success: true, message: 'Reminder summary retrieved successfully', data: { ...summary, upcomingWindowDays: reminders.UPCOMING_WINDOW_DAYS } });
  } catch (error) {
    serverError(res, 'Failed to retrieve the reminder summary');
  }
};

// GET /api/reminders/suggestions?applicationId=&today=
export const getSuggestions = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) return unauthorized(res);
    const applicationId = req.query.applicationId;
    if (applicationId !== undefined && !isUuid(applicationId)) return validationError(res, [{ field: 'applicationId', message: 'Must be a valid id' }]);
    const asOf = asOfDate(req.query.today) ?? new Date().toISOString().slice(0, 10);
    const suggestions = await reminders.getSuggestions(userId, asOf, (applicationId as string | undefined) ?? null, now());
    res.json({ success: true, message: 'Reminder suggestions retrieved successfully', data: { suggestions, interviewLeadMinutes: INTERVIEW_LEADS } });
  } catch (error) {
    serverError(res, 'Failed to retrieve reminder suggestions');
  }
};

// POST /api/reminders/suggestions/accept: saves one suggestion the user confirmed; repeating it returns the same reminder.
export const acceptSuggestion = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) return unauthorized(res);
    const body = acceptSchema.safeParse(req.body ?? {});
    if (!body.success) return validationError(res, fromZod(body.error));
    const asOf = asOfDate(req.query.today) ?? new Date().toISOString().slice(0, 10);
    const result = await reminders.acceptSuggestion(userId, { ...body.data, asOf }, now());
    if (result === 'application_not_found') return applicationNotFound(res);
    if (result === 'no_date' || result === 'application_closed') {
      return res.status(409).json({
        success: false,
        message:
          result === 'no_date'
            ? 'This application no longer has that date, or it has passed. Refresh to see current suggestions.'
            : 'This application is closed (offer, rejected or withdrawn), so no reminder is suggested.',
        error: { code: 'SUGGESTION_UNAVAILABLE', details: null },
      });
    }
    if (result === 'in_past') return validationError(res, [{ field: 'leadMinutes', message: 'That reminder time has already passed. Choose a shorter lead time.' }]);
    if (result === 'nonexistent_time') return validationError(res, [{ field: 'time', message: 'This time does not exist on that day in the chosen time zone (daylight saving). Choose another time.' }]);
    const reminder = await reminders.getReminder(userId, result.id, now());
    res.status(result.created ? 201 : 200).json({
      success: true,
      message: result.created ? 'Reminder saved successfully' : 'A reminder for this date already exists',
      data: { reminder, created: result.created },
    });
  } catch (error) {
    serverError(res, 'Failed to save the reminder');
  }
};

// GET /api/reminders/:id
export const getReminder = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) return unauthorized(res);
    if (!isUuid(req.params.id)) return invalidId(res);
    const reminder = await reminders.getReminder(userId, req.params.id, now());
    if (!reminder) return notFound(res);
    res.json({ success: true, message: 'Reminder retrieved successfully', data: { reminder } });
  } catch (error) {
    serverError(res, 'Failed to retrieve the reminder');
  }
};

// PUT /api/reminders/:id (any subset of fields; null clears notes or the application link)
export const updateReminder = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) return unauthorized(res);
    if (!isUuid(req.params.id)) return invalidId(res);
    const body = updateSchema.safeParse(req.body ?? {});
    if (!body.success) return validationError(res, fromZod(body.error));
    const result = await reminders.updateReminder(userId, req.params.id, body.data as Partial<ReminderInput>, now());
    if (typeof result === 'string') return writeError(res, result);
    const reminder = await reminders.getReminder(userId, req.params.id, now());
    res.json({ success: true, message: 'Reminder updated successfully', data: { reminder } });
  } catch (error) {
    serverError(res, 'Failed to update the reminder');
  }
};

// POST /api/reminders/:id/complete | /dismiss | /reopen
export const setStatus = (status: reminders.ReminderStatus, message: string) => async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) return unauthorized(res);
    if (!isUuid(req.params.id)) return invalidId(res);
    if ((await reminders.setStatus(userId, req.params.id, status)) === 'not_found') return notFound(res);
    const reminder = await reminders.getReminder(userId, req.params.id, now());
    res.json({ success: true, message, data: { reminder } });
  } catch (error) {
    serverError(res, 'Failed to update the reminder');
  }
};

// DELETE /api/reminders/:id
export const deleteReminder = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) return unauthorized(res);
    if (!isUuid(req.params.id)) return invalidId(res);
    if (!(await reminders.deleteReminder(userId, req.params.id))) return notFound(res);
    res.json({ success: true, message: 'Reminder deleted successfully', data: null });
  } catch (error) {
    serverError(res, 'Failed to delete the reminder');
  }
};
