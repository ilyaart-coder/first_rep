import { APIRequestContext, expect, test } from '@playwright/test';

import { env } from '../../utils/env';
import { getValidAccessToken } from '../../utils/auth';

type ManualRisk = {
  id?: string;
  created_at?: string;
  occurred_at?: string | null;
  risk_level?: string;
  client_ext_id?: string | null;
  fiat_currency?: string;
  type?: string;
  entity_category?: string | null;
  interaction?: string | null;
  risky_value?: number | null;
  risky_value_share?: number | string | null;
  network_code?: string;
  network_name?: string;
  asset?: string | null;
  amount?: number | null;
  fiat_value?: number | null;
  alert_id?: string | null;
  alert_status?: string | null;
  alert_assignee_name?: string | null;
};

type ManualChecksListResponse = {
  results?: Array<{ id?: string }>;
  next?: number | null;
};

type ManualCheckDetailResponse = {
  type?: string;
  address_info?: { network_code?: string; network_name?: string } | null;
  transfer_info?: { network_code?: string; network_name?: string } | null;
};

async function authHeaders(request: APIRequestContext) {
  const access = await getValidAccessToken(request);
  return {
    accept: 'application/json',
    authorization: `Bearer ${access}`,
  };
}

// Делает GET /manual-checks/ и возвращает список id (несколько страниц)
async function listManualCheckIds(request: APIRequestContext, maxPages = 10): Promise<string[]> {
  const ids: string[] = [];
  let page: number | null = 1;
  let iter = 0;

  while (page && iter < maxPages) {
    iter += 1;
    const qs = new URLSearchParams({ page: String(page), size: '25' });
    const url = `${env.apiUrl}/manual-checks/?${qs.toString()}`;
    const resp = await request.get(url, { headers: await authHeaders(request) });
    if (resp.status() === 404) {
      const text = await resp.text();
      // API может возвращать 404 с "Invalid page." если page вышел за границы
      if (text.includes('Invalid page')) break;
      throw new Error(`Ожидали 200 от ${url}, получили 404. Body: ${text}`);
    }
    if (resp.status() !== 200) throw new Error(`Ожидали 200 от ${url}, получили ${resp.status()}`);
    const body = (await resp.json()) as ManualChecksListResponse;
    for (const item of body.results ?? []) {
      if (item.id) ids.push(item.id);
    }
    page = body.next ?? null;
  }
  return ids;
}

// Делает GET /manual-checks/{id}/risks/
async function getManualCheckRisks(request: APIRequestContext, id: string) {
  const url = `${env.apiUrl}/manual-checks/${id}/risks/`;
  return request.get(url, { headers: await authHeaders(request) });
}

// Делает GET /manual-checks/{id}/
async function getManualCheckDetail(request: APIRequestContext, id: string) {
  const url = `${env.apiUrl}/manual-checks/${id}/`;
  return request.get(url, { headers: await authHeaders(request) });
}

function toNumber01(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const n = Number.parseFloat(value);
    return Number.isNaN(n) ? null : n;
  }
  return null;
}

async function findManualCheckIdWithRisks(request: APIRequestContext): Promise<string | null> {
  const ids = await listManualCheckIds(request, 10);
  for (const id of ids) {
    const resp = await getManualCheckRisks(request, id);
    if (resp.status() !== 200) continue;
    const body = (await resp.json()) as ManualRisk[];
    if (Array.isArray(body) && body.length > 0) return id;
  }
  return null;
}

