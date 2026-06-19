import { createParser, type EventSourceParser } from 'eventsource-parser';

export type KimakiProgrammaticEvent =
  | { type: 'install_url'; url: string }
  | { type: 'authorized'; guild_id: string }
  | { type: 'ready'; app_id: string; guild_ids: string[] }
  | { type: 'error'; message: string; install_url?: string };

export interface KimakiSseParser {
  feed: (chunk: string) => void;
  reset: () => void;
}
export function createKimakiSseParser(
  onEvent: (event: KimakiProgrammaticEvent) => void,
): KimakiSseParser {
  const parser: EventSourceParser = createParser({
    onEvent(event) {
      try {
        const parsed = JSON.parse(event.data) as KimakiProgrammaticEvent;
        if (
          parsed
          && typeof parsed === 'object'
          && ['install_url', 'authorized', 'ready', 'error'].includes(parsed.type)
        ) {
          onEvent(parsed);
        }
      } catch {
        // Kimaki documents that non-SSE process output may be interleaved with events.
      }
    },
  });

  return {
    feed: (chunk: string) => parser.feed(chunk),
    reset: () => parser.reset(),
  };
}
