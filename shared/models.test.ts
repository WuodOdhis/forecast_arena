import test from 'node:test';
import assert from 'node:assert/strict';
import { askModel } from './models.js';

test('model request names the selected chain in its forecasting prompt', async (t) => {
  const originalFetch = globalThis.fetch;
  let requestBody: { messages: { role: string; content: string }[] } | undefined;
  globalThis.fetch = async (_input, init) => {
    requestBody = JSON.parse(String(init?.body));
    return Response.json({
      model: 'test-model',
      choices: [{ message: { content: '{"prediction":42,"reasoning":"test"}' } }],
    });
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  await askModel('test-model', { blocks: [] }, 60, 'test-key', 'BOT Chain');
  const prompt = requestBody?.messages.find((message) => message.role === 'user')?.content;
  assert.match(prompt ?? '', /BOT Chain transactions/);
  assert.doesNotMatch(prompt ?? '', /BOT testnet/);
});
