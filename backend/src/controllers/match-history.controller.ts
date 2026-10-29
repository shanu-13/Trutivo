import { Request, Response } from 'express';
import * as matchHistoryService from '../services/match-history.service';

export const DEFAULT_PAGE_SIZE = 10;
export const MAX_PAGE_SIZE = 50;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isValidMatchHistoryId = (value: unknown): value is string => typeof value === 'string' && UUID_RE.test(value);

type Pagination = { page: number; limit: number } | { error: string };

// page and limit must be whole numbers (page >= 1, 1 <= limit <= MAX_PAGE_SIZE); both are optional.
export const parsePagination = (query: Record<string, unknown>): Pagination => {
  const read = (value: unknown, fallback: number) => {
    if (value === undefined) return fallback;
    if (typeof value !== 'string' || !/^\d{1,6}$/.test(value)) return NaN;
    return Number(value);
  };
  const page = read(query.page, 1);
  const limit = read(query.limit, DEFAULT_PAGE_SIZE);
  if (!Number.isInteger(page) || page < 1) return { error: 'page must be a whole number of at least 1' };
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE_SIZE) {
    return { error: `limit must be a whole number from 1 to ${MAX_PAGE_SIZE}` };
  }
  return { page, limit };
};

const unauthorized = (res: Response) =>
  res.status(401).json({ success: false, message: 'Unauthorized', error: { code: 'UNAUTHORIZED', details: null } });

const notFound = (res: Response) =>
  res.status(404).json({
    success: false,
    message: 'Match history item not found',
    error: { code: 'MATCH_HISTORY_NOT_FOUND', details: null },
  });

const invalidId = (res: Response) =>
  res.status(400).json({
    success: false,
    message: 'Invalid match history id',
    error: { code: 'INVALID_MATCH_HISTORY_ID', details: null },
  });

const serverError = (res: Response, message: string) =>
  res.status(500).json({ success: false, message, error: { code: 'SERVER_ERROR', details: null } });

export const listMatchHistory = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) return unauthorized(res);

    const pagination = parsePagination(req.query as Record<string, unknown>);
    if ('error' in pagination) {
      return res.status(400).json({
        success: false,
        message: 'Invalid pagination',
        error: { code: 'VALIDATION_ERROR', details: [{ field: 'pagination', message: pagination.error }] },
      });
    }

    const { items, total } = await matchHistoryService.listMatchHistory(userId, pagination.page, pagination.limit);
    res.json({
      success: true,
      message: 'Match history retrieved successfully',
      data: {
        items,
        pagination: {
          page: pagination.page,
          limit: pagination.limit,
          total,
          totalPages: Math.ceil(total / pagination.limit),
        },
      },
    });
  } catch (error) {
    serverError(res, 'Failed to retrieve match history');
  }
};

export const getMatchHistory = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) return unauthorized(res);
    if (!isValidMatchHistoryId(req.params.id)) return invalidId(res);

    // The stored snapshot is returned as saved; matching is not run again.
    const item = await matchHistoryService.getMatchHistory(req.params.id, userId);
    if (!item) return notFound(res);

    res.json({ success: true, message: 'Match history item retrieved successfully', data: { matchHistory: item } });
  } catch (error) {
    serverError(res, 'Failed to retrieve match history item');
  }
};

export const deleteMatchHistory = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) return unauthorized(res);
    if (!isValidMatchHistoryId(req.params.id)) return invalidId(res);

    // Removes only the saved result; the resume and job description are untouched.
    const deleted = await matchHistoryService.deleteMatchHistory(req.params.id, userId);
    if (!deleted) return notFound(res);

    res.json({ success: true, message: 'Match history item deleted successfully', data: null });
  } catch (error) {
    serverError(res, 'Failed to delete match history item');
  }
};
