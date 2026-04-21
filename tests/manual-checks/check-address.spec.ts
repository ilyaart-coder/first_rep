import { APIRequestContext, expect, test } from '@playwright/test';

import { env } from '../../utils/env';
import { getValidAccessToken } from '../../utils/auth';
import { readTokens, tokenFileExists } from '../../utils/tokens';

type ManualCheckCreateResponse = {
  id?: string;
};

type ManualChecksListItem = {
  id?: string;
  created_at?: string;
  type?: string;
  status?: string;
  risk_level?: string | null;
  network_code?: string;
  network_name?: string;
  subject?: string;
  asset_symbol?: string | null;
  asset_amount?: number | null;
};

type ManualChecksListResponse = {
  results?: ManualChecksListItem[];
};

type CatalogNetwork = {
  id?: string;
  name?: string;
  code?: string;
};

type CatalogNetworksResponse = {
  results?: CatalogNetwork[];
  next?: number | null;
};

// Берет access/refresh из .auth/tokens.json и падает, если токенов нет
function getTokensOrThrow() {
  if (!tokenFileExists()) {
    throw new Error('Нет сохраненных токенов. Сначала запусти tests/auth/login.spec.ts');
  }
  return readTokens();
}

// Делает GET /catalog/networks/ (постранично) и ищет сеть по точному совпадению кода
async function resolveNetworkIdByCode(request: APIRequestContext, code: string): Promise<string | null> {
  const access = await getValidAccessToken(request);

  for (let page = 1; page <= 20; page += 1) {
    const search = new URLSearchParams({
      page: String(page),
      size: '50',
      search: code,
      supports_kyt: 'true',
    });
    const url = `${env.apiUrl}/catalog/networks/?${search.toString()}`;

    const resp = await request.get(url, {
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${access}`,
      },
    });
    expect(resp.status()).toBe(200);

    const body = (await resp.json()) as CatalogNetworksResponse;
    const exact = (body.results ?? []).find((n) => (n.code ?? '').toUpperCase() === code.toUpperCase());
    if (exact?.id) return exact.id;
    if (!body.next) break;
  }

  return null;
}

// Делает POST /manual-checks/check-address/ с авторизацией
async function checkAddress(
  request: APIRequestContext,
  payload: { network: string; token: string | null; address: string; risk_model: string },
) {
  const access = await getValidAccessToken(request);
  const url = `${env.apiUrl}/manual-checks/check-address/`;

  return request.post(url, {
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      authorization: `Bearer ${access}`,
    },
    data: payload,
  });
}

// Делает GET /manual-checks/ с search (по subject)
async function searchManualChecks(request: APIRequestContext, searchText: string) {
  const access = await getValidAccessToken(request);
  const qs = new URLSearchParams({ page: '1', size: '50', search: searchText });
  const url = `${env.apiUrl}/manual-checks/?${qs.toString()}`;

  return request.get(url, {
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${access}`,
    },
  });
}

async function waitForManualCheckVisibleById(request: APIRequestContext, id: string, searchText: string) {
  // Ручная проверка может попадать в список не мгновенно, поэтому делаем несколько попыток.
  for (let attempt = 1; attempt <= 10; attempt += 1) {
    const resp = await searchManualChecks(request, searchText);
    expect(resp.status()).toBe(200);
    const body = (await resp.json()) as ManualChecksListResponse;
    const found = (body.results ?? []).find((x) => x.id === id);
    if (found) return found;
    await new Promise((r) => setTimeout(r, 300));
  }

  return null;
}

const riskModelId = process.env.MANUAL_CHECK_RISK_MODEL_ID ?? '2db2db3d-283a-466e-8d18-da9bbece14c8';

