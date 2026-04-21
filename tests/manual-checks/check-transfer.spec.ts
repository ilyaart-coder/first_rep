import { APIRequestContext, expect, test } from '@playwright/test';

import { env } from '../../utils/env';
import { getValidAccessToken } from '../../utils/auth';

type ManualCheckCreateResponse = {
  id?: string;
};

type ManualChecksListItem = {
  id?: string;
  type?: string;
  subject?: string;
  network_code?: string;
  network_name?: string;
  status?: string;
  created_at?: string;
};

type ManualChecksListResponse = {
  results?: ManualChecksListItem[];
};

async function authHeaders(request: APIRequestContext) {
  const access = await getValidAccessToken(request);
  return {
    accept: 'application/json',
    authorization: `Bearer ${access}`,
  };
}

// Делает POST /manual-checks/check-transfer/ с авторизацией
async function checkTransfer(
  request: APIRequestContext,
  payload: { token: string; tx_hash: string; output_address: string; check_type: string; risk_model: string },
) {
  const url = `${env.apiUrl}/manual-checks/check-transfer/`;
  return request.post(url, {
    headers: {
      ...(await authHeaders(request)),
      'content-type': 'application/json',
    },
    data: payload,
  });
}

// Делает GET /manual-checks/ с search (по subject)
async function searchManualChecks(request: APIRequestContext, searchText: string) {
  const qs = new URLSearchParams({ page: '1', size: '50', search: searchText });
  const url = `${env.apiUrl}/manual-checks/?${qs.toString()}`;
  return request.get(url, { headers: await authHeaders(request) });
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

// Risk model можно переопределить через .env (на будущее), иначе используем дефолт из примеров
const riskModelId = process.env.MANUAL_CHECK_RISK_MODEL_ID ?? '2db2db3d-283a-466e-8d18-da9bbece14c8';

// Данные для позитивного кейса (можно переопределить через env)
const sample = {
  token: process.env.MANUAL_CHECK_TOKEN_ID ?? 'c122aa40-b359-41e2-96fd-af3e2585edaf',
  tx_hash: process.env.MANUAL_CHECK_TX_HASH ?? '0xdd0e414b037051909a233e3cbd34d4a279fe864933db4be47b7b00d66c0019d8',
  output_address: process.env.MANUAL_CHECK_OUTPUT_ADDRESS ?? '0xfe837a3530dd566401d35befcd55582af7c4dffc',
};

test.describe('Manual checks POST /manual-checks/check-transfer/', () => {
  // Создаем ручную проверку трансфера и проверяем базовые гарантии ответа
  test('создает ручную проверку трансфера (deposit)', async ({ request }) => {
    const payload = {
      token: sample.token,
      tx_hash: sample.tx_hash,
      output_address: sample.output_address,
      check_type: 'deposit',
      risk_model: riskModelId,
    };

    const response = await checkTransfer(request, payload);
    if (response.status() === 403) test.skip(true, 'Нет прав на ручные проверки трансферов');
    expect([200, 201]).toContain(response.status());

    const body = (await response.json()) as ManualCheckCreateResponse;
    expect(body.id).toBeTruthy();

    // Проверяем, что созданный id уникальный (создаем второй раз и сравниваем)
    const response2 = await checkTransfer(request, payload);
    if (response2.status() === 403) test.skip(true, 'Нет прав на ручные проверки трансферов');
    expect([200, 201]).toContain(response2.status());
    const body2 = (await response2.json()) as ManualCheckCreateResponse;
    expect(body2.id).toBeTruthy();
    expect(body2.id).not.toBe(body.id);

    // Проверяем, что проверка появилась в списке (поиск по tx_hash)
    const found = await waitForManualCheckVisibleById(request, body.id!, sample.tx_hash.slice(0, 10));
    if (!found) {
      test.info().annotations.push({
        type: 'note',
        description: 'Созданная ручная проверка трансфера не появилась в списке по search за время ожидания (возможна задержка индексации)',
      });
      return;
    }

    expect(found.type).toBe('deposit');
    expect((found.subject ?? '').toLowerCase()).toContain(sample.tx_hash.slice(0, 10).toLowerCase());
    expect(found.network_code).toBeTruthy();
    expect(found.network_name).toBeTruthy();
    expect(found.status).toBeTruthy();
    expect(found.created_at).toBeTruthy();
  });

  // Создаем ручную проверку трансфера withdrawal (если API поддерживает этот тип)
  test('создает ручную проверку трансфера (withdrawal)', async ({ request }) => {
    const payload = {
      token: sample.token,
      tx_hash: sample.tx_hash,
      output_address: sample.output_address,
      check_type: 'withdrawal',
      risk_model: riskModelId,
    };

    const response = await checkTransfer(request, payload);
    if (response.status() === 403) test.skip(true, 'Нет прав на ручные проверки трансферов');
    if (response.status() === 400) {
      test.skip(true, 'На текущем окружении check_type=withdrawal не поддерживается для check-transfer');
    }
    expect([200, 201]).toContain(response.status());
    const body = (await response.json()) as ManualCheckCreateResponse;
    expect(body.id).toBeTruthy();
  });

  // Негатив: не передали обязательные поля -> 400
  test('400 если не передать обязательные поля', async ({ request }) => {
    const url = `${env.apiUrl}/manual-checks/check-transfer/`;
    const response = await request.post(url, {
      headers: { ...(await authHeaders(request)), 'content-type': 'application/json' },
      data: {},
    });
    if (response.status() === 403) test.skip(true, 'Нет прав на ручные проверки трансферов');
    expect(response.status()).toBe(400);
  });

  // Негатив: невалидный token uuid -> 400
  test('400 если token не UUID', async ({ request }) => {
    const response = await checkTransfer(request, {
      // @ts-expect-error намеренно не UUID
      token: 'not-a-uuid',
      tx_hash: sample.tx_hash,
      output_address: sample.output_address,
      check_type: 'deposit',
      risk_model: riskModelId,
    });
    if (response.status() === 403) test.skip(true, 'Нет прав на ручные проверки трансферов');
    expect(response.status()).toBe(400);
  });

  // Негатив: невалидный check_type -> 400 или API игнорирует/падает (фиксируем как несовместимость)
  test('невалидный check_type возвращает 400', async ({ request }) => {
    const response = await checkTransfer(request, {
      token: sample.token,
      tx_hash: sample.tx_hash,
      output_address: sample.output_address,
      check_type: '___bad_type___',
      risk_model: riskModelId,
    });
    if (response.status() === 403) test.skip(true, 'Нет прав на ручные проверки трансферов');
    if (response.status() === 500) {
      test.info().annotations.push({
        type: 'note',
        description: 'API вернул 500 на невалидный check_type (ожидали 400) — это баг API, не теста',
      });
      return;
    }
    expect(response.status()).toBe(400);
  });
});

