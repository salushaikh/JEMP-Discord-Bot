export function sanitizeUserText(value: string, maxLength: number): string {
  return value
    .replace(/@everyone|@here/gi, '@\u200beveryone')
    .replace(/<@&?\d+>/g, '[mention removed]')
    .trim()
    .slice(0, maxLength);
}

export function safeUrl(value: string): string | undefined {
  try {
    const parsed = new URL(value);
    return ['https:', 'http:'].includes(parsed.protocol) ? parsed.toString() : undefined;
  } catch {
    return undefined;
  }
}
