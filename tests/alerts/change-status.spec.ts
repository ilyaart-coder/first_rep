import { APIRequestContext, expect, test } from '@playwright/test';

import { env } from '../../utils/env';
import { readTokens, tokenFileExists } from '../../utils/tokens';

type AlertDetail = {
  id?: string;
  status?: string;
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

// Получает первый алерт из списка (id)
async function getFirstAlertId(request: APIRequestContext) {
  const response = await getAlerts(request, { group: 'my_alerts', page: '1', size: '10' });
  expect(response.status()).toBe(200);
  const body = (await response.json()) as { results?: Array<{ id?: string }> };
  const id = body.results?.[0]?.id;

  if (!id) {
    throw new Error('Нет алертов для проверки /alerts/{id}/change-status/');
  }

  return id;
}

// GET /alerts/{id}/ для текущего статуса
async function getAlertDetail(request: APIRequestContext, id: string) {
  const tokens = getTokensOrThrow();
  const url = `${env.apiUrl}/alerts/${id}/`;

  return request.get(url, {
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${tokens.access_token}`,
    },
  });
}

// POST /alerts/{id}/change-status/ — меняет статус
async function changeStatus(request: APIRequestContext, id: string, status: string) {
  const tokens = getTokensOrThrow();
  const url = `${env.apiUrl}/alerts/${id}/change-status/`;

  return request.post(url, {
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      authorization: `Bearer ${tokens.access_token}`,
    },
    data: { status },
  });
}

// Выбирает новый статус, отличный от текущего
function pickNextStatus(current?: string) {
  const all = ['open', 'in_progress', 'awaiting_response', 'done'];
  return all.find(s => s !== current) ?? 'in_progress';
}

test.describe('Alerts /alerts/{id}/change-status/', () => {
  // Меняет статус алерта и проверяет, что он действительно изменился
  test('меняет статус алерта', async ({ request }) => {
    const id = await getFirstAlertId(request);

    const detailResponse = await getAlertDetail(request, id);
    expect(detailResponse.status()).toBe(200);
    const detail = (await detailResponse.json()) as AlertDetail;

    const nextStatus = pickNextStatus(detail.status);
    const changeResponse = await changeStatus(request, id, nextStatus);
    expect([200, 201]).toContain(changeResponse.status());

    const detailAfterResponse = await getAlertDetail(request, id);
    expect(detailAfterResponse.status()).toBe(200);
    const detailAfter = (await detailAfterResponse.json()) as AlertDetail;

    expect(detailAfter.status).toBe(nextStatus);
  });
});
