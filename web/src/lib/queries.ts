// React Query keys + hooks for the whole app (SPEC §11.4).
//
// Conventions
//  - Query hooks return the raw `useQuery` result; `data` is already unwrapped (e.g. `useProjects().data` is
//    `ProjectSummary[]`, `useMe().data` is `User | null`).
//  - Mutations on "a project picked from a list" take the id in the variables (`{ id, ... }`);
//    mutations scoped to the open workspace take `projectId` as the hook argument.
//  - Mutations keep the caches consistent themselves; callers only add UI side effects (toasts, navigation).
import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';
import { LIMITS } from '@shared/constants';
import { clerkEnabled, signOutOfClerk } from './auth';
import type {
  ApiKeyInfo,
  ApiKeyTestResponse,
  AuthResponse,
  BuildSummary,
  ChangePasswordRequest,
  ChatMessage,
  CommunityProject,
  CreateProjectRequest,
  CreateProjectResponse,
  CreateVersionRequest,
  DeleteAccountRequest,
  KeyProvider,
  LoginRequest,
  MeResponse,
  ModelsResponse,
  OkResponse,
  PreviewUrlResponse,
  Project,
  ProjectDetailResponse,
  ProjectFile,
  ProjectSummary,
  PublishRequest,
  PublishResponse,
  RenameFileRequest,
  SaveFileRequest,
  SetApiKeyRequest,
  SignupRequest,
  UpdateMeRequest,
  UpdateProjectRequest,
  UsageSummary,
  User,
  VersionDetail,
  VersionFileDiff,
  VersionSummary,
} from '@shared/types';
import { api, type ApiError, type CommunityListParams, type ProjectListParams } from './api';

// ---------------------------------------------------------------------------
// Keys
// ---------------------------------------------------------------------------
export const qk = {
  me: ['me'] as const,
  models: ['models'] as const,
  usage: ['usage'] as const,
  apiKeys: ['api-keys'] as const,
  /** Prefix of every project list. */
  projectsAll: ['projects'] as const,
  projects: (params: ProjectListParams = {}) => ['projects', { q: params.q ?? '', sort: params.sort ?? 'updated' }] as const,
  project: (id: string) => ['project', id] as const,
  messages: (id: string) => ['messages', id] as const,
  versions: (id: string) => ['versions', id] as const,
  version: (id: string, versionId: string) => ['version', id, versionId] as const,
  versionDiff: (id: string, versionId: string) => ['version-diff', id, versionId] as const,
  build: (id: string) => ['build', id] as const,
  /** Prefix of every community list. */
  communityAll: ['community'] as const,
  community: (params: CommunityListParams = {}) =>
    ['community', { q: params.q ?? '', sort: params.sort ?? 'recent', offset: params.offset ?? 0 }] as const,
  communityInfinite: (params: Omit<CommunityListParams, 'offset'> = {}) =>
    ['community', 'infinite', { q: params.q ?? '', sort: params.sort ?? 'recent' }] as const,
};

// ---------------------------------------------------------------------------
// Cache helpers (also useful to ChatPanel when SSE events arrive)
// ---------------------------------------------------------------------------

/** Merge a fresh `Project` into the detail cache and refresh the lists. */
export function setProjectInCache(qc: QueryClient, project: Project): void {
  qc.setQueryData<ProjectDetailResponse>(qk.project(project.id), (old) => (old ? { ...old, project } : old));
  void qc.invalidateQueries({ queryKey: qk.projectsAll });
}

/** Patch some fields of the cached project (e.g. on the `project_updated` chat event). */
export function patchProjectInCache(qc: QueryClient, id: string, patch: Partial<Project>): void {
  qc.setQueryData<ProjectDetailResponse>(qk.project(id), (old) =>
    old ? { ...old, project: { ...old.project, ...patch } } : old,
  );
  qc.setQueriesData<ProjectSummary[]>({ queryKey: qk.projectsAll }, (old) =>
    Array.isArray(old) ? old.map((p) => (p.id === id ? { ...p, ...patch } : p)) : old,
  );
}

