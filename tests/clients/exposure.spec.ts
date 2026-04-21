import { APIRequestContext, expect, test } from '@playwright/test';

import { env } from '../../utils/env';
import { readTokens, tokenFileExists } from '../../utils/tokens';

type ClientsListResponse = {
  results?: Array<{ id?: string }>;
};

type ExposureItem = {
  entity_category?: string;
  share?: number;
  value_usd?: number;
  risk_score?: number;
};

type ClientExposureResponse = {
  incoming_exposure?: ExposureItem[] | null;
  outgoing_exposure?: ExposureItem[] | null;
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

// GET /clients/{id}/exposure/ с авторизацией
async function getClientExposure(request: APIRequestContext, id: string) {
  const tokens = getTokensOrThrow();
  const url = `${env.apiUrl}/clients/${id}/exposure/`;

  return request.get(url, {
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${tokens.access_token}`,
    },
  });
}

function validateExposure(items: ExposureItem[] | null | undefined) {
  if (!items || items.length === 0) return;
  for (const item of items) {
    expect(item.entity_category).toBeTruthy();
    if (typeof item.share === 'number') {
      expect(item.share).toBeGreaterThanOrEqual(0);
      expect(item.share).toBeLessThanOrEqual(1);
    }
    if (typeof item.value_usd === 'number') {
      expect(item.value_usd).toBeGreaterThanOrEqual(0);
    }
    if (typeof item.risk_score === 'number') {
      expect(item.risk_score).toBeGreaterThanOrEqual(0);
      expect(item.risk_score).toBeLessThanOrEqual(1);
    }
  }
}

function sumShare(items: ExposureItem[] | null | undefined) {
  if (!items || items.length === 0) return 0;
  return items.reduce((sum, i) => sum + (typeof i.share === 'number' ? i.share : 0), 0);
}

test.describe('Clients /clients/{id}/exposure/', () => {
  // Проверяет структуру ответа и диапазоны share/risk_score
  test('возвращает экспожур клиента', async ({ request }) => {
    const listResponse = await getClients(request);
    expect(listResponse.status()).toBe(200);
    const list = (await listResponse.json()) as ClientsListResponse;
    const id = list.results?.[0]?.id;
    if (!id) test.skip(true, 'Нет клиентов для проверки экспожура');

    const response = await getClientExposure(request, id);
    expect(response.status()).toBe(200);

    const body = (await response.json()) as ClientExposureResponse;
    expect('incoming_exposure' in body).toBeTruthy();
    expect('outgoing_exposure' in body).toBeTruthy();
    const incomingOk = body.incoming_exposure === null || Array.isArray(body.incoming_exposure);
    const outgoingOk = body.outgoing_exposure === null || Array.isArray(body.outgoing_exposure);
    expect(incomingOk).toBeTruthy();
    expect(outgoingOk).toBeTruthy();

    validateExposure(body.incoming_exposure);
    validateExposure(body.outgoing_exposure);
  });

  // Сумма share по входящему экспожуру должна быть <= 1
  test('incoming_exposure share сумма <= 1', async ({ request }) => {
    const listResponse = await getClients(request);
    expect(listResponse.status()).toBe(200);
    const list = (await listResponse.json()) as ClientsListResponse;
    const id = list.results?.[0]?.id;
    if (!id) test.skip(true, 'Нет клиентов для проверки экспожура');

    const response = await getClientExposure(request, id);
    expect(response.status()).toBe(200);
    const body = (await response.json()) as ClientExposureResponse;

    const total = sumShare(body.incoming_exposure);
    expect(total).toBeLessThanOrEqual(1);
  });

  // Сумма share по исходящему экспожуру должна быть <= 1
  test('outgoing_exposure share сумма <= 1', async ({ request }) => {
    const listResponse = await getClients(request);
    expect(listResponse.status()).toBe(200);
    const list = (await listResponse.json()) as ClientsListResponse;
    const id = list.results?.[0]?.id;
    if (!id) test.skip(true, 'Нет клиентов для проверки экспожура');

    const response = await getClientExposure(request, id);
    expect(response.status()).toBe(200);
    const body = (await response.json()) as ClientExposureResponse;

    const total = sumShare(body.outgoing_exposure);
    expect(total).toBeLessThanOrEqual(1);
  });
});
