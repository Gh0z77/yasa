// Ordered migrations. The index + 1 is stored in PRAGMA user_version. Never edit a shipped migration; append.
export const MIGRATIONS: string[] = [
  /* 1 */ `
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  plan TEXT NOT NULL DEFAULT 'free',
  default_model TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  user_agent TEXT,
  ip TEXT
);
CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  emoji TEXT NOT NULL DEFAULT '✨',
  description TEXT NOT NULL DEFAULT '',
  visibility TEXT NOT NULL DEFAULT 'private',
  custom_instructions TEXT NOT NULL DEFAULT '',
  preview_token TEXT NOT NULL UNIQUE,
  published_slug TEXT UNIQUE,
  published_version_id TEXT,
  published_at TEXT,
  current_version_id TEXT,
  has_uncommitted_changes INTEGER NOT NULL DEFAULT 0,
  name_locked INTEGER NOT NULL DEFAULT 0,
  remixed_from_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_projects_user ON projects(user_id, updated_at DESC);
CREATE INDEX idx_projects_public ON projects(visibility, updated_at DESC);
CREATE INDEX idx_projects_remixed ON projects(remixed_from_id);
CREATE TABLE project_files (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  path TEXT NOT NULL,
  content TEXT NOT NULL,
  encoding TEXT NOT NULL DEFAULT 'utf8',
  size INTEGER NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (project_id, path)
);
CREATE TABLE blobs (
  hash TEXT PRIMARY KEY,
  content TEXT NOT NULL,
  encoding TEXT NOT NULL,
  size INTEGER NOT NULL
);
CREATE TABLE versions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  number INTEGER NOT NULL,
  summary TEXT NOT NULL,
  source TEXT NOT NULL,
  message_id TEXT,
  files_changed INTEGER NOT NULL DEFAULT 0,
  build_ok INTEGER,
  created_at TEXT NOT NULL,
  UNIQUE (project_id, number)
);
CREATE TABLE version_files (
  version_id TEXT NOT NULL REFERENCES versions(id) ON DELETE CASCADE,
  path TEXT NOT NULL,
  blob_hash TEXT NOT NULL REFERENCES blobs(hash),
  PRIMARY KEY (version_id, path)
);
CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id TEXT,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  parts_json TEXT NOT NULL DEFAULT '[]',
  attachments_json TEXT NOT NULL DEFAULT '[]',
  selected_element_json TEXT,
  mode TEXT NOT NULL DEFAULT 'build',
  status TEXT NOT NULL,
  model TEXT,
  version_id TEXT,
  input_tokens INTEGER,
  output_tokens INTEGER,
  duration_ms INTEGER,
  seq INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_messages_project ON messages(project_id, created_at, seq);
CREATE TABLE uploads (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  data BLOB NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_uploads_user ON uploads(user_id);
CREATE TABLE usage_events (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id TEXT,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  key_source TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'message',
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_usage_user ON usage_events(user_id, created_at);
CREATE TABLE user_api_keys (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  encrypted_key TEXT NOT NULL,
  last4 TEXT NOT NULL,
  base_url TEXT,
  model TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (user_id, provider)
);
CREATE TABLE published_builds (
  project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  version_id TEXT NOT NULL,
  html TEXT NOT NULL,
  built_at TEXT NOT NULL
);
`,
  // 2: accounts can be backed by a Clerk user.
  `
ALTER TABLE users ADD COLUMN clerk_id TEXT;
CREATE UNIQUE INDEX idx_users_clerk ON users(clerk_id) WHERE clerk_id IS NOT NULL;
`,
  // 3: GitHub sync — a personal access token per user, a repository per project.
  `
CREATE TABLE github_connections (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  encrypted_token TEXT NOT NULL,
  login TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE project_github (
  project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  repo TEXT NOT NULL,
  branch TEXT NOT NULL,
  last_commit_sha TEXT,
  last_commit_url TEXT,
  pushed_at TEXT,
  created_at TEXT NOT NULL
);
`,
  // 4: collaboration (members by verified email), Supabase backends and custom domains.
  `
ALTER TABLE users ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 1;
CREATE TABLE project_members (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  email TEXT NOT NULL COLLATE NOCASE,
  role TEXT NOT NULL DEFAULT 'editor',
  invited_by TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (project_id, email)
);
CREATE INDEX idx_members_email ON project_members(email);
CREATE TABLE project_supabase (
  project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  anon_key TEXT NOT NULL,
  project_ref TEXT NOT NULL,
  encrypted_access_token TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE supabase_migrations (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  path TEXT NOT NULL,
  checksum TEXT NOT NULL,
  applied_at TEXT NOT NULL,
  PRIMARY KEY (project_id, path)
);
CREATE TABLE project_domains (
  domain TEXT PRIMARY KEY COLLATE NOCASE,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  verify_token TEXT NOT NULL,
  verified_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_domains_project ON project_domains(project_id);
`,
  // 5: a Supabase database connection (encrypted) as a second way to run SQL.
  `
ALTER TABLE project_supabase ADD COLUMN encrypted_db_target TEXT;
`,
];
