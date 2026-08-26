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
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { DeviceDatum, LocationPoi, isPlaced } from './types';
import {
  HistoryPoint,
  HistoryResult,
  LatestDeviceData,
  OTHER_MODEL_KEY,
  attrIcon,
  deriveModelName,
  deviceModelKey,
  fetchDeviceHistory,
  fetchLatestDeviceData,
  formatAttrLabel,
  formatAttrValue,
  hexToRgba,
  modelStyle,
  resolveNgsiId,
  sensorDisplayName,
} from './api';
import {
  AlertRecord,
  fetchAlertsForDevice,
  formatAlertDate,
  severityColor,
  statusColor,
} from './alertsApi';
import { AlertDetailModal } from './AlertDetailModal';
import { AttributeAreaChart, formatLastUpdated, formatTick } from './SensorPanels';
import { PanelId, PanelNav } from './PanelNav';

const PAGE_SIZE = 20;
const MAX_TABLE_ATTR_COLUMNS = 8;
const COMPARE_COLORS = ['#2563eb', '#dc2626', '#16a34a', '#d97706', '#7c3aed', '#0891b2', '#db2777', '#65a30d'];

interface DevicesPanelProps {
  /** Every sensor the chart knows about  not just the placed ones, since
   * the table is a data-browsing tool independent of 3D placement. */
  devices: DeviceDatum[];
  /** Camera-bookmark locations from the Customize panel's Locations editor,
   * each optionally carrying a `deviceIds` list. Drives the left sidebar —
   * omitted (or all-empty) callers simply don't get a sidebar. */
  locations?: LocationPoi[];
  activePanel: PanelId;
  onNavigate: (panel: PanelId) => void;
  /** Switches to the 3D view and points the camera at this sensor. Omitted
   * for callers that don't have a 3D view to jump to. */
  onFocusDevice?: (device: DeviceDatum) => void;
}

type LatestEntry = { loading: boolean; data?: LatestDeviceData; error?: string };

/**
 * Full-screen table view of every sensor: search, filter by model, drill
 * into one sensor's history, or compare several same-model sensors'
 * history side by side. Sits on top of the 3D viewer as an overlay; the
 * shared PanelNav (bottom-left) is how you get back or over to Alerts.
 */
