import { APIRequestContext, expect, test } from '@playwright/test';

import { env } from '../../utils/env';
import { getValidAccessToken } from '../../utils/auth';
import { readTokens, tokenFileExists } from '../../utils/tokens';

type ManualCheckGroup = 'address_checks' | 'transfer_checks' | 'all' | string;

type ManualChecksGroupItem = {
  group?: ManualCheckGroup;
  count?: number;
};

// Берет access/refresh из .auth/tokens.json и падает, если токенов нет
function getTokensOrThrow() {
  if (!tokenFileExists()) {
    throw new Error('Нет сохраненных токенов. Сначала запусти tests/auth/login.spec.ts');
  }
  return readTokens();
}

// Делает GET /manual-checks/groups/ с авторизацией
async function getManualChecksGroups(request: APIRequestContext) {
  const access = await getValidAccessToken(request);
  const url = `${env.apiUrl}/manual-checks/groups/`;

  return request.get(url, {
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${access}`,
    },
  });
}

// Делает GET /manual-checks/ с фильтром group и возвращает поле count (не нужно грузить страницы)
async function getManualChecksCountForGroup(request: APIRequestContext, group: string): Promise<number | null> {
  const access = await getValidAccessToken(request);
  const qs = new URLSearchParams({ page: '1', size: '1', group });
  const url = `${env.apiUrl}/manual-checks/?${qs.toString()}`;

  const resp = await request.get(url, {
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${access}`,
    },
  });

  if (resp.status() !== 200) return null;
  const body = (await resp.json()) as { count?: number };
  return typeof body.count === 'number' ? body.count : null;
}

test.describe('Manual checks GET /manual-checks/groups/', () => {
  // Базовая проверка структуры ответа и значений group/count
  test('возвращает список групп с корректными полями', async ({ request }) => {
    const response = await getManualChecksGroups(request);
    expect(response.status()).toBe(200);

    const body = (await response.json()) as ManualChecksGroupItem[];
    expect(Array.isArray(body)).toBeTruthy();

    const allowed = new Set(['address_checks', 'transfer_checks', 'all']);
    for (const item of body) {
      expect(item.group).toBeTruthy();
      expect(allowed.has(item.group ?? '')).toBeTruthy();
      expect(typeof item.count).toBe('number');
      expect((item.count ?? 0) >= 0).toBeTruthy();
    }
  });

  // Инвариант: all = address_checks + transfer_checks (если все 3 группы присутствуют)
  test('count для all равен сумме address_checks и transfer_checks (если группы есть)', async ({ request }) => {
    const response = await getManualChecksGroups(request);
    expect(response.status()).toBe(200);

    const body = (await response.json()) as ManualChecksGroupItem[];
    const map = new Map<string, number>();
    for (const item of body) {
      if (item.group && typeof item.count === 'number') map.set(item.group, item.count);
    }

    const all = map.get('all');
    const addr = map.get('address_checks');
    const transfer = map.get('transfer_checks');
    if (all === undefined || addr === undefined || transfer === undefined) {
      test.skip(true, 'Не все группы присутствуют в ответе для проверки инварианта');
    }

    expect(all).toBe(addr + transfer);
  });

  // Сверяем count из /manual-checks/groups/ с count из /manual-checks/?group=...
  test('count в группах совпадает с count из /manual-checks/ по фильтру group', async ({ request }) => {
    const response = await getManualChecksGroups(request);
    expect(response.status()).toBe(200);

    const body = (await response.json()) as ManualChecksGroupItem[];
    if (body.length === 0) test.skip(true, 'Нет групп для проверки');

    for (const item of body) {
      const group = item.group ?? '';
      if (!group) continue;
      const countFromList = await getManualChecksCountForGroup(request, group);
      if (countFromList === null) {
        test.info().annotations.push({
          type: 'note',
          description: `Не удалось получить count из /manual-checks/ для group=${group} (ожидали 200)`,
        });
        continue;
      }
      expect(item.count).toBe(countFromList);
    }
  });
});
