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
import React, { useEffect, useState } from 'react';
import { DeviceDatum } from './types';
import {
  HistoryPoint,
  HistoryResult,
  LatestDeviceData,
  deriveModelName,
  fetchDeviceHistory,
  fetchLatestDeviceData,
  formatAttrLabel,
  formatAttrValue,
  parseSensorId,
  resolveNgsiId,
} from './api';

/* ------------------------------------------------------------------ */
/* Shared hook: fetch the latest reading whenever the device changes. */
/* ------------------------------------------------------------------ */

export function useLatestDeviceData(deviceId: string | undefined) {
  const [data, setData] = useState<LatestDeviceData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!deviceId) {
      setData(null);
      setError('');
      return undefined;
    }
    let cancelled = false;
    setLoading(true);
    setError('');
    fetchLatestDeviceData(deviceId)
      .then(result => {
        if (!cancelled) setData(result);
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message || 'Failed to load sensor data.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [deviceId]);

  return { data, loading, error };
}

export function formatLastUpdated(iso?: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.toLocaleDateString(undefined, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })}, ${d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`;
}

/* ------------------------------------------------------------------ */
/* Right-hand detail panel — latest reading for the clicked sensor.   */
/* ------------------------------------------------------------------ */

interface DetailPanelProps {
  device: DeviceDatum;
  onClose: () => void;
  onViewGraph: () => void;
}

export function SensorDetailPanel({ device, onClose, onViewGraph }: DetailPanelProps) {
  const ngsiId = resolveNgsiId(device);
  const { data, loading, error } = useLatestDeviceData(ngsiId);
  const parsed = parseSensorId(ngsiId);
  const modelName = data?.entityType || device.modelName || parsed.modelName || 'Device';
  const title = parsed.sensorName || device.deviceName || device.deviceId;
  const eyebrow = `${modelName} sensor`.toUpperCase();
  const pill = data?.category || modelName;

  return (
    <div
      style={{
        position: 'absolute',
        // Clears the sensor-search box, which sits in this same corner
        // (top: 12) whenever there's at least one placed device — which is
        // always true here, since only placed devices get a marker to
        // click or a search result to select in the first place.
        top: 56,
        right: 16,
        zIndex: 3,
        width: 280,
        maxHeight: '82%',
        overflowY: 'auto',
        background: 'rgba(255,255,255,0.98)',
        border: '1px solid #e2e8f0',
        borderRadius: '12px',
        boxShadow: '0 8px 24px rgba(15,23,42,0.18)',
        padding: '16px 18px',
        fontSize: '13px',
        color: '#0f172a',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
        }}
      >
        <div>
          <div
            style={{
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: '0.08em',
              color: '#94a3b8',
              marginBottom: 2,
            }}
          >
            {eyebrow}
          </div>
          <div style={{ fontWeight: 700, fontSize: 17 }}>{title}</div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          style={{
            border: 'none',
            background: 'transparent',
            cursor: 'pointer',
            fontSize: 16,
            color: '#64748b',
            lineHeight: 1,
          }}
        >
          ×
        </button>
      </div>

      {pill && (
        <div
          style={{
            display: 'inline-block',
            marginTop: 10,
            padding: '3px 10px',
            borderRadius: 999,
            fontSize: 11,
            fontWeight: 700,
            color: '#b45309',
            background: '#fef3c7',
          }}
        >
          {String(pill)}
        </div>
      )}

      <div
        style={{
          marginTop: 16,
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: '0.08em',
          color: '#94a3b8',
        }}
      >
        SENSOR DATA
      </div>

      {loading && (
        <div style={{ padding: '10px 0', color: '#64748b' }}>Loading…</div>
      )}

      {!loading && error && (
        <div style={{ padding: '10px 0', color: '#b91c1c', fontSize: 12 }}>
          {error}
        </div>
      )}

      {!loading && !error && data && (
        <div style={{ marginTop: 6 }}>
          {data.attributes.length === 0 && (
            <div style={{ color: '#94a3b8', padding: '6px 0' }}>
              No sensor attributes returned.
            </div>
          )}
          {data.attributes.map(attr => (
            <div
              key={attr.key}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                gap: 12,
                padding: '7px 0',
                borderBottom: '1px solid #f1f5f9',
              }}
            >
              <div style={{ color: '#475569', flexShrink: 0 }}>{formatAttrLabel(attr.key)}</div>
              <div
                style={{
                  fontWeight: 600,
                  textAlign: 'right',
                  minWidth: 0,
                  wordBreak: 'break-word',
                }}
              >
                {formatAttrValue(attr.value)}
              </div>
            </div>
          ))}

          <div style={{ marginTop: 12, fontSize: 11, color: '#94a3b8' }}>
            Last Updated: {formatLastUpdated(data.lastUpdated)}
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={onViewGraph}
        style={{
          marginTop: 16,
          width: '100%',
          padding: '10px 0',
          borderRadius: 8,
          border: 'none',
          background: '#2563eb',
          color: 'white',
          fontWeight: 700,
          fontSize: 13,
          cursor: 'pointer',
        }}
      >
        ↗ VIEW GRAPH
      </button>
      <button
        type="button"
        onClick={onClose}
        style={{
          marginTop: 8,
          width: '100%',
          padding: '10px 0',
          borderRadius: 8,
          border: 'none',
          background: '#0f172a',
          color: 'white',
          fontWeight: 700,
          fontSize: 13,
          cursor: 'pointer',
        }}
      >
        Close
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Small dependency-free line/area chart for one attribute's history. */
/* ------------------------------------------------------------------ */

export function formatTick(ms: number): string {
  const d = new Date(ms);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${mm}/${dd} ${hh}:${min}`;
}

