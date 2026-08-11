/**
 * Licensed to the Apache Software Foundation (ASF) under one
 * or more contributor license agreements.  See the NOTICE file
 * distributed with this work for additional information
 * regarding copyright ownership.  The ASF licenses this file
 * to you under the Apache License, Version 2.0 (the
 * "License"); you may not use this file except in compliance
 * with the License.  You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied.  See the License for the
 * specific language governing permissions and limitations
 * under the License.
 */

/**
 * Client for the IDT Cities IoT gateway that backs the "click a sensor"
 * flow: one call for the sensor's latest reading (the right-hand detail
 * panel) and one for its history (the graph modal).
 *
 * Auth is via the `userId` (+ `broker`) query params, matching the working
 * example calls we were given — not the Basic Auth documented for the
 * `app.idtcities.com` host. Both are hardcoded per those examples; there is
 * no per-tenant config for this in the chart today.
 */

const API_BASE = 'https://app.snap4idtcity.com';
const BROKER = 'orionIDT';
const USER_ID = '1e6ce6bd-35bc-4aa5-9bf0-58c43a91083e';

/** One flattened attribute from a "latest" (context) response. */
export interface LatestAttribute {
  key: string;
  value: unknown;
  type?: string;
  /** ISO timestamp this specific attribute was last observed, if present. */
  timeInstant?: string;
}

export interface LatestDeviceData {
  deviceId: string;
  /** NGSI entity `type`, e.g. "Coolon-Light" — also the history API's model_name. */
  entityType?: string;
  /** Best-guess category label for the badge/pill (Nature/Subnature/HighLevelType). */
  category?: string;
  /** Most recent TimeInstant across all attributes, ISO string. */
  lastUpdated?: string;
  attributes: LatestAttribute[];
  raw: Record<string, unknown>;
}

export interface HistoryPoint {
  /** Epoch ms, parsed from dateObserved. */
  t: number;
  v: number;
}

export interface HistorySeries {
  attribute: string;
  points: HistoryPoint[];
}

export interface HistoryResult {
  /** Number of raw observation records returned by the API. */
  recordCount: number;
  series: HistorySeries[];
}

/** NGSI-v2 attribute keys that describe the entity rather than measure it —
 * kept out of the "SENSOR DATA" list and out of the graph modal. */
const NON_MEASUREMENT_KEYS = new Set([
  'id',
  'type',
  'TimeInstant',
  'HighLevelType',
  'Icon',
  'Nature',
  'Subnature',
  'location',
  'latitude',
  'longitude',
]);

/**
 * The gateway needs the *full* NGSI id ("urn:ngsi-v2:Coolon-Light:Aelita2S-001") —
 * a bare "Aelita2S-001" 500s. In dataset mode the "Sensor ID Column" and
 * "Sensor Label Column" are two independent mappings, so it's entirely
 * possible (and, per a real device viewer, apparently the case) that the id
 * column holds the short id while the label column holds the full urn, or
 * vice versa. Rather than assume which one is "right", prefer whichever of
 * deviceId / deviceName actually looks like a full NGSI urn, and only fall
 * back to the raw deviceId if neither does.
 */
const NGSI_URN_RE = /^urn:ngsi-v2:[^:]+:.+$/i;

export function resolveNgsiId(deviceId: string, deviceName?: unknown): string {
  if (NGSI_URN_RE.test(deviceId)) return deviceId;
  if (typeof deviceName === 'string' && NGSI_URN_RE.test(deviceName)) {
    return deviceName;
  }
  return deviceId;
}