export function DevicesPanel({
  devices,
  locations = [],
  activePanel,
  onNavigate,
  onFocusDevice,
}: DevicesPanelProps) {
  const [search, setSearch] = useState('');
  const [modelFilter, setModelFilter] = useState<string>('__all__');
  // '__all__' = no location filter, '__unassigned__' = the Unassigned
  // bucket, otherwise a LocationPoi id. Independent of modelFilter/search —
  // switching one must never reset the others.
  const [locationFilter, setLocationFilter] = useState<string>('__all__');
  const [page, setPage] = useState(0);
  const [compareMode, setCompareMode] = useState(false);
  const [compareSelection, setCompareSelection] = useState<string[]>([]);
  const [compareOpen, setCompareOpen] = useState(false);
  const [historyDevice, setHistoryDevice] = useState<DeviceDatum | null>(null);
  const [alertsDevice, setAlertsDevice] = useState<DeviceDatum | null>(null);
  const [latestById, setLatestById] = useState<Record<string, LatestEntry>>({});

  // Every device id currently in the roster, so a stale id left over in a
  // location's `deviceIds` (dataset changed, sensor removed) can be told
  // apart from a real assignment instead of turning into a phantom row or
  // an inflated count.
  const deviceIdSet = useMemo(() => new Set(devices.map(d => d.deviceId)), [devices]);

  // deviceId -> the (still-existing) location it's assigned to. Built once
  // per devices/locations change rather than scanned per row, since the
  // devices list runs into the hundreds.
  const deviceLocationMap = useMemo(() => {
    const map = new Map<string, string>();
    locations.forEach(loc => {
      (loc.deviceIds ?? []).forEach(id => {
        if (deviceIdSet.has(id)) map.set(id, loc.id);
      });
    });
    return map;
  }, [locations, deviceIdSet]);

  // The sidebar only earns its place once someone has actually assigned a
  // device somewhere — otherwise the panel looks exactly as it did before
  // this feature existed.
  const showLocationSidebar = useMemo(
    () => locations.some(loc => (loc.deviceIds ?? []).length > 0),
    [locations],
  );

  // A location can vanish (deleted in Customize) while it's still selected
  // here — fall back to "All locations" rather than filtering against a
  // location that no longer exists.
  useEffect(() => {
    if (locationFilter === '__all__' || locationFilter === '__unassigned__') return;
    if (!locations.some(loc => loc.id === locationFilter)) setLocationFilter('__all__');
  }, [locations, locationFilter]);

  const modelChips = useMemo(() => {
    const order: string[] = [];
    const counts = new Map<string, number>();
    devices.forEach(d => {
      const key = deviceModelKey(d);
      if (!counts.has(key)) {
        order.push(key);
        counts.set(key, 0);
      }
      counts.set(key, (counts.get(key) || 0) + 1);
    });
    return order.map(key => ({
      key,
      label: key === OTHER_MODEL_KEY ? 'Other sensors' : key,
      count: counts.get(key) || 0,
    }));
  }, [devices]);

  // The table opening on a flat, unfiltered "everything" list isn't useful 
  // there's no shared attribute schema across models to show columns for.
  // Default to whichever model has the most sensors instead, once (a
  // ref, not state, so it only fires the first time chips become
  // available and never fights the user's own filter choice afterwards).
  const defaultFilterAppliedRef = useRef(false);
  useEffect(() => {
    if (defaultFilterAppliedRef.current || modelChips.length === 0) return;
    defaultFilterAppliedRef.current = true;
    const largest = modelChips.reduce((a, b) => (b.count > a.count ? b : a), modelChips[0]);
    setModelFilter(largest.key);
  }, [modelChips]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return devices.filter(d => {
      if (modelFilter !== '__all__' && deviceModelKey(d) !== modelFilter) return false;
      if (locationFilter === '__unassigned__') {
        if (deviceLocationMap.has(d.deviceId)) return false;
      } else if (locationFilter !== '__all__') {
        if (deviceLocationMap.get(d.deviceId) !== locationFilter) return false;
      }
      if (!q) return true;
      return (
        sensorDisplayName(d).toLowerCase().includes(q) ||
        d.deviceId.toLowerCase().includes(q)
      );
    });
  }, [devices, search, modelFilter, locationFilter, deviceLocationMap]);

  // A filter/search change can leave `page` pointing past the new, shorter
  // list -- snap back to the first page rather than showing an empty table.
  useEffect(() => {
    setPage(0);
  }, [search, modelFilter, locationFilter]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const pageRows = filtered.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

  // Lazily fetch "latest reading" for whatever's on the current page, a few
  // at a time  firing one request per sensor for a fleet of hundreds would
  // either hang the tab or get rate-limited. Already-fetched rows (tracked
  // in `latestById`, which persists across page changes) are skipped.
  //
  // Waits for the default-model-filter effect above to settle first: on
  // mount, `pageRows` briefly holds every device across every model before
  // that effect narrows it down. Starting real fetches against that
  // transient, about-to-be-replaced list was wasted work  and, worse, it's
  // what caused rows to get stuck on "&" forever (see below).
  useEffect(() => {
    if (modelChips.length > 0 && !defaultFilterAppliedRef.current) return undefined;

    let cancelled = false;
    const toFetch = pageRows.filter(d => !latestById[d.deviceId]);
    if (toFetch.length === 0) return undefined;

    // Kept low and staggered on purpose: firing a burst of requests at the
    // gateway (this was 5-at-once, unstaggered) appears to be exactly what
    // triggers rows getting stuck on "&" forever  the IoT gateway seems to
    // rate-limit or silently drop concurrent bursts rather than queueing
    // them, and a plain `fetch()` with no timeout just hangs when that
    // happens (see `fetchWithTimeout` in api.ts for the other half of this
    // fix). 3 workers, staggered 120ms apart, is a lot gentler.
    //
    // Crucially, each device is only marked `{ loading: true }` right
    // before its worker actually issues the request  not eagerly for the
    // whole batch up front. Marking the whole batch loading immediately
    // used to mean that if this effect got cancelled (e.g. the model
    // filter changing) before a staggered worker reached its turn, that
    // device already "had an entry" in `latestById` and so `toFetch` above
    // would skip it on every future run  stranding it on "&" forever even
    // though its request never actually went out.
    const CONCURRENCY = 3;
    const STAGGER_MS = 120;
    let cursor = 0;
    async function worker(startDelay: number) {
      if (startDelay > 0) {
        await new Promise(resolve => setTimeout(resolve, startDelay));
      }
      for (;;) {
        if (cancelled) return;
        const index = cursor;
        cursor += 1;
        if (index >= toFetch.length) return;
        const device = toFetch[index];
        setLatestById(prev => ({ ...prev, [device.deviceId]: { loading: true } }));
        try {
          const data = await fetchLatestDeviceData(resolveNgsiId(device));
          if (cancelled) return;
          setLatestById(prev => ({ ...prev, [device.deviceId]: { loading: false, data } }));
        } catch (e) {
          if (cancelled) return;
          setLatestById(prev => ({
            ...prev,
            [device.deviceId]: {
              loading: false,
              error: (e as Error).message || 'Failed to load',
            },
          }));
        }
      }
    }
    const workerCount = Math.min(CONCURRENCY, toFetch.length);
    const workers = Array.from({ length: workerCount }, (_, i) => worker(i * STAGGER_MS));
    Promise.all(workers);
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageRows.map(d => d.deviceId).join(',')]);

  const singleModelFilter = modelFilter !== '__all__';
  // Attribute columns are now always derived from whatever's loaded for the
  // current page, regardless of whether a single model is selected  a
  // mixed page just ends up with the union of keys across models (capped),
  // with '' in cells where a given device doesn't report that attribute.
  // This is what actually puts the per-attribute columns (and their icons)
  // on screen instead of the old squashed "Latest" summary cell, which is
  // where they were going missing before.
  const attrColumns = useMemo(() => {
    const keys: string[] = [];
    pageRows.forEach(d => {
      latestById[d.deviceId]?.data?.attributes.forEach(a => {
        if (!keys.includes(a.key)) keys.push(a.key);
      });
    });
    return keys.slice(0, MAX_TABLE_ATTR_COLUMNS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageRows, latestById]);

  const compareModelKey =
    compareSelection.length > 0
      ? deviceModelKey(devices.find(d => d.deviceId === compareSelection[0]) || devices[0])
      : null;

  function toggleCompare(device: DeviceDatum) {
    setCompareSelection(prev => {
      if (prev.includes(device.deviceId)) {
        return prev.filter(id => id !== device.deviceId);
      }
      if (prev.length > 0 && deviceModelKey(device) !== compareModelKey) {
        // Silently ignore  the checkbox is disabled for this row anyway,
        // but a row click could still reach here.
        return prev;
      }
      return [...prev, device.deviceId];
    });
  }

  function exitCompareMode() {
    setCompareMode(false);
    setCompareSelection([]);
    setCompareOpen(false);
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
          deviceCount={devices.length}
          variant="dark"
        />

        <div style={{ fontSize: 18, fontWeight: 700, marginRight: 4 }}>
          Devices ({devices.length})
        </div>

        <div style={{ position: 'relative' }}>
          <span
            aria-hidden
            style={{
              position: 'absolute',
              left: 10,
              top: '50%',
              transform: 'translateY(-50%)',
              fontSize: 12,
              color: '#64748b',
              pointerEvents: 'none',
            }}
          >
            🔍
          </span>
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search devices..."
            style={{ ...searchInputStyle, paddingLeft: 28 }}
          />
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', flex: 1 }}>
          {modelChips.map(chip => {
            const active = modelFilter === chip.key;
            const style = modelStyle(chip.key);
            return (
              <button
                key={chip.key}
                type="button"
                onClick={() => setModelFilter(active ? '__all__' : chip.key)}
                style={{
                  ...chipStyle,
                  color: active ? '#0b0f17' : style.color,
                  background: active ? style.color : hexToRgba(style.color, 0.14),
                  border: `1px solid ${active ? style.color : hexToRgba(style.color, 0.4)}`,
                }}
              >
                {chip.label}: {chip.count}
              </button>
            );
          })}
        </div>

        {!compareMode ? (
          <button type="button" onClick={() => setCompareMode(true)} style={compareButtonStyle}>
            ⇄ Compare
          </button>
        ) : (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={{ fontSize: 12, color: '#94a3b8' }}>
              {compareSelection.length === 0
                ? 'Select sensors of the same model...'
                : `${compareSelection.length} selected`}
            </span>
            <button
              type="button"
              disabled={compareSelection.length < 2}
              onClick={() => setCompareOpen(true)}
              style={{
                ...compareButtonStyle,
                opacity: compareSelection.length < 2 ? 0.5 : 1,
                cursor: compareSelection.length < 2 ? 'not-allowed' : 'pointer',
              }}
            >
              Compare ({compareSelection.length})
            </button>
            <button type="button" onClick={exitCompareMode} style={backButtonStyle}>
              Cancel
            </button>
          </div>
        )}
      </div>

      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        {showLocationSidebar && (
          <LocationSidebar
            locations={locations}
            deviceLocationMap={deviceLocationMap}
            deviceIdSet={deviceIdSet}
            selected={locationFilter}
            onSelect={setLocationFilter}
          />
        )}

        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
      <div style={{ flex: 1, overflow: 'auto', padding: '4px 20px 20px' }}>
        {filtered.length === 0 ? (
          <div style={{ padding: '40px 0', textAlign: 'center', color: '#64748b' }}>
            No sensors match your search or filter.
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: '0 8px', fontSize: 13 }}>
            <thead>
              <tr style={{ textAlign: 'left', color: '#94a3b8', fontSize: 11, textTransform: 'uppercase' }}>
                {compareMode && <th style={theStyle}> </th>}
                <th style={theStyle}>Device</th>
                {!singleModelFilter && <th style={theStyle}>Model</th>}
                {attrColumns.map(key => (
                  <th key={key} style={theStyle}>
                    {attrIcon(key)} {formatAttrLabel(key)}
                  </th>
                ))}
                <th style={theStyle}>Last updated</th>
                <th style={{ ...theStyle, textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {pageRows.map(device => {
                const entry = latestById[device.deviceId];
                const key = deviceModelKey(device);
                const style = modelStyle(key);
                const placed = isPlaced(device);
                const rowDisabledForCompare =
                  compareMode && compareModelKey !== null && key !== compareModelKey;
                const checked = compareSelection.includes(device.deviceId);
                const firstCellRadius: React.CSSProperties = {
                  borderTopLeftRadius: 10,
                  borderBottomLeftRadius: 10,
                };
                const lastCellRadius: React.CSSProperties = {
                  borderTopRightRadius: 10,
                  borderBottomRightRadius: 10,
                };
                const cellBg = checked ? 'rgba(37,99,235,0.16)' : rowCardStyle.background;

                return (
                  <tr
                    key={device.deviceId}
                    onClick={() => {
                      if (compareMode) {
                        if (!rowDisabledForCompare) toggleCompare(device);
                      } else {
                        setHistoryDevice(device);
                      }
                    }}
                    style={{
                      cursor: rowDisabledForCompare ? 'not-allowed' : 'pointer',
                      opacity: rowDisabledForCompare ? 0.4 : 1,
                    }}
                  >
                    {compareMode && (
                      <td style={{ ...tdStyle, ...rowCardStyle, ...firstCellRadius, background: cellBg }}>
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={rowDisabledForCompare}
                          onClick={e => e.stopPropagation()}
                          onChange={() => toggleCompare(device)}
                        />
                      </td>
                    )}
                    <td
                      style={{
                        ...tdStyle,
                        ...rowCardStyle,
                        ...(compareMode ? {} : firstCellRadius),
                        background: cellBg,
                        minWidth: 170,
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                        <span
                          aria-hidden
                          style={{
                            width: 30,
                            height: 30,
                            flexShrink: 0,
                            borderRadius: 8,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: 14,
                            background: hexToRgba(style.color, 0.18),
                            border: `1px solid ${hexToRgba(style.color, 0.45)}`,
                          }}
                        >
                          {style.icon}
                        </span>
                        <div style={{ minWidth: 0, overflow: 'hidden' }}>
                          <div
                            title={sensorDisplayName(device)}
                            style={{
                              fontWeight: 700,
                              whiteSpace: 'nowrap',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                            }}
                          >
                            {sensorDisplayName(device)}
                          </div>
                          {key !== OTHER_MODEL_KEY && (
                            <div
                              style={{
                                fontSize: 11,
                                color: style.color,
                                whiteSpace: 'nowrap',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                              }}
                            >
                              {key}
                            </div>
                          )}
                        </div>
                      </div>
                    </td>

                    {!singleModelFilter && (
                      <td style={{ ...tdStyle, ...rowCardStyle }}>
                        {key === OTHER_MODEL_KEY ? '' : key}
                      </td>
                    )}
                    {attrColumns.map(attrKey => {
                      const attr = entry?.data?.attributes.find(a => a.key === attrKey);
                      return (
                        <td key={attrKey} style={{ ...tdStyle, ...rowCardStyle }}>
                          {entry?.loading ? (
                            '...'
                          ) : attr ? (
                            <span>
                              <span style={{ marginRight: 5 }}>{attrIcon(attrKey)}</span>
                              {formatAttrValue(attr.value)}
                            </span>
                          ) : entry?.error ? (
                            <span style={{ color: '#f87171' }} title={entry.error}>
                              failed
                            </span>
                          ) : (
                            ''
                          )}
                        </td>
                      );
                    })}

                    <td style={{ ...tdStyle, ...rowCardStyle, fontSize: 12, color: '#64748b' }}>
                      {entry?.data
                        ? formatLastUpdated(entry.data.lastUpdated)
                        : entry?.loading
                          ? '...'
                          : entry?.error
                            ? '-'
                            : ''}
                    </td>

                    <td
                      style={{ ...tdStyle, ...rowCardStyle, ...lastCellRadius, textAlign: 'right' }}
                      onClick={e => e.stopPropagation()}
                    >
                      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                        <button
                          type="button"
                          title={placed ? 'View this device in the 3D view' : 'Not placed in the 3D scene'}
                          disabled={!placed || !onFocusDevice}
                          onClick={() => onFocusDevice && onFocusDevice(device)}
                          style={{
                            ...actionIconButtonStyle,
                            color: '#60a5fa',
                            borderColor: 'rgba(96,165,250,0.35)',
                            background: 'rgba(96,165,250,0.1)',
                            opacity: placed && onFocusDevice ? 1 : 0.35,
                            cursor: placed && onFocusDevice ? 'pointer' : 'not-allowed',
                          }}
                        >
                          🎯
                        </button>
                        <button
                          type="button"
                          title="View alerts for this device"
                          onClick={() => setAlertsDevice(device)}
                          style={{
                            ...actionIconButtonStyle,
                            color: '#f87171',
                            borderColor: 'rgba(248,113,113,0.35)',
                            background: 'rgba(248,113,113,0.1)',
                          }}
                        >
                          🔔
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {pageCount > 1 && (
        <div
          style={{
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            gap: 12,
            padding: '10px 0',
            borderTop: '1px solid #1f2733',
            fontSize: 12,
          }}
        >
          <button
            type="button"
            disabled={safePage === 0}
            onClick={() => setPage(p => Math.max(0, p - 1))}
            style={{ ...backButtonStyle, opacity: safePage === 0 ? 0.4 : 1 }}
          >
            ‹ Prev
          </button>
          <span style={{ color: '#94a3b8' }}>
            Page {safePage + 1} of {pageCount}
          </span>
          <button
            type="button"
            disabled={safePage >= pageCount - 1}
            onClick={() => setPage(p => Math.min(pageCount - 1, p + 1))}
            style={{ ...backButtonStyle, opacity: safePage >= pageCount - 1 ? 0.4 : 1 }}
          >
            Next ›
          </button>
        </div>
      )}
        </div>
      </div>

      {historyDevice && (
        <HistoryDrawer device={historyDevice} onClose={() => setHistoryDevice(null)} />
      )}

      {alertsDevice && (
        <DeviceAlertsDrawer device={alertsDevice} onClose={() => setAlertsDevice(null)} />
      )}

      {compareOpen && (
        <CompareDrawer
          devices={devices.filter(d => compareSelection.includes(d.deviceId))}
          onClose={() => setCompareOpen(false)}
        />
      )}
    </div>
  );
}

/** Shared Start/End date inputs + Filter button, styled for the drawers'
 * dark background  same idea as the 3D view's SensorGraphModal filter row,
 * just re-themed rather than reused since that one is light-on-white. */
function DateRangeFilter({
  from,
  to,
  onFromChange,
  onToChange,
  onApply,
}: {
  from: string;
  to: string;
  onFromChange: (v: string) => void;
  onToChange: (v: string) => void;
  onApply: () => void;
}) {
  return (
    <div
      style={{
        display: 'flex',
        gap: 12,
        alignItems: 'flex-end',
        flexWrap: 'wrap',
        marginBottom: 16,
        paddingBottom: 14,
        borderBottom: '1px solid #1f2733',
      }}
    >
      <label style={{ fontSize: 11, color: '#94a3b8' }}>
        Start
        <input
          type="date"
          value={from}
          onChange={e => onFromChange(e.target.value)}
          style={dateInputStyle}
        />
      </label>
      <label style={{ fontSize: 11, color: '#94a3b8' }}>
        End
        <input
          type="date"
          value={to}
          onChange={e => onToChange(e.target.value)}
          style={dateInputStyle}
        />
      </label>
      <button type="button" onClick={onApply} style={compareButtonStyle}>
        Filter
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Location sidebar -- browse devices by where they physically are,   */
/* an independent filter dimension alongside the model chips.          */
/* ------------------------------------------------------------------ */

interface LocationSidebarProps {
  locations: LocationPoi[];
  deviceLocationMap: Map<string, string>;
  deviceIdSet: Set<string>;
  selected: string;
  onSelect: (id: string) => void;
}

function LocationSidebar({
  locations,
  deviceLocationMap,
  deviceIdSet,
  selected,
  onSelect,
}: LocationSidebarProps) {
  // Local to the sidebar -- collapsing is purely a display preference, not
  // filter state, so it doesn't need to live in the parent panel.
  const [collapsed, setCollapsed] = useState(false);

  // Only locations that still have at least one assigned device count as
  // "populated" here -- a location with an empty (or all-phantom) list
  // would otherwise clutter the list with a permanent zero.
  const populated = locations
    .filter(loc => (loc.deviceIds ?? []).length > 0)
    .map(loc => ({
      loc,
      count: (loc.deviceIds ?? []).filter(id => deviceIdSet.has(id)).length,
    }));

  const unassignedCount = Array.from(deviceIdSet).filter(
    id => !deviceLocationMap.has(id),
  ).length;

  return (
    <div
      style={{
        width: collapsed ? 52 : 200,
        flexShrink: 0,
        borderRight: '1px solid #1f2733',
        overflowY: 'auto',
        overflowX: 'hidden',
        padding: collapsed ? '14px 6px' : '14px 10px',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: collapsed ? 'center' : 'space-between',
          marginBottom: 8,
          padding: collapsed ? 0 : '0 6px',
        }}
      >
        {!collapsed && (
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: '#64748b',
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
            }}
          >
            Locations
          </div>
        )}
        <button
          type="button"
          onClick={() => setCollapsed(c => !c)}
          title={collapsed ? 'Expand locations' : 'Collapse locations'}
          style={{
            width: 22,
            height: 22,
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: 6,
            border: '1px solid #232b38',
            background: '#12181f',
            color: '#94a3b8',
            fontSize: 11,
            cursor: 'pointer',
          }}
        >
          {collapsed ? '»' : '«'}
        </button>
      </div>

      <SidebarEntry
        label="All locations"
        active={selected === '__all__'}
        onClick={() => onSelect('__all__')}
        collapsed={collapsed}
      />

      {populated.map(({ loc, count }) => (
        <SidebarEntry
          key={loc.id}
          label={loc.name || 'Untitled location'}
          count={count}
          active={selected === loc.id}
          onClick={() => onSelect(loc.id)}
          collapsed={collapsed}
        />
      ))}

      <div style={{ height: 1, background: '#1f2733', margin: '8px 6px' }} />

      <SidebarEntry
        label="Unassigned"
        count={unassignedCount}
        active={selected === '__unassigned__'}
        onClick={() => onSelect('__unassigned__')}
        collapsed={collapsed}
      />
    </div>
  );
}

function SidebarEntry({
  label,
  count,
  active,
  onClick,
  collapsed,
}: {
  label: string;
  count?: number;
  active: boolean;
  onClick: () => void;
  collapsed?: boolean;
}) {
  if (collapsed) {
    return (
      <button
        type="button"
        onClick={onClick}
        title={typeof count === 'number' ? `${label} (${count})` : label}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '8px 2px',
          marginBottom: 2,
          borderRadius: 7,
          border: 'none',
          background: active ? 'rgba(37,99,235,0.16)' : 'transparent',
          color: active ? '#ffffff' : '#94a3b8',
          fontSize: 11,
          fontWeight: 700,
          cursor: active ? 'default' : 'pointer',
        }}
      >
        {typeof count === 'number' ? count : '•'}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        width: '100%',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '8px',
        marginBottom: 2,
        borderRadius: 7,
        border: 'none',
        background: active ? 'rgba(37,99,235,0.16)' : 'transparent',
        color: active ? '#ffffff' : '#94a3b8',
        fontSize: 12,
        fontWeight: active ? 700 : 500,
        textAlign: 'left',
        cursor: active ? 'default' : 'pointer',
      }}
    >
      <span
        style={{
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          flex: 1,
        }}
      >
        {label}
      </span>
      {typeof count === 'number' && (
        <span
          style={{
            fontSize: 10,
            fontWeight: 700,
            color: active ? 'white' : '#64748b',
            background: active ? 'rgba(255,255,255,0.18)' : 'rgba(148,163,184,0.14)',
            borderRadius: 999,
            padding: '1px 7px',
            minWidth: 16,
            textAlign: 'center',
            flexShrink: 0,
          }}
        >
          {count}
        </span>
      )}
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* Single-sensor history drawer  same data as the 3D view's graph     */
/* modal, just reachable from the table instead of a marker click.     */
/* ------------------------------------------------------------------ */

function HistoryDrawer({ device, onClose }: { device: DeviceDatum; onClose: () => void }) {
  const ngsiId = resolveNgsiId(device);
  const key = deviceModelKey(device);
  const modelName = deriveModelName(ngsiId, key === OTHER_MODEL_KEY ? undefined : key);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [result, setResult] = useState<HistoryResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  function load() {
    if (!modelName) {
      setError('Could not determine this sensor\u2019s model name.');
      return;
    }
    setLoading(true);
    setError('');
    fetchDeviceHistory(ngsiId, modelName, {
      from: from || undefined,
      to: to || undefined,
      latest: from || to ? undefined : 1,
    })
      .then(r => setResult(r))
      .catch((e: Error) => setError(e.message || 'Failed to load history.'))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ngsiId, modelName]);

  return (
    <Drawer onClose={onClose} title={`${sensorDisplayName(device)}  history`}>
      <DateRangeFilter from={from} to={to} onFromChange={setFrom} onToChange={setTo} onApply={load} />
      {loading && <div style={{ color: '#94a3b8' }}>Loading&</div>}
      {!loading && error && <div style={{ color: '#f87171', fontSize: 12 }}>{error}</div>}
      {!loading && !error && result && (
        <>
          <div style={{ fontSize: 11, color: '#64748b', marginBottom: 10 }}>
            {result.recordCount} records
          </div>
          {result.series.length === 0 && (
            <div style={{ color: '#64748b' }}>No numeric history in range.</div>
          )}
          {result.series.map(s => (
            <div key={s.attribute} style={{ marginBottom: 20 }}>
              <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6, color: '#e2e8f0' }}>
                <span style={{ marginRight: 6 }}>{attrIcon(s.attribute)}</span>
                {formatAttrLabel(s.attribute)}
              </div>
              <div style={{ background: 'white', borderRadius: 8, padding: 8 }}>
                <AttributeAreaChart points={s.points} />
              </div>
            </div>
          ))}
        </>
      )}
    </Drawer>
  );
}

/* ------------------------------------------------------------------ */
/* Alerts drawer -- every alert raised against one device, opened from */
/* the alert action button on its row.                                 */
/* ------------------------------------------------------------------ */

function DeviceAlertsDrawer({ device, onClose }: { device: DeviceDatum; onClose: () => void }) {
  const deviceId = resolveNgsiId(device);
  const [alerts, setAlerts] = useState<AlertRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedAlert, setSelectedAlert] = useState<AlertRecord | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    fetchAlertsForDevice(deviceId, 50)
      .then(result => {
        if (!cancelled) setAlerts(result.alerts);
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message || 'Failed to load alerts.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [deviceId]);

  return (
    <Drawer onClose={onClose} title={`${sensorDisplayName(device)} — alerts`}>
      {loading && <div style={{ color: '#94a3b8' }}>Loading...</div>}
      {!loading && error && <div style={{ color: '#f87171', fontSize: 12 }}>{error}</div>}
      {!loading && !error && alerts.length === 0 && (
        <div style={{ color: '#64748b', fontSize: 13 }}>No alerts recorded for this device.</div>
      )}
      {!loading &&
        !error &&
        alerts.map(alert => {
          const sev = severityColor(alert.severity);
          const stat = statusColor(alert.status);
          return (
            <button
              key={alert.id}
              type="button"
              onClick={() => setSelectedAlert(alert)}
              style={{
                display: 'block',
                width: '100%',
                textAlign: 'left',
                background: '#111826',
                border: '1px solid #1f2733',
                borderRadius: 10,
                padding: '10px 12px',
                marginBottom: 8,
                cursor: 'pointer',
                color: '#e2e8f0',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    background: sev.bg,
                    flexShrink: 0,
                  }}
                />
                <span style={{ fontWeight: 700, fontSize: 13, flex: 1 }}>{alert.eventType}</span>
                <span
                  style={{
                    padding: '2px 8px',
                    borderRadius: 999,
                    fontSize: 10,
                    fontWeight: 700,
                    color: stat.fg,
                    background: stat.bg,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {alert.status}
                </span>
              </div>
              <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 4 }}>
                {formatAlertDate(alert.dateObserved)}
              </div>
              <div style={{ fontSize: 12, color: '#cbd5e1' }}>
                {alert.description || alert.message || 'No description provided.'}
              </div>
            </button>
          );
        })}

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
    </Drawer>
  );
}

/* ------------------------------------------------------------------ */
/* Compare drawer  same-model sensors' history overlaid per attribute */
/* ------------------------------------------------------------------ */

function CompareDrawer({ devices, onClose }: { devices: DeviceDatum[]; onClose: () => void }) {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [byDevice, setByDevice] = useState<
    Record<string, { loading: boolean; result?: HistoryResult; error?: string }>
  >({});

  function load() {
    setByDevice(Object.fromEntries(devices.map(d => [d.deviceId, { loading: true }])));
    devices.forEach(device => {
      const ngsiId = resolveNgsiId(device);
      const key = deviceModelKey(device);
      const modelName = deriveModelName(ngsiId, key === OTHER_MODEL_KEY ? undefined : key);
      if (!modelName) {
        setByDevice(prev => ({
          ...prev,
          [device.deviceId]: { loading: false, error: 'No model name' },
        }));
        return;
      }
      fetchDeviceHistory(ngsiId, modelName, {
        from: from || undefined,
        to: to || undefined,
        latest: from || to ? undefined : 1,
      })
        .then(result => {
          setByDevice(prev => ({ ...prev, [device.deviceId]: { loading: false, result } }));
        })
        .catch((e: Error) => {
          setByDevice(prev => ({
            ...prev,
            [device.deviceId]: { loading: false, error: e.message || 'Failed to load' },
          }));
        });
    });
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [devices.map(d => d.deviceId).join(',')]);

  const anyLoading = devices.some(d => byDevice[d.deviceId]?.loading);

  // Union of attribute names across every device's series, in first-seen
  // order  same-model sensors should report the same set, but this stays
  // correct even if one happens to be missing a reading.
  const attributes: string[] = [];
  devices.forEach(d => {
    byDevice[d.deviceId]?.result?.series.forEach(s => {
      if (!attributes.includes(s.attribute)) attributes.push(s.attribute);
    });
  });

  return (
    <Drawer onClose={onClose} title={`Comparing ${devices.length} sensors`}>
      <DateRangeFilter from={from} to={to} onFromChange={setFrom} onToChange={setTo} onApply={load} />
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 16 }}>
        {devices.map((d, i) => (
          <div key={d.deviceId} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
            <span
              style={{
                width: 10,
                height: 10,
                borderRadius: '50%',
                background: COMPARE_COLORS[i % COMPARE_COLORS.length],
                display: 'inline-block',
              }}
            />
            {sensorDisplayName(d)}
          </div>
        ))}
      </div>

      {anyLoading && <div style={{ color: '#94a3b8', marginBottom: 12 }}>Loading history&</div>}

      {attributes.length === 0 && !anyLoading && (
        <div style={{ color: '#64748b' }}>No comparable numeric history available.</div>
      )}

      {attributes.map(attribute => (
        <div key={attribute} style={{ marginBottom: 24 }}>
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6, color: '#e2e8f0' }}>
            <span style={{ marginRight: 6 }}>{attrIcon(attribute)}</span>
            {formatAttrLabel(attribute)}
          </div>
          <div style={{ background: 'white', borderRadius: 8, padding: 8 }}>
            <MultiSeriesChart
              series={devices.map((d, i) => ({
                label: sensorDisplayName(d),
                color: COMPARE_COLORS[i % COMPARE_COLORS.length],
                points:
                  byDevice[d.deviceId]?.result?.series.find(s => s.attribute === attribute)?.points ||
                  [],
              }))}
            />
          </div>
        </div>
      ))}
    </Drawer>
  );
}

/** Multiple devices' readings for one attribute, overlaid as coloured lines
 * on a shared axis  the comparison view's equivalent of `AttributeAreaChart`. */
function MultiSeriesChart({
  series,
}: {
  series: { label: string; color: string; points: HistoryPoint[] }[];
}) {
  const width = 780;
  const height = 200;
  const padL = 48;
  const padR = 12;
  const padT = 14;
  const padB = 38;

  const nonEmpty = series.filter(s => s.points.length > 0);
  if (nonEmpty.length === 0) {
    return (
      <div style={{ padding: '24px 0', textAlign: 'center', color: '#94a3b8', fontSize: 12 }}>
        No data in range for any selected sensor.
      </div>
    );
  }

  const allPoints = nonEmpty.flatMap(s => s.points);
  const tMin = Math.min(...allPoints.map(p => p.t));
  const tMax = Math.max(...allPoints.map(p => p.t));
  const vMin = Math.min(...allPoints.map(p => p.v));
  const vMax = Math.max(...allPoints.map(p => p.v));
  const yPad = (vMax - vMin) * 0.1 || Math.abs(vMax) * 0.1 || 1;
  const yMin = Math.min(0, vMin - yPad);
  const yMax = vMax + yPad;

  const xScale = (t: number) => padL + ((t - tMin) / (tMax - tMin || 1)) * (width - padL - padR);
  const yScale = (v: number) => padT + (1 - (v - yMin) / (yMax - yMin || 1)) * (height - padT - padB);

  const yTicks = 4;
  const yTickValues = Array.from({ length: yTicks + 1 }, (_, i) => yMin + ((yMax - yMin) * i) / yTicks);
  const xTickCount = 6;
  const xTickValues = Array.from(
    { length: xTickCount },
    (_, i) => tMin + ((tMax - tMin) * i) / Math.max(xTickCount - 1, 1),
  );

  return (
    <div>
      <svg viewBox={`0 0 ${width} ${height}`} style={{ width: '100%', height: 'auto', display: 'block' }}>
        {yTickValues.map(v => (
          <g key={v}>
            <line x1={padL} x2={width - padR} y1={yScale(v)} y2={yScale(v)} stroke="#e2e8f0" strokeWidth={1} />
            <text x={padL - 8} y={yScale(v) + 3} textAnchor="end" fontSize={10} fill="#94a3b8">
              {v.toFixed(1)}
            </text>
          </g>
        ))}
        {nonEmpty.map(s => {
          const path = s.points
            .map((p, i) => `${i === 0 ? 'M' : 'L'}${xScale(p.t).toFixed(1)},${yScale(p.v).toFixed(1)}`)
            .join(' ');
          return <path key={s.label} d={path} fill="none" stroke={s.color} strokeWidth={2} />;
        })}
        {xTickValues.map(t => (
          <text
            key={t}
            x={xScale(t)}
            y={height - padB + 16}
            textAnchor="end"
            fontSize={10}
            fill="#94a3b8"
            transform={`rotate(-30 ${xScale(t)} ${height - padB + 16})`}
          >
            {formatTick(t)}
          </text>
        ))}
        <line x1={padL} x2={padL} y1={padT} y2={height - padB} stroke="#cbd5e1" strokeWidth={1} />
        <line x1={padL} x2={width - padR} y1={height - padB} y2={height - padB} stroke="#cbd5e1" strokeWidth={1} />
      </svg>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 6 }}>
        {series.map(s => {
          if (s.points.length === 0) {
            return (
              <div key={s.label} style={{ fontSize: 11, color: '#94a3b8' }}>
                {s.label}: no data
              </div>
            );
          }
          const values = s.points.map(p => p.v);
          const min = Math.min(...values);
          const max = Math.max(...values);
          const avg = values.reduce((a, b) => a + b, 0) / values.length;
          return (
            <div key={s.label} style={{ fontSize: 11, color: '#475569' }}>
              <span style={{ color: s.color, fontWeight: 700 }}>{s.label}</span>: min {min.toFixed(1)} � max{' '}
              {max.toFixed(1)} � avg {avg.toFixed(1)}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Shared right-side drawer chrome.                                    */
/* ------------------------------------------------------------------ */

function Drawer({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        position: 'absolute',
        top: 0,
        right: 0,
        bottom: 0,
        width: 'min(520px, 100%)',
        background: '#0f172a',
        borderLeft: '1px solid #1f2733',
        boxShadow: '-8px 0 24px rgba(0,0,0,0.35)',
        display: 'flex',
        flexDirection: 'column',
        zIndex: 31,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '14px 18px',
          borderBottom: '1px solid #1f2733',
        }}
      >
        <div style={{ fontWeight: 700, fontSize: 14 }}>{title}</div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          style={{
            border: 'none',
            background: 'transparent',
            color: '#94a3b8',
            fontSize: 18,
            cursor: 'pointer',
            lineHeight: 1,
          }}
        >
          �
        </button>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 18px' }}>{children}</div>
    </div>
  );
}

const backButtonStyle: React.CSSProperties = {
  padding: '7px 12px',
  fontSize: 12,
  fontWeight: 600,
  color: '#e2e8f0',
  background: '#1a212c',
  border: '1px solid #2a3341',
  borderRadius: 8,
  cursor: 'pointer',
};

const compareButtonStyle: React.CSSProperties = {
  padding: '7px 14px',
  fontSize: 12,
  fontWeight: 700,
  color: 'white',
  background: '#7c3aed',
  border: 'none',
  borderRadius: 8,
  cursor: 'pointer',
};

const searchInputStyle: React.CSSProperties = {
  padding: '7px 12px',
  fontSize: 12,
  color: '#e2e8f0',
  background: '#1a212c',
  border: '1px solid #2a3341',
  borderRadius: 8,
  width: 200,
};

const dateInputStyle: React.CSSProperties = {
  display: 'block',
  marginTop: 4,
  padding: '6px 8px',
  borderRadius: 6,
  border: '1px solid #2a3341',
  background: '#1a212c',
  color: '#e2e8f0',
  fontSize: 12,
};

const chipStyle: React.CSSProperties = {
  padding: '6px 12px',
  fontSize: 12,
  fontWeight: 700,
  color: '#cbd5e1',
  background: '#1a212c',
  border: '1px solid #2a3341',
  borderRadius: 999,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
};

const theStyle: React.CSSProperties = {
  padding: '8px 10px',
  borderBottom: '1px solid #1f2733',
  position: 'sticky',
  top: 0,
  background: '#0b0f17',
};

const tdStyle: React.CSSProperties = {
  padding: '12px 14px',
  verticalAlign: 'middle',
  wordBreak: 'break-word',
};

/** Background applied to every cell in a row so the row reads as one
 * rounded card instead of a plain ruled table line  paired with the
 * borderSpacing set on the <table> and the corner radii applied to each
 * row's first/last cell. */
const rowCardStyle: React.CSSProperties = {
  background: '#111826',
};

const actionIconButtonStyle: React.CSSProperties = {
  width: 30,
  height: 30,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: 13,
  border: '1px solid #2a3341',
  borderRadius: 8,
  background: '#1a212c',
  color: '#e2e8f0',
  cursor: 'pointer',
};