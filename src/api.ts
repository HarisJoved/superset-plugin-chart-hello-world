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
 * a bare "Aelita2S-001" 500s. Which field actually holds that full id is a
 * dataset-configuration detail we can't assume: it might be the "Sensor ID
 * Column" (deviceId), the "Sensor Label Column" (deviceName), or — as is
 * apparently the case here — an "Extra Column" like Full_Device_Name, which
 * lands under its own dynamic key on the device object. So rather than
 * checking specific fields, scan every field on the device (in a stable,
 * predictable order) and use the first one that actually looks like a full
 * NGSI urn, falling back to the raw deviceId if none do.
 */
const NGSI_URN_RE = /^urn:ngsi-v2:[^:]+:.+$/i;

export function resolveNgsiId(device: {
  deviceId: string;
  deviceName?: unknown;
  [key: string]: unknown;
}): string {
  if (NGSI_URN_RE.test(device.deviceId)) return device.deviceId;
  if (typeof device.deviceName === 'string' && NGSI_URN_RE.test(device.deviceName)) {
    return device.deviceName;
  }
  const extraMatch = Object.keys(device)
    .filter(k => k !== 'deviceId' && k !== 'deviceName')
    .sort()
    .map(k => device[k])
    .find((v): v is string => typeof v === 'string' && NGSI_URN_RE.test(v));
  return extraMatch || device.deviceId;
}

/** Parsed pieces of an NGSI urn: "urn:ngsi-v2:Coolon-Light:Aelita2S-002". */
export interface ParsedSensorId {
  /** "Coolon-Light" — the model/entity type. */
  modelName: string;
  /** "Aelita2S-002" — the human sensor name, with the urn stripped off. */
  sensorName: string;
  /** True if `ngsiId` actually parsed as a urn; false if we just fell back to the raw string. */
  isNgsiUrn: boolean;
}

/**
 * "urn:ngsi-v2:Coolon-Light:Aelita2S-002" -> { modelName: "Coolon-Light", sensorName: "Aelita2S-002" }
 *
 * This is the single source of truth for turning a raw NGSI id into
 * display-friendly pieces — every place in the UI that shows a sensor name
 * or its model should go through this instead of rendering the urn as-is.
 * Anything that isn't a `urn:ngsi-v2:...` string (e.g. a device with no
 * matching full-id field at all) is returned as-is for both pieces, so
 * callers can render it without special-casing.
 */
export function parseSensorId(ngsiId: string): ParsedSensorId {
  const parts = ngsiId.split(':');
  if (parts.length >= 4 && parts[0].toLowerCase() === 'urn' && parts[1].toLowerCase() === 'ngsi-v2') {
    return {
      modelName: parts[2],
      sensorName: parts.slice(3).join(':'),
      isNgsiUrn: true,
    };
  }
  return { modelName: '', sensorName: ngsiId, isNgsiUrn: false };
}

