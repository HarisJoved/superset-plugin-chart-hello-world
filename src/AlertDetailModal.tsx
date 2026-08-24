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
import {
  AlertRecord,
  fetchAlertsForDevice,
  formatAlertDate,
  severityColor,
  statusColor,
} from './alertsApi';

interface AlertDetailModalProps {
  alert: AlertRecord;
  onClose: () => void;
  /** Dummy resolve — there's no resolve endpoint given, so this just flips
   * the alert to "resolved" in the parent's local state. Not persisted. */
  onResolved: (alertId: string) => void;
}

export function AlertDetailModal({ alert, onClose, onResolved }: AlertDetailModalProps) {
  const [others, setOthers] = useState<AlertRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [resolved, setResolved] = useState(alert.status === 'resolved');

  useEffect(() => {
    if (!alert.deviceId) return undefined;
    let cancelled = false;
    setLoading(true);
    setError('');
    fetchAlertsForDevice(alert.deviceId, 10)
      .then(result => {
        if (cancelled) return;
        // The device's own feed includes this alert too — drop it so
        // "Other alerts from X" doesn't list the one already shown above.
        setOthers(result.alerts.filter(a => a.id !== alert.id));
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message || 'Failed to load other alerts.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [alert.id, alert.deviceId]);

  const sev = severityColor(alert.severity);
  const stat = statusColor(resolved ? 'resolved' : alert.status);

  function handleResolve() {
    setResolved(true);
    onResolved(alert.id);
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 50,
        background: 'rgba(0,0,0,0.6)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 20,
      }}
      onMouseDown={e => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          width: 'min(760px, 100%)',
          maxHeight: '88%',
          overflowY: 'auto',
          background: '#0f172a',
          border: '1px solid #1f2733',
          borderRadius: 12,
          boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
          color: '#e2e8f0',
          fontFamily:
            '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '16px 20px',
            borderBottom: '1px solid #1f2733',
          }}
        >
          <div style={{ fontSize: 15, fontWeight: 700 }}>Alert Details</div>
          <button type="button" onClick={onClose} aria-label="Close" style={closeXStyle}>
            ×
          </button>
        </div>

        <div style={{ padding: 20 }}>
          <div
            style={{
              border: '1px solid #1f2733',
              borderRadius: 10,
              padding: 16,
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                marginBottom: 16,
                flexWrap: 'wrap',
              }}
            >
              <span
                style={{
                  width: 20,
                  height: 20,
                  borderRadius: '50%',
                  background: sev.bg,
                  color: sev.fg,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 12,
                  fontWeight: 700,
                  flexShrink: 0,
                }}
              >
                !
              </span>
              <span style={{ fontSize: 16, fontWeight: 700, flex: 1 }}>{alert.eventType}</span>
              <span style={pillStyle(sev)}>{alert.severity}</span>
              <span style={pillStyle(stat)}>{resolved ? 'resolved' : alert.status}</span>
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: 16,
                marginBottom: 16,
              }}
            >
              <div>
                <div style={fieldLabelStyle}>Device</div>
                <div style={{ fontWeight: 700 }}>{alert.deviceName || '—'}</div>
                <div style={{ fontSize: 11, color: '#64748b', wordBreak: 'break-all' }}>
                  {alert.deviceId}
                </div>
              </div>
              <div>
                <div style={fieldLabelStyle}>Date Observed</div>
                <div style={{ fontWeight: 700 }}>{formatAlertDate(alert.dateObserved)}</div>
              </div>
            </div>

            <div
              style={{
                marginBottom:
                  alert.metadata && Object.keys(alert.metadata).length > 0 ? 16 : 0,
              }}
            >
              <div style={fieldLabelStyle}>Description</div>
              <div style={{ fontWeight: 600 }}>{alert.description || alert.message || '—'}</div>
            </div>

            {alert.metadata && Object.keys(alert.metadata).length > 0 && (
              <>
                <div style={{ borderTop: '1px solid #1f2733', margin: '4px 0 16px' }} />
                <div style={{ ...fieldLabelStyle, marginBottom: 10 }}>Metadata</div>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
                    gap: 14,
                  }}
                >
                  {Object.entries(alert.metadata).map(([key, value]) => (
                    <div key={key}>
                      <div style={fieldLabelStyle}>{key}</div>
                      <div style={{ fontWeight: 700, wordBreak: 'break-word' }}>
                        {Array.isArray(value)
                          ? value.join(', ')
                          : typeof value === 'object' && value !== null
                            ? JSON.stringify(value)
                            : String(value)}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>

          <div style={{ marginTop: 20 }}>
            <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 10 }}>
              Other Alerts from {alert.deviceName || 'this device'}
              {!loading && !error && ` (${others.length})`}
            </div>

            {loading && <div style={{ color: '#94a3b8', fontSize: 12 }}>Loading…</div>}
            {!loading && error && <div style={{ color: '#f87171', fontSize: 12 }}>{error}</div>}
            {!loading && !error && others.length === 0 && (
              <div style={{ color: '#64748b', fontSize: 12 }}>No other alerts from this device.</div>
            )}
            {!loading && !error && others.length > 0 && (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ textAlign: 'left', color: '#94a3b8', fontSize: 10, textTransform: 'uppercase' }}>
                    <th style={miniTheStyle}>Event Type</th>
                    <th style={miniTheStyle}>Severity</th>
                    <th style={miniTheStyle}>Status</th>
                    <th style={miniTheStyle}>Date</th>
                  </tr>
                </thead>
                <tbody>
                  {others.map(o => {
                    const oSev = severityColor(o.severity);
                    const oStat = statusColor(o.status);
                    return (
                      <tr key={o.id} style={{ borderBottom: '1px solid #1a212c' }}>
                        <td style={miniTdStyle}>
                          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span
                              style={{
                                width: 6,
                                height: 6,
                                borderRadius: '50%',
                                background: oSev.bg,
                                flexShrink: 0,
                              }}
                            />
                            {o.eventType}
                          </span>
                        </td>
                        <td style={miniTdStyle}>
                          <span style={pillStyle(oSev)}>{o.severity}</span>
                        </td>
                        <td style={miniTdStyle}>
                          <span style={pillStyle(oStat)}>{o.status}</span>
                        </td>
                        <td style={{ ...miniTdStyle, color: '#94a3b8', whiteSpace: 'nowrap' }}>
                          {formatAlertDate(o.dateObserved)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>

        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '14px 20px',
            borderTop: '1px solid #1f2733',
          }}
        >
          {!resolved ? (
            <button type="button" onClick={handleResolve} style={resolveButtonStyle}>
              Resolve
            </button>
          ) : (
            <span style={{ fontSize: 12, color: '#34d399', fontWeight: 700 }}>✓ Resolved</span>
          )}
          <button type="button" onClick={onClose} style={closeTextButtonStyle}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function pillStyle(color: { bg: string; fg: string }): React.CSSProperties {
  return {
    padding: '3px 10px',
    borderRadius: 999,
    fontSize: 11,
    fontWeight: 700,
    color: color.fg,
    background: color.bg,
    whiteSpace: 'nowrap',
  };
}

const fieldLabelStyle: React.CSSProperties = {
  fontSize: 11,
  color: '#94a3b8',
  marginBottom: 2,
  textTransform: 'capitalize',
};

const closeXStyle: React.CSSProperties = {
  border: 'none',
  background: 'transparent',
  color: '#94a3b8',
  fontSize: 20,
  cursor: 'pointer',
  lineHeight: 1,
};

const resolveButtonStyle: React.CSSProperties = {
  padding: '8px 16px',
  fontSize: 12,
  fontWeight: 700,
  color: 'white',
  background: '#10b981',
  border: 'none',
  borderRadius: 8,
  cursor: 'pointer',
};

const closeTextButtonStyle: React.CSSProperties = {
  padding: '8px 16px',
  fontSize: 12,
  fontWeight: 700,
  color: '#e2e8f0',
  background: 'transparent',
  border: 'none',
  cursor: 'pointer',
};

const miniTheStyle: React.CSSProperties = {
  padding: '6px 8px',
  borderBottom: '1px solid #1f2733',
};

const miniTdStyle: React.CSSProperties = {
  padding: '8px',
  verticalAlign: 'top',
};
