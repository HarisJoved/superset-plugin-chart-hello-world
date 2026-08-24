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
 * Client for the mining-dashboard alerts feed. Unlike the IoT gateway
 * (api.ts), this endpoint takes no broker/userId — it's called exactly as
 * given, with the sort/limit baked into the URL.
 */
const ALERTS_BASE = 'https://home.snap4idtcity.com/5508enb-y315/api/mining-dashboard-alerts';
const ALERTS_URL = `${ALERTS_BASE}?limit=1000&sortBy=createdAt&sortOrder=desc`;

export interface AlertRecord {
  id: string;
  message: string;
  eventType: string;
  severity: string;
  deviceName: string;
  deviceId: string;
  description: string;
  dateObserved: string;
  status: string;
  metadata: Record<string, unknown>;
  source?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AlertsResult {
  total: number;
  count: number;
  alerts: AlertRecord[];
}

interface RawAlert {
  _id?: unknown;
  message?: unknown;
  eventType?: unknown;
  severity?: unknown;
  deviceName?: unknown;
  deviceId?: unknown;
  description?: unknown;
  dateObserved?: unknown;
  status?: unknown;
  metadata?: unknown;
  source?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
}

function str(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback;
}

function parseAlertsResponse(json: unknown): AlertsResult {
  const payload = json as { total?: unknown; count?: unknown; alerts?: unknown };
  const rawAlerts: RawAlert[] = Array.isArray(payload?.alerts) ? (payload.alerts as RawAlert[]) : [];

  const alerts: AlertRecord[] = rawAlerts.map((a, i) => ({
    id: str(a._id, `alert-${i}`),
    message: str(a.message),
    eventType: str(a.eventType, 'Unknown'),
    severity: str(a.severity, 'unknown').toLowerCase(),
    deviceName: str(a.deviceName),
    deviceId: str(a.deviceId),
    description: str(a.description),
    dateObserved: str(a.dateObserved),
    status: str(a.status, 'unknown').toLowerCase(),
    metadata:
      a.metadata && typeof a.metadata === 'object'
        ? (a.metadata as Record<string, unknown>)
        : {},
    source: typeof a.source === 'string' ? a.source : undefined,
    createdAt: str(a.createdAt),
    updatedAt: str(a.updatedAt),
  }));

  return {
    total: typeof payload?.total === 'number' ? payload.total : alerts.length,
    count: typeof payload?.count === 'number' ? payload.count : alerts.length,
    alerts,
  };
}

export async function fetchAlerts(): Promise<AlertsResult> {
  const res = await fetch(ALERTS_URL);
  if (!res.ok) {
    throw new Error(`Alerts request failed (${res.status})`);
  }
  return parseAlertsResponse(await res.json());
}

/**
 * "Other alerts from this device" — used by the alert detail modal. Sorted
 * by dateObserved (not createdAt) per the given example call, so it reads
 * as a timeline of when the underlying events actually happened.
 */
export async function fetchAlertsForDevice(
  deviceId: string,
  limit = 10,
): Promise<AlertsResult> {
  const url = `${ALERTS_BASE}?deviceId=${encodeURIComponent(
    deviceId,
  )}&limit=${limit}&sortBy=dateObserved&sortOrder=desc`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Alerts request failed (${res.status})`);
  }
  return parseAlertsResponse(await res.json());
}

export function formatAlertDate(iso: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.toLocaleDateString(undefined, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })}, ${d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`;
}

const SEVERITY_COLORS: Record<string, { bg: string; fg: string }> = {
  critical: { bg: '#dc2626', fg: 'white' },
  high: { bg: '#f97316', fg: 'white' },
  medium: { bg: '#eab308', fg: '#1f2733' },
  moderate: { bg: '#eab308', fg: '#1f2733' },
  low: { bg: '#64748b', fg: 'white' },
};

export function severityColor(severity: string): { bg: string; fg: string } {
  return SEVERITY_COLORS[severity] || { bg: '#475569', fg: 'white' };
}

const STATUS_COLORS: Record<string, { bg: string; fg: string }> = {
  active: { bg: '#ef4444', fg: 'white' },
  resolved: { bg: '#10b981', fg: 'white' },
  acknowledged: { bg: '#f59e0b', fg: '#1f2733' },
};

export function statusColor(status: string): { bg: string; fg: string } {
  return STATUS_COLORS[status] || { bg: '#64748b', fg: 'white' };
}
