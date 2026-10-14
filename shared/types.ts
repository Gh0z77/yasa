// Shared contract between server and web. See docs/SPEC.md.
// Must stay free of Node.js and DOM APIs.

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------
export type Locale = 'en' | 'uz' | 'ru';
export type ProviderId = 'anthropic' | 'gemini' | 'openai' | 'nvidia' | 'openrouter' | 'mock';
export type KeyProvider = Exclude<ProviderId, 'mock' | 'nvidia' | 'openrouter'>;
export type ModelId = `${ProviderId}:${string}`;
export type Visibility = 'private' | 'public';
export type FileEncoding = 'utf8' | 'base64';
export type KeySource = 'server' | 'user' | 'none';

// ---------------------------------------------------------------------------
// Users & auth
// ---------------------------------------------------------------------------
export interface User {
  id: string;
  email: string;
  name: string;
  plan: 'free' | 'pro';
  defaultModel: ModelId | null;
  createdAt: string;
}

export interface SignupRequest { name: string; email: string; password: string }
export interface LoginRequest { email: string; password: string }
export interface UpdateMeRequest { name?: string; defaultModel?: ModelId | null }
export interface ChangePasswordRequest { currentPassword: string; newPassword: string }
export interface DeleteAccountRequest { password: string }
export interface AuthResponse { user: User }
export interface MeResponse { user: User | null }

// ---------------------------------------------------------------------------
// Projects & files
// ---------------------------------------------------------------------------
export interface ProjectSummary {
  id: string;
  ownerId: string;
  name: string;
  emoji: string;
  description: string;
  visibility: Visibility;
  publishedUrl: string | null;
  remixedFromId: string | null;
  createdAt: string;
  updatedAt: string;
  /** Set on projects other people shared with the current user. */
  role?: ProjectMemberRole;
  ownerName?: string;
}

export interface Project extends ProjectSummary {
  customInstructions: string;
  /** Number of the latest version (null before the first snapshot). */
  currentVersionNumber: number | null;
  /** Number of the version that is live on the published URL. */
  publishedVersionNumber: number | null;
  /** Absolute URL of the draft preview, e.g. http://pv-abc123.localhost:3000/ */
  previewUrl: string;
  publishedSlug: string | null;
  publishedAt: string | null;
  publishedVersionId: string | null;
  currentVersionId: string | null;
  hasUncommittedChanges: boolean;
}

export interface CommunityProject extends ProjectSummary {
  ownerName: string;
  remixCount: number;
}

export interface ProjectFile {
  path: string;
  content: string;
  encoding: FileEncoding;
  /** Size in bytes of the decoded content. */
  size: number;
  updatedAt: string;
}

export interface ProjectDetailResponse {
  project: Project;
  files: ProjectFile[];
  isOwner: boolean;
  /** Owner or a member with the editor role: may chat with the AI and change files. */
  canEdit: boolean;
  role: ProjectRole | null;
}

export type ProjectSort = 'updated' | 'created' | 'name';
export type CommunitySort = 'recent' | 'popular';

export interface CreateProjectRequest {
  name?: string;
  /**
   * Initial prompt. When present the server derives a provisional name and immediately starts the first
   * generation job (build mode); the workspace attaches to it via GET /chat/active.
   */
  prompt?: string;
  attachmentIds?: string[];
  model?: ModelId;
  /** UI locale of the creator; used for the starter placeholder and as a language hint for the AI. */
  locale?: Locale;
}

export interface CreateProjectResponse {
  project: Project;
  /** True when a generation job was started for the initial prompt. */
  generating: boolean;
}

export interface UpdateProjectRequest {
  name?: string;
  emoji?: string;
  description?: string;
  visibility?: Visibility;
  customInstructions?: string;
}

export interface SaveFileRequest { path: string; content: string; encoding?: FileEncoding }
export interface DeleteFileRequest { path: string }
export interface RenameFileRequest { from: string; to: string }

