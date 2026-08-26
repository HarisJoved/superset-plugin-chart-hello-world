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
import * as THREE from 'three';
// eslint-disable-next-line import/extensions
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
// eslint-disable-next-line import/extensions
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
// eslint-disable-next-line import/extensions
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import {
  DeviceDatum,
  LocationPoi,
  RgbaColor,
  SceneData,
  SensorSource,
  SupersetPluginChartHelloWorldProps,
  isPlaced,
} from './types';
import {
  PickTarget,
  Position3,
  emitPick,
  getPickTarget,
  setModelInfo,
  setPickTarget,
  setSensorRoster,
  subscribeState,
} from './sensorEditorBridge';
import { SensorDetailPanel, SensorGraphModal } from './SensorPanels';
import {
  OTHER_MODEL_KEY,
  deviceModelKey,
  sensorDisplayName as displayName,
} from './api';
import { DEFAULT_MARKER_SHAPE, DEFAULT_SHAPE_COLORS, MarkerShapeId, buildMarkerShape } from './markerShapes';
import { DevicesPanel } from './DevicesPanel';
import { AlertsPanel } from './AlertsPanel';
import { PanelId, PanelNav } from './PanelNav';

/** Fallback world size used to derive marker/label scale before a model has
 * loaded (or when the scene has no model at all). */
const FALLBACK_WORLD_SIZE = 5;

const FALLBACK_MARKER_COLOR = '#2563eb';

/** Converts a Superset `ColorPickerControl` value ({r,g,b,a}, 0-255/0-1) to
 * a hex string, passing plain strings through unchanged so charts saved
 * before Day/Night Background Color existed (when this was a hex TextControl)
 * keep working without a migration. */
function colorPropToHex(value: RgbaColor | string | undefined, fallback: string): string {
  if (typeof value === 'string' && value.trim()) return value;
  if (value && typeof value === 'object' && 'r' in value) {
    const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
    const toHex = (n: number) => clamp(n).toString(16).padStart(2, '0');
    return `#${toHex(value.r)}${toHex(value.g)}${toHex(value.b)}`;
  }
  return fallback;
}

const filterSelectStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  color: '#334155',
  background: 'rgba(255,255,255,0.92)',
  border: '1px solid #cbd5e1',
  borderRadius: 6,
  padding: '4px 8px',
  cursor: 'pointer',
  maxWidth: 190,
};

/**
 * The marker colour, guarded against values THREE can't parse. The editor's
 * hex text field is edited character by character, so a half-typed "#25"
 * legitimately reaches us; THREE would log an "Unknown color" warning per
 * marker per keystroke and render it black.
 */
function markerColorOf(device: DeviceDatum, fallback: string = FALLBACK_MARKER_COLOR): string {
  if (typeof device.markerColor !== 'string') return fallback;
  const value = device.markerColor.trim();
  if (/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(value)) return value;
  // CSS named colours ("red", "steelblue") are valid THREE input too.
  if (/^[a-z]+$/i.test(value)) return value;
  return fallback;
}

/**
 * Builds a small canvas texture with the device's name for a billboard
 * label. `worldWidth` is how wide the label should be *in scene units* —
 * labels used to be a hardcoded 1.2 units across, which on a 5-unit model
 * meant every name was a quarter of the model wide and the markers looked
 * enormous next to the building.
 */
function makeLabelSprite(text: string, worldWidth: number): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.font = '600 64px sans-serif';
    ctx.fillStyle = 'rgba(15, 23, 42, 0.92)';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 8;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.strokeText(text, canvas.width / 2, canvas.height / 2, canvas.width - 16);
    ctx.fillText(text, canvas.width / 2, canvas.height / 2, canvas.width - 16);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.SpriteMaterial({
    map: texture,
    depthTest: false,
    transparent: true,
  });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(worldWidth, worldWidth * (canvas.height / canvas.width), 1);
  return sprite;
}

/**
 * Builds the group of device marker meshes + labels. Marker meshes are
 * also pushed into `markerMeshesOut` (with the source device stashed in
 * `userData.device`) so the click handler can raycast against them and
 * look up which device was hit.
 *
 * `worldSize` is the model's largest dimension and drives the *defaults*:
 * a device with no explicit `markerSize` gets one proportional to the model
 * instead of a fixed 0.03 that is invisible on a large model and a boulder
 * on a small one. Explicit sizes from the editor are always respected.
 */
/** One marker's per-frame animation state — a gentle idle bob applied to
 * every marker regardless of shape, plus whatever shape-specific `update`
 * the marker itself defines (dust drift, noise pulses, light glow). */
interface MarkerAnimEntry {
  group: THREE.Group;
  baseY: number;
  /** Per-marker phase offset so markers don't all bob in lockstep. */
  phase: number;
  bobAmplitude: number;
  update?: (elapsed: number, isNight: boolean) => void;
}

/** Cheap deterministic hash of a device id into a 0..2π phase, so the same
 * device always bobs with the same offset across rebuilds (no visible
 * "reset" when markers are recreated after an edit). */
function phaseFromId(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i += 1) {
    h = (h * 31 + id.charCodeAt(i)) & 0xffffffff;
  }
  return (Math.abs(h) % 1000) / 1000 * Math.PI * 2;
}

