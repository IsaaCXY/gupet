import {existsSync, readdirSync, statSync} from 'node:fs';
import path from 'node:path';
import {expect, test, _electron as electron} from '@playwright/test';

const findExecutable = (root: string): string | null => {
  if (!existsSync(root)) return null;
  for (const entry of readdirSync(root)) {
    const candidate = path.join(root, entry);
    if (process.platform === 'darwin' && candidate.endsWith('.app')) {
      return path.join(candidate, 'Contents', 'MacOS', 'Desktop Pet');
    }
    if (process.platform === 'win32' && candidate.endsWith('.exe') && !entry.toLowerCase().includes('setup')) {
      return candidate;
    }
    if (statSync(candidate).isDirectory()) {
      const nested = findExecutable(candidate);
      if (nested) return nested;
    }
  }
  return null;
};

test('packaged app opens the pet and receives settings updates', async () => {
  const executablePath = findExecutable(path.resolve('out'));
  test.skip(!executablePath, 'Run pnpm package before the packaged-app test.');
  if (!executablePath) return;

  const app = await electron.launch({executablePath});
  const pet = await app.firstWindow();
  const canvas = pet.locator('canvas');
  await expect(canvas).toBeVisible();
  const positionBeforeAnimations = await app.evaluate(({BrowserWindow}) => {
    const {x, y} = BrowserWindow.getAllWindows()[0].getBounds();
    return {x, y};
  });
  await expect(canvas).toHaveAttribute('data-animation', 'idle');
  await canvas.click({position: {x: 160, y: 160}});
  await expect(canvas).toHaveAttribute('data-animation', 'click-reaction');
  await expect(canvas).toHaveAttribute('data-animation', 'idle', {timeout: 2_000});
  const positionAfterAnimations = await app.evaluate(({BrowserWindow}) => {
    const {x, y} = BrowserWindow.getAllWindows()[0].getBounds();
    return {x, y};
  });
  expect(positionAfterAnimations).toEqual(positionBeforeAnimations);
  await canvas.hover({position: {x: 160, y: 160}});
  await pet.mouse.down();
  await pet.mouse.move(190, 190, {steps: 3});
  await pet.mouse.up();
  await expect(canvas).toBeVisible();
  const positionAfterDrag = await app.evaluate(({BrowserWindow}) => {
    const {x, y} = BrowserWindow.getAllWindows()[0].getBounds();
    return {x, y};
  });
  expect(Number.isSafeInteger(positionAfterDrag.x)).toBe(true);
  expect(Number.isSafeInteger(positionAfterDrag.y)).toBe(true);
  await app.evaluate(({BrowserWindow}) => {
    BrowserWindow.getAllWindows()[0].webContents.send('settings:changed', {
      petSize: 192,
      alwaysOnTop: true,
      snapEdges: true,
      snapThreshold: 24,
      launchAtLogin: false,
      motionMode: 'full',
    });
  });
  await expect(canvas).toHaveAttribute('aria-label', 'Penguin Suit Administrator (B.)');
  await app.close();
});