/** Replace / upsert / delete files inside the cached project detail without refetching. */
export function patchProjectFilesInCache(
  qc: QueryClient,
  id: string,
  update: (files: ProjectFile[]) => ProjectFile[],
  projectPatch?: Partial<Project>,
): void {
  qc.setQueryData<ProjectDetailResponse>(qk.project(id), (old) =>
    old
      ? {
          ...old,
          project: projectPatch ? { ...old.project, ...projectPatch } : old.project,
          files: update(old.files).sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)),
        }
      : old,
  );
}

/** Invalidate everything that a finished generation may have changed (messages, versions, project, usage). */
export function invalidateAfterChat(qc: QueryClient, projectId: string): void {
  void qc.invalidateQueries({ queryKey: qk.messages(projectId) });
  void qc.invalidateQueries({ queryKey: qk.versions(projectId) });
  void qc.invalidateQueries({ queryKey: qk.project(projectId) });
  void qc.invalidateQueries({ queryKey: qk.projectsAll });
  void qc.invalidateQueries({ queryKey: qk.usage });
}

function clearUserCaches(qc: QueryClient): void {
  // Everything except `me` belongs to the previous identity.
  qc.removeQueries({ predicate: (q) => q.queryKey[0] !== 'me' });
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------
const selectUser = (d: MeResponse): User | null => d.user;

/** Current user; `data === null` for guests, `undefined` while loading. */
export function useMe() {
  return useQuery({
    queryKey: qk.me,
    queryFn: ({ signal }) => api.auth.me({ signal }),
    select: selectUser,
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: true,
  });
}

/** Model catalog with availability for the current user (`ModelsResponse`). */
export function useModels() {
  return useQuery<ModelsResponse, ApiError>({
    queryKey: qk.models,
    queryFn: ({ signal }) => api.models.list({ signal }),
    staleTime: 60_000,
  });
}

export function useProjects(params: ProjectListParams = {}, options: { enabled?: boolean } = {}) {
  return useQuery<ProjectSummary[], ApiError>({
    queryKey: qk.projects(params),
    queryFn: async ({ signal }) => (await api.projects.list(params, { signal })).projects,
    placeholderData: keepPreviousData,
    enabled: options.enabled ?? true,
  });
}

/** Projects that other people shared with the current user. */
export function useSharedProjects(options: { enabled?: boolean } = {}) {
  return useQuery<ProjectSummary[], ApiError>({
    queryKey: ['projects', 'shared'] as const,
    queryFn: async ({ signal }) => (await api.projects.list({}, { signal })).shared,
    enabled: options.enabled ?? true,
  });
}

/** Project detail (`{ project, files, isOwner, canEdit }`). 404 → `error.code === 'not_found'`. */
export function useProject(id: string | null | undefined) {
  return useQuery<ProjectDetailResponse, ApiError>({
    queryKey: qk.project(id ?? ''),
    queryFn: ({ signal }) => api.projects.get(id as string, { signal }),
    enabled: !!id,
    staleTime: 10_000,
  });
}

export function useMessages(projectId: string | null | undefined) {
  return useQuery<ChatMessage[], ApiError>({
    queryKey: qk.messages(projectId ?? ''),
    queryFn: async ({ signal }) => (await api.messages.list(projectId as string, { signal })).messages,
    enabled: !!projectId,
    staleTime: 10_000,
  });
}

/** Newest first. */
export function useVersions(projectId: string | null | undefined, options: { enabled?: boolean } = {}) {
  return useQuery<VersionSummary[], ApiError>({
    queryKey: qk.versions(projectId ?? ''),
    queryFn: async ({ signal }) => (await api.versions.list(projectId as string, { signal })).versions,
    enabled: !!projectId && (options.enabled ?? true),
    staleTime: 10_000,
  });
}

export function useVersion(projectId: string | null | undefined, versionId: string | null | undefined) {
  return useQuery<VersionDetail, ApiError>({
    queryKey: qk.version(projectId ?? '', versionId ?? ''),
    queryFn: async ({ signal }) => (await api.versions.get(projectId as string, versionId as string, { signal })).version,
    enabled: !!projectId && !!versionId,
    staleTime: Infinity, // versions are immutable
  });
}

export function useVersionDiff(projectId: string | null | undefined, versionId: string | null | undefined) {
  return useQuery<VersionFileDiff[], ApiError>({
    queryKey: qk.versionDiff(projectId ?? '', versionId ?? ''),
    queryFn: async ({ signal }) => (await api.versions.diff(projectId as string, versionId as string, { signal })).diff,
    enabled: !!projectId && !!versionId,
    staleTime: Infinity,
  });
}

export function useUsage(options: { enabled?: boolean } = {}) {
  return useQuery<UsageSummary, ApiError>({
    queryKey: qk.usage,
    queryFn: ({ signal }) => api.me.usage({ signal }),
    enabled: options.enabled ?? true,
    staleTime: 15_000,
  });
}

export function useApiKeys(options: { enabled?: boolean } = {}) {
  return useQuery<ApiKeyInfo[], ApiError>({
    queryKey: qk.apiKeys,
    queryFn: async ({ signal }) => (await api.me.apiKeys.list({ signal })).keys,
    enabled: options.enabled ?? true,
  });
}

/** One page (24) of public projects. */
export function useCommunity(params: CommunityListParams = {}, options: { enabled?: boolean } = {}) {
  return useQuery<CommunityProject[], ApiError>({
    queryKey: qk.community(params),
    queryFn: async ({ signal }) => (await api.community.list(params, { signal })).projects,
    placeholderData: keepPreviousData,
    enabled: options.enabled ?? true,
    staleTime: 60_000,
  });
}

/** Paged community list: `data.pages.flat()`, `fetchNextPage()`, `hasNextPage`. */
export function useCommunityInfinite(params: Omit<CommunityListParams, 'offset'> = {}) {
  return useInfiniteQuery<CommunityProject[], ApiError, { pages: CommunityProject[][]; pageParams: number[] }, readonly unknown[], number>({
    queryKey: qk.communityInfinite(params),
    queryFn: async ({ pageParam, signal }) => (await api.community.list({ ...params, offset: pageParam }, { signal })).projects,
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) =>
      lastPage.length < LIMITS.communityPageSize ? undefined : allPages.reduce((n, p) => n + p.length, 0),
    staleTime: 60_000,
  });
}

