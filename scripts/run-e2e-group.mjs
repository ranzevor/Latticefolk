import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

// Keep serial files together on separate runners: each runner owns one SQLite world.
// These groups balance observed completion windows, not measured parallel run times.
// Check discovery without a browser: node scripts/run-e2e-group.mjs --list-only
const groups = {
  A: ['baking-oven', 'environment-presentation', 'playable-smoke', 'player-input-clock', 'weather-persistence'],
  B: ['coarse-presentation', 'npc-baking-stance', 'portable-objects', 'semantic-furniture',
    'visible-well', 'water-patch', 'wildlife-presentation', 'world-randomness']
};
const root = fileURLToPath(new URL('../', import.meta.url));
const cli = createRequire(import.meta.url).resolve('@playwright/test/cli');
const files = group => groups[group].map(name => `e2e/${name}\\.spec\\.ts$`);
const baseArgs = [cli, 'test', '--workers=1', '--forbid-only'];

function discover(filters = []) {
  const result = spawnSync(process.execPath, [...baseArgs, '--list', '--reporter=json', ...filters], {
    cwd: root, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024
  });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, `Playwright discovery failed: ${result.stderr}`);
  const report = JSON.parse(result.stdout);
  assert.equal(report.errors.length, 0, 'Playwright discovery reported errors');
  const cases = [];
  function visit(suites) {
    for (const suite of suites) {
      for (const spec of suite.specs) {
        for (const test of spec.tests) cases.push(JSON.stringify([spec.file, spec.id, test.projectId]));
      }
      visit(suite.suites || []);
    }
  }
  visit(report.suites);
  return cases;
}

export function verifyCoverage(all, partitions) {
  const unique = (cases, name) => {
    assert(cases.length > 0, `${name} has no tests`);
    const ids = new Set(cases);
    assert.equal(ids.size, cases.length, `${name} has duplicate tests`);
    return ids;
  };
  const expected = unique(all, 'Unrestricted discovery');
  const covered = new Set();
  for (const [group, cases] of Object.entries(partitions)) {
    for (const id of unique(cases, `Group ${group}`)) {
      assert(expected.has(id), `Group ${group} contains an unknown test: ${id}`);
      assert(!covered.has(id), `Test appears in multiple groups: ${id}`);
      covered.add(id);
    }
  }
  const missing = [...expected].filter(id => !covered.has(id));
  assert.equal(missing.length, 0, `Tests missing from groups: ${missing.join(', ')}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [group, ...extra] = process.argv.slice(2);
  assert(extra.length === 0 && (Object.hasOwn(groups, group) || group === '--list-only'),
    'Usage: node scripts/run-e2e-group.mjs A|B|--list-only');
  const all = discover();
  const partitions = Object.fromEntries(Object.keys(groups).map(key => [key, discover(files(key))]));
  verifyCoverage(all, partitions);
  console.log(`E2E coverage verified: A=${partitions.A.length}, B=${partitions.B.length}, ` +
    `union=${all.length}, overlap=0, missing=0`);
  if (group !== '--list-only') {
    const result = spawnSync(process.execPath, [...baseArgs, ...files(group)], { cwd: root, stdio: 'inherit' });
    if (result.error) throw result.error;
    process.exitCode = result.status ?? 1;
  }
}
