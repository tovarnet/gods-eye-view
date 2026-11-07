import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeMetrobusNetwork } from './model.js';
import { loadBundledMetrobusNetwork } from './source.js';

test('bundled payload decodes to the expected 2026 Metrobús network', async () => {
  const raw = await loadBundledMetrobusNetwork();
  const network = normalizeMetrobusNetwork(raw);
  assert.equal(network.routes.length, 89);
  assert.equal(network.stations.length, 378);
  assert.deepEqual(
    network.lines.map((line) => line.id),
    ['1', '2', '3', '4', '5', '6', '7'],
  );
});
