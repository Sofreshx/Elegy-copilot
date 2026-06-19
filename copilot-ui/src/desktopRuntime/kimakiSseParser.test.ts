import assert from 'node:assert/strict';
import test from 'node:test';

import { createKimakiSseParser } from './kimakiSseParser';

test('parses Kimaki non-TTY startup events across chunk boundaries', () => {
  const events: unknown[] = [];
  const parser = createKimakiSseParser((event) => events.push(event));

  parser.feed('noise\ndata: {"type":"install_url","url":"https://example.test/install"}\n');
  parser.feed('\ndata: {"type":"authorized","guild_id":"guild-1"}\n\n');
  parser.feed('data: {"type":"ready","app_id":"app-1","guild_ids":["guild-1"]}\n\n');

  assert.deepEqual(events, [
    { type: 'install_url', url: 'https://example.test/install' },
    { type: 'authorized', guild_id: 'guild-1' },
    { type: 'ready', app_id: 'app-1', guild_ids: ['guild-1'] },
  ]);
});
