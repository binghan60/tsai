const DEFAULT_PAIR_WINDOW_MS = 30 * 60 * 1000;

function createAttempt(log) {
  return {
    ...log,
    startedAt: log.event === 'queued' ? log.createdAt : null,
    completedAt: log.event === 'queued' ? null : log.createdAt,
    latestAt: log.createdAt,
  };
}

function mergeAttempt(attempt, log) {
  attempt.latestAt = new Date(log.createdAt) > new Date(attempt.latestAt) ? log.createdAt : attempt.latestAt;
  if (log.event === 'queued') {
    attempt.startedAt = log.createdAt;
    return;
  }
  const startedAt = attempt.startedAt;
  Object.assign(attempt, log, { startedAt, completedAt: log.createdAt, latestAt: attempt.latestAt });
}

// 新資料用 attemptId 精準合併 queued 與最終結果。舊資料沒有 attemptId，
// 只在同報告、同收件人且短時間內配對，避免把相隔很久的重寄錯併在一起。
export function groupDeliveryAttempts(logs, pairWindowMs = DEFAULT_PAIR_WINDOW_MS) {
  const attempts = [];
  const byAttemptId = new Map();
  const unmatchedOutcomes = new Map();

  for (const log of logs ?? []) {
    if (log.attemptId) {
      const existing = byAttemptId.get(log.attemptId);
      if (existing) mergeAttempt(existing, log);
      else {
        const attempt = createAttempt(log);
        byAttemptId.set(log.attemptId, attempt);
        attempts.push(attempt);
      }
      continue;
    }

    const key = `${log.recordId}:${log.recipient}`;
    if (log.event !== 'queued') {
      const attempt = createAttempt(log);
      attempts.push(attempt);
      const candidates = unmatchedOutcomes.get(key) ?? [];
      candidates.push(attempt);
      unmatchedOutcomes.set(key, candidates);
      continue;
    }

    const candidates = unmatchedOutcomes.get(key) ?? [];
    const matchIndex = candidates.findIndex((attempt) => {
      const elapsed = new Date(attempt.completedAt) - new Date(log.createdAt);
      return !attempt.startedAt && elapsed >= 0 && elapsed <= pairWindowMs;
    });
    if (matchIndex >= 0) {
      mergeAttempt(candidates[matchIndex], log);
      candidates.splice(matchIndex, 1);
    } else {
      attempts.push(createAttempt(log));
    }
  }

  return attempts.sort((a, b) => new Date(b.latestAt) - new Date(a.latestAt));
}
