import { APIRequestContext, expect, test } from '@playwright/test';

import { env } from '../../utils/env';
import { getValidAccessToken } from '../../utils/auth';
import { readTokens, tokenFileExists } from '../../utils/tokens';

type ManualCheckType = 'deposit' | 'withdrawal' | 'single_address' | string;
type ManualCheckStatus = 'checking' | 'checked' | 'error' | string;

type ManualChecksListItem = {
  id?: string;
  type?: ManualCheckType;
};

type ManualChecksListResponse = {
  results?: ManualChecksListItem[];
};

type ManualCheckAddressInfo = {
  address?: string;
  network_code?: string;
  network_name?: string;
  balance_in_fiat?: number | null;
  transaction_count?: number | null;
  inflow_in_fiat?: number | null;
  outflow_in_fiat?: number | null;
  first_transaction_at?: string | null;
  last_transaction_at?: string | null;
};

type ManualCheckTransferInfo = {
  tx_hash?: string;
  network_code?: string;
  network_name?: string;
  occurred_at?: string;
  asset_symbol?: string;
  input_address?: string;
  output_address?: string;
  amount?: number;
  value_in_fiat?: number | null;
};

type TransferDirectConnection = {
  entity_name?: string | null;
  entity_category?: string | null;
  risk_score?: number | null;
};

type TransferIndirectConnection = {
  entity_category?: string;
  entity_category_color?: string;
  share?: number | string;
  risk_score?: number | string;
};

type TransferExposure = {
  checked_at?: string | null;
  report_url?: string | null;
  interaction?: 'direct' | 'indirect' | string;
  counterparty?: TransferDirectConnection | null;
  indirect_exposure?: TransferIndirectConnection[] | null;
};

type AddressExposure = {
  checked_at?: string | null;
  report_url?: string | null;
  entity_name?: string | null;
  entity_category?: string | null;
  entity_risk_score?: number | null;
  exposure?: any[] | null;
};

type ManualCheckDetailResponse = {
  id?: string;
  created_at?: string;
  type?: ManualCheckType;
  status?: ManualCheckStatus;
  risk_level?: string | null;
  risk_score?: number | null;
  risk_model_name?: string | null;
  address_info?: ManualCheckAddressInfo | null;
  address_exposure_status?: string | null;
  address_exposure?: AddressExposure | null;
  transfer_info?: ManualCheckTransferInfo | null;
  transfer_exposure_status?: string | null;
  transfer_exposure?: TransferExposure | null;
  fiat_currency?: string | null;
  report_url?: string | null;
  report_without_risks_url?: string | null;
};

// Берет access/refresh из .auth/tokens.json и падает, если токенов нет
function getTokensOrThrow() {
  if (!tokenFileExists()) {
    throw new Error('Нет сохраненных токенов. Сначала запусти tests/auth/login.spec.ts');
  }
  return readTokens();
}

// Делает GET /manual-checks/ и возвращает первый доступный id
async function getAnyManualCheckId(request: APIRequestContext): Promise<string | null> {
  const access = await getValidAccessToken(request);
  const qs = new URLSearchParams({ page: '1', size: '10' });
  const url = `${env.apiUrl}/manual-checks/?${qs.toString()}`;

  const resp = await request.get(url, {
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${access}`,
    },
  });
  expect(resp.status()).toBe(200);
  const body = (await resp.json()) as ManualChecksListResponse;
  return body.results?.[0]?.id ?? null;
}

// Ищет id проверки (deposit/withdrawal), у которой в деталях есть transfer_exposure.indirect_exposure
async function findManualCheckIdWithIndirectExposure(request: APIRequestContext): Promise<string | null> {
  const access = await getValidAccessToken(request);

  // Перебираем несколько страниц, потому что не у каждой проверки будет indirect_exposure
  for (let page = 1; page <= 10; page += 1) {
    const qs = new URLSearchParams({ page: String(page), size: '25' });
    const url = `${env.apiUrl}/manual-checks/?${qs.toString()}`;

    const resp = await request.get(url, {
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${access}`,
      },
    });
    expect(resp.status()).toBe(200);
    const body = (await resp.json()) as ManualChecksListResponse;

    for (const item of body.results ?? []) {
      const type = item.type ?? '';
      if (type !== 'deposit' && type !== 'withdrawal') continue;
      if (!item.id) continue;

      const detailResp = await getManualCheckDetail(request, item.id);
      if (detailResp.status() !== 200) continue;
      const detail = (await detailResp.json()) as ManualCheckDetailResponse;
      const indirect = detail.transfer_exposure?.indirect_exposure;
      if (Array.isArray(indirect) && indirect.length > 0) {
        return item.id;
      }
    }
  }

  return null;
}

