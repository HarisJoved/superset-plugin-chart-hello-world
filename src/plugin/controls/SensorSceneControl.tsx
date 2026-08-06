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
import { DeviceDatum, SceneData } from '../../types';
import {
  Position3,
  getModelInfo,
  setPickTarget,
  subscribePick,
  subscribeState,
} from '../../sensorEditorBridge';

interface SensorSceneControlProps {
  value?: string;
  onChange?: (value: string) => void;
  label?: string;
  description?: string;
}

const DEFAULT_COLOR = '#2563eb';

/** Normalises whatever came out of the JSON into a `#rrggbb` value that
 * `<input type="color">` will accept — it silently falls back to black for
 * anything else, which looks like a bug to the user. */
function toHexColor(raw: unknown): string {
  if (typeof raw === 'string' && /^#[0-9a-fA-F]{6}$/.test(raw)) return raw;
  if (typeof raw === 'string' && /^#[0-9a-fA-F]{3}$/.test(raw)) {
    const [, r, g, b] = raw;
    return `#${r}${r}${g}${g}${b}${b}`;
  }
  return DEFAULT_COLOR;
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
  const [pickingId, setPickingId] = useState<string | null>(null);
  const [modelMaxDim, setModelMaxDim] = useState<number | null>(null);
  const [copyFeedback, setCopyFeedback] = useState<string>('');

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

  // Mirror the model size the viewer measured, for the size slider bounds.
  useEffect(() => {
    const sync = () => setModelMaxDim(getModelInfo()?.maxDim ?? null);
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

  const updateDevice = useCallback(
    (deviceId: string, patch: Partial<DeviceDatum>) => {
      const current = sceneRef.current;
      if (!current) return;
      applyScene({
        ...current,
        devices: current.devices.map(d =>
          d.deviceId === deviceId ? { ...d, ...patch } : d,
        ),
      });
    },
    [applyScene],
  );

  // Apply positions clicked in the viewer. The target device comes in with
  // the event, so there's no stale-closure hazard.
  useEffect(
    () =>
      subscribePick((deviceId: string, position: Position3) => {
        updateDevice(deviceId, { position });
        setPickTarget(null);
        setPickingId(null);
      }),
    [updateDevice],
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
          setPickingId(null);
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
  const devices = scene?.devices ?? [];

  function togglePick(deviceId: string) {
    if (pickingId === deviceId) {
      setPickingId(null);
      setPickTarget(null);
    } else {
      setPickingId(deviceId);
      setPickTarget(deviceId);
    }
  }

  function applyToAll(source: DeviceDatum) {
    const current = sceneRef.current;
    if (!current) return;
    applyScene({
      ...current,
      devices: current.devices.map(d => ({
        ...d,
        markerColor: toHexColor(source.markerColor),
        markerSize: source.markerSize ?? bounds.fallback,
      })),
    });
  }

  function copyJson() {
    if (!scene) return;
    navigator.clipboard
      .writeText(JSON.stringify(scene, null, 2))
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
      {!fileName && value && (
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
              ({devices.length})
            </span>
          </div>

          {devices.map(device => {
            const expanded = device.deviceId === expandedId;
            const picking = device.deviceId === pickingId;
            const color = toHexColor(device.markerColor);
            const size = device.markerSize ?? bounds.fallback;
            const position: Position3 = (device.position || [0, 0, 0]) as Position3;

            return (
              <div
                key={device.deviceId}
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
                      width: 10,
                      height: 10,
                      borderRadius: '50%',
                      background: color,
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
                    {device.deviceName || device.deviceId}
                  </span>
                  <span style={{ color: '#8e94a1', fontSize: 10 }}>
                    {expanded ? '▲' : '▼'}
                  </span>
                </button>

                {expanded && (
                  <div
                    style={{
                      padding: '8px',
                      borderTop: '1px solid #e2e8f0',
                    }}
                  >
                    <div style={rowStyle}>
                      <span style={fieldLabelStyle}>Colour</span>
                      <input
                        type="color"
                        value={color}
                        onChange={e =>
                          updateDevice(device.deviceId, {
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
                        value={color}
                        onChange={e =>
                          updateDevice(device.deviceId, {
                            markerColor: e.target.value,
                          })
                        }
                        style={{ ...numberInputStyle, width: 74, flexShrink: 0 }}
                      />
                    </div>

                    <div style={rowStyle}>
                      <span style={fieldLabelStyle}>Size</span>
                      <input
                        type="range"
                        min={bounds.min}
                        max={bounds.max}
                        step={bounds.step}
                        value={size}
                        onChange={e =>
                          updateDevice(device.deviceId, {
                            markerSize: Number(e.target.value),
                          })
                        }
                        style={{ flex: 1, minWidth: 0 }}
                      />
                      <input
                        type="number"
                        min={0}
                        step={bounds.step}
                        value={size}
                        onChange={e =>
                          updateDevice(device.deviceId, {
                            markerSize: Number(e.target.value) || 0,
                          })
                        }
                        style={{ ...numberInputStyle, width: 60, flexShrink: 0 }}
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
                        : 'Pick position on model'}
                    </button>

                    <button
                      type="button"
                      onClick={() => applyToAll(device)}
                      style={{ ...buttonStyle, marginTop: 6 }}
                    >
                      Apply this colour &amp; size to all sensors
                    </button>
                  </div>
                )}
              </div>
            );
          })}

          <button type="button" onClick={copyJson} style={{ ...buttonStyle, marginTop: 6 }}>
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
        </div>
      )}
    </div>
  );
}