function buildQuery(params: Record<string, string | number | undefined>): string {
  const parts = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`);
  return parts.length ? `?${parts.join('&')}` : '';
}

/**
 * device_id and model_name go straight into the URL path unencoded (as in
 * the example calls) since they're NGSI URNs like
 * "urn:ngsi-v2:Coolon-Light:Aelita2S-001" and encoding the colons breaks
 * the gateway's routing.
 */
export async function fetchLatestDeviceData(
  deviceId: string,
): Promise<LatestDeviceData> {
  const url = `${API_BASE}/iot-agent/context/devices/${deviceId}${buildQuery({
    broker: BROKER,
    userId: USER_ID,
  })}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Latest data request failed (${res.status})`);
  }
  const json = await res.json();
  return parseLatestResponse(deviceId, json);
}

function parseLatestResponse(
  deviceId: string,
  json: Record<string, unknown>,
): LatestDeviceData {
  const attributes: LatestAttribute[] = [];
  let lastUpdated: string | undefined;
  let category: string | undefined;

  Object.entries(json || {}).forEach(([key, entry]) => {
    if (key === 'id' || key === 'type') return;
    const field = entry as {
      value?: unknown;
      type?: string;
      metadata?: { TimeInstant?: { value?: string } };
    };
    const timeInstant = field?.metadata?.TimeInstant?.value;
    if (timeInstant && (!lastUpdated || timeInstant > lastUpdated)) {
      lastUpdated = timeInstant;
    }
    if (key === 'TimeInstant' && typeof field?.value === 'string') {
      if (!lastUpdated || field.value > lastUpdated) lastUpdated = field.value;
    }
    if ((key === 'Nature' || key === 'Subnature') && !category) {
      category = String(field?.value ?? '') || undefined;
    }
    if (NON_MEASUREMENT_KEYS.has(key)) return;
    attributes.push({
      key,
      value: field?.value,
      type: field?.type,
      timeInstant,
    });
  });

  return {
    deviceId,
    entityType: typeof json?.type === 'string' ? (json.type as string) : undefined,
    category,
    lastUpdated,
    attributes,
    raw: json,
  };
}

export interface HistoryOptions {
  /** ISO date (yyyy-mm-dd) or full ISO timestamp. */
  from?: string;
  to?: string;
  /** Used only when neither from nor to is set. Defaults to the last month. */
  latest?: string | number;
  limit?: number;
}

/**
 * `model_name` is the NGSI entity type (e.g. "Coolon-Light") — pass
 * `device.modelName`, falling back to the type segment of the deviceId
 * ("urn:ngsi-v2:<modelName>:<id>") when it isn't set explicitly.
 */
export async function fetchDeviceHistory(
  deviceId: string,
  modelName: string,
  options: HistoryOptions = {},
): Promise<HistoryResult> {
  const { from, to, latest, limit } = options;
  const query = buildQuery({
    broker: BROKER,
    userId: USER_ID,
    from,
    to,
    // Only sent when there's no explicit range.
    latest: !from && !to ? latest ?? 1 : undefined,
    limit: limit ?? 2000,
  });
  const url = `${API_BASE}/iot-agent/history/devices/${deviceId}/${modelName}${query}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`History request failed (${res.status})`);
  }
  const json = await res.json();
  return parseHistoryResponse(json);
}

interface HistoryAttr {
  attributeName: string;
  attributeType: string;
  attributeValue: string;
}

function parseHistoryResponse(json: unknown): HistoryResult {
  const rows: HistoryAttr[][] = Array.isArray(json) ? (json as HistoryAttr[][]) : [];
  const seriesMap = new Map<string, HistoryPoint[]>();
  const order: string[] = [];

  rows.forEach(row => {
    if (!Array.isArray(row)) return;
    const dateAttr = row.find(a => a.attributeName === 'dateObserved');
    if (!dateAttr) return;
    const t = Date.parse(dateAttr.attributeValue);
    if (Number.isNaN(t)) return;

    row.forEach(attr => {
      if (NON_MEASUREMENT_KEYS.has(attr.attributeName)) return;
      if (attr.attributeName === 'dateObserved' || attr.attributeName === 'device_id') {
        return;
      }
      const v = Number(attr.attributeValue);
      if (Number.isNaN(v)) return; // non-numeric attrs aren't chartable
      if (!seriesMap.has(attr.attributeName)) {
        seriesMap.set(attr.attributeName, []);
        order.push(attr.attributeName);
      }
      seriesMap.get(attr.attributeName)!.push({ t, v });
    });
  });

  const series: HistorySeries[] = order.map(attribute => ({
    attribute,
    points: (seriesMap.get(attribute) || []).sort((a, b) => a.t - b.t),
  }));

  return { recordCount: rows.length, series };
}

/** "Coolon-Light" out of "urn:ngsi-v2:Coolon-Light:Aelita2S-001". */
export function deriveModelName(ngsiId: string, explicit?: string): string {
  if (explicit) return explicit;
  const parts = ngsiId.split(':');
  if (parts.length >= 4 && parts[0] === 'urn') return parts[2];
  return explicit || '';
}

export function formatAttrLabel(key: string): string {
  return key.replace(/_/g, ' ');
}

export function formatAttrValue(value: unknown): string {
  if (typeof value === 'number') {
    return Number.isInteger(value) ? String(value) : value.toFixed(2);
  }
  if (value === null || value === undefined) return '—';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}
