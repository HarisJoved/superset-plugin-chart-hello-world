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
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DeviceDatum, LocationPoi, SceneData, isPlaced } from '../../types';
import {
  Position3,
  getModelInfo,
  getSensorRoster,
  setPickTarget,
  subscribePick,
  subscribeState,
} from '../../sensorEditorBridge';
import { parseSensorId, resolveNgsiId } from '../../api';
import {
  DEFAULT_MARKER_SHAPE,
  DEFAULT_SHAPE_COLORS,
  MARKER_SHAPE_OPTIONS,
  MarkerShapeId,
} from '../../markerShapes';

interface SensorSceneControlProps {
  value?: string;
  onChange?: (value: string) => void;
  label?: string;
  description?: string;
}

const DEFAULT_COLOR = '#2563eb';
/** Bucket key for sensors whose id doesn't parse as a full NGSI urn, so we
 * can't tell which model they belong to. */
const UNGROUPED_KEY = '__ungrouped__';

/** Normalises whatever came out of the JSON into a `#rrggbb` value that
 * `<input type="color">` will accept — it silently falls back to black for
 * anything else, which looks like a bug to the user. */
function toHexColor(raw: unknown, fallback: string = DEFAULT_COLOR): string {
  if (typeof raw === 'string' && /^#[0-9a-fA-F]{6}$/.test(raw)) return raw;
  if (typeof raw === 'string' && /^#[0-9a-fA-F]{3}$/.test(raw)) {
    const [, r, g, b] = raw;
    return `#${r}${r}${g}${g}${b}${b}`;
  }
  return fallback;
}

/**
 * Slider bounds for marker size. The right absolute size depends entirely
 * on how big the loaded model is in world units (a 0.03 radius marker is
 * invisible on a 200-unit model and enormous on a 0.5-unit one), so we take
 * the model's measured size from the bridge when the viewer has reported it.
 */
function sizeBounds(maxDim: number | null) {
  const dim = maxDim && maxDim > 0 ? maxDim : 5;
  return {
    min: Number((dim * 0.002).toPrecision(2)),
    max: Number((dim * 0.06).toPrecision(2)),
    step: Number((dim * 0.001).toPrecision(2)),
    fallback: Number((dim * 0.012).toPrecision(2)),
  };
}

/**
 * Slider bounds for a location's "zoom" (camera view distance when the
 * viewer flies here). Same size-relative approach as `sizeBounds`, just
 * scaled for "how far back should the camera sit" instead of "how big is a
 * marker".
 */
function zoomDistanceBounds(maxDim: number | null) {
  const dim = maxDim && maxDim > 0 ? maxDim : 5;
  return {
    min: Number((dim * 0.02).toPrecision(2)),
    max: Number((dim * 2.5).toPrecision(2)),
    step: Number((dim * 0.01).toPrecision(2)),
    fallback: Number((dim * 0.3).toPrecision(2)),
  };
}

const rowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  marginBottom: 6,
};

const fieldLabelStyle: React.CSSProperties = {
  width: 46,
  flexShrink: 0,
  color: '#8e94a1',
  fontSize: 11,
};

const numberInputStyle: React.CSSProperties = {
  width: '100%',
  minWidth: 0,
  fontSize: 11,
  padding: '2px 4px',
  border: '1px solid #d9dbe4',
  borderRadius: 4,
};

const buttonStyle: React.CSSProperties = {
  width: '100%',
  padding: '5px 8px',
  borderRadius: 4,
  border: '1px solid #d9dbe4',
  background: 'white',
  color: '#323b48',
  fontSize: 11,
  fontWeight: 600,
  cursor: 'pointer',
};

/**
 * The single control behind the "Sensor Scene JSON" field. It owns both
 * halves of the scene workflow:
 *
 *  1. uploading a scene .json file, and
 *  2. editing the sensors in it — position (by clicking the model in the
 *     viewer), marker colour, and marker size.
 *
 * Everything is stored back into the *same* form-data field as the raw JSON
 * text, so edits round-trip through Superset's normal control machinery and
 * the field's `renderTrigger` re-renders the viewer live. Position picking
 * needs a click inside the chart canvas, which is a different React tree —
 * see `sensorEditorBridge` for that hand-off.
 */
