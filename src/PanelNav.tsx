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
import React from 'react';

export type PanelId = '3d' | 'devices' | 'alerts';

interface NavItem {
  id: PanelId;
  label: string;
  icon: string;
  badge?: number;
}

interface PanelNavProps {
  active: PanelId;
  onNavigate: (panel: PanelId) => void;
  deviceCount?: number;
  alertCount?: number;
  /** 'light' for the pill floating over the bright 3D canvas, 'dark' when
   * it's sitting on a dark panel header (Devices/Alerts). */
  variant?: 'light' | 'dark';
  /** Accepted for backward compatibility with existing call sites; the nav
   * is always a horizontal row now, so this no longer changes anything. */
  menuDirection?: 'up' | 'down';
}

const ACCENT = '#2563eb';

/**
 * One nav, reused everywhere: an always-visible row of destination tabs
 * (3D View / Devices / Alerts) with the current one highlighted, styled to
 * read as a real top navigation bar rather than a dropdown tucked away in a
 * corner. Every panel renders this same component so jumping between them
 * never requires backtracking through the 3D view first.
 */
export function PanelNav({
  active,
  onNavigate,
  deviceCount,
  alertCount,
  variant = 'light',
}: PanelNavProps) {
  const items: NavItem[] = [
    { id: '3d', label: '3D View', icon: '🧊' },
    { id: 'devices', label: 'Devices', icon: '▦', badge: deviceCount },
    { id: 'alerts', label: 'Alerts', icon: '🔔', badge: alertCount },
  ];

  const isDark = variant === 'dark';

  return (
    <div
      role="tablist"
      aria-label="Switch view"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 2,
        padding: 4,
        borderRadius: 10,
        background: isDark ? '#12181f' : 'rgba(15,23,42,0.55)',
        border: `1px solid ${isDark ? '#232b38' : 'rgba(255,255,255,0.14)'}`,
        backdropFilter: isDark ? undefined : 'blur(6px)',
      }}
    >
      {items.map(item => {
        const isActive = item.id === active;
        return (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => {
              if (!isActive) onNavigate(item.id);
            }}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 7,
              padding: '7px 14px',
              fontSize: 12,
              fontWeight: 700,
              borderRadius: 7,
              border: 'none',
              borderBottom: isActive ? `2px solid ${ACCENT}` : '2px solid transparent',
              background: isActive ? 'rgba(37,99,235,0.16)' : 'transparent',
              color: isActive ? '#ffffff' : isDark ? '#94a3b8' : '#cbd5e1',
              cursor: isActive ? 'default' : 'pointer',
              whiteSpace: 'nowrap',
              transition: 'background 120ms ease, color 120ms ease',
            }}
          >
            <span style={{ fontSize: 13 }}>{item.icon}</span>
            <span>{item.label}</span>
            {typeof item.badge === 'number' && (
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  color: isActive ? 'white' : '#94a3b8',
                  background: isActive ? 'rgba(255,255,255,0.22)' : 'rgba(148,163,184,0.18)',
                  borderRadius: 999,
                  padding: '1px 7px',
                  minWidth: 16,
                  textAlign: 'center',
                }}
              >
                {item.badge}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