export function AttributeAreaChart({ points }: { points: HistoryPoint[] }) {
  const width = 780;
  const height = 190;
  const padL = 48;
  const padR = 12;
  const padT = 14;
  const padB = 38;

  if (points.length === 0) {
    return (
      <div style={{ padding: '24px 0', textAlign: 'center', color: '#94a3b8', fontSize: 12 }}>
        No historical data in range.
      </div>
    );
  }

  const values = points.map(p => p.v);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  const tMin = points[0].t;
  const tMax = points[points.length - 1].t;

  const yPad = (max - min) * 0.1 || Math.abs(max) * 0.1 || 1;
  const yMin = Math.min(0, min - yPad);
  const yMax = max + yPad;

  const xScale = (t: number) =>
    padL + ((t - tMin) / (tMax - tMin || 1)) * (width - padL - padR);
  const yScale = (v: number) =>
    padT + (1 - (v - yMin) / (yMax - yMin || 1)) * (height - padT - padB);

  const linePath = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${xScale(p.t).toFixed(1)},${yScale(p.v).toFixed(1)}`)
    .join(' ');
  const areaPath = `${linePath} L${xScale(tMax).toFixed(1)},${(height - padB).toFixed(1)} L${xScale(
    tMin,
  ).toFixed(1)},${(height - padB).toFixed(1)} Z`;

  const yTicks = 4;
  const yTickValues = Array.from({ length: yTicks + 1 }, (_, i) => yMin + ((yMax - yMin) * i) / yTicks);

  const xTickCount = Math.min(6, points.length);
  const xTickIdx = Array.from({ length: xTickCount }, (_, i) =>
    Math.round((i * (points.length - 1)) / Math.max(xTickCount - 1, 1)),
  );

  return (
    <div>
      <div style={{ textAlign: 'center', fontSize: 11, color: '#64748b', marginBottom: 4 }}>
        Min: {min.toFixed(2)} | Max: {max.toFixed(2)} | Avg: {avg.toFixed(2)}
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} style={{ width: '100%', height: 'auto', display: 'block' }}>
        {yTickValues.map(v => (
          <g key={v}>
            <line
              x1={padL}
              x2={width - padR}
              y1={yScale(v)}
              y2={yScale(v)}
              stroke="#e2e8f0"
              strokeWidth={1}
            />
            <text x={padL - 8} y={yScale(v) + 3} textAnchor="end" fontSize={10} fill="#94a3b8">
              {v.toFixed(1)}
            </text>
          </g>
        ))}
        <path d={areaPath} fill="rgba(37, 99, 235, 0.12)" stroke="none" />
        <path d={linePath} fill="none" stroke="#2563eb" strokeWidth={2} />
        {xTickIdx.map(i => (
          <text
            key={i}
            x={xScale(points[i].t)}
            y={height - padB + 16}
            textAnchor="end"
            fontSize={10}
            fill="#94a3b8"
            transform={`rotate(-30 ${xScale(points[i].t)} ${height - padB + 16})`}
          >
            {formatTick(points[i].t)}
          </text>
        ))}
        <line x1={padL} x2={padL} y1={padT} y2={height - padB} stroke="#cbd5e1" strokeWidth={1} />
        <line
          x1={padL}
          x2={width - padR}
          y1={height - padB}
          y2={height - padB}
          stroke="#cbd5e1"
          strokeWidth={1}
        />
      </svg>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Graph modal — historical series for every numeric attribute.       */
/* ------------------------------------------------------------------ */

interface GraphModalProps {
  device: DeviceDatum;
  entityType?: string;
  onClose: () => void;
}

export function SensorGraphModal({ device, entityType, onClose }: GraphModalProps) {
  const ngsiId = resolveNgsiId(device);
  const parsed = parseSensorId(ngsiId);
  const modelName = deriveModelName(ngsiId, entityType || device.modelName);
  const sensorName = parsed.sensorName || device.deviceName || device.deviceId;
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [result, setResult] = useState<HistoryResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set());

  const load = () => {
    if (!modelName) {
      setError('Could not determine the sensor model name (model_name) for this device.');
      return;
    }
    setLoading(true);
    setError('');
    fetchDeviceHistory(ngsiId, modelName, {
      from: from || undefined,
      to: to || undefined,
      latest: from || to ? undefined : 1,
    })
      .then(setResult)
      .catch((e: Error) => setError(e.message || 'Failed to load history.'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ngsiId]);

  const series = result?.series || [];
  const allCollapsed = series.length > 0 && collapsedIds.size === series.length;

  const toggleAll = () => {
    setCollapsedIds(allCollapsed ? new Set() : new Set(series.map(s => s.attribute)));
  };
  const toggleOne = (attr: string) => {
    setCollapsedIds(prev => {
      const next = new Set(prev);
      if (next.has(attr)) next.delete(attr);
      else next.add(attr);
      return next;
    });
  };

  return (
    <div
      style={{
        position: 'absolute',
        top: 12,
        left: 16,
        bottom: 12,
        width: 460,
        maxWidth: 'calc(100% - 320px)',
        zIndex: 5,
        background: 'rgba(255,255,255,0.98)',
        border: '1px solid #e2e8f0',
        borderRadius: '12px',
        boxShadow: '0 8px 24px rgba(15,23,42,0.2)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        fontSize: 13,
        color: '#0f172a',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '12px 16px',
          borderBottom: '1px solid #e2e8f0',
        }}
      >
        <div style={{ fontWeight: 700, fontSize: 14 }}>
          ↗ Sensor Graph - {sensorName}
          {modelName && (
            <span style={{ fontWeight: 500, color: '#64748b' }}> · {modelName}</span>
          )}
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <button
            type="button"
            onClick={load}
            aria-label="Refresh"
            style={{ border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 14 }}
          >
            ↻
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{ border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 16 }}
          >
            ×
          </button>
        </div>
      </div>

      <div style={{ padding: '12px 16px', borderBottom: '1px solid #e2e8f0' }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <label style={{ fontSize: 11, color: '#64748b' }}>
            Start
            <input
              type="date"
              value={from}
              onChange={e => setFrom(e.target.value)}
              style={{
                display: 'block',
                marginTop: 4,
                padding: '5px 8px',
                borderRadius: 6,
                border: '1px solid #cbd5e1',
                fontSize: 12,
              }}
            />
          </label>
          <label style={{ fontSize: 11, color: '#64748b' }}>
            End
            <input
              type="date"
              value={to}
              onChange={e => setTo(e.target.value)}
              style={{
                display: 'block',
                marginTop: 4,
                padding: '5px 8px',
                borderRadius: 6,
                border: '1px solid #cbd5e1',
                fontSize: 12,
              }}
            />
          </label>
          <button
            type="button"
            onClick={load}
            style={{
              padding: '6px 12px',
              borderRadius: 6,
              border: '1px solid #2563eb',
              background: '#eff6ff',
              color: '#2563eb',
              fontWeight: 700,
              fontSize: 12,
              cursor: 'pointer',
            }}
          >
            Filter
          </button>
          {result && (
            <div
              style={{
                marginLeft: 'auto',
                fontSize: 11,
                color: '#475569',
                background: '#f1f5f9',
                borderRadius: 999,
                padding: '4px 10px',
              }}
            >
              {result.recordCount} records
            </div>
          )}
        </div>

        {series.length > 0 && (
          <button
            type="button"
            onClick={toggleAll}
            style={{
              marginTop: 10,
              padding: '6px 12px',
              borderRadius: 6,
              border: 'none',
              background: '#2563eb',
              color: 'white',
              fontWeight: 700,
              fontSize: 12,
              cursor: 'pointer',
            }}
          >
            {allCollapsed ? '⌄' : '⌃'} {allCollapsed ? 'Expand' : 'Collapse'} {series.length}
          </button>
        )}
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px' }}>
        {loading && <div style={{ color: '#64748b' }}>Loading…</div>}
        {!loading && error && <div style={{ color: '#b91c1c', fontSize: 12 }}>{error}</div>}
        {!loading && !error && series.length === 0 && (
          <div style={{ color: '#94a3b8' }}>No numeric attributes with history in range.</div>
        )}
        {!loading &&
          !error &&
          series.map((s, idx) => {
            const collapsed = collapsedIds.has(s.attribute);
            return (
              <div
                key={s.attribute}
                style={{
                  border: '1px solid #e2e8f0',
                  borderRadius: 10,
                  marginBottom: 12,
                  overflow: 'hidden',
                }}
              >
                <button
                  type="button"
                  onClick={() => toggleOne(s.attribute)}
                  style={{
                    width: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '10px 12px',
                    border: 'none',
                    background: '#f8fafc',
                    cursor: 'pointer',
                    textAlign: 'left',
                  }}
                >
                  <span
                    style={{
                      width: 22,
                      height: 22,
                      borderRadius: 999,
                      background: '#2563eb',
                      color: 'white',
                      fontSize: 10,
                      fontWeight: 700,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                    }}
                  >
                    {String(idx + 1).padStart(2, '0')}
                  </span>
                  <span style={{ fontWeight: 700, fontSize: 13 }}>
                    {formatAttrLabel(s.attribute)}
                  </span>
                  <span style={{ marginLeft: 'auto', fontSize: 12, color: '#94a3b8' }}>
                    {collapsed ? '⌄' : '⌃'}
                  </span>
                </button>
                {!collapsed && (
                  <div style={{ padding: '10px 12px' }}>
                    <AttributeAreaChart points={s.points} />
                  </div>
                )}
              </div>
            );
          })}
      </div>
    </div>
  );
}