function buildDeviceGroup(
  devices: DeviceDatum[],
  markerMeshesOut: THREE.Mesh[],
  worldSize: number,
  showLabels: boolean,
  modelShapes: Record<string, string> | undefined,
  markerAnimOut: MarkerAnimEntry[],
): THREE.Group {
  const group = new THREE.Group();
  const defaultRadius = worldSize * 0.012;

  devices.forEach(device => {
    const [x, y, z] = device.position || [0, 0, 0];
    const pos = new THREE.Vector3(x || 0, y || 0, z || 0);
    const radius =
      typeof device.markerSize === 'number' && device.markerSize > 0
        ? device.markerSize
        : defaultRadius;

    const shapeId = (modelShapes?.[deviceModelKey(device)] as MarkerShapeId) || DEFAULT_MARKER_SHAPE;
    const color = new THREE.Color(
      markerColorOf(device, DEFAULT_SHAPE_COLORS[shapeId] || FALLBACK_MARKER_COLOR),
    );
    const { group: markerGroup, coreMesh, update } = buildMarkerShape(shapeId, color, radius);
    markerGroup.position.copy(pos);
    coreMesh.userData.device = device;
    group.add(markerGroup);
    markerMeshesOut.push(coreMesh);
    markerAnimOut.push({
      group: markerGroup,
      baseY: pos.y,
      phase: phaseFromId(device.deviceId),
      bobAmplitude: radius * 0.18,
      update,
    });

    if (showLabels && (device.deviceName || device.deviceId)) {
      const label = makeLabelSprite(displayName(device), worldSize * 0.18);
      // Local offset, not a world position — parented to markerGroup so the
      // label rides along with the marker's idle bob instead of floating
      // detached from it.
      label.position.set(0, radius + worldSize * 0.03, 0);
      markerGroup.add(label);
    }
  });

  return group;
}

function disposeObject3D(obj: THREE.Object3D) {
  obj.traverse(node => {
    const mesh = node as THREE.Mesh;
    const sprite = node as THREE.Sprite;
    if (mesh.isMesh || sprite.isSprite) {
      (mesh as THREE.Mesh).geometry?.dispose();
      const mat = (node as THREE.Mesh).material as
        | THREE.Material
        | THREE.Material[];
      const materials = Array.isArray(mat) ? mat : [mat];
      materials.forEach(m => {
        const withMap = m as THREE.Material & { map?: THREE.Texture };
        withMap?.map?.dispose();
        m?.dispose();
      });
    }
  });
}

