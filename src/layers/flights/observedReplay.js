/**
 * Explicit REPRODUCCIÓN HISTÓRICA: every displayed vertex is sourced from an
 * already-received flight fix. A global timestamp is shared by the fleet.
 * This is NOT a live position or a predicted future location.
 */
export const REPLAY_SPEED = 12;
export const REPLAY_WINDOW_MS = 4 * 60 * 1000;

function epoch(fix) {
  return Number.isFinite(fix?.epochMs) ? fix.epochMs : null;
}

export function replayWindow(histories, nowMs = Date.now()) {
  let earliest = Infinity;
  let latest = -Infinity;
  let tracks = 0;
  for (const history of histories.values()) {
    if (!history || history.length < 2) continue;
    const a = epoch(history[0]);
    const b = epoch(history[history.length - 1]);
    if (a == null || b == null || b <= a) continue;
    if (b < nowMs - 8 * 60 * 1000 || b > nowMs + 30 * 1000) continue;
    tracks++;
    earliest = Math.min(earliest, a);
    latest = Math.max(latest, b);
  }
  if (tracks < 3 || latest - earliest < 15_000) return null;
  return {
    fromMs: Math.max(earliest, latest - REPLAY_WINDOW_MS),
    toMs: latest,
    tracks,
  };
}

export function replayCursor(replay, nowMs = Date.now()) {
  if (!replay?.active) return null;
  return Math.min(
    replay.toMs,
    replay.fromMs + Math.max(0, nowMs - replay.startedMs) * REPLAY_SPEED,
  );
}

export function observedReplayPair(history, instantMs) {
  if (!Array.isArray(history) || history.length < 2 || !Number.isFinite(instantMs))
    return null;
  for (let i = history.length - 1; i > 0; i--) {
    const a = history[i - 1];
    const b = history[i];
    const startMs = epoch(a);
    const endMs = epoch(b);
    if (
      startMs == null ||
      endMs == null ||
      endMs <= startMs ||
      instantMs < startMs ||
      instantMs > endMs
    )
      continue;
    if (!a.position || !b.position) return null;
    return { a, b, t: (instantMs - startMs) / (endMs - startMs) };
  }
  return null;
}