// Делает GET /manual-checks/{id}/ с авторизацией
async function getManualCheckDetail(request: APIRequestContext, id: string) {
  const access = await getValidAccessToken(request);
  const url = `${env.apiUrl}/manual-checks/${id}/`;

  return request.get(url, {
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${access}`,
    },
  });
}

function toNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const n = Number.parseFloat(value);
    return Number.isNaN(n) ? null : n;
  }
  return null;
}

function expectUrlOrNull(value: unknown) {
  if (value === null || value === undefined) return;
  expect(typeof value).toBe('string');
  expect((value as string).startsWith('http')).toBeTruthy();
}

test.describe('Manual checks GET /manual-checks/{id}/', () => {
  // Базовая проверка структуры ответа по одной ручной проверке
  test('возвращает детали проверки с базовыми полями', async ({ request }) => {
    const id = await getAnyManualCheckId(request);
    if (!id) test.skip(true, 'Нет manual-checks для проверки detail');

    const response = await getManualCheckDetail(request, id!);
    expect(response.status()).toBe(200);

    const body = (await response.json()) as ManualCheckDetailResponse;
    expect(body.id).toBe(id);
    expect(body.created_at).toBeTruthy();
    expect(body.type).toBeTruthy();
    expect(body.status).toBeTruthy();

    // risk_score должен быть числом 0..1 или null
    const rs = body.risk_score;
    if (rs !== null && rs !== undefined) {
      expect(typeof rs).toBe('number');
      expect(rs >= 0 && rs <= 1).toBeTruthy();
    }

    // report_url может быть null
    expectUrlOrNull(body.report_url);
    expectUrlOrNull(body.report_without_risks_url);
  });

  // Условные поля: для transfer-проверок (deposit/withdrawal) должен быть transfer_info, а address_info — null
  test('для deposit/withdrawal есть transfer_info, для single_address есть address_info', async ({ request }) => {
    const id = await getAnyManualCheckId(request);
    if (!id) test.skip(true, 'Нет manual-checks для проверки detail');

    const response = await getManualCheckDetail(request, id!);
    expect(response.status()).toBe(200);
    const body = (await response.json()) as ManualCheckDetailResponse;

    const type = body.type ?? '';
    if (type === 'single_address') {
      expect(body.address_info).toBeTruthy();
      expect(body.transfer_info === null || body.transfer_info === undefined).toBeTruthy();
      expect(body.address_info?.address).toBeTruthy();
      expect(body.address_info?.network_code).toBeTruthy();
      expect(body.address_info?.network_name).toBeTruthy();
    } else if (type === 'deposit' || type === 'withdrawal') {
      expect(body.transfer_info).toBeTruthy();
      expect(body.address_info === null || body.address_info === undefined).toBeTruthy();
      expect(body.transfer_info?.tx_hash).toBeTruthy();
      expect(body.transfer_info?.network_code).toBeTruthy();
      expect(body.transfer_info?.network_name).toBeTruthy();
      expect(body.transfer_info?.input_address).toBeTruthy();
      expect(body.transfer_info?.output_address).toBeTruthy();
    } else {
      test.info().annotations.push({
        type: 'note',
        description: `Неожиданный type=${type} (проверяем только single_address/deposit/withdrawal)`,
      });
    }
  });

  // Проверка transfer_exposure: если есть indirect_exposure — share/risk_score должны быть 0..1
  test('transfer_exposure.indirect_exposure имеет корректные доли и риск', async ({ request }) => {
    const id = await findManualCheckIdWithIndirectExposure(request);
    if (!id) test.skip(true, 'Не нашли manual-check с indirect_exposure для проверки диапазонов share/risk_score');

    const response = await getManualCheckDetail(request, id);
    expect(response.status()).toBe(200);
    const body = (await response.json()) as ManualCheckDetailResponse;

    const exposure = body.transfer_exposure;
    expect(Array.isArray(exposure?.indirect_exposure)).toBeTruthy();
    expect((exposure?.indirect_exposure ?? []).length > 0).toBeTruthy();

    for (const item of exposure!.indirect_exposure ?? []) {
      const share = toNumberOrNull(item.share);
      const risk = toNumberOrNull(item.risk_score);
      if (share !== null) expect(share >= 0 && share <= 1).toBeTruthy();
      if (risk !== null) expect(risk >= 0 && risk <= 1).toBeTruthy();
      if (item.entity_category_color !== undefined && item.entity_category_color !== null) {
        expect(typeof item.entity_category_color).toBe('string');
        expect((item.entity_category_color as string).startsWith('#')).toBeTruthy();
      }
    }
  });

  // Негатив: невалидный id -> 404 (или 400 в зависимости от реализации)
  test('невалидный id возвращает 404 или 400', async ({ request }) => {
    const response = await getManualCheckDetail(request, '00000000-0000-0000-0000-000000000000');
    expect([400, 404]).toContain(response.status());
  });
});
