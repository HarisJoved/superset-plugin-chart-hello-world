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
import React, { useEffect, useRef, useState } from 'react';

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
  /** 'light' for the collapsed pill floating over the bright 3D canvas,
   * 'dark' when it's already sitting on a dark panel header. The expanded
   * menu itself is always dark, since it can pop up over either. */
  variant?: 'light' | 'dark';
  /** Which way the expanded menu opens relative to the collapsed button.
   * 'up' suits a bottom-anchored button (the 3D view); 'down' suits a
   * top-anchored one (the Devices/Alerts panel headers). */
  menuDirection?: 'up' | 'down';
}

/**
 * One nav, reused everywhere: collapsed by default (current panel + a
 * chevron), expands to the other two destinations on click. Every panel —
 * the 3D viewer, Devices, Alerts — renders this same component so jumping
 * between them never requires backtracking through the 3D view first.
 */
export function PanelNav({
  active,
  onNavigate,
  deviceCount,
  alertCount,
  variant = 'light',
  menuDirection = 'up',
}: PanelNavProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return undefined;
    function onDocPointerDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onDocPointerDown);
    return () => document.removeEventListener('mousedown', onDocPointerDown);
  }, [open]);

  const items: NavItem[] = [
    { id: '3d', label: '3D Viewer', icon: '🧊' },
    { id: 'devices', label: 'Devices', icon: '☰', badge: deviceCount },
    { id: 'alerts', label: 'Alerts', icon: '⚠', badge: alertCount },
  ];
  const activeItem = items.find(i => i.id === active) || items[0];

  const collapsedStyle: React.CSSProperties =
    variant === 'dark'
      ? {
          color: '#e2e8f0',
          background: '#1a212c',
          border: '1px solid #2a3341',
        }
      : {
          color: '#334155',
          background: 'rgba(255,255,255,0.92)',
          border: '1px solid #cbd5e1',
        };

  return (
    <div ref={rootRef} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        aria-label="Switch view"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '6px 12px',
          fontSize: 11,
          fontWeight: 700,
          borderRadius: 6,
          cursor: 'pointer',
          ...collapsedStyle,
        }}
      >
        <span>{activeItem.icon}</span>
        <span>{activeItem.label}</span>
        <span style={{ fontSize: 9, opacity: 0.7 }}>{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div
          style={{
            position: 'absolute',
            ...(menuDirection === 'up'
              ? { bottom: '100%', marginBottom: 6 }
              : { top: '100%', marginTop: 6 }),
            left: 0,
            minWidth: 170,
            background: '#0f172a',
            border: '1px solid #1f2733',
            borderRadius: 8,
            boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
            overflow: 'hidden',
            zIndex: 40,
          }}
        >
          {items.map(item => {
            const isActive = item.id === active;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  setOpen(false);
                  if (!isActive) onNavigate(item.id);
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  width: '100%',
                  padding: '9px 12px',
                  fontSize: 12,
                  fontWeight: isActive ? 700 : 600,
                  color: isActive ? 'white' : '#cbd5e1',
                  background: isActive ? '#2563eb' : 'transparent',
                  border: 'none',
                  cursor: isActive ? 'default' : 'pointer',
                  textAlign: 'left',
                }}
              >
                <span>{item.icon}</span>
                <span style={{ flex: 1 }}>{item.label}</span>
                {typeof item.badge === 'number' && (
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      color: isActive ? 'white' : '#94a3b8',
                      background: isActive ? 'rgba(255,255,255,0.2)' : '#1a212c',
                      borderRadius: 999,
                      padding: '1px 7px',
                    }}
                  >
                    {item.badge}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
