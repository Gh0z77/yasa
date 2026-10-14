// Typed client for every endpoint in SPEC §6 (+ §15). All calls are same-origin with the session cookie.
import type {
  ApiKeyInfo,
  ApiKeysResponse,
  ApiKeyTestResponse,
  AuthResponse,
  BuildSummary,
  ChangePasswordRequest,
  ChatEvent,
  ChatRequest,
  CommunityProject,
  CommunitySort,
  CreateProjectRequest,
  CreateProjectResponse,
  CreateVersionRequest,
  DeleteAccountRequest,
  HealthResponse,
  KeyProvider,
  LoginRequest,
  MeResponse,
  MessagesResponse,
  ModelsResponse,
  OkResponse,
  PreviewUrlResponse,
  Project,
  ProjectDetailResponse,
  ProjectFile,
  ProjectSort,
  ProjectSummary,
  PublishRequest,
  PublishResponse,
  RenameFileRequest,
  SaveFileRequest,
  SetApiKeyRequest,
  SignupRequest,
  SlugAvailabilityResponse,
  StopResponse,
  UpdateMeRequest,
  UpdateProjectRequest,
  UploadResponse,
  UsageSummary,
  VersionDetail,
  VersionFileDiff,
  VersionSummary,
  GithubConnectionResponse,
  GithubProjectResponse,
  GithubPushRequest,
  GithubPushResult,
  DomainsResponse,
  MembersResponse,
  ProjectDomain,
  ProjectMember,
  ProjectMemberRole,
  SupabaseAccount,
  SupabaseAccountProject,
  SupabaseConnectStart,
  SupabaseApplyResponse,
  SupabaseConnectRequest,
  SupabaseOverview,
  SupabaseStatus,
} from '@shared/types';
import { ApiError, isAbortError } from './api-error';
import { authHeaders } from './auth';
import { queryClient } from './query-client';
import { streamSSE, type SSEMessage } from './sse';

export { ApiError, isAbortError, isApiError, type ClientErrorCode } from './api-error';

const BASE = '/api';

type QueryValue = string | number | boolean | null | undefined;

export interface RequestOptions {
  signal?: AbortSignal;
}

interface InternalOptions extends RequestOptions {
  query?: Record<string, QueryValue>;
  /** JSON body (serialized) … */
  json?: unknown;
  /** … or a raw body (FormData for multipart; the browser sets the boundary header). */
  body?: BodyInit;
}

/** Builds `/api/...` with a query string; empty / null / undefined params are skipped. */
export function apiUrl(path: string, query?: Record<string, QueryValue>): string {
  let url = BASE + path;
  if (query) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null || value === '') continue;
      params.set(key, String(value));
    }
    const qs = params.toString();
    if (qs) url += `?${qs}`;
  }
  return url;
}

const seg = encodeURIComponent;

/** Paths where a 401 is an expected answer to bad credentials, not an expired session. */
const AUTH_PATHS = new Set(['/auth/login', '/auth/signup', '/auth/logout', '/auth/me']);

function handleUnauthorized(path: string): void {
  if (AUTH_PATHS.has(path)) return;
  // The session is gone: refresh `me` so ProtectedRoute & headers react.
  void queryClient.invalidateQueries({ queryKey: ['me'] });
}

async function send(method: string, path: string, opts: InternalOptions = {}): Promise<Response> {
  const headers: Record<string, string> = { Accept: 'application/json', ...(await authHeaders()) };
  let body: BodyInit | undefined = opts.body;
  if (opts.json !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(opts.json);
  }
  let res: Response;
  try {
    res = await fetch(apiUrl(path, opts.query), {
      method,
      headers,
      body,
      credentials: 'same-origin',
      signal: opts.signal,
    });
  } catch (err) {
    if (isAbortError(err)) throw err;
    throw ApiError.network(err);
  }
  if (!res.ok) {
    if (res.status === 401) handleUnauthorized(path);
    throw await ApiError.fromResponse(res);
  }
  return res;
}

async function request<T>(method: string, path: string, opts: InternalOptions = {}): Promise<T> {
  const res = await send(method, path, opts);
  if (res.status === 204) return undefined as T;
  try {
    return (await res.json()) as T;
  } catch {
    throw new ApiError(res.status, 'internal', 'The server returned an invalid response.');
  }
}

const get = <T>(path: string, query?: Record<string, QueryValue>, o?: RequestOptions) =>
  request<T>('GET', path, { query, signal: o?.signal });
const post = <T>(path: string, json?: unknown, o?: RequestOptions) =>
  request<T>('POST', path, { json: json ?? {}, signal: o?.signal });