/** A change to the working tree. A rename is expressed as delete + upsert. */
export interface FileChange {
  path: string;
  kind: 'upsert' | 'delete';
  content?: string;
  encoding?: FileEncoding;
}

// ---------------------------------------------------------------------------
// Versions
// ---------------------------------------------------------------------------
export type VersionSource = 'initial' | 'ai' | 'manual' | 'restore';

export interface VersionSummary {
  id: string;
  projectId: string;
  number: number;
  summary: string;
  source: VersionSource;
  messageId: string | null;
  filesChanged: number;
  /** Result of the build validation for this snapshot; null when it was never built. */
  buildOk: boolean | null;
  createdAt: string;
}

export interface VersionDetail extends VersionSummary {
  files: ProjectFile[];
}

export type FileChangeStatus = 'added' | 'modified' | 'deleted';

export interface VersionFileDiff {
  path: string;
  status: FileChangeStatus;
  encoding: FileEncoding;
  before: string | null;
  after: string | null;
}

export interface CreateVersionRequest { summary?: string }

// ---------------------------------------------------------------------------
// Build / preview
// ---------------------------------------------------------------------------
export interface BuildErrorInfo {
  file: string | null;
  line: number | null;
  column: number | null;
  message: string;
  lineText: string | null;
}

export interface BuildSummary {
  ok: boolean;
  errors: BuildErrorInfo[];
  warnings: BuildErrorInfo[];
  durationMs: number;
  /** Content hash of the built file set. */
  hash: string;
}

export interface PreviewError {
  kind: 'runtime' | 'promise' | 'console' | 'resource' | 'build';
  message: string;
  stack: string | null;
  source: string | null;
  line: number | null;
  column: number | null;
  timestamp: number;
}

export interface ConsoleEntry {
  level: 'log' | 'info' | 'warn' | 'error' | 'debug';
  args: string[];
  timestamp: number;
}

export interface SelectedElement {
  tagName: string;
  id: string | null;
  className: string;
  /** Visible text, max 300 chars. */
  text: string;
  /** outerHTML, max 1200 chars. */
  html: string;
  /** Short unique CSS selector. */
  selector: string;
  /** Names of the nearest React components rendering this element, innermost first (max 5). */
  components: string[];
  /** Route path of the preview when selected. */
  path: string;
}

/** Messages posted from the preview iframe to the builder. */
export type PreviewToParentMessage =
  | { source: 'yasa-preview'; type: 'ready'; path: string }
  | { source: 'yasa-preview'; type: 'navigate'; path: string }
  | { source: 'yasa-preview'; type: 'console'; entry: ConsoleEntry }
  | { source: 'yasa-preview'; type: 'error'; error: PreviewError }
  | { source: 'yasa-preview'; type: 'element-selected'; element: SelectedElement }
  /** The user pressed Esc inside the preview while select mode was on. */
  | { source: 'yasa-preview'; type: 'select-mode-exited' };

/** Messages posted from the builder to the preview iframe. */
export type ParentToPreviewMessage =
  | { source: 'yasa-parent'; type: 'select-mode'; enabled: boolean }
  | { source: 'yasa-parent'; type: 'navigate'; path: string }
  | { source: 'yasa-parent'; type: 'reload' };

export interface PreviewUrlResponse { previewUrl: string }

// ---------------------------------------------------------------------------
// Publishing
// ---------------------------------------------------------------------------
export interface PublishRequest { slug: string }

export interface PublishInfo {
  slug: string;
  url: string;
  publishedAt: string;
  versionId: string;
}

export interface PublishResponse { project: Project; publish: PublishInfo }
export interface SlugAvailabilityResponse { available: boolean; reason?: string }

// ---------------------------------------------------------------------------
// Chat
// ---------------------------------------------------------------------------
export type ChatRole = 'user' | 'assistant';
export type ChatMode = 'build' | 'chat';
export type MessageStatus = 'streaming' | 'done' | 'error' | 'stopped';
export type ActionKind = 'write' | 'edit' | 'delete' | 'rename' | 'dependency' | 'image';
export type ActionStatus = 'pending' | 'done' | 'error';