test.describe('Manual checks GET /manual-checks/{id}/risks/', () => {
  // Базовая проверка: ответ - массив, у риска есть id/type/risk_level/network_code/network_name
  test('возвращает список рисков с базовыми полями', async ({ request }) => {
    const id = await findManualCheckIdWithRisks(request);
    if (!id) test.skip(true, 'Не нашли manual-check с ненулевым списком рисков');

    const response = await getManualCheckRisks(request, id);
    expect(response.status()).toBe(200);

    const risks = (await response.json()) as ManualRisk[];
    expect(Array.isArray(risks)).toBeTruthy();
    expect(risks.length > 0).toBeTruthy();

    const allowedRiskLevels = new Set(['low', 'medium', 'high', 'severe']);
    for (const r of risks) {
      expect(r.id).toBeTruthy();
      expect(r.created_at).toBeTruthy();
      expect(r.type).toBeTruthy();
      expect(r.risk_level).toBeTruthy();
      expect(allowedRiskLevels.has((r.risk_level ?? '').toLowerCase())).toBeTruthy();
      expect(r.network_code).toBeTruthy();
      expect(r.network_name).toBeTruthy();

      // Важно по доке: client_ext_id всегда null
      expect(r.client_ext_id === null || r.client_ext_id === undefined).toBeTruthy();

      // Важно по доке: поля алерта всегда null
      expect(r.alert_id === null || r.alert_id === undefined).toBeTruthy();
      expect(r.alert_status === null || r.alert_status === undefined).toBeTruthy();
      expect(r.alert_assignee_name === null || r.alert_assignee_name === undefined).toBeTruthy();

      // risky_value_share (если есть) должен быть 0..1
      const share = toNumber01(r.risky_value_share);
      if (share !== null) expect(share >= 0 && share <= 1).toBeTruthy();
    }
  });

  // Проверка инвариантов для address рисков: risky_value/amount/fiat_value должны быть null
  test('address риски имеют risky_value/amount/fiat_value = null', async ({ request }) => {
    const id = await findManualCheckIdWithRisks(request);
    if (!id) test.skip(true, 'Не нашли manual-check с ненулевым списком рисков');

    const response = await getManualCheckRisks(request, id);
    expect(response.status()).toBe(200);
    const risks = (await response.json()) as ManualRisk[];

    const addressRisks = risks.filter((r) => r.type === 'address_entity' || r.type === 'address_exposure');
    if (addressRisks.length === 0) test.skip(true, 'Нет address_entity/address_exposure рисков для проверки');

    for (const r of addressRisks) {
      expect(r.risky_value === null || r.risky_value === undefined).toBeTruthy();
      expect(r.amount === null || r.amount === undefined).toBeTruthy();
      expect(r.fiat_value === null || r.fiat_value === undefined).toBeTruthy();
      // asset может быть null
      const assetOk = r.asset === null || r.asset === undefined || typeof r.asset === 'string';
      expect(assetOk).toBeTruthy();
    }
  });

  // Сверяем, что network_code/network_name риска совпадают с сетью из /manual-checks/{id}/
  test('network_code/network_name рисков совпадают с сетью проверки', async ({ request }) => {
    const id = await findManualCheckIdWithRisks(request);
    if (!id) test.skip(true, 'Не нашли manual-check с ненулевым списком рисков');

    const detailResp = await getManualCheckDetail(request, id);
    expect(detailResp.status()).toBe(200);
    const detail = (await detailResp.json()) as ManualCheckDetailResponse;

    const code = detail.transfer_info?.network_code ?? detail.address_info?.network_code;
    const name = detail.transfer_info?.network_name ?? detail.address_info?.network_name;
    if (!code || !name) test.skip(true, 'Нет network_code/network_name в detail для сверки');

    const risksResp = await getManualCheckRisks(request, id);
    expect(risksResp.status()).toBe(200);
    const risks = (await risksResp.json()) as ManualRisk[];
    for (const r of risks) {
      expect((r.network_code ?? '').toUpperCase()).toBe(code.toUpperCase());
      expect(r.network_name).toBe(name);
    }
  });

  // Негатив: невалидный id -> 404 или 400
  test('невалидный id возвращает 404 или 400', async ({ request }) => {
    const response = await getManualCheckRisks(request, '00000000-0000-0000-0000-000000000000');
    expect([400, 404]).toContain(response.status());
  });
});