const put = <T>(path: string, json: unknown, o?: RequestOptions) => request<T>('PUT', path, { json, signal: o?.signal });
const patch = <T>(path: string, json: unknown, o?: RequestOptions) =>
  request<T>('PATCH', path, { json, signal: o?.signal });
const del = <T>(path: string, json?: unknown, o?: RequestOptions) =>
  request<T>('DELETE', path, { json, signal: o?.signal });

// ---------------------------------------------------------------------------
// Chat streaming
// ---------------------------------------------------------------------------
export type ChatEventHandler = (event: ChatEvent) => void;

function chatDispatcher(onEvent: ChatEventHandler): (message: SSEMessage) => void {
  return (message) => {
    let event: ChatEvent;
    try {
      event = JSON.parse(message.data) as ChatEvent;
    } catch {
      return; // malformed frame: skip rather than break the stream
    }
    if (event && typeof event === 'object' && typeof event.type === 'string') onEvent(event);
  };
}

async function openChatStream(
  path: string,
  init: RequestInit,
  onEvent: ChatEventHandler,
  signal?: AbortSignal,
): Promise<Response> {
  let res: Response;
  try {
    res = await streamSSE(BASE + path, init, chatDispatcher(onEvent), signal);
  } catch (err) {
    if (isAbortError(err) || signal?.aborted) throw err;
    throw ApiError.network(err);
  }
  if (!res.ok) {
    if (res.status === 401) handleUnauthorized(path);
    throw await ApiError.fromResponse(res);
  }
  return res;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------
export interface ProjectListParams {
  q?: string;
  sort?: ProjectSort;
}

export interface CommunityListParams {
  q?: string;
  sort?: CommunitySort;
  offset?: number;
}

export const api = {
  health: (o?: RequestOptions) => get<HealthResponse>('/health', undefined, o),

  auth: {
    signup: (body: SignupRequest) => post<AuthResponse>('/auth/signup', body),
    login: (body: LoginRequest) => post<AuthResponse>('/auth/login', body),
    logout: () => post<OkResponse>('/auth/logout'),
    /** Never 401: `{ user: null }` for guests. */
    me: (o?: RequestOptions) => get<MeResponse>('/auth/me', undefined, o),
  },

  /** People a project is shared with. */
  members: {
    list: (projectId: string, o?: RequestOptions) => get<MembersResponse>(`/projects/${seg(projectId)}/members`, undefined, o),
    set: (projectId: string, body: { email: string; role: ProjectMemberRole }) => post<{ member: ProjectMember }>(`/projects/${seg(projectId)}/members`, body),
    remove: (projectId: string, email: string) => post<OkResponse>(`/projects/${seg(projectId)}/members/remove`, { email }),
  },

  /** Supabase backend of a project. */
  supabase: {
    status: (projectId: string, o?: RequestOptions) => get<SupabaseStatus>(`/projects/${seg(projectId)}/supabase`, undefined, o),
    overview: (projectId: string, o?: RequestOptions) => get<SupabaseOverview>(`/projects/${seg(projectId)}/supabase/overview`, undefined, o),
    connect: (projectId: string, body: SupabaseConnectRequest) => put<SupabaseStatus>(`/projects/${seg(projectId)}/supabase`, body),
    disconnect: (projectId: string) => del<SupabaseStatus>(`/projects/${seg(projectId)}/supabase`, {}),
    apply: (projectId: string) => post<SupabaseApplyResponse>(`/projects/${seg(projectId)}/supabase/migrations/apply`),
    mark: (projectId: string, path: string) => post<SupabaseStatus>(`/projects/${seg(projectId)}/supabase/migrations/mark`, { path }),
    /** One of the user's own Supabase projects (from the connected account). */
    link: (projectId: string, ref: string) => post<SupabaseStatus>(`/projects/${seg(projectId)}/supabase/link`, { ref }),
    create: (projectId: string, body: { organizationId?: string; region?: string } = {}) => post<SupabaseAccountProject>(`/projects/${seg(projectId)}/supabase/create`, body),
  },

  /** The user's own Supabase account. */
  supabaseAccount: {
    get: (o?: RequestOptions) => get<SupabaseAccount>('/me/supabase', undefined, o),
    /** Where to send the browser to approve Yasa on Supabase; it comes back to `returnTo`. */
    startConnect: (returnTo: string) => post<SupabaseConnectStart>('/me/supabase/connect', { returnTo }),
    disconnect: () => del<SupabaseAccount>('/me/supabase', {}),
  },

  /** Custom domains of a published project. */
  domains: {
    list: (projectId: string, o?: RequestOptions) => get<DomainsResponse>(`/projects/${seg(projectId)}/domains`, undefined, o),
    add: (projectId: string, domain: string) => post<{ domain: ProjectDomain }>(`/projects/${seg(projectId)}/domains`, { domain }),
    verify: (projectId: string, domain: string) => post<{ domain: ProjectDomain }>(`/projects/${seg(projectId)}/domains/verify`, { domain }),
    remove: (projectId: string, domain: string) => post<OkResponse>(`/projects/${seg(projectId)}/domains/remove`, { domain }),
  },

  /** GitHub sync: the user's connection and a project's repository. */
  github: {
    status: (o?: RequestOptions) => get<GithubConnectionResponse>('/me/github', undefined, o),
    connect: (token: string) => put<GithubConnectionResponse>('/me/github', { token }),
    disconnect: () => del<OkResponse>('/me/github', {}),
    project: (projectId: string, o?: RequestOptions) => get<GithubProjectResponse>(`/projects/${seg(projectId)}/github`, undefined, o),
    push: (projectId: string, body: GithubPushRequest) => post<GithubPushResult>(`/projects/${seg(projectId)}/github/push`, body),
    unlink: (projectId: string) => del<OkResponse>(`/projects/${seg(projectId)}/github`, {}),
  },

  me: {
    update: (body: UpdateMeRequest) => patch<AuthResponse>('/me', body),
    changePassword: (body: ChangePasswordRequest) => post<OkResponse>('/me/password', body),
    deleteAccount: (body: DeleteAccountRequest) => del<OkResponse>('/me', body),
    usage: (o?: RequestOptions) => get<UsageSummary>('/me/usage', undefined, o),
    apiKeys: {
      list: (o?: RequestOptions) => get<ApiKeysResponse>('/me/api-keys', undefined, o),
      set: (provider: KeyProvider, body: SetApiKeyRequest) =>
        put<{ key: ApiKeyInfo }>(`/me/api-keys/${seg(provider)}`, body),
      remove: (provider: KeyProvider) => del<OkResponse>(`/me/api-keys/${seg(provider)}`),
      test: (provider: KeyProvider) => post<ApiKeyTestResponse>(`/me/api-keys/${seg(provider)}/test`),
    },
  },

  models: {
    list: (o?: RequestOptions) => get<ModelsResponse>('/models', undefined, o),
  },

  projects: {
    list: (params: ProjectListParams = {}, o?: RequestOptions) =>
      get<{ projects: ProjectSummary[]; shared: ProjectSummary[] }>('/projects', { q: params.q, sort: params.sort }, o),
    /** With `prompt` the server also starts the first generation job (SPEC §15.1). */
    create: (body: CreateProjectRequest = {}) => post<CreateProjectResponse>('/projects', body),
    get: (id: string, o?: RequestOptions) => get<ProjectDetailResponse>(`/projects/${seg(id)}`, undefined, o),
    update: (id: string, body: UpdateProjectRequest) => patch<{ project: Project }>(`/projects/${seg(id)}`, body),
    remove: (id: string) => del<OkResponse>(`/projects/${seg(id)}`),
    duplicate: (id: string) => post<{ project: Project }>(`/projects/${seg(id)}/duplicate`),
    remix: (id: string) => post<{ project: Project }>(`/projects/${seg(id)}/remix`),
    /** URL of the ZIP download (use as `<a href download>` or `window.location.assign`). */
    downloadUrl: (id: string, versionId?: string | null) => apiUrl(`/projects/${seg(id)}/download`, { versionId }),
  },

  files: {
    list: (projectId: string, o?: RequestOptions) =>
      get<{ files: ProjectFile[] }>(`/projects/${seg(projectId)}/files`, undefined, o),
    save: (projectId: string, body: SaveFileRequest, o?: RequestOptions) =>
      put<{ file: ProjectFile }>(`/projects/${seg(projectId)}/files`, body, o),
    remove: (projectId: string, path: string) => post<OkResponse>(`/projects/${seg(projectId)}/files/delete`, { path }),
    rename: (projectId: string, body: RenameFileRequest) =>
      post<{ file: ProjectFile }>(`/projects/${seg(projectId)}/files/rename`, body),
  },

  versions: {
    list: (projectId: string, o?: RequestOptions) =>
      get<{ versions: VersionSummary[] }>(`/projects/${seg(projectId)}/versions`, undefined, o),
    /** 409 `conflict` when there are no uncommitted changes. */
    create: (projectId: string, body: CreateVersionRequest = {}) =>
      post<{ version: VersionSummary }>(`/projects/${seg(projectId)}/versions`, body),
    get: (projectId: string, versionId: string, o?: RequestOptions) =>
      get<{ version: VersionDetail }>(`/projects/${seg(projectId)}/versions/${seg(versionId)}`, undefined, o),
    diff: (projectId: string, versionId: string, o?: RequestOptions) =>
      get<{ diff: VersionFileDiff[] }>(`/projects/${seg(projectId)}/versions/${seg(versionId)}/diff`, undefined, o),
    /** 409 `conflict` while a generation is running. */
    restore: (projectId: string, versionId: string) =>
      post<{ version: VersionSummary; files: ProjectFile[] }>(
        `/projects/${seg(projectId)}/versions/${seg(versionId)}/restore`,
      ),
  },

  messages: {
    list: (projectId: string, o?: RequestOptions) =>
      get<MessagesResponse>(`/projects/${seg(projectId)}/messages`, undefined, o),
    /** Clears the chat; 409 while generating. */
    clear: (projectId: string) => del<OkResponse>(`/projects/${seg(projectId)}/messages`),
  },

  chat: {
    /**
     * POST /chat (owner only) — starts a generation and streams its `ChatEvent`s. Resolves when the stream ends.
     * The stream always ends with `done { message }`; when the turn failed an `error { error: { code, message } }`
     * event arrives right BEFORE that `done` (the final message then has status `error` + an `error` part).
     * Only exception: `error` with code `interrupted` can be the last event if the job vanished.
     * Rejects with `ApiError` for HTTP failures before the stream starts (409 conflict = a job is already running,
     * 429 limit_reached / rate_limited, 503 no_provider — see `err.chatCode`) or with the `AbortError` when `signal`
     * is aborted. Aborting only detaches this client; the job keeps running — use `chat.stop` to stop it.
     */
    stream: async (projectId: string, body: ChatRequest, onEvent: ChatEventHandler, signal?: AbortSignal): Promise<void> => {
      await openChatStream(
        `/projects/${seg(projectId)}/chat`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
        onEvent,
        signal,
      );
    },
    /**
     * GET /chat/active (owner only — do not call it in read-only mode) — attaches to a running job: the first
     * event is `snapshot { userMessage, assistantMessage }` (parts accumulated so far), then live events exactly
     * like `stream`. Resolves `false` immediately when no job is running (204), otherwise `true` once the stream
     * has ended.
     */
    attach: async (projectId: string, onEvent: ChatEventHandler, signal?: AbortSignal): Promise<boolean> => {
      const res = await openChatStream(`/projects/${seg(projectId)}/chat/active`, { method: 'GET' }, onEvent, signal);
      return res.status !== 204;
    },
    stop: (projectId: string) => post<StopResponse>(`/projects/${seg(projectId)}/chat/stop`),
  },

  uploads: {
    /** Multipart upload of one image (png / jpeg / webp / gif, ≤ 5 MB). */
    create: (file: File | Blob, opts: { projectId?: string | null; name?: string; signal?: AbortSignal } = {}) => {
      const form = new FormData();
      const name = opts.name ?? (file instanceof File ? file.name : 'image');
      form.append('file', file, name);
      if (opts.projectId) form.append('projectId', opts.projectId);
      return request<UploadResponse>('POST', '/uploads', { body: form, signal: opts.signal });
    },
    /** URL of the binary (usable as `<img src>`). */
    url: (id: string) => apiUrl(`/uploads/${seg(id)}`),
  },

  preview: {
    /** Bundles the current working tree (cached by content hash). */
    build: (projectId: string, o?: RequestOptions) =>
      get<BuildSummary>(`/projects/${seg(projectId)}/build`, undefined, o),
    /** Rotates the draft preview token and returns the new URL. */
    rotateToken: (projectId: string) => post<PreviewUrlResponse>(`/projects/${seg(projectId)}/preview-token`),
  },

  publish: {
    /** 400 `bad_request` with `details.errors: BuildErrorInfo[]` when the build fails; 409 when the slug is taken. */
    publish: (projectId: string, body: PublishRequest) =>
      post<PublishResponse>(`/projects/${seg(projectId)}/publish`, body),
    unpublish: (projectId: string) => del<{ project: Project }>(`/projects/${seg(projectId)}/publish`),
    slugAvailable: (slug: string, projectId?: string | null, o?: RequestOptions) =>
      get<SlugAvailabilityResponse>('/slug-available', { slug, projectId }, o),
  },

  community: {
    list: (params: CommunityListParams = {}, o?: RequestOptions) =>
      get<{ projects: CommunityProject[] }>(
        '/community',
        { q: params.q, sort: params.sort, offset: params.offset || undefined },
        o,
      ),
  },
} as const;

export type Api = typeof api;
