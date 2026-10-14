import type {
  Attachment,
  ChatMessage,
  ChatMode,
  ChatRole,
  MessagePart,
  MessageStatus,
  ModelId,
  SelectedElement,
  TokenUsage,
} from '../../shared/types';
import { all, get, run } from '../db';
import { newId } from '../lib/ids';
import { nowIso } from '../lib/time';

interface MessageRow {
  id: string;
  project_id: string;
  role: string;
  content: string;
  parts_json: string;
  attachments_json: string;
  selected_element_json: string | null;
  mode: string;
  status: string;
  model: string | null;
  version_id: string | null;
  version_number: number | null;
  input_tokens: number | null;
  output_tokens: number | null;
  duration_ms: number | null;
  created_at: string;
}

const SELECT = `
  SELECT m.id, m.project_id, m.role, m.content, m.parts_json, m.attachments_json, m.selected_element_json, m.mode,
         m.status, m.model, m.version_id, m.input_tokens, m.output_tokens, m.duration_ms, m.created_at,
         (SELECT number FROM versions v WHERE v.id = m.version_id) AS version_number
    FROM messages m`;

function parseJson<T>(text: string | null, fallback: T): T {
  if (!text) return fallback;
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

function toMessage(row: MessageRow): ChatMessage {
  return {
    id: row.id,
    projectId: row.project_id,
    role: row.role as ChatRole,
    content: row.content,
    parts: parseJson<MessagePart[]>(row.parts_json, []),
    attachments: parseJson<Attachment[]>(row.attachments_json, []),
    selectedElement: parseJson<SelectedElement | null>(row.selected_element_json, null),
    mode: (row.mode === 'chat' ? 'chat' : 'build') as ChatMode,
    status: row.status as MessageStatus,
    model: row.model as ModelId | null,
    versionId: row.version_id,
    versionNumber: row.version_number,
    usage: row.input_tokens === null && row.output_tokens === null ? null : { inputTokens: row.input_tokens ?? 0, outputTokens: row.output_tokens ?? 0 },
    durationMs: row.duration_ms,
    createdAt: row.created_at,
  };
}

export interface CreateMessageInput {
  projectId: string;
  userId?: string | null;
  role: ChatRole;
  content: string;
  parts?: MessagePart[];
  attachments?: Attachment[];
  selectedElement?: SelectedElement | null;
  mode?: ChatMode;
  status: MessageStatus;
  model?: ModelId | null;
}

export function createMessage(input: CreateMessageInput): ChatMessage {
  const id = newId('msg');
  const seq = (get<{ n: number | null }>('SELECT MAX(seq) AS n FROM messages WHERE project_id = ?', input.projectId)?.n ?? 0) + 1;
  run(
    `INSERT INTO messages (id, project_id, user_id, role, content, parts_json, attachments_json, selected_element_json,
                           mode, status, model, seq, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    input.projectId,
    input.userId ?? null,
    input.role,
    input.content,
    JSON.stringify(input.parts ?? []),
    JSON.stringify(input.attachments ?? []),
    input.selectedElement ? JSON.stringify(input.selectedElement) : null,
    input.mode ?? 'build',
    input.status,
    input.model ?? null,
    seq,
    nowIso(),
  );
  return getMessage(id)!;
}

export interface UpdateMessagePatch {
  content?: string;
  parts?: MessagePart[];
  status?: MessageStatus;
  versionId?: string | null;
  usage?: TokenUsage | null;
  model?: ModelId | null;
  durationMs?: number | null;
}

export function updateMessage(id: string, patch: UpdateMessagePatch): ChatMessage {
  const sets: string[] = [];
  const params: (string | number | null)[] = [];
  if (patch.content !== undefined) {
    sets.push('content = ?');
    params.push(patch.content);
  }
  if (patch.parts !== undefined) {
    sets.push('parts_json = ?');
    params.push(JSON.stringify(patch.parts));
  }
  if (patch.status !== undefined) {
    sets.push('status = ?');
    params.push(patch.status);
  }
  if (patch.versionId !== undefined) {
    sets.push('version_id = ?');
    params.push(patch.versionId);
  }
  if (patch.usage !== undefined) {
    sets.push('input_tokens = ?', 'output_tokens = ?');
    params.push(patch.usage?.inputTokens ?? null, patch.usage?.outputTokens ?? null);
  }
  if (patch.model !== undefined) {
    sets.push('model = ?');
    params.push(patch.model);
  }
  if (patch.durationMs !== undefined) {
    sets.push('duration_ms = ?');
    params.push(patch.durationMs);
  }
  if (sets.length > 0) run(`UPDATE messages SET ${sets.join(', ')} WHERE id = ?`, ...params, id);
  return getMessage(id)!;
}

export function getMessage(id: string): ChatMessage | null {
  const row = get<MessageRow>(`${SELECT} WHERE m.id = ?`, id);
  return row ? toMessage(row) : null;
}

/** Oldest → newest; the last `limit` messages. */
export function listMessages(projectId: string, limit = 200): ChatMessage[] {
  const rows = all<MessageRow>(`${SELECT} WHERE m.project_id = ? ORDER BY m.seq DESC LIMIT ?`, projectId, limit);
  return rows.reverse().map(toMessage);
}

/** Startup recovery: jobs do not survive a restart. */
/**
 * Marks unfinished generations as interrupted. `olderThanMs` spares the ones that may still be running on
 * another instance (0 = all of them: a single server that has just restarted).
 */
export function markStreamingMessagesInterrupted(olderThanMs = 0): number {
  const before = new Date(Date.now() - olderThanMs).toISOString();
  const rows = all<{ id: string; parts_json: string }>("SELECT id, parts_json FROM messages WHERE status = 'streaming' AND created_at <= ?", before);
  for (const row of rows) {
    const parts = parseJson<MessagePart[]>(row.parts_json, []);
    parts.push({ type: 'error', code: 'interrupted', message: 'The server restarted while this was being generated.' });
    run("UPDATE messages SET status = 'error', parts_json = ? WHERE id = ?", JSON.stringify(parts), row.id);
  }
  return rows.length;
}

/** The generation another instance is running for this project right now, if any. */
export function findRunningMessage(projectId: string, withinMs: number): ChatMessage | null {
  const since = new Date(Date.now() - withinMs).toISOString();
  const row = get<{ id: string }>(
    "SELECT id FROM messages WHERE project_id = ? AND role = 'assistant' AND status = 'streaming' AND created_at > ? ORDER BY seq DESC LIMIT 1",
    projectId,
    since,
  );
  return row ? getMessage(row.id) : null;
}

export function clearMessages(projectId: string): void {
  run('DELETE FROM messages WHERE project_id = ?', projectId);
}

export function countMessages(projectId: string): number {
  return get<{ n: number }>('SELECT COUNT(*) AS n FROM messages WHERE project_id = ?', projectId)?.n ?? 0;
}
