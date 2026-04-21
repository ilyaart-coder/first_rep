import { request as pwRequest } from '@playwright/test';

import { env } from './utils/env';
import { getValidAccessToken } from './utils/auth';
import { readTokens, saveTokens, tokenFileExists } from './utils/tokens';

// Глобальная подготовка: обновляет access_token через refresh_token перед запуском тестов.
// Это решает массовые 401, когда access_token истек, но refresh еще жив.
export default async function globalSetup() {
  const argv = process.argv.join(' ');
  const isLoginRun = argv.includes('login.spec.ts');

  // Для прогона UI-логина токены могут быть отсутствовать/протухнуть — не блокируем этот тест.
  if (isLoginRun) {
    return;
  }

  if (!tokenFileExists()) {
    throw new Error('Нет .auth/tokens.json. Сначала запусти: npx.cmd playwright test tests/auth/login.spec.ts');
  }

  const api = await pwRequest.newContext();
  try {
    // 1) Обновляем токен по exp (если нужно)
    const access = await getValidAccessToken(api);

    // 2) Дополнительная проверка: если токен отозван и API вернет 401, обновим еще раз и проверим повторно.
    const infoUrl = `${env.apiUrl}/user/info/`;
    const infoResp = await api.get(infoUrl, { headers: { accept: 'application/json', authorization: `Bearer ${access}` } });
    if (infoResp.status() === 401) {
      const tokens = readTokens();
      const refreshed = await api.post(`${env.apiUrl}/auth/update-token/`, {
        headers: { accept: 'application/json', 'content-type': 'application/json' },
        data: { refresh: tokens.refresh_token },
      });
      if (refreshed.status() === 401) {
        throw new Error('Refresh token истек/отозван. Запусти tests/auth/login.spec.ts для получения новых токенов.');
      }
      if (![200, 201].includes(refreshed.status())) {
        throw new Error(`Неожиданный статус при refresh: ${refreshed.status()}`);
      }
      const body = (await refreshed.json()) as any;
      const newAccess = body.access ?? body.access_token;
      const newRefresh = body.refresh ?? body.refresh_token;
      if (newAccess && newRefresh) saveTokens({ access_token: newAccess, refresh_token: newRefresh });
    }
  } finally {
    await api.dispose();
  }
}
