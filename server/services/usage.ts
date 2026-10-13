import { LIMITS } from '../../shared/constants';
import type { KeySource, ProviderId, UsageBucket, UsageSummary } from '../../shared/types';
import { get, run } from '../db';
import { getConfig } from '../env';
import { newId } from '../lib/ids';
import { nextDayIso, nowIso, startOfDayIso, startOfMonthIso } from '../lib/time';

export function recordUsage(input: {
  userId: string;
  projectId?: string | null;
  provider: ProviderId;
  model: string;
  keySource: KeySource;
  kind?: 'message' | 'fix';
  inputTokens: number;
  outputTokens: number;
}): void {
  run(
    `INSERT INTO usage_events (id, user_id, project_id, provider, model, key_source, kind, input_tokens, output_tokens, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    newId('use'),
    input.userId,
    input.projectId ?? null,
    input.provider,
    input.model,
    input.keySource,
    input.kind ?? 'message',
    Math.max(0, Math.round(input.inputTokens)),
    Math.max(0, Math.round(input.outputTokens)),
    nowIso(),
  );
}

function bucket(userId: string, since: string): UsageBucket {
  const row = get<{ messages: number; input: number | null; output: number | null }>(
    `SELECT COUNT(*) AS messages, SUM(input_tokens) AS input, SUM(output_tokens) AS output
       FROM usage_events WHERE user_id = ? AND created_at >= ?`,
    userId,
    since,
  );
  return { messages: row?.messages ?? 0, inputTokens: row?.input ?? 0, outputTokens: row?.output ?? 0 };
}

/** Requests today that consumed the server's own keys and count against the daily message limit. */
export function countServerMessagesToday(userId: string): number {
  const fixes = countServerFixesToday(userId);
  const messages =
    get<{ n: number }>(
      `SELECT COUNT(*) AS n FROM usage_events
        WHERE user_id = ? AND created_at >= ? AND key_source = 'server' AND kind = 'message'`,
      userId,
      startOfDayIso(),
    )?.n ?? 0;
  // Fixes beyond the free quota count as messages.
  return messages + Math.max(0, fixes - LIMITS.freeFixesPerDay);
}

export function countServerFixesToday(userId: string): number {
  return (
    get<{ n: number }>(
      `SELECT COUNT(*) AS n FROM usage_events
        WHERE user_id = ? AND created_at >= ? AND key_source = 'server' AND kind = 'fix'`,
      userId,
      startOfDayIso(),
    )?.n ?? 0
  );
}

export function getUsageSummary(userId: string): UsageSummary {
  const limit = getConfig().dailyMessageLimit;
  const used = countServerMessagesToday(userId);
  return {
    today: bucket(userId, startOfDayIso()),
    month: bucket(userId, startOfMonthIso()),
    dailyMessageLimit: limit > 0 ? limit : null,
    remainingToday: limit > 0 ? Math.max(0, limit - used) : null,
    freeFixesRemaining: Math.max(0, LIMITS.freeFixesPerDay - countServerFixesToday(userId)),
    resetsAt: nextDayIso(),
  };
}