export default function SupersetPluginChartHelloWorld(
  props: SupersetPluginChartHelloWorldProps,
) {
  const {
    height,
    width,
    boldText,
    headerFontSize,
    headerText,
    sceneDataJson,
    dayBackgroundColor,
    nightBackgroundColor,
    cameraZoom = 1,
    showLabels = true,
    sensorSource,
    modelUrl: modelUrlOverride = '',
    data = [],
    sensorIdColumn,
    sensorNameColumn,
    sensorExtraColumns = [],
  } = props;

  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const modelGroupRef = useRef<THREE.Group | null>(null);
  const deviceGroupRef = useRef<THREE.Group | null>(null);
  const markerMeshesRef = useRef<THREE.Mesh[]>([]);
  const markerAnimRef = useRef<MarkerAnimEntry[]>([]);
  // Plays back animation clips embedded in the loaded GLB (conveyor belts,
  // fans, anything the model author baked in) — previously never wired up,
  // which is why the model looked frozen even when it had real animations.
  const mixerRef = useRef<THREE.AnimationMixer | null>(null);
  const clockRef = useRef<THREE.Clock>(new THREE.Clock());
  const ambientLightRef = useRef<THREE.AmbientLight | null>(null);
  const directionalLightRef = useRef<THREE.DirectionalLight | null>(null);
  // Mirrors `isNight` state into a ref so the mount-only animate loop can
  // read the current value without re-subscribing every toggle.
  const isNightRef = useRef(false);
  const raycasterRef = useRef<THREE.Raycaster>(new THREE.Raycaster());
  const animationFrameRef = useRef<number>(0);
  // Always-fresh reference to frameCamera, so effects that fire on model
  // load use the *current* cameraZoom rather than the value captured when
  // the effect was registered.
  const frameCameraRef = useRef<() => void>(() => {});
  const focusOnDeviceRef = useRef<(device: DeviceDatum) => void>(() => {});

  const [error, setError] = useState<string>('');
  const [modelError, setModelError] = useState<string>('');
  const [selectedDevice, setSelectedDevice] = useState<DeviceDatum | null>(null);
  // Whether the historical-data graph modal is open for the selected device.
  const [showGraph, setShowGraph] = useState(false);
  const [modelWorldSize, setModelWorldSize] = useState<number | null>(null);
  // Target the control panel is waiting on a click for (device placement or
  // location pick), mirrored from the sensor-editor bridge into React state
  // so the overlay can react to it.
  const [pickTarget, setPickTargetState] = useState<PickTarget | null>(null);
  // Runtime filters — local to the viewer, not persisted with the chart.
  const [modelFilter, setModelFilter] = useState<string>('__all__');
  const [locationFilter, setLocationFilter] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [activePanel, setActivePanel] = useState<PanelId>('3d');
  const [isNight, setIsNight] = useState(false);

  const fontSizes: Record<string, string> = {
    xxs: '12px',
    xs: '14px',
    s: '16px',
    m: '20px',
    l: '24px',
    xl: '30px',
    xxl: '38px',
  };
  const currentFontSize = fontSizes[headerFontSize] || '24px';

  const sceneData: SceneData | null = useMemo(() => {
    if (!sceneDataJson) return null;
    try {
      const parsed = JSON.parse(sceneDataJson);
      if (!parsed || !Array.isArray(parsed.devices)) {
        setError('JSON must have a top-level "devices" array.');
        return null;
      }
      setError('');
      return parsed as SceneData;
    } catch (e) {
      setError('Could not parse the uploaded JSON.');
      return null;
    }
  }, [sceneDataJson]);

  /** Devices as stored in the scene JSON. In dataset mode this is purely the
   * placement store — positions, colours and sizes keyed by device id — and
   * the roster itself comes from the query. */
  const storedDevices = useMemo<DeviceDatum[]>(
    () => sceneData?.devices ?? [],
    [sceneData],
  );

  // Deliberately keyed off the explicit control and nothing else. Inferring
  // the mode from "is there any scene JSON?" is unstable, because dataset
  // placements are stored in that same field — the first placement would flip
  // the chart into file mode. buildQuery keys off the same control.
  const effectiveSource: SensorSource =
    sensorSource === 'dataset' ? 'dataset' : 'json';

  // The model URL control wins over the uploaded file's `modelUrl`, and is the
  // only source of a model in dataset mode.
  const resolvedModelUrl = modelUrlOverride || sceneData?.modelUrl || '';

  // Joined by value, not reference: transformProps rebuilds this array each
  // render, which would otherwise invalidate the memo below every time.
  const extraColumnsKey = sensorExtraColumns.join(',');

  /** One sensor per dataset row, joined to its stored placement by id. */
  const datasetDevices = useMemo<DeviceDatum[]>(() => {
    if (effectiveSource !== 'dataset' || !sensorIdColumn) return [];
    const placements = new Map<string, DeviceDatum>(
      storedDevices.map(d => [d.deviceId, d] as [string, DeviceDatum]),
    );
    const extras = extraColumnsKey ? extraColumnsKey.split(',') : [];
    const seen = new Set<string>();
    const out: DeviceDatum[] = [];
    data.forEach(row => {
      const rawId = row[sensorIdColumn];
      if (rawId === null || rawId === undefined || rawId === '') return;
      const deviceId = String(rawId);
      // A dataset may legitimately repeat an id (e.g. one row per reading);
      // one marker per sensor is the only thing that makes sense here.
      if (seen.has(deviceId)) return;
      seen.add(deviceId);
      const stored = placements.get(deviceId);
      const extraFields: Record<string, unknown> = {};
      extras.forEach(column => {
        if (column in row) extraFields[column] = row[column];
      });
      const label = sensorNameColumn ? row[sensorNameColumn] : undefined;
      out.push({
        ...extraFields,
        deviceId,
        deviceName:
          label === null || label === undefined ? deviceId : String(label),
        position: stored?.position,
        markerColor: stored?.markerColor,
        markerSize: stored?.markerSize,
      });
    });
    return out;
  }, [
    effectiveSource,
    sensorIdColumn,
    sensorNameColumn,
    extraColumnsKey,
    data,
    storedDevices,
  ]);

  const devices = effectiveSource === 'dataset' ? datasetDevices : storedDevices;
  // Only placed sensors get a marker — dataset sensors start out with no
  // position and would otherwise all pile up at the origin.
  const placedDevices = devices.filter(isPlaced);
  // The model-name filter above the viewer. "__all__" is every placed
  // sensor; anything else is one model key from `deviceModelKey`.
  const modelOptions = Array.from(new Set(placedDevices.map(deviceModelKey)));
  // Falls back to "All" if the previously selected model filter no longer
  // has any sensors under it (e.g. the dataset changed underneath it).
  const effectiveModelFilter =
    modelFilter === '__all__' || modelOptions.includes(modelFilter)
      ? modelFilter
      : '__all__';
  const visibleDevices =
    effectiveModelFilter === '__all__'
      ? placedDevices
      : placedDevices.filter(d => deviceModelKey(d) === effectiveModelFilter);
  // Saved camera bookmarks from the Customize panel's Locations editor.
  const pois = sceneData?.pois ?? [];
  const effectiveLocationFilter = pois.some(p => p.id === locationFilter)
    ? locationFilter
    : '';
  // Only sensors with a position can be zoomed to, so search only looks at
  // `placedDevices` — an unplaced sensor wouldn't have anywhere to fly.
  const searchMatches = (() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return [];
    return placedDevices
      .filter(
        d =>
          displayName(d).toLowerCase().includes(q) ||
          d.deviceId.toLowerCase().includes(q),
      )
      .slice(0, 8);
  })();

  function selectSearchResult(device: DeviceDatum) {
    setSelectedDevice(device);
    setShowGraph(false);
    setSearchQuery('');
    setSearchOpen(false);
    focusOnDevice(device);
  }
  const modelShapes = sceneData?.modelShapes;
  // Only used to decide whether the marker-rebuild effect needs to run —
  // modelShapes is a fresh object reference on every scene update, so a
  // plain dependency would rebuild markers on every unrelated edit too.
  const modelShapesSignature = JSON.stringify(modelShapes ?? {});
  // Serialised marker inputs — lets the marker-rebuild effect fire on colour
  // / size / position edits from the control panel without also refetching
  // the GLB every time an unrelated part of the scene JSON changes.
  const deviceSignature = JSON.stringify(
    placedDevices.map(d => [
      d.deviceId,
      d.deviceName,
      d.position,
      d.markerColor,
      d.markerSize,
    ]),
  );

  // Publish the dataset roster so the sensor editor in the control panel can
  // list sensors it has no other way of seeing (control panels don't get
  // query results). Unchanged rosters are dropped inside the bridge, so this
  // can't loop.
  useEffect(() => {
    if (effectiveSource !== 'dataset') {
      setSensorRoster([]);
      return;
    }
    setSensorRoster(
      datasetDevices.map(d => ({
        deviceId: d.deviceId,
        deviceName: String(d.deviceName || d.deviceId),
      })),
    );
  }, [effectiveSource, datasetDevices]);

  // Mirror the control panel's pick request into local state.
  useEffect(() => {
    const sync = () => setPickTargetState(getPickTarget());
    sync();
    return subscribeState(sync);
  }, []);

  // Clear any stale pick request if the viewer goes away mid-pick.
  useEffect(() => () => setPickTarget(null), []);

  /**
   * Frames the camera so the model fills the viewport.
   *
   * The previous version used the bounding box's max dimension directly as a
   * per-axis camera offset (`maxDim * 1.8 + 2` on x, y *and* z), which puts
   * the camera roughly 1.6x further out than that number again along the
   * diagonal — about 3x too far for a typical model, hence "everything is
   * tiny until I zoom in". This instead measures how much of the viewport the
   * model's bounding box actually covers and closes in until it fills ~92% of
   * the tighter axis, so the fit holds for any model size or aspect ratio.
   */
  function frameCamera() {
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    const scene = sceneRef.current;
    if (!camera || !controls || !scene) return;

    // Prefer framing on the model alone. Devices can sit well outside the
    // model (bad coordinates, or not yet positioned) and would otherwise
    // blow the bounding box up and shrink the model on screen.
    const box = new THREE.Box3();
    if (modelGroupRef.current) {
      box.setFromObject(modelGroupRef.current);
    } else {
      let hasContent = false;
      scene.traverse(node => {
        if ((node as THREE.Mesh).isMesh) {
          box.expandByObject(node);
          hasContent = true;
        }
      });
      if (!hasContent) return;
    }
    if (box.isEmpty()) return;

    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const center = sphere.center.clone();
    const radius = Math.max(sphere.radius, 1e-4);

    // Pleasant three-quarter view. The camera always sits exactly `distance`
    // along this direction from the centre.
    const direction = new THREE.Vector3(1, 0.55, 1).normalize();
    const place = (dist: number) => {
      camera.position.copy(center).add(direction.clone().multiplyScalar(dist));
      // Scale the clip planes to the scene, or small models get clipped by
      // the fixed 0.1 near plane and huge ones lose depth precision. `far` is
      // generous enough to cover orbiting out to `controls.maxDistance`,
      // otherwise the model vanishes when the user zooms out.
      camera.near = Math.max(dist / 200, 1e-6);
      camera.far = dist * 30 + radius * 10;
      camera.updateProjectionMatrix();
      camera.lookAt(center);
      camera.updateMatrixWorld();
    };

    const vFov = (camera.fov * Math.PI) / 180;
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * camera.aspect);
    // Fitting the bounding *sphere* is the easy closed form, but it's very
    // conservative — a cube's sphere is 1.7x its width, so the model would
    // only fill ~60% of the frame. Use it as a first guess, then measure the
    // box's actual on-screen extent and close in. Three passes is plenty.
    let distance = radius / Math.sin(Math.min(vFov, hFov) / 2);
    const corners = [
      new THREE.Vector3(box.min.x, box.min.y, box.min.z),
      new THREE.Vector3(box.min.x, box.min.y, box.max.z),
      new THREE.Vector3(box.min.x, box.max.y, box.min.z),
      new THREE.Vector3(box.min.x, box.max.y, box.max.z),
      new THREE.Vector3(box.max.x, box.min.y, box.min.z),
      new THREE.Vector3(box.max.x, box.min.y, box.max.z),
      new THREE.Vector3(box.max.x, box.max.y, box.min.z),
      new THREE.Vector3(box.max.x, box.max.y, box.max.z),
    ];
    // How much of the viewport the model should span, 0-1.
    const targetFill = 0.92;
    for (let pass = 0; pass < 3; pass += 1) {
      place(distance);
      let extent = 0;
      corners.forEach(corner => {
        const ndc = corner.clone().project(camera);
        extent = Math.max(extent, Math.abs(ndc.x), Math.abs(ndc.y));
      });
      if (extent <= 1e-6) break;
      // Perspective makes this non-linear, hence iterating; clamp each step
      // so a corner landing behind the camera can't send it flying.
      const scale = Math.min(Math.max(extent / targetFill, 0.25), 4);
      distance *= scale;
    }

    const zoom = cameraZoom > 0 ? cameraZoom : 1;
    distance /= zoom;
    place(distance);

    controls.target.copy(center);
    controls.minDistance = radius * 0.02;
    controls.maxDistance = distance * 20;
    controls.update();
  }
  frameCameraRef.current = frameCamera;

  /**
   * Points the camera at `center` from `distance` away, along the same
   * three-quarter angle `frameCamera` uses for the whole-model fit. Shared
   * by `flyToLocation` and `focusOnDevice`, which only differ in how they
   * compute `center`/`distance`.
   */
  function pointCameraAt(center: THREE.Vector3, distance: number) {
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!camera || !controls) return;

    const direction = new THREE.Vector3(1, 0.55, 1).normalize();
    camera.position.copy(center).add(direction.clone().multiplyScalar(distance));
    camera.near = Math.max(distance / 200, 1e-6);
    camera.far = distance * 30 + distance * 10;
    camera.updateProjectionMatrix();
    camera.lookAt(center);
    camera.updateMatrixWorld();

    controls.target.copy(center);
    controls.minDistance = distance * 0.02;
    controls.maxDistance = Math.max(controls.maxDistance, distance * 20);
    controls.update();
  }

  /**
   * Points the camera at a saved location bookmark instead of fitting the
   * whole model — centred on the bookmark's point at its own fixed distance
   * rather than one computed to fit a bounding box. Called directly from
   * the Location filter's onChange, so (unlike frameCamera) it doesn't need
   * a ref: there is no later effect that needs to call a "current" version
   * of it.
   */
  function flyToLocation(loc: LocationPoi) {
    const [x, y, z] = loc.position || [0, 0, 0];
    const center = new THREE.Vector3(x || 0, y || 0, z || 0);
    const fallbackDistance = (modelWorldSize ?? FALLBACK_WORLD_SIZE) * 0.3;
    const distance =
      typeof loc.zoomDistance === 'number' && loc.zoomDistance > 0
        ? loc.zoomDistance
        : fallbackDistance;
    pointCameraAt(center, distance);
  }

  /**
   * Zooms in on one sensor for a focused view — used both when a marker is
   * clicked and when a search result is picked. Distance is proportional to
   * the marker's own size (or the model's, if the marker uses the default),
   * so a "focused" view stays a close-up regardless of model scale.
   */
  function focusOnDevice(device: DeviceDatum) {
    const [x, y, z] = device.position || [0, 0, 0];
    const center = new THREE.Vector3(x || 0, y || 0, z || 0);
    const worldSize = modelWorldSize ?? FALLBACK_WORLD_SIZE;
    const radius =
      typeof device.markerSize === 'number' && device.markerSize > 0
        ? device.markerSize
        : worldSize * 0.012;
    const distance = Math.max(radius * 10, worldSize * 0.06);
    pointCameraAt(center, distance);
  }
  // The click handler below lives in an effect keyed on `pickTarget`, not on
  // every render, so it can't just close over `focusOnDevice` directly (that
  // would freeze it to whatever `modelWorldSize` was when the effect last
  // ran). Mirroring it into a ref — refreshed every render, same as
  // `frameCameraRef` — keeps it current without re-subscribing the click
  // listener on every model-size change.
  focusOnDeviceRef.current = focusOnDevice;

  function raycastMarkersAt(clientX: number, clientY: number): THREE.Intersection[] {
    const renderer = rendererRef.current;
    const camera = cameraRef.current;
    const markers = markerMeshesRef.current;
    if (!renderer || !camera || markers.length === 0) return [];
    const rect = renderer.domElement.getBoundingClientRect();
    const mouse = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    raycasterRef.current.setFromCamera(mouse, camera);
    return raycasterRef.current.intersectObjects(markers, false);
  }

  /** Raycasts against the loaded model's real geometry — used for the
   * click-to-place workflow, so a captured position always lands exactly
   * where the user clicked in the same coordinate space the model
   * already renders in. No scale/offset guessing required. */
  function raycastModelAt(clientX: number, clientY: number): THREE.Intersection[] {
    const renderer = rendererRef.current;
    const camera = cameraRef.current;
    const model = modelGroupRef.current;
    if (!renderer || !camera || !model) return [];
    const rect = renderer.domElement.getBoundingClientRect();
    const mouse = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    raycasterRef.current.setFromCamera(mouse, camera);
    return raycasterRef.current.intersectObject(model, true);
  }

  // Base scene setup (renderer, camera, lights, environment, controls).
  // Mount-only: it must NOT re-run for prop changes, because rebuilding the
  // THREE.Scene here would throw away the loaded model and the device markers
  // without the effects that own them re-running to put them back (that's
  // what used to blank the viewer when the background colour was edited).
  // The background colour is applied in place by its own effect below.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;

    const scene = new THREE.Scene();
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(
      50,
      container.clientWidth / Math.max(container.clientHeight, 1),
      0.1,
      1000,
    );
    camera.position.set(4, 3, 4);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setPixelRatio(window.devicePixelRatio || 1);
    // GLTFLoader materials are physically-based and expect proper color
    // management + some environment lighting, or they render flat/washed
    // out compared to a standard glTF viewer.
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1;
    container.innerHTML = '';
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    scene.environment = pmremGenerator.fromScene(
      new RoomEnvironment(),
      0.04,
    ).texture;
    pmremGenerator.dispose();

    const ambient = new THREE.AmbientLight(0xffffff, 0.7);
    scene.add(ambient);
    ambientLightRef.current = ambient;
    const directional = new THREE.DirectionalLight(0xffffff, 0.9);
    directional.position.set(5, 8, 5);
    scene.add(directional);
    directionalLightRef.current = directional;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controlsRef.current = controls;

    clockRef.current = new THREE.Clock();
    const animate = () => {
      const delta = clockRef.current.getDelta();
      const elapsed = clockRef.current.getElapsedTime();

      if (mixerRef.current) mixerRef.current.update(delta);

      const night = isNightRef.current;
      markerAnimRef.current.forEach(entry => {
        entry.group.position.y =
          entry.baseY + Math.sin(elapsed * 1.4 + entry.phase) * entry.bobAmplitude;
        if (entry.update) entry.update(elapsed, night);
      });

      controls.update();
      renderer.render(scene, camera);
      animationFrameRef.current = requestAnimationFrame(animate);
    };
    animate();

    return () => {
      cancelAnimationFrame(animationFrameRef.current);
      controls.dispose();
      renderer.dispose();
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
      if (modelGroupRef.current) disposeObject3D(modelGroupRef.current);
      if (deviceGroupRef.current) disposeObject3D(deviceGroupRef.current);
      modelGroupRef.current = null;
      deviceGroupRef.current = null;
      markerMeshesRef.current = [];
      markerAnimRef.current = [];
      mixerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Recolour the existing scene in place rather than rebuilding it. Picks
  // Day or Night's configured colour based on the toggle, so switching
  // modes changes both lighting (separate effect below) and background
  // together.
  useEffect(() => {
    if (!sceneRef.current) return;
    const hex = isNight
      ? colorPropToHex(nightBackgroundColor, '#0b0f17')
      : colorPropToHex(dayBackgroundColor, '#f8fafc');
    sceneRef.current.background = new THREE.Color(hex);
  }, [dayBackgroundColor, nightBackgroundColor, isNight]);

  // Day/night only touches lighting, not the configured background colour —
  // swapping to a cool, dim ambient + directional light for night, and back
  // to the bright neutral defaults for day. Markers with their own
  // day/night behaviour (e.g. the "light" shape's glow) read `isNightRef`
  // directly inside the animate loop above.
  useEffect(() => {
    isNightRef.current = isNight;
    const ambient = ambientLightRef.current;
    const directional = directionalLightRef.current;
    if (!ambient || !directional) return;
    if (isNight) {
      ambient.intensity = 0.22;
      ambient.color.set('#7c9cff');
      directional.intensity = 0.25;
      directional.color.set('#8fb0ff');
    } else {
      ambient.intensity = 0.7;
      ambient.color.set('#ffffff');
      directional.intensity = 0.9;
      directional.color.set('#ffffff');
    }
  }, [isNight]);

  // Click/hover handling. Re-registered whenever the pick target changes, so
  // the listener always reads fresh state without stale closures.
  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer) return undefined;

    const handleClick = (event: MouseEvent) => {
      if (pickTarget) {
        const hits = raycastModelAt(event.clientX, event.clientY);
        if (hits.length > 0) {
          const p = hits[0].point;
          // Hand the position back to the sensor editor in the control
          // panel; it writes it into the scene JSON, which flows back down
          // here as new props and moves the marker (or the location pin).
          emitPick(pickTarget.kind, pickTarget.id, [p.x, p.y, p.z] as Position3);
        }
        return;
      }

      const hits = raycastMarkersAt(event.clientX, event.clientY);
      if (hits.length > 0) {
        const device = hits[0].object.userData.device as DeviceDatum | undefined;
        setSelectedDevice(device || null);
        setShowGraph(false);
        if (device) focusOnDeviceRef.current(device);
      } else {
        setSelectedDevice(null);
        setShowGraph(false);
      }
    };

    const handleMouseMove = (event: MouseEvent) => {
      if (pickTarget) {
        renderer.domElement.style.cursor = 'crosshair';
        return;
      }
      const hits = raycastMarkersAt(event.clientX, event.clientY);
      renderer.domElement.style.cursor = hits.length > 0 ? 'pointer' : 'default';
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && pickTarget) setPickTarget(null);
    };

    renderer.domElement.addEventListener('click', handleClick);
    renderer.domElement.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      renderer.domElement.removeEventListener('click', handleClick);
      renderer.domElement.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('keydown', handleKeyDown);
      renderer.domElement.style.cursor = 'default';
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickTarget]);

  // Load / reload the GLB model whenever modelUrl changes.
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return undefined;

    setModelError('');

    if (modelGroupRef.current) {
      scene.remove(modelGroupRef.current);
      disposeObject3D(modelGroupRef.current);
      modelGroupRef.current = null;
    }
    // The mixer is tied to whichever GLB is currently loaded — clear it
    // before either bailing out (no modelUrl) or loading a new one, so a
    // stale mixer never keeps ticking against a disposed scene graph.
    mixerRef.current = null;

    const modelUrl = resolvedModelUrl;
    if (!modelUrl) {
      setModelWorldSize(null);
      setModelInfo(null);
      frameCameraRef.current();
      return undefined;
    }

    let cancelled = false;
    const loader = new GLTFLoader();
    // Some GLB exports (e.g. compressed with gltfpack) use the EXT_meshopt_compression
    // extension for their buffer views. Without a decoder wired in, GLTFLoader
    // throws "setMeshoptDecoder must be called before loading compressed
    // files" the moment it hits one — this has nothing to do with the URL or
    // CORS, only with whether *this* particular file happens to use meshopt
    // compression.
    loader.setMeshoptDecoder(MeshoptDecoder);
    loader.load(
      modelUrl,
      gltf => {
        if (cancelled) return;
        const group = new THREE.Group();
        group.add(gltf.scene);
        const scale = sceneData?.modelScale ?? 1;
        group.scale.setScalar(scale);
        if (sceneData?.modelOffset) {
          const [ox, oy, oz] = sceneData.modelOffset;
          group.position.set(ox || 0, oy || 0, oz || 0);
        }
        modelGroupRef.current = group;
        scene.add(group);
        frameCameraRef.current();

        // Play back whatever animation clips are baked into the GLB (rigged
        // machinery, conveyor belts, spinning fans, etc). This is very
        // likely the actual fix for "the model shows no motion" — the
        // clips were there all along, nothing was ever driving them.
        if (gltf.animations && gltf.animations.length > 0) {
          const mixer = new THREE.AnimationMixer(gltf.scene);
          gltf.animations.forEach(clip => mixer.clipAction(clip).play());
          mixerRef.current = mixer;
          // eslint-disable-next-line no-console
          console.info(
            `[3D Viewer] playing ${gltf.animations.length} model animation clip(s):`,
            gltf.animations.map(c => c.name || '(unnamed)').join(', '),
          );
        } else {
          mixerRef.current = null;
        }

        const modelBox = new THREE.Box3().setFromObject(group);
        const modelSize = modelBox.getSize(new THREE.Vector3());
        const modelCenter = modelBox.getCenter(new THREE.Vector3());
        const maxDim = Math.max(modelSize.x, modelSize.y, modelSize.z);
        if (maxDim > 0) {
          // Drives marker/label default scale here, and the marker-size
          // slider bounds over in the control panel.
          setModelWorldSize(maxDim);
          setModelInfo({ maxDim });
        }
        // eslint-disable-next-line no-console
        console.info(
          '[3D Viewer] model bounding box — size (x,y,z):',
          modelSize.x.toFixed(3),
          modelSize.y.toFixed(3),
          modelSize.z.toFixed(3),
          '| center:',
          modelCenter.x.toFixed(3),
          modelCenter.y.toFixed(3),
          modelCenter.z.toFixed(3),
        );
      },
      undefined,
      err => {
        if (cancelled) return;
        // eslint-disable-next-line no-console
        console.error('Failed to load GLB model', err);
        setModelError(
          'Failed to load the model at modelUrl — this is almost always CORS (the host must send Access-Control-Allow-Origin) or an unreachable/wrong URL, not a code bug. Sharing links (SharePoint/OneDrive/Google Drive "share" URLs) will not work here. Device markers will still render.',
        );
        setModelWorldSize(null);
        setModelInfo(null);
        frameCameraRef.current();
      },
    );

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolvedModelUrl, sceneData?.modelScale, JSON.stringify(sceneData?.modelOffset)]);

  // Rebuild device markers whenever a marker's position, colour or size
  // changes in the scene JSON (i.e. on every edit made in the control
  // panel's sensor editor), the model filter changes, or the model's
  // measured size changes the defaults. Independent of the model load, so
  // editing a sensor never refetches the GLB.
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;

    if (deviceGroupRef.current) {
      scene.remove(deviceGroupRef.current);
      disposeObject3D(deviceGroupRef.current);
      deviceGroupRef.current = null;
    }
    markerMeshesRef.current = [];
    markerAnimRef.current = [];

    if (visibleDevices.length === 0) return;

    const newMarkers: THREE.Mesh[] = [];
    const newMarkerAnim: MarkerAnimEntry[] = [];
    const group = buildDeviceGroup(
      visibleDevices,
      newMarkers,
      modelWorldSize ?? FALLBACK_WORLD_SIZE,
      showLabels,
      modelShapes,
      newMarkerAnim,
    );
    deviceGroupRef.current = group;
    markerMeshesRef.current = newMarkers;
    markerAnimRef.current = newMarkerAnim;
    scene.add(group);

    // Keep the open detail panel in sync with the rebuilt (edited) device.
    setSelectedDevice(prev =>
      prev ? placedDevices.find(d => d.deviceId === prev.deviceId) || null : null,
    );

    // Only auto-frame off devices if there's no model to frame against;
    // the model-load effect already frames the camera when a model exists.
    if (!resolvedModelUrl) {
      frameCameraRef.current();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    deviceSignature,
    modelWorldSize,
    showLabels,
    effectiveModelFilter,
    modelShapesSignature,
  ]);

  // Re-frame when the zoom control changes.
  useEffect(() => {
    frameCameraRef.current();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameraZoom]);

  // Resize the renderer/camera in place on chart resize.
  useEffect(() => {
    const renderer = rendererRef.current;
    const camera = cameraRef.current;
    const container = containerRef.current;
    if (!renderer || !camera || !container) return;
    renderer.setSize(container.clientWidth, container.clientHeight);
    camera.aspect =
      container.clientWidth / Math.max(container.clientHeight, 1);
    camera.updateProjectionMatrix();
  }, [width, height]);

  // Human-readable label for whatever is currently armed for pick mode —
  // a device name, a location's name, or the raw id as a last resort.
  const pickTargetLabel = (() => {
    if (!pickTarget) return '';
    if (pickTarget.kind === 'device') {
      const device = devices.find(d => d.deviceId === pickTarget.id);
      return device ? displayName(device) : pickTarget.id;
    }
    const loc = pois.find(p => p.id === pickTarget.id);
    return loc?.name || pickTarget.id;
  })();

  // Nothing to look at yet — say which knob is missing rather than showing an
  // empty grey box.
  let setupMessage = '';
  if (!resolvedModelUrl && placedDevices.length === 0) {
    setupMessage =
      effectiveSource === 'dataset'
        ? 'Enter a 3D Model URL in the Customize panel, then map a Sensor ID Column in the Data tab to place your sensors.'
        : 'Enter a 3D Model URL and upload a Sensor Scene JSON file in the Customize panel — or set Sensor Source to "Dataset rows" to place sensors from this dataset instead.';
  }
  // The model is up but the sensors aren't on it yet. Non-blocking hint.
  let placementHint = '';
  if (!setupMessage && !error && !modelError) {
    if (effectiveSource === 'dataset' && !sensorIdColumn) {
      placementHint =
        'Choose a Sensor ID Column in the Data tab to build sensors from this dataset.';
    } else if (devices.length > 0 && placedDevices.length === 0) {
      placementHint = `${devices.length} sensor${
        devices.length === 1 ? '' : 's'
      } loaded, none placed yet — use the Sensors list in the Customize panel.`;
    }
  }

  return (
    <div
      style={{
        width,
        height,
        position: 'relative',
        boxSizing: 'border-box',
        borderRadius: '12px',
        border: '1px solid #e2e8f0',
        overflow: 'hidden',
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
      }}
    >
      <div
        style={{
          position: 'absolute',
          top: 12,
          left: 16,
          zIndex: 2,
          fontSize: currentFontSize,
          fontWeight: boldText ? 700 : 400,
          color: '#0f172a',
          letterSpacing: '-0.02em',
          textShadow: '0 1px 2px rgba(255,255,255,0.8)',
          pointerEvents: 'none',
        }}
      >
        {headerText || '3D Viewer'}
      </div>

      {placedDevices.length > 0 && (
        <div
          style={{
            position: 'absolute',
            top: 12,
            right: 16,
            zIndex: 3,
            width: 220,
          }}
        >
          <input
            type="text"
            value={searchQuery}
            onChange={e => {
              setSearchQuery(e.target.value);
              setSearchOpen(true);
            }}
            onFocus={() => setSearchOpen(true)}
            onBlur={() => {
              // Delay so a click on a result registers before the dropdown
              // unmounts out from under it.
              window.setTimeout(() => setSearchOpen(false), 150);
            }}
            onKeyDown={e => {
              if (e.key === 'Enter' && searchMatches.length > 0) {
                selectSearchResult(searchMatches[0]);
              } else if (e.key === 'Escape') {
                setSearchQuery('');
                setSearchOpen(false);
              }
            }}
            placeholder="Search sensors…"
            aria-label="Search sensors"
            style={{ ...filterSelectStyle, width: '100%', cursor: 'text' }}
          />
          {searchOpen && searchQuery.trim() && (
            <div
              style={{
                position: 'relative',
                zIndex: 6,
                marginTop: 4,
                background: 'rgba(255,255,255,0.98)',
                border: '1px solid #cbd5e1',
                borderRadius: 6,
                boxShadow: '0 8px 20px rgba(15,23,42,0.18)',
                maxHeight: 220,
                overflowY: 'auto',
              }}
            >
              {searchMatches.length === 0 && (
                <div style={{ padding: '8px 10px', fontSize: 11, color: '#94a3b8' }}>
                  No sensors match "{searchQuery.trim()}"
                </div>
              )}
              {searchMatches.map(device => {
                const key = deviceModelKey(device);
                return (
                  <button
                    key={device.deviceId}
                    type="button"
                    // Mouse down (not click) fires before the input's blur,
                    // so the result is still in the DOM when this runs.
                    onMouseDown={e => {
                      e.preventDefault();
                      selectSearchResult(device);
                    }}
                    style={{
                      display: 'block',
                      width: '100%',
                      textAlign: 'left',
                      padding: '7px 10px',
                      border: 'none',
                      borderBottom: '1px solid #f1f5f9',
                      background: 'transparent',
                      cursor: 'pointer',
                      fontSize: 12,
                      color: '#0f172a',
                    }}
                  >
                    <span style={{ fontWeight: 600 }}>{displayName(device)}</span>
                    {key !== OTHER_MODEL_KEY && (
                      <span style={{ color: '#94a3b8', fontSize: 11 }}> · {key}</span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {(modelOptions.length > 1 || pois.length > 0) && (
        <div
          style={{
            position: 'absolute',
            top: 48,
            left: 16,
            zIndex: 3,
            display: 'flex',
            gap: 6,
            flexWrap: 'wrap',
            maxWidth: 'calc(100% - 32px)',
          }}
        >
          {modelOptions.length > 1 && (
            <select
              value={effectiveModelFilter}
              onChange={e => setModelFilter(e.target.value)}
              aria-label="Filter by sensor model"
              style={filterSelectStyle}
            >
              <option value="__all__">All sensors ({placedDevices.length})</option>
              {modelOptions.map(key => {
                const count = placedDevices.filter(
                  d => deviceModelKey(d) === key,
                ).length;
                return (
                  <option key={key} value={key}>
                    {key === OTHER_MODEL_KEY ? 'Other sensors' : key} ({count})
                  </option>
                );
              })}
            </select>
          )}

          {pois.length > 0 && (
            <select
              value={effectiveLocationFilter}
              onChange={e => {
                const id = e.target.value;
                setLocationFilter(id);
                if (!id) {
                  frameCameraRef.current();
                  return;
                }
                const loc = pois.find(p => p.id === id);
                if (loc) flyToLocation(loc);
              }}
              aria-label="Jump to a saved location"
              style={filterSelectStyle}
            >
              <option value="">Full view</option>
              {pois.map(loc => (
                <option key={loc.id} value={loc.id}>
                  {loc.name || 'Untitled location'}
                </option>
              ))}
            </select>
          )}
        </div>
      )}

      {setupMessage && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#94a3b8',
            fontSize: '14px',
            textAlign: 'center',
            padding: '24px',
            maxWidth: 420,
            margin: '0 auto',
            lineHeight: 1.5,
          }}
        >
          {setupMessage}
        </div>
      )}

      {placementHint && (
        <div
          style={{
            position: 'absolute',
            // Clears the Devices/Alerts button row, which always sits at
            // bottom: 12 in this same left corner.
            bottom: 48,
            left: 16,
            right: 16,
            zIndex: 2,
            fontSize: '12px',
            color: '#475569',
            background: 'rgba(255,255,255,0.9)',
            borderRadius: '6px',
            padding: '6px 10px',
          }}
        >
          {placementHint}
        </div>
      )}

      {/* Pick mode is driven from the sensor editor in the control panel;
          this is the only thing that overlays the canvas while it's on. */}
      {pickTarget && (
        <div
          style={{
            position: 'absolute',
            top: 12,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 4,
            background: 'rgba(37, 99, 235, 0.95)',
            color: 'white',
            fontSize: 12,
            fontWeight: 600,
            padding: '7px 14px',
            borderRadius: 999,
            boxShadow: '0 4px 16px rgba(15,23,42,0.25)',
            pointerEvents: 'none',
            whiteSpace: 'nowrap',
            maxWidth: 'calc(100% - 32px)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {modelWorldSize !== null
            ? `Click the model to place ${pickTargetLabel} — Esc to cancel`
            : 'Load a model (modelUrl) before picking a position'}
        </div>
      )}

      {(error || modelError) && (
        <div
          style={{
            position: 'absolute',
            bottom: 12,
            left: 16,
            right: 16,
            zIndex: 2,
            fontSize: '12px',
            color: '#b91c1c',
            background: 'rgba(255,255,255,0.9)',
            borderRadius: '6px',
            padding: '6px 10px',
          }}
        >
          {error || modelError}
        </div>
      )}

      {selectedDevice && (
        <SensorDetailPanel
          device={selectedDevice}
          onClose={() => {
            setSelectedDevice(null);
            setShowGraph(false);
          }}
          onViewGraph={() => setShowGraph(true)}
        />
      )}

      {selectedDevice && showGraph && (
        <SensorGraphModal
          device={selectedDevice}
          onClose={() => setShowGraph(false)}
        />
      )}

      <div
        style={{
          position: 'absolute',
          bottom: 12,
          right: 16,
          zIndex: 3,
          display: 'flex',
          gap: 8,
          alignItems: 'center',
        }}
      >
        <div
          role="group"
          aria-label="Day or night lighting"
          style={{
            display: 'flex',
            border: '1px solid #cbd5e1',
            borderRadius: 6,
            overflow: 'hidden',
            background: 'rgba(255,255,255,0.9)',
          }}
        >
          <button
            type="button"
            onClick={() => setIsNight(false)}
            style={{
              padding: '5px 10px',
              fontSize: 11,
              fontWeight: 700,
              border: 'none',
              cursor: 'pointer',
              color: isNight ? '#64748b' : 'white',
              background: isNight ? 'transparent' : '#2563eb',
            }}
          >
            ☀ Day
          </button>
          <button
            type="button"
            onClick={() => setIsNight(true)}
            style={{
              padding: '5px 10px',
              fontSize: 11,
              fontWeight: 700,
              border: 'none',
              borderLeft: '1px solid #cbd5e1',
              cursor: 'pointer',
              color: isNight ? 'white' : '#64748b',
              background: isNight ? '#1e3a8a' : 'transparent',
            }}
          >
            🌙 Night
          </button>
        </div>

        {(resolvedModelUrl || placedDevices.length > 0) && (
          <button
            type="button"
            onClick={() => frameCameraRef.current()}
            style={{
              padding: '5px 10px',
              fontSize: 11,
              fontWeight: 600,
              color: '#334155',
              background: 'rgba(255,255,255,0.9)',
              border: '1px solid #cbd5e1',
              borderRadius: 6,
              cursor: 'pointer',
            }}
          >
            Reset view
          </button>
        )}
      </div>

      <div
        style={{
          position: 'absolute',
          bottom: 12,
          left: 16,
          zIndex: 3,
        }}
      >
        <PanelNav
          active="3d"
          onNavigate={setActivePanel}
          deviceCount={devices.length}
          variant="light"
        />
      </div>

      {activePanel === 'devices' && (
        <DevicesPanel
          devices={devices}
          locations={pois}
          activePanel={activePanel}
          onNavigate={setActivePanel}
          onFocusDevice={device => {
            setActivePanel('3d');
            focusOnDeviceRef.current(device);
          }}
        />
      )}

      {activePanel === 'alerts' && (
        <AlertsPanel activePanel={activePanel} onNavigate={setActivePanel} />
      )}

      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
    </div>
  );
}
