import { APIRequestContext, expect, test } from '@playwright/test';

import { env } from '../../utils/env';
import { getValidAccessToken } from '../../utils/auth';

type FoundNetwork = { id?: string; code?: string; name?: string };
type FindAddressResponse = { address?: string; networks?: FoundNetwork[] };

async function authHeaders(request: APIRequestContext) {
  const access = await getValidAccessToken(request);
  return { accept: 'application/json', authorization: `Bearer ${access}` };
}

function isUuid(value: string | undefined): boolean {
  if (!value) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

// POST /explorer/find-address/
async function findAddress(request: APIRequestContext, payload: { address: string; monitoring_support?: boolean }) {
  const url = `${env.apiUrl}/explorer/find-address/`;
  return request.post(url, {
    headers: { ...(await authHeaders(request)), 'content-type': 'application/json' },
    data: payload,
  });
}

const ethAddress = process.env.EXPLORER_ETH_ADDRESS ?? '0xBef7B36845cA31045E86D0B46DBCac4e6752A9cE';

test.describe('Explorer POST /explorer/find-address/', () => {
  // Базовая проверка: адрес находится хотя бы в одной сети, сеть имеет id/code/name
  test('возвращает список сетей, где найден адрес', async ({ request }) => {
    const resp = await findAddress(request, { address: ethAddress });
    expect(resp.status()).toBe(200);
    const body = (await resp.json()) as FindAddressResponse;
    expect((body.address ?? '').toLowerCase()).toContain(ethAddress.slice(0, 6).toLowerCase());
    expect(Array.isArray(body.networks)).toBeTruthy();
    expect((body.networks ?? []).length > 0).toBeTruthy();

    for (const n of body.networks ?? []) {
      expect(isUuid(n.id)).toBeTruthy();
      expect(n.code).toBeTruthy();
      expect(n.name).toBeTruthy();
    }
  });

  // monitoring_support=true возвращает только сети с мониторингом (как минимум — тоже корректная структура)
  test('monitoring_support=true возвращает корректную структуру', async ({ request }) => {
    const resp = await findAddress(request, { address: ethAddress, monitoring_support: true });
    expect(resp.status()).toBe(200);
    const body = (await resp.json()) as FindAddressResponse;
    expect(Array.isArray(body.networks)).toBeTruthy();
    for (const n of body.networks ?? []) {
      expect(isUuid(n.id)).toBeTruthy();
      expect(n.code).toBeTruthy();
      expect(n.name).toBeTruthy();
    }
  });

  // Негатив: пустой address -> 400
  test('400 если address пустой', async ({ request }) => {
    const resp = await findAddress(request, { address: '' });
    expect(resp.status()).toBe(400);
  });

  // Негатив: без авторизации -> 401
  test('401 без авторизации', async ({ request }) => {
    const url = `${env.apiUrl}/explorer/find-address/`;
    const resp = await request.post(url, {
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      data: { address: ethAddress },
    });
    expect(resp.status()).toBe(401);
  });
});

