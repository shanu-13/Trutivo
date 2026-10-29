// Inlined at build time. Production builds refuse to start without it (see next.config.ts),
// so the localhost fallback only ever applies to local development.
export const API_URL = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000/api').replace(/\/+$/, '');

// An error response from the backend. `message` is safe to show to the user;
// `code` and `details` (e.g. per-field validation messages) come from the
// standard error envelope when the server provided them.
export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string | null = null,
    public readonly details: unknown = null
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

const readJson = async (res: Response) => {
  try {
    return await res.json();
  } catch {
    return null;
  }
};

// Turns an error response into an ApiError (shared by JSON and file requests).
const throwForStatus = async (res: Response) => {
  if (res.status === 401) {
    // A missing or invalid session gets the session message; other 401s (wrong
    // login details) keep the server's own message.
    const data = await readJson(res);
    const code = data?.error?.code ?? null;
    if (code === 'MISSING_TOKEN' || code === 'INVALID_TOKEN' || !data?.message || data.message === 'Unauthorized') {
      throw new ApiError('Your session has expired. Please log in again.', 401, 'UNAUTHORIZED');
    }
    throw new ApiError(data.message, 401, code);
  }
  if (res.status >= 500) {
    // The message stays generic; the code and details (e.g. whether a draft was kept) are passed on.
    const data = await readJson(res);
    throw new ApiError('Something went wrong. Please try again.', res.status, data?.error?.code ?? null, data?.error?.details ?? null);
  }
  if (res.ok) return;
  const data = await readJson(res);
  if (res.status === 413) {
    throw new ApiError(data?.message || 'File size is too large.', 413, data?.error?.code ?? null);
  }
  if (res.status === 404) {
    throw new ApiError(data?.message || 'Not found.', 404, data?.error?.code ?? null);
  }
  throw new ApiError(data?.message || 'An error occurred', res.status, data?.error?.code ?? null, data?.error?.details ?? null);
};

const request = async <T>(endpoint: string, options: RequestInit, read: (res: Response) => Promise<T>) => {
  try {
    const res = await fetch(`${API_URL}${endpoint}`, {
      ...options,
      credentials: 'include'
    });
    await throwForStatus(res);
    return await read(res);
  } catch (error: unknown) {
    if (error instanceof TypeError || (error instanceof Error && error.message === 'Failed to fetch')) {
      throw new Error('Unable to connect to the server.\nPlease check your connection and try again.');
    }
    throw error;
  }
};

export const apiClient = async (endpoint: string, options: RequestInit = {}) => request(endpoint, options, readJson);

// The filename from `Content-Disposition: attachment; filename="..."`, if present.
const attachmentFilename = (res: Response) => res.headers.get('Content-Disposition')?.match(/filename="([^"]+)"/)?.[1] ?? null;

// For endpoints that return a file: the body as a Blob (never parsed as text).
export const apiDownload = async (endpoint: string, options: RequestInit = {}) =>
  request(endpoint, options, async (res) => ({ blob: await res.blob(), filename: attachmentFilename(res) }));
