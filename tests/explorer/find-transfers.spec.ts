import { APIRequestContext, expect, test } from '@playwright/test';

import { env } from '../../utils/env';
import { getValidAccessToken } from '../../utils/auth';

type FoundTransfer = {
  network_code?: string;
  network_name?: string;
  token_id?: string | null;
  token_symbol?: string | null;
  token_name?: string | null;
  amount?: number | string | null;
  input_address?: string | null;
  output_address?: string | null;
};

async function authHeaders(request: APIRequestContext) {
  const access = await getValidAccessToken(request);
  return { accept: 'application/json', authorization: `Bearer ${access}` };
}

function isUuid(value: string | undefined | null): boolean {
  if (!value) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

// POST /explorer/find-transfers/
async function findTransfers(request: APIRequestContext, tx_hash: string) {
  const url = `${env.apiUrl}/explorer/find-transfers/`;
  return request.post(url, {
    headers: { ...(await authHeaders(request)), 'content-type': 'application/json' },
    data: { tx_hash },
  });
}

const txHash = process.env.EXPLORER_TX_HASH ?? '0xdd0e414b037051909a233e3cbd34d4a279fe864933db4be47b7b00d66c0019d8';

test.describe('Explorer POST /explorer/find-transfers/', () => {
  // Базовая проверка структуры ответа
  test('возвращает список трансферов по tx_hash', async ({ request }) => {
    const resp = await findTransfers(request, txHash);
    expect(resp.status()).toBe(200);
    const body = (await resp.json()) as FoundTransfer[];
    expect(Array.isArray(body)).toBeTruthy();

    if (body.length === 0) {
      test.skip(true, 'По этому tx_hash нет трансферов на стенде (нужно другой EXPLORER_TX_HASH)');
    }

    for (const t of body) {
      expect(t.network_code).toBeTruthy();
      expect(t.network_name).toBeTruthy();
      // token_id может быть null
      if (t.token_id !== null && t.token_id !== undefined) expect(isUuid(t.token_id)).toBeTruthy();
      // token_symbol/token_name могут быть null
      const symOk = t.token_symbol === null || t.token_symbol === undefined || typeof t.token_symbol === 'string';
      const nameOk = t.token_name === null || t.token_name === undefined || typeof t.token_name === 'string';
      expect(symOk).toBeTruthy();
      expect(nameOk).toBeTruthy();

      // amount часто число, иногда строка (фиксируем оба)
      const amountOk = t.amount === null || t.amount === undefined || typeof t.amount === 'number' || typeof t.amount === 'string';
      expect(amountOk).toBeTruthy();

      const inOk = t.input_address === null || t.input_address === undefined || typeof t.input_address === 'string';
      const outOk = t.output_address === null || t.output_address === undefined || typeof t.output_address === 'string';
      expect(inOk).toBeTruthy();
      expect(outOk).toBeTruthy();
    }
  });

  // Негатив: невалидный tx_hash -> 400
  test('400 если tx_hash невалидный', async ({ request }) => {
    const resp = await findTransfers(request, 'not-a-hash');
    expect(resp.status()).toBe(400);
  });

  // Негатив: без авторизации -> 401
  test('401 без авторизации', async ({ request }) => {
    const url = `${env.apiUrl}/explorer/find-transfers/`;
    const resp = await request.post(url, {
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      data: { tx_hash: txHash },
    });
    expect(resp.status()).toBe(401);
  });
});