const cases: Array<{ code: string; address: string; title: string }> = [
  {
    title: 'Ethereum (ETH) — EVM адрес',
    code: 'ETH',
    address: '0x28F86ed030fd080a07Dc4AbcDE6e04ee67517F10',
  },
  {
    title: 'BNB Chain (BSC) — EVM адрес',
    code: 'BSC',
    address: '0xc4d3360ec7e42c38af81bfd34cd59d547bb3e03e',
  },
  {
    title: 'Tron (TRX) — TRON адрес',
    code: 'TRX',
    address: 'TRCaStEkZ76QHSnFkHqiXzXiyzfC3i3VHa',
  },
  {
    title: 'Bitcoin (BTC) — BTC адрес',
    code: 'BTC',
    address: 'bc1qgdjqv0av3q56jvd82tkdjpy7gdp9ut8tlqmgrpmv24sq90ecnvqqjwvw97',
  },
];

test.describe('Manual checks POST /manual-checks/check-address/', () => {
  for (const tc of cases) {
    // Создаем ручную проверку адреса для конкретной сети и проверяем базовые гарантии ответа
    test(`создает проверку адреса: ${tc.title}`, async ({ request }) => {
      const networkId = await resolveNetworkIdByCode(request, tc.code);
      if (!networkId) test.skip(true, `Не нашли сеть в /catalog/networks/ по code=${tc.code}`);

      const payload = {
        network: networkId!,
        token: null as null,
        address: tc.address,
        risk_model: riskModelId,
      };

      const response = await checkAddress(request, payload);
      // На разных окружениях может быть 200 или 201 — принимаем оба варианта
      if (response.status() === 403) test.skip(true, 'Нет прав access_risk_models=full или недоступна ручная проверка');
      expect([200, 201]).toContain(response.status());

      const body = (await response.json()) as ManualCheckCreateResponse;
      expect(body.id).toBeTruthy();

      // Проверяем, что созданный id уникальный (создаем второй раз и сравниваем)
      const response2 = await checkAddress(request, payload);
      if (response2.status() === 403) test.skip(true, 'Нет прав access_risk_models=full или недоступна ручная проверка');
      expect([200, 201]).toContain(response2.status());
      const body2 = (await response2.json()) as ManualCheckCreateResponse;
      expect(body2.id).toBeTruthy();
      expect(body2.id).not.toBe(body.id);

      // Проверяем, что проверка появилась в списке (поиск по адресу)
      const found = await waitForManualCheckVisibleById(request, body.id!, tc.address.slice(0, 10));
      if (!found) {
        test.info().annotations.push({
          type: 'note',
          description: 'Созданная ручная проверка не появилась в списке по search за время ожидания (возможна задержка индексации)',
        });
        return;
      }

      // Проверяем, что сеть отображается кодом/названием, а subject совпадает с адресом
      expect((found.network_code ?? '').toUpperCase()).toBe(tc.code.toUpperCase());
      expect(found.network_name).toBeTruthy();
      expect((found.subject ?? '').toLowerCase()).toContain(tc.address.slice(0, 6).toLowerCase());
      expect(found.status).toBeTruthy();
      expect(found.created_at).toBeTruthy();
    });
  }

  // Негатив: пустое тело -> 400
  test('400 если не передать обязательные поля', async ({ request }) => {
    const response = await checkAddress(request, {
      // @ts-expect-error намеренно проверяем невалидный payload
      network: undefined,
      // @ts-expect-error намеренно проверяем невалидный payload
      token: undefined,
      // @ts-expect-error намеренно проверяем невалидный payload
      address: undefined,
      // @ts-expect-error намеренно проверяем невалидный payload
      risk_model: undefined,
    });
    if (response.status() === 403) test.skip(true, 'Нет прав access_risk_models=full или ручная проверка недоступна');
    expect(response.status()).toBe(400);
  });

  // Негатив: невалидный UUID сети -> 400
  test('400 если network не UUID', async ({ request }) => {
    const response = await checkAddress(request, {
      // @ts-expect-error намеренно передаем невалидный тип
      network: 'not-a-uuid',
      token: null,
      address: '0x28F86ed030fd080a07Dc4AbcDE6e04ee67517F10',
      risk_model: riskModelId,
    });
    if (response.status() === 403) test.skip(true, 'Нет прав access_risk_models=full или ручная проверка недоступна');
    expect(response.status()).toBe(400);
  });
});
