export interface RunRecord {
  time: number;
  kills: number;
  level: number;
}

const KEY = 'code-survivors:best';

export function readBest(): RunRecord | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<RunRecord>;
    if (typeof parsed.time !== 'number') return null;
    return {
      time: parsed.time,
      kills: typeof parsed.kills === 'number' ? parsed.kills : 0,
      level: typeof parsed.level === 'number' ? parsed.level : 1,
    };
  } catch {
    return null;
  }
}

export function writeBest(record: RunRecord): boolean {
  const current = readBest();
  if (current && current.time >= record.time) return false;
  try {
    localStorage.setItem(KEY, JSON.stringify(record));
    return true;
  } catch {
    return false;
  }
}

export function formatTime(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
