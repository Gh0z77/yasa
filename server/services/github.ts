// GitHub sync: a user connects a personal access token, then pushes a project to a repository of their own.
// Each push is one commit that mirrors the project's files exactly (Git Data API: blobs → tree → commit → ref).
import type { GithubConnection, GithubPushResult, GithubRepoLink, ProjectFile } from '../../shared/types';
import { get, run } from '../db';
import { decryptSecret, encryptSecret } from '../lib/crypto';
import { HttpError, badRequest, conflict } from '../lib/errors';
import { logger } from '../lib/logger';
import { nowIso } from '../lib/time';

const API = 'https://api.github.com';
const BLOB_CONCURRENCY = 6;
export const REPO_NAME_PATTERN = /^[A-Za-z0-9._-]{1,100}$/;
/** Branch used inside a repository that existed before it was linked. */
export const EXISTING_REPO_BRANCH = 'yasa';

interface RepoInfo {
  full_name: string;
  default_branch: string;
}

type Fetch = typeof fetch;
let http: Fetch = (...args) => fetch(...args);

/** Test helper: replaces the HTTP client (pass null to restore the real one). */
export function setGithubFetchForTests(fake: Fetch | null): void {
  http = fake ?? ((...args) => fetch(...args));
}

class GithubApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function gh<T>(token: string, method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await http(API + path, {
      method,
      headers: {
        authorization: 'Bearer ' + token,
        accept: 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28',
        'user-agent': 'yasa-app-builder',
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    throw new HttpError(502, 'provider_error', 'Could not reach GitHub. Try again in a moment.', { github: 'unreachable' });
  }
  if (!res.ok) {
    const detail = (await res.json().catch(() => null)) as { message?: string } | null;
    throw new GithubApiError(res.status, detail?.message ?? 'GitHub answered ' + res.status);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

/** Runs a lookup that may legitimately find nothing (404, or 409 for an empty repository). */
async function optional<T>(lookup: () => Promise<T>): Promise<T | null> {
  try {
    return await lookup();
  } catch (err) {
    if (err instanceof GithubApiError && (err.status === 404 || err.status === 409)) return null;
    throw err;
  }
}

/** Turns a GitHub failure into an error the UI can show; `what` names the step for the log. */
function explain(err: unknown, what: string): never {
  if (err instanceof HttpError) throw err;
  if (err instanceof GithubApiError) {
    logger.warn('GitHub ' + what + ' failed', { status: err.status, message: err.message });
    if (err.status === 401) throw badRequest('GitHub rejected the token. Connect GitHub again with a new token.', { github: 'token_invalid' });
    if (err.status === 403 || err.status === 404) {
      throw badRequest('The token is not allowed to do this. It needs read and write access to repository contents.', { github: 'forbidden' });
    }
    if (err.status === 422) throw conflict('GitHub refused the request. A repository with this name may already exist.', { github: 'name_taken' });
    throw new HttpError(502, 'provider_error', 'GitHub returned an error. Try again in a moment.', { github: 'unreachable' });
  }
  throw err;
}

// ---- connection (per user) ---------------------------------------------------------------------------------

interface ConnectionRow {
  encrypted_token: string;
  login: string;
  created_at: string;
}

export function getGithubConnection(userId: string): GithubConnection | null {
  const row = get<ConnectionRow>('SELECT * FROM github_connections WHERE user_id = ?', userId);
  return row ? { login: row.login, connectedAt: row.created_at } : null;
}

function tokenFor(userId: string): { token: string; login: string } {
  const row = get<ConnectionRow>('SELECT * FROM github_connections WHERE user_id = ?', userId);
  const token = row ? decryptSecret(row.encrypted_token) : null;
  if (!row || !token) throw badRequest('Connect your GitHub account first.', { github: 'not_connected' });
  return { token, login: row.login };
}

/** Checks the token against GitHub and stores it encrypted. */
export async function connectGithub(userId: string, rawToken: string): Promise<GithubConnection> {
  const token = rawToken.trim();
  let login: string;
  try {
    login = (await gh<{ login: string }>(token, 'GET', '/user')).login;
  } catch (err) {
    explain(err, 'token check');
  }
  const now = nowIso();
  run(
    `INSERT INTO github_connections (user_id, encrypted_token, login, created_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET encrypted_token = excluded.encrypted_token, login = excluded.login, created_at = excluded.created_at`,
    userId,
    encryptSecret(token),
    login,
    now,
  );
  return { login, connectedAt: now };
}

export function disconnectGithub(userId: string): void {
  run('DELETE FROM github_connections WHERE user_id = ?', userId);
}

// ---- repository link (per project) -------------------------------------------------------------------------

interface LinkRow {
  repo: string;
  branch: string;
  last_commit_sha: string | null;
  last_commit_url: string | null;
  pushed_at: string | null;
}

export function getGithubLink(projectId: string): GithubRepoLink | null {
  const row = get<LinkRow>('SELECT * FROM project_github WHERE project_id = ?', projectId);
  if (!row) return null;
  return {
    repo: row.repo,
    branch: row.branch,
    url: 'https://github.com/' + row.repo + (row.branch === EXISTING_REPO_BRANCH ? '/tree/' + row.branch : ''),
    lastCommitSha: row.last_commit_sha,
    lastCommitUrl: row.last_commit_url,
    pushedAt: row.pushed_at,
  };
}

export function unlinkGithub(projectId: string): void {
  run('DELETE FROM project_github WHERE project_id = ?', projectId);
}

async function inBatches<T, R>(items: T[], size: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += size) out.push(...(await Promise.all(items.slice(i, i + size).map(work))));
  return out;
}

export interface PushInput {
  projectId: string;
  projectName: string;
  description: string;
  files: ProjectFile[];
  message: string;
  /** Only for the first push: the repository to create or reuse. */
  repoName?: string;
  isPrivate?: boolean;
}

/**
 * Pushes the project as one commit. The first push links a repository: a new one is created and receives the
 * code on its default branch; one that already exists is reused on a separate branch, so its own files stay
 * untouched. Later pushes commit on top of the linked branch.
 */
export async function pushProjectToGithub(userId: string, input: PushInput): Promise<GithubPushResult> {
  const { token, login } = tokenFor(userId);
  if (input.files.length === 0) throw badRequest('The project has no files to push.');
  let link = getGithubLink(input.projectId);
  let created = false;

  try {
    if (!link) {
      const name = (input.repoName ?? '').trim();
      if (!REPO_NAME_PATTERN.test(name)) throw badRequest('Use letters, digits, dots, dashes and underscores for the repository name.');
      const existing = await optional(() => gh<RepoInfo>(token, 'GET', '/repos/' + login + '/' + name));
      let repo = existing;
      if (!repo) {
        try {
          repo = await gh<RepoInfo>(token, 'POST', '/user/repos', {
            name,
            description: (input.description || input.projectName + ' — built with Yasa').slice(0, 300),
            private: input.isPrivate ?? true,
            auto_init: true,
          });
        } catch (err) {
          if (err instanceof GithubApiError && err.status === 403) {
            throw badRequest('This token cannot create repositories. Create an empty repository on GitHub and enter its name here.', {
              github: 'cannot_create',
            });
          }
          throw err;
        }
        created = true;
      }
      run(
        'INSERT INTO project_github (project_id, repo, branch, created_at) VALUES (?, ?, ?, ?)',
        input.projectId,
        repo.full_name,
        existing ? EXISTING_REPO_BRANCH : repo.default_branch || 'main',
        nowIso(),
      );
      link = getGithubLink(input.projectId)!;
    }

    const repoName = link.repo;
    const branch = link.branch;
    const base = '/repos/' + repoName;
    const headOf = async (name: string): Promise<string | null> => {
      const ref = await optional(() => gh<{ object: { sha: string } }>(token, 'GET', base + '/git/ref/heads/' + encodeURIComponent(name)));
      return ref?.object.sha ?? null;
    };

    let parent = await headOf(branch);
    if (!parent) {
      // The sync branch does not exist yet: start it from the default branch, giving an empty repository its
      // first commit on the way (the Git Data API cannot write to a repository without one).
      const { default_branch: defaultBranch } = await gh<RepoInfo>(token, 'GET', base);
      parent = branch === defaultBranch ? null : await headOf(defaultBranch);
      if (!parent) {
        await gh(token, 'PUT', base + '/contents/README.md', {
          message: 'Initial commit',
          content: Buffer.from('# ' + input.projectName + '\n', 'utf8').toString('base64'),
        });
        parent = await headOf(defaultBranch);
        if (!parent) throw new GithubApiError(502, 'The repository could not be initialised');
      }
      if (branch !== defaultBranch) await gh(token, 'POST', base + '/git/refs', { ref: 'refs/heads/' + branch, sha: parent });
    }

    const blobs = await inBatches(input.files, BLOB_CONCURRENCY, async (file) => {
      const blob = await gh<{ sha: string }>(token, 'POST', base + '/git/blobs', {
        content: file.content,
        encoding: file.encoding === 'base64' ? 'base64' : 'utf-8',
      });
      return { path: file.path, mode: '100644' as const, type: 'blob' as const, sha: blob.sha };
    });
    // No base tree: the commit mirrors the project, so files deleted in Yasa disappear from the branch too.
    const tree = await gh<{ sha: string }>(token, 'POST', base + '/git/trees', { tree: blobs });
    const commit = await gh<{ sha: string; html_url?: string }>(token, 'POST', base + '/git/commits', {
      message: input.message.slice(0, 500),
      tree: tree.sha,
      parents: [parent],
    });
    await gh(token, 'PATCH', base + '/git/refs/heads/' + encodeURIComponent(branch), { sha: commit.sha });

    const commitUrl = commit.html_url ?? 'https://github.com/' + repoName + '/commit/' + commit.sha;
    run(
      'UPDATE project_github SET last_commit_sha = ?, last_commit_url = ?, pushed_at = ? WHERE project_id = ?',
      commit.sha,
      commitUrl,
      nowIso(),
      input.projectId,
    );
    logger.info('Project pushed to GitHub', { projectId: input.projectId, repo: repoName, branch, files: input.files.length, created });
    return { link: getGithubLink(input.projectId)!, created, files: input.files.length };
  } catch (err) {
    explain(err, 'push');
  }
}