export interface TextPart { type: 'text'; text: string }

export interface ThinkingPart { type: 'thinking'; text: string; durationMs: number | null }

export interface ActionPart {
  type: 'action';
  id: string;
  kind: ActionKind;
  /** Target path for write/edit/delete, destination path for rename, null for dependency. */
  path: string | null;
  /** Source path for rename. */
  from?: string;
  dependency?: { name: string; version: string };
  status: ActionStatus;
  error?: string;
  linesAdded?: number;
  linesRemoved?: number;
}

export interface BuildPart {
  type: 'build';
  /** 0 = first validation, 1..n = auto-fix passes. */
  attempt: number;
  ok: boolean;
  errors: BuildErrorInfo[];
  /** Number of actions (edits) that failed to apply in the pass that preceded this validation. */
  failedActions: number;
  /** True when another automatic repair pass follows this validation. */
  willRetry: boolean;
  durationMs: number;
}

export interface SuggestionsPart { type: 'suggestions'; items: string[] }

/** One clarifying question the AI asks before it builds. */
export interface ChatQuestion {
  text: string;
  /** single = pick one, multi = pick any, colors = pick one palette (options carry swatches). */
  kind: 'single' | 'multi' | 'colors';
  options: Array<{ label: string; colors?: string[] }>;
}
export interface QuestionsPart { type: 'questions'; items: ChatQuestion[] }

/** Machine-readable reason carried by error parts / events; the UI localizes by code. */
export type ChatErrorCode =
  | 'provider_auth'
  | 'provider_rate_limit'
  | 'provider_overloaded'
  | 'provider_bad_request'
  | 'provider_network'
  | 'provider_error'
  | 'refusal'
  | 'max_tokens'
  | 'edit_failed'
  | 'build_failed'
  | 'interrupted'
  | 'no_provider'
  | 'limit_reached'
  | 'internal';

export interface ErrorPart { type: 'error'; code: ChatErrorCode; message: string }

/** The requested model was unavailable and the turn continued on another one. */
export interface NoticePart { type: 'notice'; code: 'model_fallback'; from: ModelId; to: ModelId }
/** The AI asked for a backend: Yasa creates a Supabase project in the user's account and links it. */
export interface BackendPart { type: 'backend'; status: 'creating' | 'ready' | 'failed'; name: string; ref: string | null; error?: string }
/** Migrations Yasa ran on the linked Supabase project after the reply. */
export interface MigrationsPart { type: 'migrations'; applied: string[]; failed: { path: string; message: string } | null; waiting?: boolean }

export type MessagePart = TextPart | ThinkingPart | ActionPart | BuildPart | SuggestionsPart | ErrorPart | NoticePart | QuestionsPart | BackendPart | MigrationsPart;

export interface Attachment {
  id: string;
  name: string;
  mime: string;
  size: number;
  /** URL to fetch the binary from the builder API, e.g. /api/uploads/upl_… */
  url: string;
  /** Path inside the project once copied there, e.g. public/uploads/upl_….png */
  projectPath: string | null;
}

export interface TokenUsage { inputTokens: number; outputTokens: number }

export interface ChatMessage {
  id: string;
  projectId: string;
  role: ChatRole;
  /** User: the prompt. Assistant: concatenation of its text parts. */
  content: string;
  parts: MessagePart[];
  attachments: Attachment[];
  selectedElement: SelectedElement | null;
  mode: ChatMode;
  status: MessageStatus;
  model: ModelId | null;
  versionId: string | null;
  versionNumber: number | null;
  usage: TokenUsage | null;
  /** Wall-clock duration of the generation (assistant messages), null while streaming. */
  durationMs: number | null;
  createdAt: string;
}

