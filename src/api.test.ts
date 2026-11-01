import test from 'node:test';
import assert from 'node:assert/strict';
import { apiUrl } from './api.js';

test('API paths stay same-origin unless a staging base is configured', () => {
  assert.equal(apiUrl('/api/status'), '/api/status');
  assert.throws(() => apiUrl('https://example.com/api/status'), /must start with/);
});
