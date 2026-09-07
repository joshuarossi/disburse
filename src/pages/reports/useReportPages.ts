import { useState } from 'react';

export function useReportPages(scope: unknown) {
  const key = JSON.stringify(scope);
  const [position, setPosition] = useState<{ key: string; cursors: (string | undefined)[] }>({ key, cursors: [undefined] });
  const cursors = position.key === key ? position.cursors : [undefined];
  return { cursor: cursors[cursors.length - 1], page: cursors.length,
    next: (cursor: string) => setPosition({ key, cursors: [...cursors, cursor] }),
    previous: () => setPosition({ key, cursors: cursors.slice(0, -1) }) };
}
