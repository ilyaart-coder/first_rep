import { APIRequestContext, expect, test } from '@playwright/test';

import { env } from '../../utils/env';
import { getValidAccessToken } from '../../utils/auth';

type FoundNetwork = { id?: string; code?: string; name?: string };
type FoundAddress = { address?: string; networks?: FoundNetwork[] };

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

type FoundTransaction = { tx_hash?: string; transfers?: FoundTransfer[] };

type FindAddressOrTransactionResponse = {
  query?: string;
  address?: FoundAddress | null;
  transaction?: FoundTransaction | null;
};

async function authHeaders(request: APIRequestContext) {
  const access = await getValidAccessToken(request);
  return { accept: 'application/json', authorization: `Bearer ${access}` };
}

function isUuid(value: string | undefined): boolean {
  if (!value) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

// POST /explorer/find-address-or-transaction/
async function findAddressOrTransaction(request: APIRequestContext, query: string) {
  const url = `${env.apiUrl}/explorer/find-address-or-transaction/`;
  return request.post(url, {
    headers: { ...(await authHeaders(request)), 'content-type': 'application/json' },
    data: { query },
  });
}

const ethAddress = process.env.EXPLORER_ETH_ADDRESS ?? '0xBef7B36845cA31045E86D0B46DBCac4e6752A9cE';
const txHash = process.env.EXPLORER_TX_HASH ?? '0xdd0e414b037051909a233e3cbd34d4a279fe864933db4be47b7b00d66c0019d8';

test.describe('Explorer POST /explorer/find-address-or-transaction/', () => {
  // Адрес: должны получить address, transaction=null
  test('по адресу возвращает address и transaction=null', async ({ request }) => {
    const resp = await findAddressOrTransaction(request, ethAddress);
    expect(resp.status()).toBe(200);
    const body = (await resp.json()) as FindAddressOrTransactionResponse;
    expect(body.query).toBe(ethAddress);
    expect(body.address).toBeTruthy();
    expect(body.transaction === null || body.transaction === undefined).toBeTruthy();

    const addr = body.address!;
    expect((addr.address ?? '').toLowerCase()).toContain(ethAddress.slice(0, 6).toLowerCase());
    expect(Array.isArray(addr.networks)).toBeTruthy();
    expect((addr.networks ?? []).length > 0).toBeTruthy();
    for (const n of addr.networks ?? []) {
      expect(isUuid(n.id)).toBeTruthy();
      expect(n.code).toBeTruthy();
      expect(n.name).toBeTruthy();
    }
  });

  // Транзакция: если по хэшу находится transaction, проверяем transfers; если нет — скипаем (на стенде может не быть)
  test('по tx_hash возвращает transaction (если найдено)', async ({ request }) => {
    const resp = await findAddressOrTransaction(request, txHash);
    expect(resp.status()).toBe(200);
    const body = (await resp.json()) as FindAddressOrTransactionResponse;
    expect(body.query).toBe(txHash);

    if (!body.transaction) {
      test.skip(true, 'Для этого tx_hash transaction не найден (нужно другой EXPLORER_TX_HASH)');
    }

    expect(body.address === null || body.address === undefined).toBeTruthy();
    expect(body.transaction?.tx_hash).toBeTruthy();
    expect(Array.isArray(body.transaction?.transfers)).toBeTruthy();

    for (const t of body.transaction?.transfers ?? []) {
      expect(t.network_code).toBeTruthy();
      expect(t.network_name).toBeTruthy();
      const idOk = t.token_id === null || t.token_id === undefined || isUuid(t.token_id);
      expect(idOk).toBeTruthy();
      const amountOk = t.amount === null || t.amount === undefined || typeof t.amount === 'number' || typeof t.amount === 'string';
      expect(amountOk).toBeTruthy();
    }
  });

  // Негатив: пустой query -> 400
  test('400 если query пустой', async ({ request }) => {
    const resp = await findAddressOrTransaction(request, '');
    expect(resp.status()).toBe(400);
  });

  // Негатив: без авторизации -> 401
  test('401 без авторизации', async ({ request }) => {
    const url = `${env.apiUrl}/explorer/find-address-or-transaction/`;
    const resp = await request.post(url, {
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      data: { query: ethAddress },
    });
    expect(resp.status()).toBe(401);
  });
});

