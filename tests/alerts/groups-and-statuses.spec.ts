import { APIRequestContext, expect, test } from '@playwright/test';

import { env } from '../../utils/env';
import { readTokens, tokenFileExists } from '../../utils/tokens';

type GroupsAndStatusesItem = {
  group?: string | null;
  status?: string | null;
  count?: number;
};

// Берет access/refresh из .auth/tokens.json и падает, если токенов нет
function getTokensOrThrow() {
  if (!tokenFileExists()) {
    throw new Error('Нет сохраненных токенов. Сначала запусти tests/auth/login.spec.ts');
  }

  return readTokens();
}

// Универсальный GET для /alerts/groups-and-statuses/ с авторизацией
async function getGroupsAndStatuses(request: APIRequestContext, params: Record<string, string> = {}) {
  const tokens = getTokensOrThrow();
  const search = new URLSearchParams(params);
  const suffix = search.toString() ? `?${search.toString()}` : '';
  const url = `${env.apiUrl}/alerts/groups-and-statuses/${suffix}`;

  return request.get(url, {
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${tokens.access_token}`,
    },
  });
}

// Получает count из /alerts/ по параметрам
async function getAlertsCount(request: APIRequestContext, params: Record<string, string>) {
  const tokens = getTokensOrThrow();
  const search = new URLSearchParams(params);
  const url = `${env.apiUrl}/alerts/?${search.toString()}`;

  const response = await request.get(url, {
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${tokens.access_token}`,
    },
  });

  expect(response.status()).toBe(200);
  const body = (await response.json()) as { count?: number };
  return body.count ?? 0;
}

test.describe('Alerts /alerts/groups-and-statuses/', () => {
  // Базовая проверка структуры и правил: либо group, либо status; count > 0
  test('возвращает список групп/статусов с валидной структурой', async ({ request }) => {
    const response = await getGroupsAndStatuses(request);
    expect(response.status()).toBe(200);

    const body = (await response.json()) as GroupsAndStatusesItem[];
    expect(Array.isArray(body)).toBeTruthy();

    for (const item of body) {
      const hasGroup = !!item.group;
      const hasStatus = !!item.status;
      expect(hasGroup || hasStatus).toBeTruthy();
      expect(!(hasGroup && hasStatus)).toBeTruthy();
      expect(typeof item.count).toBe('number');
      expect((item.count ?? 0) > 0).toBeTruthy();
    }
  });

  // Сверяем group=my_alerts с /alerts/?group=my_alerts
  test('count для group=my_alerts совпадает с /alerts/', async ({ request }) => {
    const response = await getGroupsAndStatuses(request);
    expect(response.status()).toBe(200);

    const body = (await response.json()) as GroupsAndStatusesItem[];
    const entry = body.find(i => i.group === 'my_alerts');
    if (!entry) test.skip(true, 'Нет group=my_alerts в ответе');

    const count = await getAlertsCount(request, { group: 'my_alerts', page: '1', size: '10' });
    expect(entry?.count).toBe(count);
  });

  // Сверяем group=active_alerts с /alerts/?group=active_alerts
  test('count для group=active_alerts совпадает с /alerts/', async ({ request }) => {
    const response = await getGroupsAndStatuses(request);
    expect(response.status()).toBe(200);

    const body = (await response.json()) as GroupsAndStatusesItem[];
    const entry = body.find(i => i.group === 'active_alerts');
    if (!entry) test.skip(true, 'Нет group=active_alerts в ответе');

    const count = await getAlertsCount(request, { group: 'active_alerts', page: '1', size: '10' });
    expect(entry?.count).toBe(count);
  });

  // Сверяем count по статусам с /alerts/?status=...
  test('count для status=open совпадает с /alerts/', async ({ request }) => {
    const response = await getGroupsAndStatuses(request);
    expect(response.status()).toBe(200);

    const body = (await response.json()) as GroupsAndStatusesItem[];
    const entry = body.find(i => i.status === 'open');
    if (!entry) test.skip(true, 'Нет status=open в ответе');

    const count = await getAlertsCount(request, { status: 'open', page: '1', size: '10' });
    expect(entry?.count).toBe(count);
  });

  test('count для status=in_progress совпадает с /alerts/', async ({ request }) => {
    const response = await getGroupsAndStatuses(request);
    expect(response.status()).toBe(200);

    const body = (await response.json()) as GroupsAndStatusesItem[];
    const entry = body.find(i => i.status === 'in_progress');
    if (!entry) test.skip(true, 'Нет status=in_progress в ответе');

    const count = await getAlertsCount(request, { status: 'in_progress', page: '1', size: '10' });
    expect(entry?.count).toBe(count);
  });

  test('count для status=done совпадает с /alerts/', async ({ request }) => {
    const response = await getGroupsAndStatuses(request);
    expect(response.status()).toBe(200);

    const body = (await response.json()) as GroupsAndStatusesItem[];
    const entry = body.find(i => i.status === 'done');
    if (!entry) test.skip(true, 'Нет status=done в ответе');

    const count = await getAlertsCount(request, { status: 'done', page: '1', size: '10' });
    expect(entry?.count).toBe(count);
  });
});
