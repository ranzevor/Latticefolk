import { expect, type Page } from '@playwright/test';

/**
 * Activate the real start button without an absolute CDP mouse move immediately
 * preceding pointer lock. The Chromium runner can deliver that positioning event
 * after lock, rotating the camera before a direction-sensitive movement scenario.
 *
 * This is native keyboard activation of the existing click handler, not a direct
 * requestPointerLock/game/camera call. Mouse-start and relative-look interaction
 * coverage remains in the furniture and visible-well scenarios.
 */
export async function startFirstPerson(page:Page) {
  const start=page.locator('#startBtn');
  await expect(start).toBeVisible();
  await expect(start).toBeEnabled();
  await start.press('Enter');
  await expect(page.locator('#startOverlay')).toHaveClass(/hidden/);
  await page.waitForFunction(
    ()=>document.pointerLockElement?.tagName==='CANVAS',
    undefined,
    {timeout:15_000}
  );
}
