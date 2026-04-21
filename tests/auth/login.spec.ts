import { expect, test } from '@playwright/test';

import { env } from '../../utils/env';
import { readTokens, saveTokens, tokenFileExists } from '../../utils/tokens';

test.describe('Auth /auth/email/sign-in/', () => {
  // Логин через UI, перехват ответа /auth/email/sign-in/ и сохранение access/refresh токенов
  test('logs in via UI and saves access and refresh tokens', async ({ page }) => {
    const signInResponsePromise = page.waitForResponse((response) => {
      return response.url().includes('/v1/auth/email/sign-in/') && response.request().method() === 'POST';
    });

    await page.goto(`${env.appUrl}/sign-in`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.auth-box')).toBeVisible();

    await page.locator('#username').fill(env.email);
    await page.locator('input[name="password"]').fill(env.password);
    await expect(page.getByRole('button', { name: /log in|sign in|войти/i })).toBeEnabled();
    await page.getByRole('button', { name: /log in|sign in|войти/i }).click();

    const signInResponse = await signInResponsePromise;
    expect(signInResponse.ok()).toBeTruthy();

    const body = (await signInResponse.json()) as {
      access_token?: string;
      refresh_token?: string;
    };

    expect(body.access_token, 'access_token should be present in login response').toBeTruthy();
    expect(body.refresh_token, 'refresh_token should be present in login response').toBeTruthy();

    saveTokens({
      access_token: body.access_token as string,
      refresh_token: body.refresh_token as string,
    });

    expect(tokenFileExists()).toBeTruthy();

    const savedTokens = readTokens();
    expect(savedTokens.access_token).toBe(body.access_token);
    expect(savedTokens.refresh_token).toBe(body.refresh_token);

    await expect(page).not.toHaveURL(/\/sign-in$/);
  });
});