/** Build status of the working tree (optional helper; CodePanel may also call `api.preview.build` directly). */
export function useBuild(projectId: string | null | undefined, options: { enabled?: boolean } = {}) {
  return useQuery<BuildSummary, ApiError>({
    queryKey: qk.build(projectId ?? ''),
    queryFn: ({ signal }) => api.preview.build(projectId as string, { signal }),
    enabled: !!projectId && (options.enabled ?? true),
    staleTime: 0,
  });
}

// ---------------------------------------------------------------------------
// Auth & account mutations
// ---------------------------------------------------------------------------
function onAuthenticated(qc: QueryClient, res: AuthResponse): void {
  clearUserCaches(qc);
  qc.setQueryData<MeResponse>(qk.me, { user: res.user });
}

export function useLogin() {
  const qc = useQueryClient();
  return useMutation<AuthResponse, ApiError, LoginRequest>({
    mutationFn: (body) => api.auth.login(body),
    onSuccess: (res) => onAuthenticated(qc, res),
  });
}

export function useSignup() {
  const qc = useQueryClient();
  return useMutation<AuthResponse, ApiError, SignupRequest>({
    mutationFn: (body) => api.auth.signup(body),
    onSuccess: (res) => onAuthenticated(qc, res),
  });
}

export function useLogout() {
  const qc = useQueryClient();
  return useMutation<OkResponse, ApiError, void>({
    // With Clerk the session lives there; the built-in accounts end theirs on the server.
    mutationFn: async () => {
      if (clerkEnabled) await signOutOfClerk();
      return api.auth.logout();
    },
    onSuccess: () => {
      qc.setQueryData<MeResponse>(qk.me, { user: null });
      clearUserCaches(qc);
    },
  });
}

export function useUpdateMe() {
  const qc = useQueryClient();
  return useMutation<AuthResponse, ApiError, UpdateMeRequest>({
    mutationFn: (body) => api.me.update(body),
    onSuccess: (res, vars) => {
      qc.setQueryData<MeResponse>(qk.me, { user: res.user });
      if ('defaultModel' in vars) void qc.invalidateQueries({ queryKey: qk.models });
    },
  });
}

export function useChangePassword() {
  return useMutation<OkResponse, ApiError, ChangePasswordRequest>({
    mutationFn: (body) => api.me.changePassword(body),
  });
}

