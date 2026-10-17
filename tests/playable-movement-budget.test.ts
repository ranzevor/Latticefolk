import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const source = fs.readFileSync(new URL('../e2e/playable-smoke.spec.ts', import.meta.url), 'utf8');
const ast = ts.createSourceFile('playable-smoke.spec.ts', source, ts.ScriptTarget.Latest, true);
const method = ast.statements.find((node): node is ts.FunctionDeclaration =>
  ts.isFunctionDeclaration(node) && node.name?.text === 'drivePlayerTo');
assert.ok(method);
const code = ts.transpileModule(`${method.getText(ast)}\nreturn drivePlayerTo;`, {
  compilerOptions: {target: ts.ScriptTarget.ES2022}
}).outputText;
const expect = (actual: unknown) => ({
  toBe: (expected: unknown) => assert.equal(actual, expected),
  toBeLessThanOrEqual: (maximum: number) => assert.ok(typeof actual === 'number' && actual <= maximum)
});
const helper = () => {};
const drive = new Function('expect', 'driveNativeWaypoint', code)(expect, helper);

for (const budget of [18, 25]) {
  test(`playable route forwards the ${budget}s input ceiling`, async () => {
    const target = {x: 5.2, z: 4};
    const result = {reached: true, x: 5.2, z: 4, inputSeconds: budget};
    const page = {evaluate: async (callback: unknown, request: unknown) => {
      assert.equal(callback, helper);
      assert.deepEqual(request, {target, timeoutMs: 45000, tolerance: .55, maxInputSeconds: budget});
      return result;
    }};
    assert.equal(await drive(page, target, 45000, .55, budget), result);
  });
  test(`playable route rejects reached output exceeding the ${budget}s input ceiling`, async () => {
    const page = {evaluate: async () => ({reached: true, x: 5.2, z: 4, inputSeconds: budget + .001})};
    await assert.rejects(drive(page, {x: 5.2, z: 4}, 45000, .55, budget), assert.AssertionError);
  });
}

test('both previously widened playable routes have explicit input ceilings', () => {
  const calls: ts.CallExpression[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && node.expression.getText(ast) === 'drivePlayerTo') calls.push(node);
    ts.forEachChild(node, visit);
  };
  visit(ast);
  const bounded = calls.filter(call => call.arguments[2]?.getText(ast) === '45_000');
  assert.equal(bounded.length, 2);
  assert.deepEqual(bounded.map(call => call.arguments[4]?.getText(ast)), ['18', '25']);
  assert.deepEqual(bounded.map(call => call.arguments[1].getText(ast)), ['{x:5.2,z:4.0}', '{x:13.95,z:3.4}']);
  assert.deepEqual(bounded.map(call => call.arguments[3].getText(ast)), ['.55', '.45']);
});

test('arrival failure remains a failure within the input ceiling', async () => {
  const page = {evaluate: async () => ({reached: false, x: 0, z: 0, inputSeconds: 1})};
  await assert.rejects(drive(page, {x: 5.2, z: 4}, 45000, .55, 18), assert.AssertionError);
});