export default function SensorSceneControl({
  value,
  onChange,
  label,
  description,
}: SensorSceneControlProps) {
  const [fileName, setFileName] = useState<string>('');
  const [error, setError] = useState<string>('');
  const [scene, setScene] = useState<SceneData | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [expandedModel, setExpandedModel] = useState<string | null>(null);
  const [pickingId, setPickingId] = useState<string | null>(null);
  const [expandedLocationId, setExpandedLocationId] = useState<string | null>(null);
  const [pickingLocationId, setPickingLocationId] = useState<string | null>(null);
  // Search box inside whichever location's device checklist is open. Reset
  // whenever a different location is expanded so a stale filter from one
  // location doesn't silently hide devices in the next one.
  const [locationDeviceFilter, setLocationDeviceFilter] = useState('');
  const [modelMaxDim, setModelMaxDim] = useState<number | null>(null);
  const [copyFeedback, setCopyFeedback] = useState<string>('');
  // Sensors the viewer found in its dataset query, published over the bridge.
  // Empty when the scene comes from an uploaded file.
  const [roster, setRoster] = useState(() => getSensorRoster());
  // Read inside callbacks that must not be re-created when the roster changes.
  const rosterRef = useRef(roster);
  rosterRef.current = roster;

  // JSON text we most recently pushed up through onChange. Used to tell our
  // own edits apart from a genuinely new value arriving from outside, so
  // re-parsing doesn't clobber in-progress local state.
  const lastEmittedRef = useRef<string | null>(null);
  const commitTimerRef = useRef<number | undefined>(undefined);
  const pendingCommitRef = useRef<string | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  // Mirror of `scene` readable synchronously, so the edit helpers below can
  // build the next scene without doing work inside a state updater (React
  // may invoke those twice, and they must stay side-effect free).
  const sceneRef = useRef<SceneData | null>(null);

  // Parse incoming form-data value into local editable state.
  useEffect(() => {
    if (!value) {
      sceneRef.current = null;
      setScene(null);
      return;
    }
    if (value === lastEmittedRef.current) return;
    try {
      const parsed = JSON.parse(value) as SceneData;
      if (!parsed || !Array.isArray(parsed.devices)) {
        setError('JSON must have a top-level "devices" array.');
        return;
      }
      setError('');
      sceneRef.current = parsed;
      setScene(parsed);
    } catch (e) {
      setError('Could not parse the stored scene JSON.');
    }
  }, [value]);

  // Mirror what the viewer publishes: the model size (for the size slider
  // bounds) and the dataset sensor roster.
  useEffect(() => {
    const sync = () => {
      setModelMaxDim(getModelInfo()?.maxDim ?? null);
      setRoster(getSensorRoster());
    };
    sync();
    return subscribeState(sync);
  }, []);

  /** Pushes JSON up to form data, coalescing the rapid-fire updates that
   * dragging a slider or colour picker produces into one change. */
  const commit = useCallback((next: SceneData) => {
    const text = JSON.stringify(next, null, 2);
    pendingCommitRef.current = text;
    lastEmittedRef.current = text;
    if (commitTimerRef.current !== undefined) {
      window.clearTimeout(commitTimerRef.current);
    }
    commitTimerRef.current = window.setTimeout(() => {
      commitTimerRef.current = undefined;
      const payload = pendingCommitRef.current;
      pendingCommitRef.current = null;
      if (payload !== null && onChangeRef.current) onChangeRef.current(payload);
    }, 120);
  }, []);

  // Flush any coalesced edit and disarm pick mode if this control goes away
  // (e.g. the user collapses the section or leaves Explore).
  useEffect(
    () => () => {
      if (commitTimerRef.current !== undefined) {
        window.clearTimeout(commitTimerRef.current);
        const payload = pendingCommitRef.current;
        if (payload !== null && onChangeRef.current) onChangeRef.current(payload);
      }
      setPickTarget(null);
    },
    [],
  );

  /** Single write path for scene edits: local state, the synchronous mirror,
   * and the (debounced) push up into form data. */
  const applyScene = useCallback(
    (next: SceneData) => {
      sceneRef.current = next;
      setScene(next);
      commit(next);
    },
    [commit],
  );

  /**
   * Upsert, not update: a sensor that came from a dataset row has no entry in
   * the devices array until it's first placed, and when nothing has been
   * uploaded there's no scene object either. Both get created on demand, which
   * is how dataset placements end up saved with the chart.
   */
  const updateDevice = useCallback(
    (deviceId: string, patch: Partial<DeviceDatum>) => {
      const current: SceneData = sceneRef.current ?? { devices: [] };
      const existing = current.devices.find(d => d.deviceId === deviceId);
      applyScene({
        ...current,
        devices: existing
          ? current.devices.map(d =>
              d.deviceId === deviceId ? { ...d, ...patch } : d,
            )
          : [
              ...current.devices,
              {
                deviceId,
                // Carry the label across so the exported JSON is readable
                // without the dataset alongside it.
                deviceName: rosterRef.current.find(r => r.deviceId === deviceId)
                  ?.deviceName,
                ...patch,
              },
            ],
      });
    },
    [applyScene],
  );

  /**
   * Upsert, not update, for a location bookmark too: a location that's only
   * ever been typed in (never picked) still needs to exist the moment its
   * name field is touched.
   */
  const updateLocation = useCallback(
    (id: string, patch: Partial<Omit<LocationPoi, 'id'>>) => {
      const current: SceneData = sceneRef.current ?? { devices: [] };
      const list = current.pois ?? [];
      const existing = list.find(p => p.id === id);
      const nextList = existing
        ? list.map(p => (p.id === id ? { ...p, ...patch } : p))
        : [
            ...list,
            {
              id,
              name: 'New location',
              position: [0, 0, 0] as Position3,
              ...patch,
            },
          ];
      applyScene({ ...current, pois: nextList });
    },
    [applyScene],
  );

  /**
   * One-location-per-device assignment, written as a single pass over the
   * `pois` array so a device is never briefly (or permanently, if a second
   * write races) a member of two locations at once. Checking a device in
   * location B's checklist both adds it there *and* strips it from wherever
   * else it was — that removal is the whole point of this helper, not
   * something callers need to do separately.
   */
  const setDeviceLocation = useCallback(
    (deviceId: string, targetLocationId: string, assign: boolean) => {
      const current: SceneData = sceneRef.current ?? { devices: [] };
      const list = current.pois ?? [];
      const nextList = list.map(p => {
        const ids = p.deviceIds ?? [];
        if (p.id === targetLocationId) {
          if (assign) {
            return ids.includes(deviceId) ? p : { ...p, deviceIds: [...ids, deviceId] };
          }
          return ids.includes(deviceId)
            ? { ...p, deviceIds: ids.filter(id => id !== deviceId) }
            : p;
        }
        // Assigning to another location: drop it from every other one too.
        if (assign && ids.includes(deviceId)) {
          return { ...p, deviceIds: ids.filter(id => id !== deviceId) };
        }
        return p;
      });
      applyScene({ ...current, pois: nextList });
    },
    [applyScene],
  );

  /**
   * Bulk "select all filtered" / "clear filtered" — the primary way someone
   * assigns a batch of devices at once. Both are a single atomic write over
   * `pois`, same as `setDeviceLocation`, and selecting still enforces
   * one-location-per-device by pulling the selected ids out of every other
   * location in the same pass.
   */
  const selectAllFiltered = useCallback(
    (targetLocationId: string, deviceIds: string[]) => {
      const current: SceneData = sceneRef.current ?? { devices: [] };
      const list = current.pois ?? [];
      const targetSet = new Set(deviceIds);
      const nextList = list.map(p => {
        const ids = p.deviceIds ?? [];
        if (p.id === targetLocationId) {
          const merged = new Set(ids);
          targetSet.forEach(id => merged.add(id));
          return { ...p, deviceIds: Array.from(merged) };
        }
        const filtered = ids.filter(id => !targetSet.has(id));
        return filtered.length === ids.length ? p : { ...p, deviceIds: filtered };
      });
      applyScene({ ...current, pois: nextList });
    },
    [applyScene],
  );

  const clearFiltered = useCallback(
    (targetLocationId: string, deviceIds: string[]) => {
      const current: SceneData = sceneRef.current ?? { devices: [] };
      const list = current.pois ?? [];
      const dropSet = new Set(deviceIds);
      const nextList = list.map(p => {
        if (p.id !== targetLocationId) return p;
        const ids = p.deviceIds ?? [];
        return { ...p, deviceIds: ids.filter(id => !dropSet.has(id)) };
      });
      applyScene({ ...current, pois: nextList });
    },
    [applyScene],
  );

  // Apply positions clicked in the viewer. The target (device or location)
  // comes in with the event, so there's no stale-closure hazard.
  useEffect(
    () =>
      subscribePick((kind, id, position) => {
        if (kind === 'location') {
          updateLocation(id, { position });
          setPickingLocationId(null);
        } else {
          updateDevice(id, { position });
          setPickingId(null);
        }
        setPickTarget(null);
      }),
    [updateDevice, updateLocation],
  );

  const handleFile = useCallback(
    (file: File) => {
      setError('');
      const reader = new FileReader();
      reader.onload = () => {
        const text = String(reader.result || '');
        try {
          const parsed = JSON.parse(text);
          if (!parsed || !Array.isArray(parsed.devices)) {
            setError('JSON must have a top-level "devices" array.');
            return;
          }
          setFileName(file.name);
          setExpandedId(null);
          setExpandedModel(null);
          setPickingId(null);
          setExpandedLocationId(null);
          setPickingLocationId(null);
          setPickTarget(null);
          sceneRef.current = parsed as SceneData;
          setScene(parsed as SceneData);
          lastEmittedRef.current = text;
          if (onChange) onChange(text);
        } catch (e) {
          setError('Could not parse file as JSON.');
        }
      };
      reader.onerror = () => setError('Could not read file.');
      reader.readAsText(file);
    },
    [onChange],
  );

  const bounds = useMemo(() => sizeBounds(modelMaxDim), [modelMaxDim]);
  const storedDevices = scene?.devices ?? [];
  const fromDataset = roster.length > 0;
  /**
   * The list to edit. In dataset mode the roster is authoritative about which
   * sensors exist (so sensors that have never been placed still show up), with
   * any stored placement merged in. Otherwise the uploaded file's devices are
   * the whole list.
   */
  const devices: DeviceDatum[] = fromDataset
    ? roster.map(entry => ({
        ...(storedDevices.find(d => d.deviceId === entry.deviceId) || {}),
        deviceId: entry.deviceId,
        deviceName: entry.deviceName,
      }))
    : storedDevices;

  /**
   * Sensors grouped by their NGSI model type ("Coolon-Light"), in first-seen
   * order. Sensors whose id doesn't parse as a full `urn:ngsi-v2:...` (so we
   * can't tell what model they belong to) land in one catch-all "Other
   * sensors" bucket, keyed by `UNGROUPED_KEY`.
   */
  const modelGroups = useMemo(() => {
    const order: string[] = [];
    const byKey = new Map<string, DeviceDatum[]>();
    devices.forEach(device => {
      const parsed = parseSensorId(resolveNgsiId(device));
      const key = parsed.isNgsiUrn && parsed.modelName ? parsed.modelName : UNGROUPED_KEY;
      if (!byKey.has(key)) {
        order.push(key);
        byKey.set(key, []);
      }
      byKey.get(key)!.push(device);
    });
    return order.map(key => ({
      key,
      label: key === UNGROUPED_KEY ? 'Other sensors' : key,
      sensors: byKey.get(key)!,
    }));
  }, [devices]);

  function togglePick(deviceId: string) {
    if (pickingId === deviceId) {
      setPickingId(null);
      setPickTarget(null);
    } else {
      setPickingId(deviceId);
      setPickTarget({ kind: 'device', id: deviceId });
    }
  }

  /**
   * Every sensor under one model shares a marker colour & size — there's no
   * per-sensor styling control any more, only this. Upserts the patch onto
   * every device in the group (dataset-sourced sensors that have never been
   * placed get created here too, same as `updateDevice`).
   */
  function applyStyleToGroup(
    sensors: DeviceDatum[],
    patch: Partial<Pick<DeviceDatum, 'markerColor' | 'markerSize'>>,
  ) {
    const current: SceneData = sceneRef.current ?? { devices: [] };
    const byId = new Map<string, DeviceDatum>(
      current.devices.map(d => [d.deviceId, d] as [string, DeviceDatum]),
    );
    sensors.forEach(row => {
      byId.set(row.deviceId, {
        ...(byId.get(row.deviceId) ?? {
          deviceId: row.deviceId,
          deviceName: row.deviceName,
        }),
        ...patch,
      });
    });
    applyScene({ ...current, devices: Array.from(byId.values()) });
  }

  /**
   * The 3D shape used for every sensor under one model — stored once per
   * model key, not per device (unlike colour/size, there's no per-sensor
   * data to preserve here, so there's no reason to touch every device row
   * just to change a shape).
   */
  function updateModelShape(modelKey: string, shape: MarkerShapeId) {
    const current: SceneData = sceneRef.current ?? { devices: [] };
    applyScene({
      ...current,
      modelShapes: { ...(current.modelShapes ?? {}), [modelKey]: shape },
    });
  }

  function clearPlacement(deviceId: string) {
    // `undefined` rather than a delete: JSON.stringify drops the key, so the
    // sensor goes back to being unplaced.
    updateDevice(deviceId, { position: undefined });
    if (pickingId === deviceId) {
      setPickingId(null);
      setPickTarget(null);
    }
  }

  const locations: LocationPoi[] = scene?.pois ?? [];

  /** deviceId -> the location it's currently assigned to, built once so
   * the checklist's "assigned elsewhere" badge doesn't scan every
   * location's `deviceIds` per row on every render. */
  const deviceLocationMap = useMemo(() => {
    const map = new Map<string, string>();
    locations.forEach(loc => {
      (loc.deviceIds ?? []).forEach(id => map.set(id, loc.id));
    });
    return map;
  }, [locations]);

  function toggleLocationPick(id: string) {
    if (pickingLocationId === id) {
      setPickingLocationId(null);
      setPickTarget(null);
    } else {
      setPickingLocationId(id);
      setPickTarget({ kind: 'location', id });
    }
  }

  function addLocation() {
    const current: SceneData = sceneRef.current ?? { devices: [] };
    const list = current.pois ?? [];
    const id = `loc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const next: LocationPoi = {
      id,
      name: `Location ${list.length + 1}`,
      position: [0, 0, 0],
    };
    applyScene({ ...current, pois: [...list, next] });
    setExpandedLocationId(id);
  }

  function removeLocation(id: string) {
    const current: SceneData = sceneRef.current ?? { devices: [] };
    applyScene({ ...current, pois: (current.pois ?? []).filter(p => p.id !== id) });
    if (pickingLocationId === id) {
      setPickingLocationId(null);
      setPickTarget(null);
    }
    if (expandedLocationId === id) setExpandedLocationId(null);
  }

  function copyJson() {
    // In dataset mode, export the merged view — roster names plus placements —
    // so the result is a portable scene file that works in JSON mode too. In
    // file mode, export exactly what's stored so the round-trip is lossless.
    const payload: SceneData = fromDataset
      ? { ...(scene ?? { devices: [] }), devices: devices.filter(isPlaced) }
      : (scene ?? { devices: [] });
    navigator.clipboard
      .writeText(JSON.stringify(payload, null, 2))
      .then(() => {
        setCopyFeedback('Copied!');
        window.setTimeout(() => setCopyFeedback(''), 2000);
      })
      .catch(() => setCopyFeedback('Copy failed — check clipboard permissions.'));
  }

  return (
    <div style={{ marginBottom: 8 }}>
      {label && (
        <div style={{ fontWeight: 600, marginBottom: 4, fontSize: 12 }}>
          {label}
        </div>
      )}
      {description && (
        <div style={{ fontSize: 11, color: '#8e94a1', marginBottom: 6 }}>
          {description}
        </div>
      )}
      <input
        type="file"
        accept=".json,application/json"
        onChange={e => {
          const file = e.target.files && e.target.files[0];
          if (file) handleFile(file);
        }}
      />
      {fileName && (
        <div style={{ fontSize: 12, color: '#16a34a', marginTop: 4 }}>
          Loaded {fileName}
        </div>
      )}
      {!fileName && value && !fromDataset && (
        <div style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>
          Existing scene data loaded ({value.length} chars). Choose a file to
          replace it.
        </div>
      )}
      {error && (
        <div style={{ fontSize: 12, color: '#dc2626', marginTop: 4 }}>
          {error}
        </div>
      )}

      {devices.length === 0 && (
        <div style={{ fontSize: 11, color: '#8e94a1', marginTop: 8 }}>
          No sensors yet. Either upload a scene file above, or set Sensor Source
          to &ldquo;Dataset rows&rdquo; and map a Sensor ID Column in the Data
          tab — the sensors will then be listed here to place on the model.
        </div>
      )}

      {devices.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <div
            style={{
              fontWeight: 600,
              fontSize: 12,
              marginBottom: 6,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            Sensors
            <span style={{ color: '#8e94a1', fontWeight: 400 }}>
              ({devices.filter(isPlaced).length}/{devices.length} placed)
            </span>
          </div>

          <div style={{ fontSize: 11, color: '#8e94a1', marginBottom: 6 }}>
            {fromDataset
              ? 'From the dataset. Placements are saved with the chart, keyed by sensor ID.'
              : 'From the uploaded file.'}
          </div>

          {modelGroups.map(group => {
            const groupExpanded = group.key === expandedModel;
            const groupPlaced = group.sensors.filter(isPlaced).length;
            const groupShape = scene?.modelShapes?.[group.key] ?? DEFAULT_MARKER_SHAPE;
            const groupColor = toHexColor(
              group.sensors[0]?.markerColor,
              DEFAULT_SHAPE_COLORS[groupShape],
            );
            const groupSize = group.sensors[0]?.markerSize ?? bounds.fallback;

            return (
              <div
                key={group.key}
                style={{
                  border: '1px solid #e2e8f0',
                  borderRadius: 4,
                  marginBottom: 6,
                  overflow: 'hidden',
                  background: groupExpanded ? '#f8fafc' : 'white',
                }}
              >
                <button
                  type="button"
                  onClick={() =>
                    setExpandedModel(groupExpanded ? null : group.key)
                  }
                  style={{
                    width: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '7px 8px',
                    border: 'none',
                    background: 'transparent',
                    cursor: 'pointer',
                    fontSize: 12,
                    fontWeight: 700,
                    textAlign: 'left',
                    color: '#323b48',
                  }}
                >
                  <span
                    style={{
                      width: 10,
                      height: 10,
                      borderRadius: '50%',
                      background: groupColor,
                      border: '1px solid rgba(15,23,42,0.2)',
                      flexShrink: 0,
                    }}
                  />
                  <span
                    style={{
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      flex: 1,
                    }}
                  >
                    {group.label}
                  </span>
                  <span style={{ color: '#8e94a1', fontWeight: 400, fontSize: 11, flexShrink: 0 }}>
                    {groupPlaced}/{group.sensors.length} placed
                  </span>
                  <span style={{ color: '#8e94a1', fontSize: 10, flexShrink: 0 }}>
                    {groupExpanded ? '▲' : '▼'}
                  </span>
                </button>

                {groupExpanded && (
                  <div style={{ padding: '8px', borderTop: '1px solid #e2e8f0' }}>
                    {groupShape === 'light' ? (
                      <div
                        style={{
                          fontSize: 10,
                          color: '#8e94a1',
                          background: '#f8fafc',
                          border: '1px solid #e2e8f0',
                          borderRadius: 4,
                          padding: '6px 8px',
                          marginBottom: 8,
                        }}
                      >
                        Light markers use a fixed grey (day) / amber (night) glow — colour
                        isn&apos;t customisable for this shape.
                      </div>
                    ) : (
                      <div style={rowStyle}>
                        <span style={fieldLabelStyle}>Colour</span>
                        <input
                          type="color"
                          value={groupColor}
                          onChange={e =>
                            applyStyleToGroup(group.sensors, {
                              markerColor: e.target.value,
                            })
                          }
                          style={{
                            width: 34,
                            height: 24,
                            padding: 0,
                            border: '1px solid #d9dbe4',
                            borderRadius: 4,
                            background: 'none',
                            cursor: 'pointer',
                            flexShrink: 0,
                          }}
                        />
                        <input
                          type="text"
                          value={groupColor}
                          onChange={e =>
                            applyStyleToGroup(group.sensors, {
                              markerColor: e.target.value,
                            })
                          }
                          style={{ ...numberInputStyle, width: 74, flexShrink: 0 }}
                        />
                      </div>
                    )}

                    <div style={rowStyle}>
                      <span style={fieldLabelStyle}>Size</span>
                      <input
                        type="range"
                        min={bounds.min}
                        max={bounds.max}
                        step={bounds.step}
                        value={groupSize}
                        onChange={e =>
                          applyStyleToGroup(group.sensors, {
                            markerSize: Number(e.target.value),
                          })
                        }
                        style={{ flex: 1, minWidth: 0 }}
                      />
                      <input
                        type="number"
                        min={0}
                        step={bounds.step}
                        value={groupSize}
                        onChange={e =>
                          applyStyleToGroup(group.sensors, {
                            markerSize: Number(e.target.value) || 0,
                          })
                        }
                        style={{ ...numberInputStyle, width: 60, flexShrink: 0 }}
                      />
                    </div>

                    <div style={rowStyle}>
                      <span style={fieldLabelStyle}>Shape</span>
                      <select
                        value={scene?.modelShapes?.[group.key] ?? DEFAULT_MARKER_SHAPE}
                        onChange={e =>
                          updateModelShape(group.key, e.target.value as MarkerShapeId)
                        }
                        style={{
                          ...numberInputStyle,
                          flex: 1,
                          minWidth: 0,
                          cursor: 'pointer',
                        }}
                      >
                        {MARKER_SHAPE_OPTIONS.map(opt => (
                          <option key={opt.id} value={opt.id}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div
                      style={{
                        fontSize: 10,
                        color: '#8e94a1',
                        margin: '2px 0 10px',
                      }}
                    >
                      Colour, size &amp; shape apply to all {group.sensors.length} sensor
                      {group.sensors.length === 1 ? '' : 's'} under {group.label}.
                    </div>

                    <div
                      style={{
                        fontSize: 10,
                        fontWeight: 700,
                        color: '#8e94a1',
                        textTransform: 'uppercase',
                        letterSpacing: '0.03em',
                        margin: '2px 0 4px',
                      }}
                    >
                      Sensors
                    </div>

                    {group.sensors.map(device => {
                      const expanded = device.deviceId === expandedId;
                      const picking = device.deviceId === pickingId;
                      const placed = isPlaced(device);
                      const position: Position3 = (device.position || [0, 0, 0]) as Position3;
                      const parsedId = parseSensorId(resolveNgsiId(device));
                      const label = parsedId.sensorName || device.deviceName || device.deviceId;

                      return (
                        <div
                          key={device.deviceId}
                          style={{
                            border: '1px solid #e2e8f0',
                            borderRadius: 4,
                            marginBottom: 6,
                            overflow: 'hidden',
                            background: expanded ? 'white' : '#fbfcfe',
                          }}
                        >
                          <button
                            type="button"
                            onClick={() =>
                              setExpandedId(expanded ? null : device.deviceId)
                            }
                            style={{
                              width: '100%',
                              display: 'flex',
                              alignItems: 'center',
                              gap: 6,
                              padding: '6px 8px',
                              border: 'none',
                              background: 'transparent',
                              cursor: 'pointer',
                              fontSize: 12,
                              textAlign: 'left',
                              color: '#323b48',
                            }}
                          >
                            <span
                              style={{
                                width: 8,
                                height: 8,
                                borderRadius: '50%',
                                background: placed ? groupColor : 'transparent',
                                border: placed
                                  ? '1px solid rgba(15,23,42,0.2)'
                                  : '1px dashed #b0b6c3',
                                flexShrink: 0,
                              }}
                            />
                            <span
                              style={{
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                                flex: 1,
                                color: placed ? '#323b48' : '#8e94a1',
                              }}
                            >
                              {label}
                            </span>
                            {!placed && (
                              <span
                                style={{
                                  fontSize: 10,
                                  color: '#8e94a1',
                                  border: '1px solid #e2e8f0',
                                  borderRadius: 3,
                                  padding: '0 4px',
                                  flexShrink: 0,
                                }}
                              >
                                unplaced
                              </span>
                            )}
                            <span style={{ color: '#8e94a1', fontSize: 10 }}>
                              {expanded ? '▲' : '▼'}
                            </span>
                          </button>

                          {expanded && (
                            <div style={{ padding: '8px', borderTop: '1px solid #e2e8f0' }}>
                              <div style={rowStyle}>
                                <span style={fieldLabelStyle}>Position</span>
                                <div style={{ display: 'flex', gap: 4, flex: 1, minWidth: 0 }}>
                                  {[0, 1, 2].map(axis => (
                                    <input
                                      // eslint-disable-next-line react/no-array-index-key
                                      key={axis}
                                      type="number"
                                      step={0.01}
                                      value={position[axis] ?? 0}
                                      onChange={e => {
                                        const next: Position3 = [...position] as Position3;
                                        next[axis] = Number(e.target.value) || 0;
                                        updateDevice(device.deviceId, { position: next });
                                      }}
                                      style={numberInputStyle}
                                    />
                                  ))}
                                </div>
                              </div>

                              <button
                                type="button"
                                onClick={() => togglePick(device.deviceId)}
                                style={{
                                  ...buttonStyle,
                                  marginTop: 2,
                                  border: 'none',
                                  color: 'white',
                                  background: picking ? '#dc2626' : '#2563eb',
                                }}
                              >
                                {picking
                                  ? 'Click the model in the viewer… (cancel)'
                                  : placed
                                    ? 'Re-pick position on model'
                                    : 'Pick position on model'}
                              </button>

                              {placed && (
                                <button
                                  type="button"
                                  onClick={() => clearPlacement(device.deviceId)}
                                  style={{ ...buttonStyle, marginTop: 6, color: '#b91c1c' }}
                                >
                                  Remove from model
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div style={{ marginTop: 16 }}>
        <div
          style={{
            fontWeight: 600,
            fontSize: 12,
            marginBottom: 6,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          Locations
          <span style={{ color: '#8e94a1', fontWeight: 400 }}>
            ({locations.length})
          </span>
        </div>
        <div style={{ fontSize: 11, color: '#8e94a1', marginBottom: 6 }}>
          Named camera bookmarks. Pick a spot on the model or type coordinates,
          then jump to it from the Location filter above the viewer.
        </div>

        {locations.length === 0 && (
          <div style={{ fontSize: 11, color: '#8e94a1', marginBottom: 8 }}>
            No locations yet.
          </div>
        )}

        {locations.map(loc => {
          const expanded = loc.id === expandedLocationId;
          const picking = loc.id === pickingLocationId;
          const zBounds = zoomDistanceBounds(modelMaxDim);
          const zoom = loc.zoomDistance ?? zBounds.fallback;
          const position: Position3 = loc.position || [0, 0, 0];

          return (
            <div
              key={loc.id}
              style={{
                border: '1px solid #e2e8f0',
                borderRadius: 4,
                marginBottom: 6,
                overflow: 'hidden',
                background: expanded ? '#f8fafc' : 'white',
              }}
            >
              <button
                type="button"
                onClick={() => {
                  setExpandedLocationId(expanded ? null : loc.id);
                  setLocationDeviceFilter('');
                }}
                style={{
                  width: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '6px 8px',
                  border: 'none',
                  background: 'transparent',
                  cursor: 'pointer',
                  fontSize: 12,
                  textAlign: 'left',
                  color: '#323b48',
                }}
              >
                <span
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: '50%',
                    background: '#f59e0b',
                    border: '1px solid rgba(15,23,42,0.2)',
                    flexShrink: 0,
                  }}
                />
                <span
                  style={{
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    flex: 1,
                  }}
                >
                  {loc.name || 'Untitled location'}
                </span>
                <span style={{ color: '#8e94a1', fontSize: 10 }}>
                  {expanded ? '▲' : '▼'}
                </span>
              </button>

              {expanded && (
                <div style={{ padding: '8px', borderTop: '1px solid #e2e8f0' }}>
                  <div style={rowStyle}>
                    <span style={fieldLabelStyle}>Name</span>
                    <input
                      type="text"
                      value={loc.name}
                      onChange={e => updateLocation(loc.id, { name: e.target.value })}
                      style={{ ...numberInputStyle, flex: 1 }}
                    />
                  </div>

                  <div style={rowStyle}>
                    <span style={fieldLabelStyle}>Position</span>
                    <div style={{ display: 'flex', gap: 4, flex: 1, minWidth: 0 }}>
                      {[0, 1, 2].map(axis => (
                        <input
                          // eslint-disable-next-line react/no-array-index-key
                          key={axis}
                          type="number"
                          step={0.01}
                          value={position[axis] ?? 0}
                          onChange={e => {
                            const next: Position3 = [...position] as Position3;
                            next[axis] = Number(e.target.value) || 0;
                            updateLocation(loc.id, { position: next });
                          }}
                          style={numberInputStyle}
                        />
                      ))}
                    </div>
                  </div>

                  <div style={rowStyle}>
                    <span style={fieldLabelStyle}>Zoom</span>
                    <input
                      type="range"
                      min={zBounds.min}
                      max={zBounds.max}
                      step={zBounds.step}
                      value={zoom}
                      onChange={e =>
                        updateLocation(loc.id, { zoomDistance: Number(e.target.value) })
                      }
                      style={{ flex: 1, minWidth: 0 }}
                    />
                    <input
                      type="number"
                      min={0}
                      step={zBounds.step}
                      value={zoom}
                      onChange={e =>
                        updateLocation(loc.id, {
                          zoomDistance: Number(e.target.value) || 0,
                        })
                      }
                      style={{ ...numberInputStyle, width: 60, flexShrink: 0 }}
                    />
                  </div>
                  <div style={{ fontSize: 10, color: '#8e94a1', margin: '2px 0 8px' }}>
                    Lower = camera sits closer when jumping here.
                  </div>

                  {(() => {
                    const assignedIds = new Set(loc.deviceIds ?? []);
                    const filterText = locationDeviceFilter.trim().toLowerCase();
                    const filteredDevices = filterText
                      ? devices.filter(d => {
                          const parsedId = parseSensorId(resolveNgsiId(d));
                          const lbl = (
                            parsedId.sensorName ||
                            d.deviceName ||
                            d.deviceId ||
                            ''
                          ).toLowerCase();
                          return lbl.includes(filterText);
                        })
                      : devices;
                    const filteredIds = filteredDevices.map(d => d.deviceId);

                    return (
                      <div style={{ marginBottom: 8 }}>
                        <div
                          style={{
                            fontSize: 10,
                            fontWeight: 700,
                            color: '#8e94a1',
                            textTransform: 'uppercase',
                            letterSpacing: '0.03em',
                            margin: '2px 0 4px',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 6,
                          }}
                        >
                          Devices
                          <span
                            style={{
                              color: '#8e94a1',
                              fontWeight: 400,
                              textTransform: 'none',
                              letterSpacing: 0,
                            }}
                          >
                            ({assignedIds.size} of {devices.length} assigned)
                          </span>
                        </div>

                        <input
                          type="text"
                          value={locationDeviceFilter}
                          onChange={e => setLocationDeviceFilter(e.target.value)}
                          placeholder="Search devices…"
                          style={{ ...numberInputStyle, marginBottom: 6 }}
                        />

                        <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
                          <button
                            type="button"
                            onClick={() => selectAllFiltered(loc.id, filteredIds)}
                            disabled={filteredIds.length === 0}
                            style={{
                              ...buttonStyle,
                              flex: 1,
                              fontSize: 10,
                              padding: '4px 6px',
                              opacity: filteredIds.length === 0 ? 0.5 : 1,
                            }}
                          >
                            Select all filtered ({filteredIds.length})
                          </button>
                          <button
                            type="button"
                            onClick={() => clearFiltered(loc.id, filteredIds)}
                            disabled={filteredIds.length === 0}
                            style={{
                              ...buttonStyle,
                              flex: 1,
                              fontSize: 10,
                              padding: '4px 6px',
                              opacity: filteredIds.length === 0 ? 0.5 : 1,
                            }}
                          >
                            Clear filtered
                          </button>
                        </div>

                        <div
                          style={{
                            maxHeight: 160,
                            overflowY: 'auto',
                            border: '1px solid #e2e8f0',
                            borderRadius: 4,
                            padding: 4,
                          }}
                        >
                          {filteredDevices.length === 0 && (
                            <div style={{ fontSize: 11, color: '#8e94a1', padding: '4px 2px' }}>
                              No devices match.
                            </div>
                          )}
                          {filteredDevices.map(d => {
                            const parsedId = parseSensorId(resolveNgsiId(d));
                            const lbl = parsedId.sensorName || d.deviceName || d.deviceId;
                            const checked = assignedIds.has(d.deviceId);
                            const otherLocId = !checked
                              ? deviceLocationMap.get(d.deviceId)
                              : undefined;
                            const otherLoc = otherLocId
                              ? locations.find(l => l.id === otherLocId)
                              : undefined;

                            return (
                              <label
                                key={d.deviceId}
                                style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: 6,
                                  padding: '3px 2px',
                                  fontSize: 11,
                                  cursor: 'pointer',
                                }}
                              >
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={e =>
                                    setDeviceLocation(d.deviceId, loc.id, e.target.checked)
                                  }
                                />
                                <span
                                  style={{
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                    whiteSpace: 'nowrap',
                                    flex: 1,
                                    color: '#323b48',
                                  }}
                                >
                                  {lbl}
                                </span>
                                {otherLoc && (
                                  <span
                                    style={{
                                      fontSize: 9,
                                      color: '#b45309',
                                      border: '1px solid #fde68a',
                                      background: '#fffbeb',
                                      borderRadius: 3,
                                      padding: '0 4px',
                                      flexShrink: 0,
                                      whiteSpace: 'nowrap',
                                    }}
                                  >
                                    in {otherLoc.name || 'Untitled location'}
                                  </span>
                                )}
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })()}

                  <button
                    type="button"
                    onClick={() => toggleLocationPick(loc.id)}
                    style={{
                      ...buttonStyle,
                      border: 'none',
                      color: 'white',
                      background: picking ? '#dc2626' : '#2563eb',
                    }}
                  >
                    {picking
                      ? 'Click the model in the viewer… (cancel)'
                      : 'Pick position on model'}
                  </button>

                  <button
                    type="button"
                    onClick={() => removeLocation(loc.id)}
                    style={{ ...buttonStyle, marginTop: 6, color: '#b91c1c' }}
                  >
                    Remove location
                  </button>
                </div>
              )}
            </div>
          );
        })}

        <button type="button" onClick={addLocation} style={buttonStyle}>
          + Add location
        </button>
      </div>

      {(devices.length > 0 || locations.length > 0) && (
        <>
          <button
            type="button"
            onClick={copyJson}
            style={{ ...buttonStyle, marginTop: 12 }}
          >
            Copy scene JSON
          </button>
          {copyFeedback && (
            <div
              style={{
                fontSize: 11,
                color: '#16a34a',
                marginTop: 4,
                textAlign: 'center',
              }}
            >
              {copyFeedback}
            </div>
          )}
        </>
      )}
    </div>
  );
}
