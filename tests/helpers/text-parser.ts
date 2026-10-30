import type { Response } from 'superagent';

type RawStream = NodeJS.ReadableStream & { setEncoding(encoding: string): void };

/**
 * Superagent parser that keeps the payload as text. Without it Superagent throws on invalid JSON, so a
 * broken response could never be reported as a contract violation (see `fromSupertest`).
 */
export function textParser(
  res: Response,
  callback: (error: Error | null, body: string) => void,
): void {
  const stream = res as unknown as RawStream;
  let data = '';
  stream.setEncoding('utf8');
  stream.on('data', (chunk: string) => {
    data += chunk;
  });
  stream.on('end', () => {
    callback(null, data);
  });
}