export interface ChatRequest {
  message: string;
  attachmentIds?: string[];
  selectedElement?: SelectedElement | null;
  runtimeErrors?: PreviewError[];
  model?: ModelId;
  mode?: ChatMode;
  /** 'fix' = error-repair request (has its own free daily quota); 'continue' = resume after max_tokens. */
  intent?: 'fix' | 'continue';
  /** UI locale, used as a language hint when the message language is ambiguous. */
  locale?: Locale;
  /** The user turned clarifying questions off: build straight away. */
  skipQuestions?: boolean;
}

export interface MessagesResponse { messages: ChatMessage[] }
export interface StopResponse { ok: true; stopped: boolean }

/** Server-sent events on POST /api/projects/:id/chat and GET /api/projects/:id/chat/active. */
export type ChatEvent =
  | { type: 'start'; userMessage: ChatMessage; assistantMessage: ChatMessage }
  | { type: 'snapshot'; userMessage: ChatMessage | null; assistantMessage: ChatMessage }
  | { type: 'part_start'; index: number; part: MessagePart }
  | { type: 'part_delta'; index: number; delta: string }
  | { type: 'part_update'; index: number; part: MessagePart }
  | { type: 'files_changed'; changes: FileChange[] }
  | { type: 'project_updated'; project: { name: string; emoji: string; description: string } }
  | { type: 'build'; summary: BuildSummary; attempt: number }
  | { type: 'version'; version: VersionSummary }
  | { type: 'usage'; inputTokens: number; outputTokens: number }
  | { type: 'done'; message: ChatMessage }
  | { type: 'error'; error: { code: ChatErrorCode; message: string } };

export type ChatEventType = ChatEvent['type'];

// ---------------------------------------------------------------------------
// Models, keys, usage
// ---------------------------------------------------------------------------
export type ModelTier = 'best' | 'balanced' | 'fast' | 'demo';

export interface ModelInfo {
  id: ModelId;
  provider: ProviderId;
  model: string;
  label: string;
  description: string;
  tier: ModelTier;
  available: boolean;
  keySource: KeySource | null;
}

export interface ModelsResponse {
  models: ModelInfo[];
  defaultModel: ModelId | null;
}

export interface ApiKeyInfo {
  provider: KeyProvider;
  last4: string;
  baseUrl: string | null;
  /** Model id to use with this key (OpenAI-compatible providers such as OpenRouter/DeepSeek/Groq/Ollama). */
  model: string | null;
  createdAt: string;
}

export interface SetApiKeyRequest { apiKey: string; baseUrl?: string | null; model?: string | null }
export interface ApiKeysResponse { keys: ApiKeyInfo[] }
export interface ApiKeyTestResponse { ok: boolean; message: string }

export interface UsageBucket { messages: number; inputTokens: number; outputTokens: number }

export interface UsageSummary {
  today: UsageBucket;
  month: UsageBucket;
  /** null = unlimited */
  dailyMessageLimit: number | null;
  remainingToday: number | null;
  /** Free error-fix requests left today (they do not count against the message limit). */
  freeFixesRemaining: number;
  /** ISO time when the daily counters reset (next UTC midnight). */
  resetsAt: string;
}

// ---------------------------------------------------------------------------
// Uploads
// ---------------------------------------------------------------------------
export interface UploadResponse { attachment: Attachment }

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------
export type ApiErrorCode =
  | 'bad_request'
  | 'validation_error'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'payload_too_large'
  | 'rate_limited'
  | 'limit_reached'
  | 'provider_error'
  | 'no_provider'
  | 'internal';

export interface ApiErrorBody {
  error: { code: ApiErrorCode; message: string; details?: unknown };
}

