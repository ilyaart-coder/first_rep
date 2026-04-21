import { expect, test } from '@playwright/test';

import { env } from '../../utils/env';
import { readTokens, saveTokens, tokenFileExists } from '../../utils/tokens';

test.describe('Auth /auth/update-token/', () => {
  // Обновление access/refresh токенов по refresh-токену и сохранение их в .auth/tokens.json
  test('refreshes access token using refresh token', async ({ request }) => {
    if (!tokenFileExists()) {
      throw new Error('No saved tokens found. Run tests/auth/login.spec.ts first.');
    }

    const tokens = readTokens();

    const response = await request.post(`${env.apiUrl}/auth/update-token/`, {
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
      },
      data: { refresh: tokens.refresh_token },
    });

    expect([200, 201]).toContain(response.status());

    const body = (await response.json()) as {
      access?: string;
      refresh?: string;
      access_token?: string;
      refresh_token?: string;
    };

    const access = body.access ?? body.access_token;
    const refresh = body.refresh ?? body.refresh_token ?? tokens.refresh_token;

    expect(access, 'access token should be present in refresh response').toBeTruthy();
    expect(refresh, 'refresh token should be present or preserved').toBeTruthy();

    saveTokens({
      access_token: access as string,
      refresh_token: refresh as string,
    });
  });
});