function buildQuery(params: Record<string, string | number | undefined>): string {
  const parts = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`);
  return parts.length ? `?${parts.join('&')}` : '';
}

/**
 * Every fetch to the IoT gateway goes through this — a plain `fetch()` has
 * no timeout, so a slow or silently-hanging gateway response (which is
 * exactly what happens if it's rate-limiting a burst of concurrent
 * requests, e.g. the Devices table paging in 20 sensors' latest readings
 * at once) leaves the caller "loading" forever with nothing to show for
 * it. This guarantees the promise settles one way or another.
 */
const REQUEST_TIMEOUT_MS = 15000;

async function fetchWithTimeout(url: string, timeoutMs = REQUEST_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') {
      throw new Error(`Request timed out after ${Math.round(timeoutMs / 1000)}s`);
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
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
  const res = await fetchWithTimeout(url);
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
  // History payloads can be a lot bigger than a "latest" snapshot (up to
  // `limit` observations), so this gets a longer timeout than the default.
  const res = await fetchWithTimeout(url, 25000);
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
  return parseSensorId(ngsiId).modelName;
}

export function formatAttrLabel(key: string): string {
  return key.replace(/_/g, ' ');
}

/** Small icon for an attribute, guessed from its key — purely cosmetic, so
 * an unrecognised key just falls back to a plain bullet rather than
 * breaking anything. */
export function attrIcon(key: string): string {
  const k = key.toLowerCase();
  if (k.includes('brightness') || k.includes('light_level') || k.includes('lux')) return '💡';
  if (k.includes('humid')) return '💧';
  if (k.includes('temp')) return '🌡️';
  if (k.includes('pressure')) return '📊';
  if (k.includes('noise') || k.includes('sound') || k.includes('_db') || k === 'db') return '🔊';
  if (k.includes('motion')) return '🚶';
  if (k.includes('power_source')) return '🔌';
  if (k.includes('power') || k.includes('voltage') || k.includes('current')) return '⚡';
  if (k.includes('battery')) return '🔋';
  if (k.includes('online') || k.includes('connected') || k.includes('uptime')) return '⏱️';
  if (k.includes('dust') || k.includes('pm10') || k.includes('pm25') || k.includes('particulate')) return '🌫️';
  if (k.includes('water') || k.includes('flow') || k.includes('flood')) return '💦';
  if (k.includes('wind')) return '🍃';
  if (k.includes('co2') || k.includes('gas') || k.includes('air_quality') || k === 'aqi') return '🌬️';
  if (k.includes('location') || k.includes('gps') || k.includes('latitude') || k.includes('longitude')) return '📍';
  if (k.includes('uv')) return '☀️';
  return '•';
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;

export function formatAttrValue(value: unknown): string {
  if (typeof value === 'number') {
    return Number.isInteger(value) ? String(value) : value.toFixed(2);
  }
  if (value === null || value === undefined) return '—';
  // Raw ISO timestamps ("2026-01-29T02:42:05.633Z") are common in NGSI
  // payloads (dateObserved, TimeInstant, ...) — shown as-is they're both
  // unreadable and, being one long unbreakable token, prone to overflowing
  // whatever fixed-width panel is displaying them.
  if (typeof value === 'string' && ISO_DATE_RE.test(value)) {
    const d = new Date(value);
    if (!Number.isNaN(d.getTime())) {
      return `${d.toLocaleDateString(undefined, {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      })}, ${d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`;
    }
  }
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/** Bucket key for sensors whose id doesn't parse as a full NGSI urn (so we
 * can't tell which model they belong to). Shared by every place in the UI
 * that groups or filters sensors by model — the placement editor, the
 * viewer's model filter, and the Devices table's model chips all need the
 * exact same bucketing or "Coolon-Light" in one place and "Other sensors"
 * in another for the same sensor. */
export const OTHER_MODEL_KEY = '__other_sensors__';

export function deviceModelKey(device: {
  deviceId: string;
  deviceName?: unknown;
  [key: string]: unknown;
}): string {
  const parsed = parseSensorId(resolveNgsiId(device));
  return parsed.isNgsiUrn && parsed.modelName ? parsed.modelName : OTHER_MODEL_KEY;
}

/** Visual identity (accent colour + icon) for one sensor model, used to
 * colour-code the model filter chips and the row badges in the Devices
 * table so a busy fleet reads as distinct categories at a glance instead of
 * one flat list. Keyword-matched against the model key first (so
 * "Coolon-Light" reliably lands on the "lighting" colour regardless of
 * vendor prefix); anything that doesn't match a known category still gets a
 * stable colour, hashed from its name so the same model always renders the
 * same way. */
export interface ModelStyle {
  color: string;
  icon: string;
}

const MODEL_STYLE_RULES: { match: RegExp; color: string; icon: string }[] = [
  { match: /weather|climate|env/i, color: '#38bdf8', icon: '☁️' },
  { match: /light|lumin|lux/i, color: '#f59e0b', icon: '💡' },
  { match: /noise|sound|acoustic|audio/i, color: '#22c55e', icon: '🔊' },
  { match: /dust|particulate|pm\d/i, color: '#b45309', icon: '🌫️' },
  { match: /water|flow|flood|leak|moisture/i, color: '#0ea5e9', icon: '💧' },
  { match: /temp|thermo|hvac/i, color: '#ef4444', icon: '🌡️' },
  { match: /motion|presence|occupan|pir/i, color: '#a855f7', icon: '🚶' },
  { match: /gas|air|co2|aqi|smoke/i, color: '#14b8a6', icon: '🌬️' },
  { match: /camera|cctv|vision/i, color: '#6366f1', icon: '📷' },
  { match: /power|energy|volt|current/i, color: '#eab308', icon: '⚡' },
  { match: /door|access|lock/i, color: '#ec4899', icon: '🚪' },
];

const MODEL_FALLBACK_COLORS = ['#818cf8', '#f472b6', '#4ade80', '#fb923c', '#2dd4bf', '#c084fc'];

function hashModelKey(key: string): number {
  let hash = 0;
  for (let i = 0; i < key.length; i += 1) {
    hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  }
  return hash;
}

export function modelStyle(modelKey: string): ModelStyle {
  if (modelKey === OTHER_MODEL_KEY) return { color: '#64748b', icon: '📦' };
  const rule = MODEL_STYLE_RULES.find(r => r.match.test(modelKey));
  if (rule) return { color: rule.color, icon: rule.icon };
  const color = MODEL_FALLBACK_COLORS[hashModelKey(modelKey) % MODEL_FALLBACK_COLORS.length];
  return { color, icon: '🔧' };
}

/** `#2563eb` -> `rgba(37,99,235,0.16)`  used to tint chip/badge backgrounds
 * with a model's accent colour without hardcoding a second palette. */
export function hexToRgba(hex: string, alpha: number): string {
  const clean = hex.replace('#', '');
  const bigint = parseInt(
    clean.length === 3
      ? clean.split('').map(c => c + c).join('')
      : clean,
    16,
  );
  const r = (bigint >> 16) & 255;
  const g = (bigint >> 8) & 255;
  const b = bigint & 255;
  return `rgba(${r},${g},${b},${alpha})`;
}

/** "Aelita2S-002" instead of "urn:ngsi-v2:Coolon-Light:Aelita2S-002" — the
 * one place every sensor-name display in the UI should go through. */
export function sensorDisplayName(device: {
  deviceId: string;
  deviceName?: unknown;
  [key: string]: unknown;
}): string {
  const parsed = parseSensorId(resolveNgsiId(device));
  return (
    parsed.sensorName ||
    (typeof device.deviceName === 'string' ? device.deviceName : '') ||
    device.deviceId
  );
}
