import { APIRequestContext, expect, test } from '@playwright/test';

import { env } from '../../utils/env';
import { readTokens, tokenFileExists } from '../../utils/tokens';

type AlertsListResponse = {
  count?: number;
  next?: string | null;
  previous?: string | null;
  results?: AlertItem[];
};

type AlertItem = {
  id?: string;
  created_at?: string;
  occurred_at?: string;
  type?: string;
  client_ext_id?: string | null;
  risk_level?: string;
  status?: string;
  assignee_name?: string | null;
  fiat_currency?: string | null;
  entity_category?: string;
  proximity?: string;
  network_code?: string;
  risky_value?: number | null;
  risky_value_share?: number | null;
  asset?: string | null;
  amount?: number | null;
  fiat_value?: number | null;
  transfer?: string | null;
};

// Берет access/refresh из .auth/tokens.json и падает, если токенов нет
function getTokensOrThrow() {
  if (!tokenFileExists()) {
    throw new Error('Нет сохраненных токенов. Сначала запусти tests/auth/login.spec.ts');
  }

  return readTokens();
}

// Универсальный GET для /alerts/ с авторизацией
async function getAlerts(request: APIRequestContext, params: Record<string, string>) {
  const tokens = getTokensOrThrow();
  const search = new URLSearchParams(params);
  const url = `${env.apiUrl}/alerts/?${search.toString()}`;

  return request.get(url, {
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${tokens.access_token}`,
    },
  });
}

// Возвращает первый алерт из базового списка, если он есть
async function getSampleAlert(request: APIRequestContext) {
  const response = await getAlerts(request, { group: 'my_alerts', page: '1', size: '10' });
  expect(response.status(), 'Базовый список алертов должен возвращать 200').toBe(200);
  const body = (await response.json()) as AlertsListResponse;
  const first = body.results?.[0];

  return { body, first };
}

// Ищет первый алерт с ненулевым asset (по нескольким страницам)
async function getAlertWithAsset(request: APIRequestContext) {
  const pagesToScan = ['1', '2', '3'];
  for (const page of pagesToScan) {
    const response = await getAlerts(request, { group: 'my_alerts', page, size: '20' });
    if (response.status() !== 200) continue;
    const body = (await response.json()) as AlertsListResponse;
    const found = (body.results ?? []).find(a => a.asset);
    if (found?.asset) {
      return found;
    }
  }

  return null;
}

test.describe('Alerts /alerts/', () => {
  // Базовая проверка структуры ответа и обязательных полей у элементов
  test('возвращает список и поля алерта', async ({ request }) => {
    const response = await getAlerts(request, { group: 'my_alerts', page: '1', size: '10' });
    expect(response.status()).toBe(200);

    const body = (await response.json()) as AlertsListResponse;
    expect(Array.isArray(body.results)).toBeTruthy();
    expect(typeof body.count === 'number' || body.count === undefined).toBeTruthy();

    const item = body.results?.[0];
    if (!item) return;

    expect(item.id).toBeTruthy();
    expect(item.created_at).toBeTruthy();
    expect(item.occurred_at).toBeTruthy();
    expect(item.type).toBeTruthy();
    expect(item.risk_level).toBeTruthy();
    expect(item.status).toBeTruthy();
    expect(item.entity_category).toBeTruthy();
    expect(item.proximity).toBeTruthy();
    expect(item.network_code).toBeTruthy();
    expect(item.risky_value_share === null || typeof item.risky_value_share === 'number').toBeTruthy();
  });

  // Фильтр по статусу (status)
  test('фильтр status возвращает алерты только с этим статусом', async ({ request }) => {
    const { first } = await getSampleAlert(request);
    if (!first?.status) test.skip(true, 'Нет алертов для проверки status');

    const response = await getAlerts(request, { group: 'my_alerts', status: first.status, page: '1', size: '10' });
    expect(response.status()).toBe(200);

    const body = (await response.json()) as AlertsListResponse;
    for (const alert of body.results ?? []) {
      expect(alert.status).toBe(first.status);
    }
  });

  // Статусы: open
  test('статус open возвращает только open', async ({ request }) => {
    const response = await getAlerts(request, { status: 'open', page: '1', size: '10' });
    expect(response.status()).toBe(200);

    const body = (await response.json()) as AlertsListResponse;
    for (const alert of body.results ?? []) {
      expect(alert.status).toBe('open');
    }
  });

  // Статусы: in_progress
  test('статус in_progress возвращает только in_progress', async ({ request }) => {
    const response = await getAlerts(request, { status: 'in_progress', page: '1', size: '10' });
    expect(response.status()).toBe(200);

    const body = (await response.json()) as AlertsListResponse;
    for (const alert of body.results ?? []) {
      expect(alert.status).toBe('in_progress');
    }
  });

  // Статусы: done
  test('статус done возвращает только done', async ({ request }) => {
    const response = await getAlerts(request, { status: 'done', page: '1', size: '10' });
    expect(response.status()).toBe(200);

    const body = (await response.json()) as AlertsListResponse;
    for (const alert of body.results ?? []) {
      expect(alert.status).toBe('done');
    }
  });

  // Фильтр по уровню риска (risk_level)
  test('фильтр risk_level возвращает алерты только с этим уровнем', async ({ request }) => {
    const { first } = await getSampleAlert(request);
    if (!first?.risk_level) test.skip(true, 'Нет алертов для проверки risk_level');

    const response = await getAlerts(request, { group: 'my_alerts', risk_level: first.risk_level, page: '1', size: '10' });
    expect(response.status()).toBe(200);

    const body = (await response.json()) as AlertsListResponse;
    for (const alert of body.results ?? []) {
      expect(alert.risk_level).toBe(first.risk_level);
    }
  });

  // Фильтр по типу (type)
  test('фильтр type возвращает алерты только этого типа', async ({ request }) => {
    const { first } = await getSampleAlert(request);
    if (!first?.type) test.skip(true, 'Нет алертов для проверки type');

    const response = await getAlerts(request, { group: 'my_alerts', type: first.type, page: '1', size: '10' });
    expect(response.status()).toBe(200);

    const body = (await response.json()) as AlertsListResponse;
    for (const alert of body.results ?? []) {
      expect(alert.type).toBe(first.type);
    }
  });

  // Фильтр по близости (proximity)
  test('фильтр proximity возвращает алерты только с этой близостью', async ({ request }) => {
    const { first } = await getSampleAlert(request);
    if (!first?.proximity) test.skip(true, 'Нет алертов для проверки proximity');

    const response = await getAlerts(request, { group: 'my_alerts', proximity: first.proximity, page: '1', size: '10' });
    expect(response.status()).toBe(200);

    const body = (await response.json()) as AlertsListResponse;
    for (const alert of body.results ?? []) {
      expect(alert.proximity).toBe(first.proximity);
    }
  });

  // Фильтр по сети (network_code)
  test('фильтр network_code возвращает алерты только по этой сети', async ({ request }) => {
    const { first } = await getSampleAlert(request);
    if (!first?.network_code) test.skip(true, 'Нет алертов для проверки network_code');

    const response = await getAlerts(request, { group: 'my_alerts', network_code: first.network_code, page: '1', size: '10' });
    expect(response.status()).toBe(200);

    const body = (await response.json()) as AlertsListResponse;
    for (const alert of body.results ?? []) {
      expect(alert.network_code).toBe(first.network_code);
    }
  });

  // Фильтр по активу (asset)
  test('фильтр asset возвращает алерты только с этим активом', async ({ request }) => {
    const firstWithAsset = await getAlertWithAsset(request);
    if (!firstWithAsset?.asset) test.skip(true, 'Нет алертов с заполненным asset для проверки');

    const response = await getAlerts(request, { group: 'my_alerts', asset: firstWithAsset.asset, page: '1', size: '10' });
    expect(response.status()).toBe(200);

    const body = (await response.json()) as AlertsListResponse;
    for (const alert of body.results ?? []) {
      expect(alert.asset).toBe(firstWithAsset.asset);
    }
  });

  // Фильтр по диапазону дат (date_from/date_to) на основе created_at первого алерта
  test('фильтр date_from/date_to ограничивает результаты по дате', async ({ request }) => {
    const { first } = await getSampleAlert(request);
    if (!first?.created_at) test.skip(true, 'Нет алертов для проверки date_from/date_to');

    const createdAt = new Date(first.created_at);
    const dateOnly = first.created_at.split('T')[0];
    const from = new Date(createdAt);
    const to = new Date(createdAt);
    to.setDate(to.getDate() + 1);

    const response = await getAlerts(request, {
      group: 'my_alerts',
      date_from: dateOnly,
      date_to: dateOnly,
      page: '1',
      size: '10',
    });

    if (response.status() === 400) {
      test.skip(true, 'API не принял формат date_from/date_to (ожидается другой формат)');
    }
    expect(response.status()).toBe(200);
    const body = (await response.json()) as AlertsListResponse;

    for (const alert of body.results ?? []) {
      if (!alert.created_at) continue;
      const d = new Date(alert.created_at).getTime();
      expect(d).toBeGreaterThanOrEqual(from.getTime());
      expect(d).toBeLessThanOrEqual(to.getTime());
    }
  });

  // Фильтр search по ID алерта
  test('search по ID возвращает нужный алерт', async ({ request }) => {
    const { first } = await getSampleAlert(request);
    if (!first?.id) test.skip(true, 'Нет алертов для проверки search');

    const response = await getAlerts(request, { group: 'my_alerts', search: first.id, page: '1', size: '10' });
    expect(response.status()).toBe(200);

    const body = (await response.json()) as AlertsListResponse;
    const ids = (body.results ?? []).map(a => a.id);
    expect(ids).toContain(first.id);
  });

  // Фильтр archived=false должен работать без ошибок
  test('фильтр archived=false возвращает данные без ошибок', async ({ request }) => {
    const response = await getAlerts(request, { group: 'my_alerts', archived: 'false', page: '1', size: '10' });
    expect(response.status()).toBe(200);
  });

  // Фильтр group=active_alerts должен работать без ошибок
  test('группа active_alerts возвращается без ошибок', async ({ request }) => {
    const response = await getAlerts(request, { group: 'active_alerts', page: '1', size: '10' });
    expect(response.status()).toBe(200);
  });

  // Группа active_alerts: статусы не должны быть done
  test('группа active_alerts не должна содержать done', async ({ request }) => {
    const response = await getAlerts(request, { group: 'active_alerts', page: '1', size: '10' });
    expect(response.status()).toBe(200);

    const body = (await response.json()) as AlertsListResponse;
    for (const alert of body.results ?? []) {
      expect(alert.status).not.toBe('done');
    }
  });

  // Группа my_alerts: все алерты назначены на текущего пользователя
  test('группа my_alerts возвращает алерты с assignee_name = ilya.art', async ({ request }) => {
    const response = await getAlerts(request, { group: 'my_alerts', page: '1', size: '10' });
    expect(response.status()).toBe(200);

    const body = (await response.json()) as AlertsListResponse;
    for (const alert of body.results ?? []) {
      expect(alert.assignee_name).toBe('ilya.art');
    }
  });

  // Негатив: неверный status
  test('невалидный status возвращает 400 или пустой результат', async ({ request }) => {
    const response = await getAlerts(request, { status: 'invalid_status', page: '1', size: '10' });
    if (response.status() === 400) return;
    expect(response.status()).toBe(200);
    const body = (await response.json()) as AlertsListResponse;
    expect((body.results ?? []).length).toBe(0);
  });

  // Негатив: неверный risk_level
  test('невалидный risk_level возвращает 400 или пустой результат', async ({ request }) => {
    const response = await getAlerts(request, { risk_level: 'invalid_risk', page: '1', size: '10' });
    if (response.status() === 400) return;
    expect(response.status()).toBe(200);
    const body = (await response.json()) as AlertsListResponse;
    expect((body.results ?? []).length).toBe(0);
  });
});
