export const normalizeTagName = (name: string) => name.trim().toLowerCase();

export const dedupeTagNames = (names: string[]) => {
  const deduped = new Map<string, string>();
  for (const rawName of names) {
    const trimmed = rawName.trim();
    if (!trimmed) continue;
    const normalized = normalizeTagName(trimmed);
    if (!deduped.has(normalized)) {
      deduped.set(normalized, trimmed);
    }
  }
  return Array.from(deduped.entries()).map(([normalized, name]) => ({
    normalized,
    name,
  }));
};