export function useDeleteAccount() {
  const qc = useQueryClient();
  return useMutation<OkResponse, ApiError, DeleteAccountRequest>({
    mutationFn: (body) => api.me.deleteAccount(body),
    onSuccess: () => {
      qc.setQueryData<MeResponse>(qk.me, { user: null });
      clearUserCaches(qc);
    },
  });
}

// ---------------------------------------------------------------------------
// API keys
// ---------------------------------------------------------------------------
function invalidateAiAvailability(qc: QueryClient): void {
  void qc.invalidateQueries({ queryKey: qk.apiKeys });
  void qc.invalidateQueries({ queryKey: qk.models });
  void qc.invalidateQueries({ queryKey: qk.usage });
}

export function useSetApiKey() {
  const qc = useQueryClient();
  return useMutation<{ key: ApiKeyInfo }, ApiError, { provider: KeyProvider } & SetApiKeyRequest>({
    mutationFn: ({ provider, ...body }) => api.me.apiKeys.set(provider, body),
    onSuccess: () => invalidateAiAvailability(qc),
  });
}

export function useDeleteApiKey() {
  const qc = useQueryClient();
  return useMutation<OkResponse, ApiError, KeyProvider>({
    mutationFn: (provider) => api.me.apiKeys.remove(provider),
    onSuccess: () => {
      invalidateAiAvailability(qc);
      void qc.invalidateQueries({ queryKey: qk.me }); // the default model may have been reset
    },
  });
}

/** Resolves `{ ok, message }` — a failed test is a *successful* mutation with `ok: false`. */
export function useTestApiKey() {
  return useMutation<ApiKeyTestResponse, ApiError, KeyProvider>({
    mutationFn: (provider) => api.me.apiKeys.test(provider),
  });
}

// ---------------------------------------------------------------------------
// Project mutations
// ---------------------------------------------------------------------------
export function useCreateProject() {
  const qc = useQueryClient();
  return useMutation<CreateProjectResponse, ApiError, CreateProjectRequest | void>({
    mutationFn: (body) => api.projects.create(body ?? {}),
    onSuccess: (res) => {
      void qc.invalidateQueries({ queryKey: qk.projectsAll });
      if (res.generating) void qc.invalidateQueries({ queryKey: qk.usage });
    },
  });
}

export function useUpdateProject() {
  const qc = useQueryClient();
  return useMutation<{ project: Project }, ApiError, { id: string } & UpdateProjectRequest>({
    mutationFn: ({ id, ...body }) => api.projects.update(id, body),
    onSuccess: ({ project }, vars) => {
      setProjectInCache(qc, project);
      if (vars.visibility !== undefined) void qc.invalidateQueries({ queryKey: qk.communityAll });
    },
  });
}

export function useDeleteProject() {
  const qc = useQueryClient();
  return useMutation<OkResponse, ApiError, string>({
    mutationFn: (id) => api.projects.remove(id),
    onSuccess: (_res, id) => {
      qc.setQueriesData<ProjectSummary[]>({ queryKey: qk.projectsAll }, (old) =>
        Array.isArray(old) ? old.filter((p) => p.id !== id) : old,
      );
      for (const key of [qk.project(id), qk.messages(id), qk.versions(id), qk.build(id)]) qc.removeQueries({ queryKey: key });
      void qc.invalidateQueries({ queryKey: qk.projectsAll });
      void qc.invalidateQueries({ queryKey: qk.communityAll });
    },
  });
}

export function useDuplicateProject() {
  const qc = useQueryClient();
  return useMutation<{ project: Project }, ApiError, string>({
    mutationFn: (id) => api.projects.duplicate(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.projectsAll }),
  });
}

export function useRemixProject() {
  const qc = useQueryClient();
  return useMutation<{ project: Project }, ApiError, string>({
    mutationFn: (id) => api.projects.remix(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.projectsAll });
      void qc.invalidateQueries({ queryKey: qk.communityAll }); // remix counts
    },
  });
}

// ---------------------------------------------------------------------------
// Files (workspace-scoped). The zustand store is the live source of truth; these keep the query cache in step.
// ---------------------------------------------------------------------------
export function useSaveFile(projectId: string) {
  const qc = useQueryClient();
  return useMutation<{ file: ProjectFile }, ApiError, SaveFileRequest>({
    mutationFn: (body) => api.files.save(projectId, body),
    onSuccess: ({ file }) =>
      patchProjectFilesInCache(qc, projectId, (files) => [...files.filter((f) => f.path !== file.path), file], {
        hasUncommittedChanges: true,
      }),
  });
}

