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
import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertRecord,
  fetchAlerts,
  formatAlertDate,
  severityColor,
  statusColor,
} from './alertsApi';
import { AlertDetailModal } from './AlertDetailModal';
import { PanelId, PanelNav } from './PanelNav';

// Keeps the "Live" badge honest without hammering the endpoint — alerts are
// a slow-moving feed (device-triggered events, not a tick-by-tick stream).
const AUTO_REFRESH_MS = 60000;
const ROWS_PER_PAGE_OPTIONS = [10, 25, 50, 100];

interface AlertsPanelProps {
  activePanel: PanelId;
  onNavigate: (panel: PanelId) => void;
}

export function AlertsPanel({ activePanel, onNavigate }: AlertsPanelProps) {
  const [alerts, setAlerts] = useState<AlertRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [lastFetchedAt, setLastFetchedAt] = useState<number | null>(null);
  const [selectedAlert, setSelectedAlert] = useState<AlertRecord | null>(null);

  const [search, setSearch] = useState('');
  const [severityFilter, setSeverityFilter] = useState('__all__');
  const [eventTypeFilter, setEventTypeFilter] = useState('__all__');
  const [statusFilter, setStatusFilter] = useState('__all__');
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(25);

  function load() {
    setLoading(true);
    setError('');
    fetchAlerts()
      .then(result => {
        setAlerts(result.alerts);
        setLastFetchedAt(Date.now());
      })
      .catch((e: Error) => setError(e.message || 'Failed to load alerts.'))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
    const interval = window.setInterval(load, AUTO_REFRESH_MS);
    return () => window.clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const severityOptions = useMemo(
    () => Array.from(new Set(alerts.map(a => a.severity))).sort(),
    [alerts],
  );
  const eventTypeOptions = useMemo(
    () => Array.from(new Set(alerts.map(a => a.eventType))).sort(),
    [alerts],
  );
  const statusOptions = useMemo(
    () => Array.from(new Set(alerts.map(a => a.status))).sort(),
    [alerts],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return alerts.filter(a => {
      if (severityFilter !== '__all__' && a.severity !== severityFilter) return false;
      if (eventTypeFilter !== '__all__' && a.eventType !== eventTypeFilter) return false;
      if (statusFilter !== '__all__' && a.status !== statusFilter) return false;
      if (!q) return true;
      return (
        a.message.toLowerCase().includes(q) ||
        a.description.toLowerCase().includes(q) ||
        a.deviceName.toLowerCase().includes(q) ||
        a.deviceId.toLowerCase().includes(q) ||
        a.eventType.toLowerCase().includes(q)
      );
    });
  }, [alerts, search, severityFilter, eventTypeFilter, statusFilter]);

  useEffect(() => {
    setPage(0);
  }, [search, severityFilter, eventTypeFilter, statusFilter, rowsPerPage]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / rowsPerPage));
  const safePage = Math.min(page, pageCount - 1);
  const pageRows = filtered.slice(safePage * rowsPerPage, safePage * rowsPerPage + rowsPerPage);
  const rangeStart = filtered.length === 0 ? 0 : safePage * rowsPerPage + 1;
  const rangeEnd = Math.min(filtered.length, safePage * rowsPerPage + rowsPerPage);

  function downloadCsv() {
    const header = [
      'Event Type',
      'Severity',
      'Device Name',
      'Device ID',
      'Status',
      'Date Observed',
      'Description',
      'Message',
    ];
    const rows = filtered.map(a => [
      a.eventType,
      a.severity,
      a.deviceName,
      a.deviceId,
      a.status,
      a.dateObserved,
      a.description,
      a.message,
    ]);
    const escape = (v: string) => `"${v.replace(/"/g, '""')}"`;
    const csv = [header, ...rows].map(row => row.map(escape).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'alerts.csv';
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 30,
        background: '#0b0f17',
        color: '#e2e8f0',
        display: 'flex',
        flexDirection: 'column',
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '14px 20px',
          borderBottom: '1px solid #1f2733',
          flexWrap: 'wrap',
        }}
      >
        <PanelNav
          active={activePanel}
          onNavigate={onNavigate}
          alertCount={alerts.length}
          variant="dark"
          menuDirection="down"
        />

        <div style={{ fontSize: 18, fontWeight: 700 }}>Mining Dashboard Alerts</div>

        {!error && (
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 5,
              padding: '3px 10px',
              borderRadius: 999,
              fontSize: 11,
              fontWeight: 700,
              color: '#052e1a',
              background: '#34d399',
            }}
          >
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                background: '#052e1a',
                display: 'inline-block',
              }}
            />
            Live
          </span>
        )}

        <span
          style={{
            padding: '3px 10px',
            borderRadius: 999,
            fontSize: 11,
            fontWeight: 700,
            color: '#cbd5e1',
            background: '#1a212c',
            border: '1px solid #2a3341',
          }}
        >
          {filtered.length === alerts.length
            ? `${alerts.length} Alerts`
            : `${filtered.length} of ${alerts.length} Alerts`}
        </span>

        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <button
            type="button"
            onClick={downloadCsv}
            disabled={filtered.length === 0}
            title="Download CSV"
            style={{ ...iconButtonStyle, opacity: filtered.length === 0 ? 0.4 : 1 }}
          >
            ⬇
          </button>
          <button type="button" onClick={load} title="Refresh" style={iconButtonStyle}>
            ↻
          </button>
        </div>
      </div>

      <div
        style={{
          display: 'flex',
          gap: 12,
          alignItems: 'flex-end',
          padding: '14px 20px',
          borderBottom: '1px solid #1f2733',
          flexWrap: 'wrap',
        }}
      >
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search alerts…"
          style={{ ...searchInputStyle, flex: 1, minWidth: 220 }}
        />

        <label style={filterLabelStyle}>
          Severity
          <select
            value={severityFilter}
            onChange={e => setSeverityFilter(e.target.value)}
            style={selectStyle}
          >
            <option value="__all__">All Severity</option>
            {severityOptions.map(s => (
              <option key={s} value={s}>
                {s.charAt(0).toUpperCase() + s.slice(1)}
              </option>
            ))}
          </select>
        </label>

        <label style={filterLabelStyle}>
          Event Type
          <select
            value={eventTypeFilter}
            onChange={e => setEventTypeFilter(e.target.value)}
            style={selectStyle}
          >
            <option value="__all__">All Types</option>
            {eventTypeOptions.map(t => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>

        <label style={filterLabelStyle}>
          Status
          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
            style={selectStyle}
          >
            <option value="__all__">All Status</option>
            {statusOptions.map(s => (
              <option key={s} value={s}>
                {s.charAt(0).toUpperCase() + s.slice(1)}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: '0 20px' }}>
        {loading && alerts.length === 0 && (
          <div style={{ padding: '40px 0', textAlign: 'center', color: '#64748b' }}>
            Loading alerts…
          </div>
        )}
        {!loading && error && (
          <div style={{ padding: '40px 0', textAlign: 'center', color: '#f87171' }}>{error}</div>
        )}
        {!loading && !error && filtered.length === 0 && (
          <div style={{ padding: '40px 0', textAlign: 'center', color: '#64748b' }}>
            No alerts match your search or filters.
          </div>
        )}
        {filtered.length > 0 && (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ textAlign: 'left', color: '#94a3b8', fontSize: 11, textTransform: 'uppercase' }}>
                <th style={theStyle}>Event Type</th>
                <th style={theStyle}>Severity</th>
                <th style={theStyle}>Device</th>
                <th style={theStyle}>Status</th>
                <th style={theStyle}>Date Observed</th>
                <th style={theStyle}>Description</th>
              </tr>
            </thead>
            <tbody>
              {pageRows.map(alert => {
                const sev = severityColor(alert.severity);
                const stat = statusColor(alert.status);
                return (
                  <tr
                    key={alert.id}
                    onClick={() => setSelectedAlert(alert)}
                    style={{ borderBottom: '1px solid #1a212c', cursor: 'pointer' }}
                  >
                    <td style={tdStyle}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span
                          style={{
                            width: 8,
                            height: 8,
                            borderRadius: '50%',
                            background: sev.bg,
                            flexShrink: 0,
                          }}
                        />
                        <span style={{ fontWeight: 700 }}>{alert.eventType}</span>
                      </div>
                    </td>
                    <td style={tdStyle}>
                      <span
                        style={{
                          padding: '3px 10px',
                          borderRadius: 999,
                          fontSize: 11,
                          fontWeight: 700,
                          color: sev.fg,
                          background: sev.bg,
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {alert.severity}
                      </span>
                    </td>
                    <td style={tdStyle}>
                      <div style={{ fontWeight: 700 }}>{alert.deviceName || '—'}</div>
                      <div style={{ fontSize: 11, color: '#64748b', wordBreak: 'break-all' }}>
                        {alert.deviceId}
                      </div>
                    </td>
                    <td style={tdStyle}>
                      <span
                        style={{
                          padding: '3px 10px',
                          borderRadius: 999,
                          fontSize: 11,
                          fontWeight: 700,
                          color: stat.fg,
                          background: stat.bg,
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {alert.status}
                      </span>
                    </td>
                    <td style={{ ...tdStyle, fontSize: 12, color: '#94a3b8', whiteSpace: 'nowrap' }}>
                      {formatAlertDate(alert.dateObserved)}
                    </td>
                    <td style={{ ...tdStyle, color: '#cbd5e1' }}>{alert.description || alert.message}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {filtered.length > 0 && (
        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            alignItems: 'center',
            gap: 16,
            padding: '10px 20px',
            borderTop: '1px solid #1f2733',
            fontSize: 12,
            color: '#94a3b8',
          }}
        >
          <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            Rows per page:
            <select
              value={rowsPerPage}
              onChange={e => setRowsPerPage(Number(e.target.value))}
              style={{ ...selectStyle, padding: '4px 8px' }}
            >
              {ROWS_PER_PAGE_OPTIONS.map(n => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>

          <span>
            {rangeStart}-{rangeEnd} of {filtered.length}
          </span>

          <div style={{ display: 'flex', gap: 4 }}>
            <button
              type="button"
              disabled={safePage === 0}
              onClick={() => setPage(p => Math.max(0, p - 1))}
              style={{ ...iconButtonStyle, opacity: safePage === 0 ? 0.4 : 1 }}
            >
              ‹
            </button>
            <button
              type="button"
              disabled={safePage >= pageCount - 1}
              onClick={() => setPage(p => Math.min(pageCount - 1, p + 1))}
              style={{ ...iconButtonStyle, opacity: safePage >= pageCount - 1 ? 0.4 : 1 }}
            >
              ›
            </button>
          </div>
        </div>
      )}

      {lastFetchedAt !== null && (
        <div style={{ padding: '0 20px 10px', fontSize: 10, color: '#475569' }}>
          Last refreshed {new Date(lastFetchedAt).toLocaleTimeString()}
        </div>
      )}

      {selectedAlert && (
        <AlertDetailModal
          alert={selectedAlert}
          onClose={() => setSelectedAlert(null)}
          onResolved={alertId => {
            setAlerts(prev =>
              prev.map(a => (a.id === alertId ? { ...a, status: 'resolved' } : a)),
            );
          }}
        />
      )}
    </div>
  );
}

const iconButtonStyle: React.CSSProperties = {
  padding: '6px 10px',
  fontSize: 14,
  color: '#e2e8f0',
  background: '#1a212c',
  border: '1px solid #2a3341',
  borderRadius: 8,
  cursor: 'pointer',
};

const searchInputStyle: React.CSSProperties = {
  padding: '9px 12px',
  fontSize: 12,
  color: '#e2e8f0',
  background: '#1a212c',
  border: '1px solid #2a3341',
  borderRadius: 8,
};

const filterLabelStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  fontSize: 11,
  color: '#94a3b8',
};

const selectStyle: React.CSSProperties = {
  padding: '8px 10px',
  fontSize: 12,
  fontWeight: 600,
  color: '#e2e8f0',
  background: '#1a212c',
  border: '1px solid #2a3341',
  borderRadius: 8,
  cursor: 'pointer',
  minWidth: 140,
};

const theStyle: React.CSSProperties = {
  padding: '8px 10px',
  borderBottom: '1px solid #1f2733',
  position: 'sticky',
  top: 0,
  background: '#0b0f17',
};

const tdStyle: React.CSSProperties = {
  padding: '10px',
  verticalAlign: 'top',
};
