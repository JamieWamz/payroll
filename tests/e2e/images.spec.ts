import { test, expect } from '@playwright/test';

test('public CDN photography loads under the deployed image policy', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  const image = page.locator('.access-photo img');
  await expect(image).toHaveAttribute('referrerpolicy', 'no-referrer');
  await expect(image).toHaveAttribute('crossorigin', 'anonymous');
  await expect
    .poll(
      () =>
        image.evaluate(
          (element: HTMLImageElement) =>
            element.complete && element.naturalWidth > 0,
        ),
      { timeout: 30000 },
    )
    .toBe(true);
  await page.screenshot({
    path: testInfo.outputPath('login-cdn-desktop.png'),
    fullPage: true,
  });
});

test('login remains usable when decorative CDN images fail', async ({
  page,
}, testInfo) => {
  await page.route('https://images.unsplash.com/**', (route) => route.abort());
  const response = await page.goto('/');
  const policy = response?.headers()['content-security-policy'];
  expect(policy).toContain("img-src 'self' data: https://images.unsplash.com");
  expect(policy).toContain("script-src 'self'");
  await expect(page.locator('.access-photo')).toHaveAttribute(
    'data-image-state',
    'fallback',
  );
  await expect(page.locator('.access-photo img')).toHaveCount(0);
  await page.getByLabel('Email address').fill('image-fallback@example.com');
  await page
    .getByLabel('Password', { exact: true })
    .fill('Synthetic image fallback password');
  await expect(
    page.getByRole('button', { name: 'Sign in', exact: true }),
  ).toBeEnabled();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath('login-cdn-fallback-mobile.png'),
    fullPage: true,
  });
});
