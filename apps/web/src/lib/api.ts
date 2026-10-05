import { currentLocale } from '../i18n';
import type {
  ActiveLabResponse,
  CreateLabResponse,
  HintResponse,
  MeResponse,
  MissionDetailResponse,
  MissionListResponse,
  MissionProgress,
  SubmitFlagResponse,
} from '@zero-root/types';

/**
 * The API client.
 *
 * Authentication is an HttpOnly cookie, so there is no token to store and nothing for this
 * file to manage: `credentials: 'include'` is the whole of it. That also means the client
 * genuinely cannot read or forge its own identity, which is the point.
 */

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    /** The parsed response body, so a caller can act on more than the message. */
    readonly body?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method,
    credentials: 'include',
    headers: {
      // Mission text is rendered server-side from content, so the API has to be told which
      // language the interface is showing or the two would disagree.
      'x-locale': currentLocale(),
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

  if (response.status === 204) return undefined as T;

  const text = await response.text();
  const payload: unknown = text === '' ? undefined : safeParse(text);

  if (!response.ok) {
    throw new ApiError(
      response.status,
      messageFrom(payload) ?? `Request failed (${response.status}).`,
      payload,
    );
  }
  return payload as T;
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** Nest returns `message` as a string or, for validation errors, an array of them. */
export function messageFrom(payload: unknown): string | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const message = (payload as { message?: unknown }).message;
  if (typeof message === 'string') return message;
  if (Array.isArray(message) && message.length > 0) return message.map(String).join(' ');
  return null;
}

export const api = {
  register: (email: string, username: string, password: string) =>
    request<{ id: string }>('POST', '/api/auth/register', { email, username, password }),

  login: (email: string, password: string) =>
    request<{ id: string }>('POST', '/api/auth/login', { email, password }),

  logout: () => request<void>('POST', '/api/auth/logout'),

  me: () => request<MeResponse>('GET', '/api/me'),

  missions: () => request<MissionListResponse>('GET', '/api/missions'),

  mission: (id: string) => request<MissionDetailResponse>('GET', `/api/missions/${id}`),

  startMission: (id: string) =>
    request<{ progress: MissionProgress }>('POST', `/api/missions/${id}/start`),

  hint: (id: string) => request<HintResponse>('POST', `/api/missions/${id}/hint`),

  submitFlag: (id: string, value: string) =>
    request<SubmitFlagResponse>('POST', `/api/missions/${id}/flag`, { value }),

  createLab: (missionId: string) => request<CreateLabResponse>('POST', '/api/labs', { missionId }),

  activeLab: async (): Promise<CreateLabResponse | null> =>
    (await request<ActiveLabResponse>('GET', '/api/labs/active')).lab ?? null,

  destroyLab: (sessionId: string) => request<void>('DELETE', `/api/labs/${sessionId}`),
};
