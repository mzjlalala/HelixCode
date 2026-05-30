export function createCompactTextDiff(before: string, after: string, maxLines = 24): string {
  const beforeLines = splitLines(before);
  const afterLines = splitLines(after);
  let prefix = 0;
  while (
    prefix < beforeLines.length &&
    prefix < afterLines.length &&
    beforeLines[prefix] === afterLines[prefix]
  ) {
    prefix += 1;
  }

  let suffix = 0;
  while (
    suffix < beforeLines.length - prefix &&
    suffix < afterLines.length - prefix &&
    beforeLines[beforeLines.length - 1 - suffix] === afterLines[afterLines.length - 1 - suffix]
  ) {
    suffix += 1;
  }

  const removed = beforeLines.slice(prefix, beforeLines.length - suffix);
  const added = afterLines.slice(prefix, afterLines.length - suffix);
  const body = [
    ...removed.map((line) => `-${line}`),
    ...added.map((line) => `+${line}`)
  ];

  if (body.length === 0) return 'No content changes.';

  const header = [
    '--- current',
    '+++ proposed',
    `@@ around line ${prefix + 1} @@`
  ];
  const clipped = body.slice(0, maxLines);
  if (body.length > maxLines) clipped.push(`... ${body.length - maxLines} more diff lines`);
  return [...header, ...clipped].join('\n');
}

export function countTextLines(content: string): number {
  if (!content) return 0;
  return content.replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n').length;
}

function splitLines(content: string): string[] {
  if (!content) return [];
  return content.replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n');
}
