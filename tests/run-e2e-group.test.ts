import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const { verifyCoverage } = await import(new URL('../scripts/run-e2e-group.mjs', import.meta.url).href) as {
  verifyCoverage: (all: string[], partitions: Record<string, string[]>) => void;
};
const root = fileURLToPath(new URL('../', import.meta.url));
const script = fileURLToPath(new URL('../scripts/run-e2e-group.mjs', import.meta.url));

test('coverage accepts disjoint groups containing every discovered test', () => {
  assert.doesNotThrow(() => verifyCoverage(['one', 'two', 'three'], {
    A: ['three', 'one'], B: ['two']
  }));
});

test('coverage rejects empty unrestricted discovery and empty groups', () => {
  assert.throws(() => verifyCoverage([], { A: ['one'], B: ['two'] }),
    /Unrestricted discovery has no tests/);
  assert.throws(() => verifyCoverage(['one'], { A: [], B: ['one'] }), /Group A has no tests/);
  assert.throws(() => verifyCoverage(['one'], { A: ['one'], B: [] }), /Group B has no tests/);
});

test('coverage rejects duplicate tests in discovery or either group', () => {
  assert.throws(() => verifyCoverage(['one', 'one'], { A: ['one'], B: ['two'] }),
    /Unrestricted discovery has duplicate tests/);
  assert.throws(() => verifyCoverage(['one', 'two'], { A: ['one', 'one'], B: ['two'] }),
    /Group A has duplicate tests/);
  assert.throws(() => verifyCoverage(['one', 'two'], { A: ['one'], B: ['two', 'two'] }),
    /Group B has duplicate tests/);
});

test('coverage rejects unknown tests, overlap and missing tests', () => {
  assert.throws(() => verifyCoverage(['one', 'two'], { A: ['unknown'], B: ['two'] }),
    /Group A contains an unknown test: unknown/);
  assert.throws(() => verifyCoverage(['one', 'two'], { A: ['one'], B: ['unknown'] }),
    /Group B contains an unknown test: unknown/);
  assert.throws(() => verifyCoverage(['one', 'two'], { A: ['one'], B: ['one', 'two'] }),
    /Test appears in multiple groups: one/);
  assert.throws(() => verifyCoverage(['one', 'two', 'three'], { A: ['one'], B: ['two'] }),
    /Tests missing from groups: three/);
});

test('group CLI rejects missing, unknown and extra arguments', () => {
  for (const args of [[], ['C'], ['a'], ['--help'], ['A', '--list-only'], ['--list-only', 'extra']]) {
    const result = spawnSync(process.execPath, [script, ...args], {
      cwd: root, encoding: 'utf8', timeout: 10_000
    });
    assert.ifError(result.error);
    assert.notEqual(result.status, 0, JSON.stringify(args));
    assert.equal(result.signal, null);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /Usage: node scripts\/run-e2e-group\.mjs A\|B\|--list-only/);
  }
});

test('list-only validates real Playwright discovery without success output', { timeout: 60_000 }, () => {
  const result = spawnSync(process.execPath, [script, '--list-only'], {
    cwd: root, encoding: 'utf8', timeout: 55_000
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.signal, null);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, '');
});
