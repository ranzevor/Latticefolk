import assert from 'node:assert/strict';
import test from 'node:test';
import { SimulationClock, type PlayerMovementInput } from '../src/world/simulationClock.js';

const east: PlayerMovementInput = { forward: 0, right: 1, sprint: false, directionX: 0, directionZ: -1 };

function fixture() {
  const clock = new SimulationClock();
  let elapsedMs = 0;
  let inputMs = 0;
  const step = (seconds: number, input: PlayerMovementInput | undefined) => {
    const durationMs = seconds * 1000;
    if (input) inputMs += durationMs;
    elapsedMs += durationMs;
  };
  const frame = (at: number) => clock.advance(at, step);
  const frameAt = (frameAt: number, handledAt: number) => clock.advanceFrame(frameAt, handledAt, step);
  return { clock, frame, frameAt, get elapsedMs() { return elapsedMs; }, get inputMs() { return inputMs; } };
}

test('clearInput discards the prior late-event offset but preserves unconsumed world time', () => {
  const f = fixture();
  f.frame(0);
  f.frame(5000);
  assert.equal(f.clock.consumedThroughMs, 2000);
  assert.equal(f.clock.diagnostics.pendingSeconds, 3);

  assert.equal(f.clock.recordEvent(1000, 5200, east), true);
  f.clock.clearInput();

  assert.equal(f.clock.recordEvent(5300, 5301, east), true);
  assert.equal(f.clock.recordEvent(5500, 5501, undefined), true);
  f.frameAt(5502, 5503);
  f.frameAt(5600, 5601);

  assert.equal(f.clock.consumedThroughMs, 5600);
  assert.equal(f.clock.diagnostics.pendingSeconds, 0);
  assert.ok(Math.abs(f.elapsedMs - 5600) < 1e-9, `elapsed=${f.elapsedMs}`);
  assert.ok(Math.abs(f.inputMs - 200) < 1e-9, `input=${f.inputMs}`);
});

test('partially late press/release preserves its full interval without replaying consumed time', () => {
  const f = fixture();
  f.frame(0);
  f.frame(5000);
  assert.equal(f.clock.consumedThroughMs, 2000);
  assert.equal(f.clock.recordEvent(1900, 5200, east), true);
  assert.equal(f.clock.recordEvent(2100, 5201, undefined), true);
  f.frameAt(5300, 5400);
  f.frameAt(5300, 5401);

  assert.equal(f.clock.consumedThroughMs, 5300);
  assert.ok(Math.abs(f.elapsedMs - 5300) < 1e-9, `elapsed=${f.elapsedMs}`);
  assert.ok(Math.abs(f.inputMs - 200) < 1e-9, `input=${f.inputMs}`);
});

test('suspension reset drops pre-suspension input and permits a fresh raw interval', () => {
  const f = fixture();
  f.frame(0);
  f.frame(5000);
  assert.equal(f.clock.recordEvent(1000, 5200, east), true);
  f.clock.reset();
  f.frame(10000);
  f.clock.recordEvent(10100, 10100, east);
  f.clock.recordEvent(10200, 10200, undefined);
  f.frame(10300);

  assert.ok(Math.abs(f.elapsedMs - 2300) < 1e-9, `elapsed=${f.elapsedMs}`);
  assert.ok(Math.abs(f.inputMs - 100) < 1e-9, `input=${f.inputMs}`);
  assert.equal(f.clock.diagnostics.resetReason, 'none');
});