export function useDeleteFile(projectId: string) {
  const qc = useQueryClient();
  return useMutation<OkResponse, ApiError, string>({
    mutationFn: (path) => api.files.remove(projectId, path),
    onSuccess: (_res, path) =>
      patchProjectFilesInCache(qc, projectId, (files) => files.filter((f) => f.path !== path), {
        hasUncommittedChanges: true,
      }),
  });
}

export function useRenameFile(projectId: string) {
  const qc = useQueryClient();
  return useMutation<{ file: ProjectFile }, ApiError, RenameFileRequest>({
    mutationFn: (body) => api.files.rename(projectId, body),
    onSuccess: ({ file }, vars) =>
      patchProjectFilesInCache(
        qc,
        projectId,
        (files) => [...files.filter((f) => f.path !== vars.from && f.path !== file.path), file],
        { hasUncommittedChanges: true },
      ),
  });
}

// ---------------------------------------------------------------------------
// Versions
// ---------------------------------------------------------------------------
export function useCreateVersion(projectId: string) {
  const qc = useQueryClient();
  return useMutation<{ version: VersionSummary }, ApiError, CreateVersionRequest | void>({
    mutationFn: (body) => api.versions.create(projectId, body ?? {}),
    onSuccess: ({ version }) => {
      patchProjectInCache(qc, projectId, {
        currentVersionId: version.id,
        currentVersionNumber: version.number,
        hasUncommittedChanges: false,
      });
      void qc.invalidateQueries({ queryKey: qk.versions(projectId) });
    },
  });
}

/** Resolves `{ version, files }`; the caller pushes `files` into the workspace store and reloads the preview. */
export function useRestoreVersion(projectId: string) {
  const qc = useQueryClient();
  return useMutation<{ version: VersionSummary; files: ProjectFile[] }, ApiError, string>({
    mutationFn: (versionId) => api.versions.restore(projectId, versionId),
    onSuccess: ({ version, files }) => {
      patchProjectFilesInCache(qc, projectId, () => [...files], {
        currentVersionId: version.id,
        currentVersionNumber: version.number,
        hasUncommittedChanges: false,
      });
      void qc.invalidateQueries({ queryKey: qk.versions(projectId) });
      void qc.invalidateQueries({ queryKey: qk.project(projectId) });
      void qc.invalidateQueries({ queryKey: qk.build(projectId) });
    },
  });
}

// ---------------------------------------------------------------------------
// Publishing & sharing
// ---------------------------------------------------------------------------
export function usePublish(projectId: string) {
  const qc = useQueryClient();
  return useMutation<PublishResponse, ApiError, PublishRequest>({
    mutationFn: (body) => api.publish.publish(projectId, body),
    onSuccess: ({ project }) => {
      setProjectInCache(qc, project);
      void qc.invalidateQueries({ queryKey: qk.versions(projectId) }); // publishing may snapshot uncommitted edits
      void qc.invalidateQueries({ queryKey: qk.communityAll });
    },
  });
}

export function useUnpublish(projectId: string) {
  const qc = useQueryClient();
  return useMutation<{ project: Project }, ApiError, void>({
    mutationFn: () => api.publish.unpublish(projectId),
    onSuccess: ({ project }) => {
      setProjectInCache(qc, project);
      void qc.invalidateQueries({ queryKey: qk.communityAll });
    },
  });
}

export function useRotatePreviewToken(projectId: string) {
  const qc = useQueryClient();
  return useMutation<PreviewUrlResponse, ApiError, void>({
    mutationFn: () => api.preview.rotateToken(projectId),
    onSuccess: ({ previewUrl }) => patchProjectInCache(qc, projectId, { previewUrl }),
  });
}

// ---------------------------------------------------------------------------
// Chat helpers
// ---------------------------------------------------------------------------
export function useClearMessages(projectId: string) {
  const qc = useQueryClient();
  return useMutation<OkResponse, ApiError, void>({
    mutationFn: () => api.messages.clear(projectId),
    onSuccess: () => qc.setQueryData<ChatMessage[]>(qk.messages(projectId), []),
  });
}
