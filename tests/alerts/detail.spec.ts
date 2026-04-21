import { APIRequestContext, expect, test } from '@playwright/test';

import { env } from '../../utils/env';
import { readTokens, tokenFileExists } from '../../utils/tokens';

type AlertDetail = {
  id?: string;
  created_at?: string;
  updated_at?: string;
  type?: string;
  status?: string;
  assignee_name?: string | null;
  fiat_currency?: string | null;
  occurred_at?: string;
  client_id?: string | null;
  client_ext_id?: string | null;
  network_code?: string | null;
  network_name?: string | null;
  tx_hash?: string | null;
  asset?: string | null;
  amount?: number | null;
  fiat_value?: number | null;
  input_address?: string | null;
  output_address?: string | null;
  entity_category?: string | null;
  proximity?: string | null;
  risky_value?: number | null;
  risky_value_share?: number | null;
  counterparty_name?: string | null;
  indirect_exposure?: Array<{
    entity_category?: string;
    entity_category_color?: string;
    share?: number;
    risk_score?: number;
  }> | null;
  triggered_by_rule?: {
    entity_category?: string;
    proximity?: string;
    min_value_usd?: number | null;
    min_share?: number | null;
  } | null;
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

// Получает первый алерт из списка (id + type)
async function getFirstAlertFromList(request: APIRequestContext) {
  const response = await getAlerts(request, { group: 'my_alerts', page: '1', size: '10' });
  expect(response.status()).toBe(200);
  const body = (await response.json()) as { results?: Array<{ id?: string; type?: string }> };
  const first = body.results?.[0];

  if (!first?.id) {
    throw new Error('Нет алертов для проверки /alerts/{id}/');
  }

  return first;
}

// GET /alerts/{id}/ с авторизацией
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

test.describe('Alerts /alerts/{id}/', () => {
  // Базовые поля и структура ответа
  test('возвращает базовые поля алерта', async ({ request }) => {
    const first = await getFirstAlertFromList(request);
    const response = await getAlertDetail(request, first.id as string);
    expect(response.status()).toBe(200);

    const alert = (await response.json()) as AlertDetail;
    expect(alert.id).toBe(first.id);
    expect(alert.created_at).toBeTruthy();
    expect(alert.updated_at).toBeTruthy();
    expect(alert.type).toBeTruthy();
    expect(alert.status).toBeTruthy();
  });

  // Валидность значения status
  test('status имеет ожидаемое значение', async ({ request }) => {
    const first = await getFirstAlertFromList(request);
    const response = await getAlertDetail(request, first.id as string);
    expect(response.status()).toBe(200);

    const alert = (await response.json()) as AlertDetail;
    const allowed = new Set(['open', 'in_progress', 'awaiting_response', 'done']);
    expect(allowed.has(alert.status ?? '')).toBeTruthy();
  });

  // Валидность значения type
  test('type имеет ожидаемое значение', async ({ request }) => {
    const first = await getFirstAlertFromList(request);
    const response = await getAlertDetail(request, first.id as string);
    expect(response.status()).toBe(200);

    const alert = (await response.json()) as AlertDetail;
    if (!first.type) {
      test.skip(true, 'В списке алертов нет type для проверки');
    }
    expect(alert.type).toBe(first.type);
  });

  // Поля трансфера должны быть доступны (могут быть null, но ключи ожидаются)
  test('поля трансфера присутствуют', async ({ request }) => {
    const first = await getFirstAlertFromList(request);
    const response = await getAlertDetail(request, first.id as string);
    expect(response.status()).toBe(200);

    const alert = (await response.json()) as AlertDetail;
    expect('occurred_at' in alert).toBeTruthy();
    expect('network_code' in alert).toBeTruthy();
    expect('network_name' in alert).toBeTruthy();
    expect('tx_hash' in alert).toBeTruthy();
    expect('asset' in alert).toBeTruthy();
    expect('amount' in alert).toBeTruthy();
    expect('fiat_value' in alert).toBeTruthy();
    expect('input_address' in alert).toBeTruthy();
    expect('output_address' in alert).toBeTruthy();
  });

  // Для origin_of_funds / destination_of_funds проверяем специфичные поля
  test('специфичные поля для origin_of_funds/destination_of_funds', async ({ request }) => {
    const first = await getFirstAlertFromList(request);
    const response = await getAlertDetail(request, first.id as string);
    expect(response.status()).toBe(200);

    const alert = (await response.json()) as AlertDetail;
    const isFundsType = alert.type === 'origin_of_funds' || alert.type === 'destination_of_funds';
    if (!isFundsType) test.skip(true, 'Алерт не origin_of_funds/destination_of_funds');

    expect('entity_category' in alert).toBeTruthy();
    expect('proximity' in alert).toBeTruthy();
    expect('risky_value' in alert).toBeTruthy();
    expect('risky_value_share' in alert).toBeTruthy();
    expect('counterparty_name' in alert).toBeTruthy();
    expect('indirect_exposure' in alert).toBeTruthy();
    expect('triggered_by_rule' in alert).toBeTruthy();

    if (alert.proximity === 'direct') {
      expect(alert.indirect_exposure).toBeNull();
    }
    if (alert.proximity === 'indirect' && Array.isArray(alert.indirect_exposure)) {
      for (const item of alert.indirect_exposure) {
        expect(item.share === undefined || (item.share >= 0 && item.share <= 1)).toBeTruthy();
        expect(item.risk_score === undefined || (item.risk_score >= 0 && item.risk_score <= 1)).toBeTruthy();
      }
    }
  });

  // Некорректный ID должен возвращать 404
  test('невалидный id возвращает 404', async ({ request }) => {
    const response = await getAlertDetail(request, '00000000-0000-0000-0000-000000000000');
    expect(response.status()).toBe(404);
  });
});
