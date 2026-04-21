import { APIRequestContext, expect, test } from '@playwright/test';

import { env } from '../../utils/env';
import { getValidAccessToken } from '../../utils/auth';

type ManualCheckCreateResponse = {
  id?: string;
};

type ManualCheckDetail = {
  id?: string;
  status?: string;
  type?: string;
};

type CatalogNetwork = { id?: string; code?: string };
type CatalogNetworksResponse = { results?: CatalogNetwork[] };

async function authHeaders(request: APIRequestContext) {
  const access = await getValidAccessToken(request);
  return { accept: 'application/json', authorization: `Bearer ${access}` };
}

// Получает UUID сети по коду (например, ETH/TRX/BTC/BSC) из /catalog/networks/
async function resolveNetworkIdByCode(request: APIRequestContext, code: string): Promise<string | null> {
  const qs = new URLSearchParams({ page: '1', size: '50', search: code, supports_kyt: 'true' });
  const url = `${env.apiUrl}/catalog/networks/?${qs.toString()}`;
  const resp = await request.get(url, { headers: await authHeaders(request) });
  expect(resp.status()).toBe(200);
  const body = (await resp.json()) as CatalogNetworksResponse;
  const exact = (body.results ?? []).find((n) => (n.code ?? '').toUpperCase() === code.toUpperCase());
  return exact?.id ?? null;
}

// Создает ручную проверку адреса (чтобы получить валидный id для recheck)
async function createAddressCheck(request: APIRequestContext, networkCode: string, address: string, riskModelId: string) {
  const networkId = await resolveNetworkIdByCode(request, networkCode);
  if (!networkId) test.skip(true, `Не нашли сеть в /catalog/networks/ по code=${networkCode}`);

  const url = `${env.apiUrl}/manual-checks/check-address/`;
  const resp = await request.post(url, {
    headers: { ...(await authHeaders(request)), 'content-type': 'application/json' },
    data: { network: networkId, token: null, address, risk_model: riskModelId },
  });
  if (resp.status() === 403) test.skip(true, 'Нет прав на ручные проверки (access_risk_models/full)');
  expect([200, 201]).toContain(resp.status());
  const body = (await resp.json()) as ManualCheckCreateResponse;
  expect(body.id).toBeTruthy();
  return body.id as string;
}

// POST /manual-checks/{id}/recheck/
async function recheckManualCheck(request: APIRequestContext, id: string) {
  const url = `${env.apiUrl}/manual-checks/${id}/recheck/`;
  return request.post(url, { headers: await authHeaders(request) });
}

// GET /manual-checks/{id}/
async function getManualCheckDetail(request: APIRequestContext, id: string) {
  const url = `${env.apiUrl}/manual-checks/${id}/`;
  return request.get(url, { headers: await authHeaders(request) });
}

const riskModelId = process.env.MANUAL_CHECK_RISK_MODEL_ID ?? '2db2db3d-283a-466e-8d18-da9bbece14c8';

test.describe('Manual checks POST /manual-checks/{id}/recheck/', () => {
  // Повторная проверка должна возвращать 200
  test('recheck возвращает 200 для существующей проверки', async ({ request }) => {
    const id = await createAddressCheck(
      request,
      'ETH',
      '0x28F86ed030fd080a07Dc4AbcDE6e04ee67517F10',
      riskModelId,
    );

    const response = await recheckManualCheck(request, id);
    if (response.status() === 403) test.skip(true, 'Нет прав на повторную проверку manual-check');
    expect(response.status()).toBe(200);

    // Доп.проверка: после recheck детализация доступна и status имеет ожидаемое значение
    const detailResp = await getManualCheckDetail(request, id);
    expect(detailResp.status()).toBe(200);
    const detail = (await detailResp.json()) as ManualCheckDetail;
    expect(detail.id).toBe(id);
    expect(detail.type).toBeTruthy();
    // Обычно статус становится checking, но может быстро стать checked (если обработка мгновенная)
    expect(['checking', 'checked', 'error']).toContain(detail.status ?? '');
  });

  // Негатив: невалидный id -> 404 или 400
  test('невалидный id возвращает 404 или 400', async ({ request }) => {
    const response = await recheckManualCheck(request, '00000000-0000-0000-0000-000000000000');
    expect([400, 404]).toContain(response.status());
  });
});

