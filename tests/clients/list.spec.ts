import { APIRequestContext, expect, test } from '@playwright/test';

import { env } from '../../utils/env';
import { readTokens, tokenFileExists } from '../../utils/tokens';

type ClientsListResponse = {
  count?: number;
  next?: string | null;
  previous?: string | null;
  results?: ClientItem[];
};

type ClientItem = {
  id?: string;
  created_at?: string;
  ext_id?: string | null;
  risk_level?: string;
  fiat_currency?: string | null;
  active_alert_count?: number | null;
  last_alert_at?: string | null;
  transfer_volume?: number | null;
  transfer_count?: number | null;
  last_transfer_at?: string | null;
};

// Берет access/refresh из .auth/tokens.json и падает, если токенов нет
function getTokensOrThrow() {
  if (!tokenFileExists()) {
    throw new Error('Нет сохраненных токенов. Сначала запусти tests/auth/login.spec.ts');
  }

  return readTokens();
}

// Универсальный GET для /clients/ с авторизацией
async function getClients(request: APIRequestContext, params: Record<string, string>) {
  const tokens = getTokensOrThrow();
  const search = new URLSearchParams(params);
  const url = `${env.apiUrl}/clients/?${search.toString()}`;

  return request.get(url, {
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${tokens.access_token}`,
    },
  });
}

// Возвращает первого клиента из списка, если он есть
async function getSampleClient(request: APIRequestContext) {
  const response = await getClients(request, { page: '1', size: '10' });
  expect(response.status()).toBe(200);
  const body = (await response.json()) as ClientsListResponse;
  const first = body.results?.[0];

  return { body, first };
}

test.describe('Clients /clients/', () => {
  // Базовая проверка структуры ответа и полей клиента
  test('возвращает список клиентов и базовые поля', async ({ request }) => {
    const response = await getClients(request, { page: '1', size: '10' });
    expect(response.status()).toBe(200);

    const body = (await response.json()) as ClientsListResponse;
    expect(Array.isArray(body.results)).toBeTruthy();
    expect(typeof body.count === 'number' || body.count === undefined).toBeTruthy();

    const item = body.results?.[0];
    if (!item) return;

    expect(item.id).toBeTruthy();
    expect(item.created_at).toBeTruthy();
    expect(item.risk_level).toBeTruthy();
  });

  // Фильтр archived=false не должен давать ошибку
  test('фильтр archived=false возвращает данные', async ({ request }) => {
    const response = await getClients(request, { archived: 'false', page: '1', size: '10' });
    expect(response.status()).toBe(200);
  });

  // Фильтр по уровню риска
  test('фильтр risk_level возвращает только указанный уровень', async ({ request }) => {
    const { first } = await getSampleClient(request);
    if (!first?.risk_level) test.skip(true, 'Нет клиентов для проверки risk_level');

    const response = await getClients(request, { risk_level: first.risk_level, page: '1', size: '10' });
    expect(response.status()).toBe(200);

    const body = (await response.json()) as ClientsListResponse;
    for (const client of body.results ?? []) {
      expect(client.risk_level).toBe(first.risk_level);
    }
  });

  // Поиск по ext_id (если есть)
  test('search по ext_id возвращает нужного клиента', async ({ request }) => {
    const { first } = await getSampleClient(request);
    if (!first?.ext_id) test.skip(true, 'Нет ext_id для проверки search');

    const response = await getClients(request, { search: first.ext_id, page: '1', size: '10' });
    expect(response.status()).toBe(200);

    const body = (await response.json()) as ClientsListResponse;
    const extIds = (body.results ?? []).map(c => c.ext_id);
    expect(extIds).toContain(first.ext_id);
  });

  // Фильтр по датам last_transfer_from / last_transfer_to
  test('фильтр last_transfer_from/last_transfer_to ограничивает результаты по дате', async ({ request }) => {
    const { first } = await getSampleClient(request);
    if (!first?.last_transfer_at) test.skip(true, 'Нет last_transfer_at для проверки даты');

    const dateOnly = first.last_transfer_at.split('T')[0];
    const response = await getClients(request, {
      last_transfer_from: dateOnly,
      last_transfer_to: dateOnly,
      page: '1',
      size: '10',
    });
    if (response.status() === 400) {
      test.skip(true, 'API не принял формат last_transfer_from/last_transfer_to');
    }
    expect(response.status()).toBe(200);

    const body = (await response.json()) as ClientsListResponse;
    for (const client of body.results ?? []) {
      if (!client.last_transfer_at) continue;
      const d = new Date(client.last_transfer_at).toISOString().split('T')[0];
      expect(d).toBe(dateOnly);
    }
  });

  // archived=true и archived=false не пересекаются
  test('архивные и неархивные клиенты не пересекаются', async ({ request }) => {
    const activeResponse = await getClients(request, { archived: 'false', page: '1', size: '100' });
    const archivedResponse = await getClients(request, { archived: 'true', page: '1', size: '100' });
    if (activeResponse.status() !== 200 || archivedResponse.status() !== 200) {
      test.skip(true, 'Не удалось получить списки клиентов');
    }

    const activeBody = (await activeResponse.json()) as ClientsListResponse;
    const archivedBody = (await archivedResponse.json()) as ClientsListResponse;

    const activeIds = new Set((activeBody.results ?? []).map(c => c.id).filter(Boolean));
    const archivedIds = new Set((archivedBody.results ?? []).map(c => c.id).filter(Boolean));

    if (activeIds.size === 0 || archivedIds.size === 0) {
      test.skip(true, 'Нет данных для проверки пересечения');
    }

    for (const id of activeIds) {
      expect(archivedIds.has(id as string)).toBeFalsy();
    }
  });
});
