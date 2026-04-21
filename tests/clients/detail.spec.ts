import { APIRequestContext, expect, test } from '@playwright/test';

import { env } from '../../utils/env';
import { readTokens, tokenFileExists } from '../../utils/tokens';

type ClientsListResponse = {
  results?: Array<{ id?: string }>;
};

type ClientDetail = {
  id?: string;
  created_at?: string;
  ext_id?: string | null;
  risk_level?: string;
  risk_level_changed_at?: string | null;
  fiat_currency?: string | null;
  active_alert_count?: number | null;
  last_alert_at?: string | null;
  transfer_volume?: number | null;
  transfer_count?: number | null;
  incoming_transfer_volume?: number | null;
  incoming_transfer_count?: number | null;
  outgoing_transfer_volume?: number | null;
  outgoing_transfer_count?: number | null;
  first_transfer_at?: string | null;
  last_transfer_at?: string | null;
  is_archived?: boolean;
};

// Берет access/refresh из .auth/tokens.json и падает, если токенов нет
function getTokensOrThrow() {
  if (!tokenFileExists()) {
    throw new Error('Нет сохраненных токенов. Сначала запусти tests/auth/login.spec.ts');
  }

  return readTokens();
}

// GET /clients/ с авторизацией
async function getClients(request: APIRequestContext) {
  const tokens = getTokensOrThrow();
  const url = `${env.apiUrl}/clients/?page=1&size=10`;

  return request.get(url, {
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${tokens.access_token}`,
    },
  });
}

// GET /clients/{id}/ с авторизацией
async function getClientDetail(request: APIRequestContext, id: string) {
  const tokens = getTokensOrThrow();
  const url = `${env.apiUrl}/clients/${id}/`;

  return request.get(url, {
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${tokens.access_token}`,
    },
  });
}

test.describe('Clients /clients/{id}/', () => {
  // Базовые поля и структура ответа
  test('возвращает базовые поля клиента', async ({ request }) => {
    const listResponse = await getClients(request);
    expect(listResponse.status()).toBe(200);
    const list = (await listResponse.json()) as ClientsListResponse;
    const id = list.results?.[0]?.id;
    if (!id) test.skip(true, 'Нет клиентов для проверки /clients/{id}/');

    const response = await getClientDetail(request, id);
    expect(response.status()).toBe(200);

    const body = (await response.json()) as ClientDetail;
    expect(body.id).toBe(id);
    expect(body.created_at).toBeTruthy();
    expect(body.risk_level).toBeTruthy();
    expect(typeof body.is_archived === 'boolean' || body.is_archived === undefined).toBeTruthy();
  });

  // Проверка допустимых значений risk_level
  test('risk_level имеет допустимое значение', async ({ request }) => {
    const listResponse = await getClients(request);
    expect(listResponse.status()).toBe(200);
    const list = (await listResponse.json()) as ClientsListResponse;
    const id = list.results?.[0]?.id;
    if (!id) test.skip(true, 'Нет клиентов для проверки risk_level');

    const response = await getClientDetail(request, id);
    expect(response.status()).toBe(200);
    const body = (await response.json()) as ClientDetail;

    const allowed = new Set(['low', 'medium', 'high', 'severe', 'none', 'no_risk']);
    expect(allowed.has(body.risk_level ?? '')).toBeTruthy();
  });

  // Поля по трансферам должны быть доступны (могут быть null)
  test('поля по трансферам присутствуют', async ({ request }) => {
    const listResponse = await getClients(request);
    expect(listResponse.status()).toBe(200);
    const list = (await listResponse.json()) as ClientsListResponse;
    const id = list.results?.[0]?.id;
    if (!id) test.skip(true, 'Нет клиентов для проверки полей трансферов');

    const response = await getClientDetail(request, id);
    expect(response.status()).toBe(200);
    const body = (await response.json()) as ClientDetail;

    expect('transfer_volume' in body).toBeTruthy();
    expect('transfer_count' in body).toBeTruthy();
    expect('incoming_transfer_volume' in body).toBeTruthy();
    expect('incoming_transfer_count' in body).toBeTruthy();
    expect('outgoing_transfer_volume' in body).toBeTruthy();
    expect('outgoing_transfer_count' in body).toBeTruthy();
    expect('first_transfer_at' in body).toBeTruthy();
    expect('last_transfer_at' in body).toBeTruthy();
  });
});
