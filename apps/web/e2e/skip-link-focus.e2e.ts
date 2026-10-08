import { expect, test } from '@playwright/test';

const fixtureUser = {
  id: 'fixture-staff-viewer',
  username: 'fixture-staff-viewer',
  displayName: 'Fixture Staff Viewer',
  isActive: true,
  mustChangePassword: false,
  aiEnabled: false,
  aiDailyLimit: null,
  lastLoginAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  role: 'director',
  voicePart: 'none',
};

const pages = [
  { name: 'library', route: '/library' },
  { name: 'staff viewer', route: '/score/fixture-score' },
];

for (const width of [320, 390]) {
  for (const pageCase of pages) {
    test(`${pageCase.name}: skip-link focus and header targets at ${width}px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 844 });
      await page.route('**/api/**', async (route) => {
        const request = route.request();
        const requestUrl = new URL(request.url());

        if (
          requestUrl.pathname === '/api/auth/me' &&
          request.method() === 'GET'
        ) {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ user: fixtureUser }),
          });
          return;
        }

        await route.abort('blockedbyclient');
      });

      await page.goto(pageCase.route);
      const main = page.locator('main#main-content');
      await expect(main).toBeVisible();

      const headerTargets = [
        page.locator('.app-header > .brand'),
        page.locator('.app-header .app-nav__link'),
        page.locator('.app-header__account button'),
      ];
      for (const target of headerTargets) {
        await expect(target).toBeVisible();
        const bounds = await target.boundingBox();
        expect(bounds?.width).toBeGreaterThanOrEqual(44);
        expect(bounds?.height).toBeGreaterThanOrEqual(44);
      }

      const layout = await page.evaluate(() => ({
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: Math.max(
          document.documentElement.scrollWidth,
          document.body.scrollWidth
        ),
      }));
      expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth);

      const skipLink = page.getByRole('link', {
        name: 'Skip to main content',
      });
      await page.keyboard.press('Tab');
      await expect(skipLink).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(main).toBeFocused();
      await expect
        .poll(() =>
          main.evaluate((element) => element.matches(':focus-visible'))
        )
        .toBe(true);

      const focusStyle = await main.evaluate((element) => {
        const style = window.getComputedStyle(element);
        return {
          outlineStyle: style.outlineStyle,
          outlineWidth: style.outlineWidth,
          outlineOffset: style.outlineOffset,
        };
      });
      expect(focusStyle.outlineStyle).toBe('solid');
      expect(Number.parseFloat(focusStyle.outlineWidth)).toBeGreaterThanOrEqual(
        3
      );
      expect(focusStyle.outlineOffset).toBe('4px');
    });
  }
}