// ---------------------------------------------------------------------------
// GitHub sync
// ---------------------------------------------------------------------------
export interface GithubConnection { login: string; connectedAt: string }
export interface GithubRepoLink {
  /** owner/name */
  repo: string;
  branch: string;
  url: string;
  lastCommitSha: string | null;
  lastCommitUrl: string | null;
  pushedAt: string | null;
}
export interface GithubConnectionResponse { connection: GithubConnection | null }
export interface GithubProjectResponse { connection: GithubConnection | null; link: GithubRepoLink | null; suggestedRepo: string }
export interface GithubPushRequest { repo?: string; private?: boolean; message?: string }
export interface GithubPushResult { link: GithubRepoLink; created: boolean; files: number }
/** The "github" field in the details of an error from the GitHub endpoints. */
export type GithubFailure = 'token_invalid' | 'forbidden' | 'cannot_create' | 'name_taken' | 'unreachable' | 'not_connected';

// ---------------------------------------------------------------------------
// Collaboration, Supabase, custom domains
// ---------------------------------------------------------------------------
export type ProjectMemberRole = 'editor' | 'viewer';
export type ProjectRole = 'owner' | ProjectMemberRole;
export interface ProjectMember {
  email: string;
  role: ProjectMemberRole;
  /** Display name once the person has an account with this (verified) address. */
  name: string | null;
  joined: boolean;
  addedAt: string;
}
export interface MembersResponse { owner: { email: string; name: string }; members: ProjectMember[] }

export interface SupabaseMigration { path: string; name: string; sql: string; applied: boolean; appliedAt: string | null }
export interface SupabaseStatus {
  connection: { url: string; projectRef: string; canRunSql: boolean; connectedAt: string } | null;
  migrations: SupabaseMigration[];
  pending: number;
}
/** Contents of the connected Supabase project, shown in the Cloud tab. */
export interface SupabaseOverview {
  tables: Array<{ name: string; rows: number; columns: number; rls: boolean }>;
  users: { count: number; recent: Array<{ email: string; createdAt: string }> };
  buckets: Array<{ name: string; public: boolean }>;
  dashboardUrl: string;
}
export interface SupabaseConnectRequest {
  url: string;
  anonKey: string;
  accessToken?: string | null;
  /** Database connection string (URI) from Supabase: a second way to let Yasa run migrations. */
  dbUrl?: string | null;
}
export interface SupabaseOrganization { id: string; name: string }
export interface SupabaseAccountProject { ref: string; name: string; region: string; status: string; organizationId: string; ready: boolean }
/** The user's own Supabase account (connected with a personal access token). */
/** The user's own Supabase account. `canConnect`: this server can start the one-click (OAuth) connection. */
export interface SupabaseAccount { connected: boolean; canConnect: boolean; organizations: SupabaseOrganization[]; projects: SupabaseAccountProject[] }
export interface SupabaseConnectStart { url: string }
export interface SupabaseAccountConnectRequest { accessToken: string }
export interface SupabaseCreateProjectRequest { name: string; organizationId?: string; region?: string }
export interface SupabaseApplyResponse { status: SupabaseStatus; applied: string[]; failed: { path: string; message: string } | null }
/** The "supabase" field in the details of an error from the Supabase endpoints. */
export type SupabaseFailure =
  | 'bad_url'
  | 'bad_key'
  | 'bad_token'
  | 'unreachable'
  | 'not_connected'
  | 'no_token'
  | 'bad_db_url'
  | 'bad_db_password'
  | 'db_unreachable'
  | 'bad_account_token'
  | 'no_account'
  | 'project_limit'
  | 'not_ready';

export interface ProjectDomain {
  domain: string;
  verified: boolean;
  verifiedAt: string | null;
  /** DNS TXT record that proves control of the domain. */
  txtName: string;
  txtValue: string;
  /** Host the domain has to point at (CNAME, or the A record of that host). */
  target: string;
  addedAt: string;
}
export interface DomainsResponse { domains: ProjectDomain[] }
/** The "domain" field in the details of an error from the domain endpoints. */
export type DomainFailure = 'invalid' | 'reserved' | 'taken' | 'not_verified';

export interface OkResponse { ok: true }
export interface HealthResponse { ok: true; version: string }
