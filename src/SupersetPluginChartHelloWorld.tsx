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
// eslint-disable-next-line import/extensions
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { DeviceDatum, SceneData, SupersetPluginChartHelloWorldProps } from './types';

/** Builds a small canvas texture with the device's name for a billboard label. */
function makeLabelSprite(text: string): THREE.Sprite {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const fontSize = 42;
  canvas.width = 256;
  canvas.height = 64;
  if (ctx) {
    ctx.font = `${fontSize}px sans-serif`;
    ctx.fillStyle = 'rgba(15, 23, 42, 0.9)';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, canvas.width / 2, canvas.height / 2, canvas.width - 8);
  }
  const texture = new THREE.CanvasTexture(canvas);
  const material = new THREE.SpriteMaterial({ map: texture, depthTest: false });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(1.2, 0.3, 1);
  return sprite;
}

/**
 * Builds the group of device marker meshes + labels. Marker meshes are
 * also pushed into `markerMeshesOut` (with the source device stashed in
 * `userData.device`) so the click handler can raycast against them and
 * look up which device was hit. Takes a plain devices array (not the
 * whole SceneData) so it can be rebuilt from `workingDevices`  the
 * live, user-editable copy of the positions  rather than only the
 * originally uploaded JSON.
 */
function buildDeviceGroup(
  devices: DeviceDatum[],
  markerMeshesOut: THREE.Mesh[],
): THREE.Group {
  const group = new THREE.Group();

  devices.forEach(device => {
    const [x, y, z] = device.position || [0, 0, 0];
    const pos = new THREE.Vector3(x || 0, y || 0, z || 0);
    const radius = device.markerSize || 0.03;

    const geometry = new THREE.SphereGeometry(radius, 16, 16);
    const material = new THREE.MeshStandardMaterial({
      color: device.markerColor || '#2563eb',
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.copy(pos);
    mesh.userData.device = device;
    group.add(mesh);
    markerMeshesOut.push(mesh);

    if (device.deviceName || device.deviceId) {
      const label = makeLabelSprite(device.deviceName || device.deviceId);
      label.position.copy(pos).add(new THREE.Vector3(0, radius + 0.15, 0));
      group.add(label);
    }
  });

  return group;
}

function makePendingMarker(size: number): THREE.Mesh {
  const geometry = new THREE.SphereGeometry(size, 16, 16);
  const material = new THREE.MeshStandardMaterial({
    color: '#f59e0b',
    emissive: '#f59e0b',
    emissiveIntensity: 0.4,
  });
  return new THREE.Mesh(geometry, material);
}

function disposeObject3D(obj: THREE.Object3D) {
  obj.traverse(node => {
    const mesh = node as THREE.Mesh;
    if ((mesh as THREE.Mesh).isMesh) {
      mesh.geometry?.dispose();
      const mat = mesh.material as THREE.Material | THREE.Material[];
      if (Array.isArray(mat)) {
        mat.forEach(m => m.dispose());
      } else {
        mat?.dispose();
      }
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
    backgroundColor,
  } = props;

  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const modelGroupRef = useRef<THREE.Group | null>(null);
  const deviceGroupRef = useRef<THREE.Group | null>(null);
  const markerMeshesRef = useRef<THREE.Mesh[]>([]);
  const pendingMarkerRef = useRef<THREE.Mesh | null>(null);
  const raycasterRef = useRef<THREE.Raycaster>(new THREE.Raycaster());
  const animationFrameRef = useRef<number>(0);

  const [error, setError] = useState<string>('');
  const [modelError, setModelError] = useState<string>('');
  const [selectedDevice, setSelectedDevice] = useState<DeviceDatum | null>(null);

  // Live, user-editable copy of the devices list. Repositioning via the
  // click-to-place workflow updates this, not the original uploaded JSON 
  // "Copy Devices JSON" is how the result gets back out.
  const [workingDevices, setWorkingDevices] = useState<DeviceDatum[]>([]);
  const [pickerDeviceId, setPickerDeviceId] = useState<string | null>(null);
  const [pickModeOn, setPickModeOn] = useState<boolean>(false);
  const [pendingPosition, setPendingPosition] = useState<
    [number, number, number] | null
  >(null);
  const [copyFeedback, setCopyFeedback] = useState<string>('');

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

  // Reset the working copy + picker UI whenever a genuinely new file is
  // uploaded (not on every re-render).
  useEffect(() => {
    setWorkingDevices(sceneData?.devices ? [...sceneData.devices] : []);
    setPickerDeviceId(null);
    setPickModeOn(false);
    setPendingPosition(null);
    setSelectedDevice(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sceneDataJson]);

  /** Frames the camera/controls target around whatever's currently in the scene. */
  function frameCamera() {
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    const scene = sceneRef.current;
    if (!camera || !controls || !scene) return;

    const box = new THREE.Box3();
    let hasContent = false;
    scene.traverse(node => {
      const mesh = node as THREE.Mesh;
      if ((mesh as THREE.Mesh).isMesh) {
        box.expandByObject(node);
        hasContent = true;
      }
    });
    if (!hasContent) return;

    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z, 1);
    const distance = maxDim * 1.8 + 2;
    camera.position.set(
      center.x + distance,
      center.y + distance * 0.7,
      center.z + distance,
    );
    controls.target.copy(center);
    camera.lookAt(center);
    controls.update();
  }

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

  /** Raycasts against the loaded model's real geometry  used for the
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
  // Runs once on mount and whenever the background color changes; does
  // NOT reload the model or rebuild device markers, so those can update
  // independently. Click/hover handling lives in its own effect below
  // since it needs to react to pick-mode state changes.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(backgroundColor || '#f8fafc');
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

    scene.add(new THREE.AmbientLight(0xffffff, 0.7));
    const directional = new THREE.DirectionalLight(0xffffff, 0.9);
    directional.position.set(5, 8, 5);
    scene.add(directional);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controlsRef.current = controls;

    const animate = () => {
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
      if (pendingMarkerRef.current) disposeObject3D(pendingMarkerRef.current);
      modelGroupRef.current = null;
      deviceGroupRef.current = null;
      pendingMarkerRef.current = null;
      markerMeshesRef.current = [];
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backgroundColor]);

  // Click/hover handling. Re-registered whenever pick mode or the active
  // picker device changes, so the listener always reads fresh state
  // without relying on stale closures over React state.
  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer) return undefined;

    const handleClick = (event: MouseEvent) => {
      if (pickModeOn && pickerDeviceId) {
        const hits = raycastModelAt(event.clientX, event.clientY);
        if (hits.length > 0) {
          const p = hits[0].point;
          setPendingPosition([p.x, p.y, p.z]);
        }
        return;
      }

      const hits = raycastMarkersAt(event.clientX, event.clientY);
      if (hits.length > 0) {
        const device = hits[0].object.userData.device as DeviceDatum | undefined;
        setSelectedDevice(device || null);
      } else {
        setSelectedDevice(null);
      }
    };

    const handleMouseMove = (event: MouseEvent) => {
      if (pickModeOn) {
        renderer.domElement.style.cursor = 'crosshair';
        return;
      }
      const hits = raycastMarkersAt(event.clientX, event.clientY);
      renderer.domElement.style.cursor = hits.length > 0 ? 'pointer' : 'default';
    };

    renderer.domElement.addEventListener('click', handleClick);
    renderer.domElement.addEventListener('mousemove', handleMouseMove);

    return () => {
      renderer.domElement.removeEventListener('click', handleClick);
      renderer.domElement.removeEventListener('mousemove', handleMouseMove);
      renderer.domElement.style.cursor = 'default';
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickModeOn, pickerDeviceId]);

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

    const modelUrl = sceneData?.modelUrl;
    if (!modelUrl) {
      frameCamera();
      return undefined;
    }

    let cancelled = false;
    const loader = new GLTFLoader();
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
        frameCamera();

        const modelBox = new THREE.Box3().setFromObject(group);
        const modelSize = modelBox.getSize(new THREE.Vector3());
        const modelCenter = modelBox.getCenter(new THREE.Vector3());
        // eslint-disable-next-line no-console
        console.info(
          '[3D Device Viewer] model bounding box  size (x,y,z):',
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
          'Failed to load the model at modelUrl  this is almost always CORS (the host must send Access-Control-Allow-Origin) or an unreachable/wrong URL, not a code bug. Sharing links (SharePoint/OneDrive/Google Drive "share" URLs) will not work here. Device markers will still render.',
        );
        frameCamera();
      },
    );

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sceneData?.modelUrl, sceneData?.modelScale, JSON.stringify(sceneData?.modelOffset)]);

  // Rebuild device markers whenever the *working* device list changes 
  // i.e. live edits from the click-to-place workflow, not just the
  // original uploaded JSON. Independent of the model load, so editing
  // positions doesn't refetch the GLB.
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;

    if (deviceGroupRef.current) {
      scene.remove(deviceGroupRef.current);
      disposeObject3D(deviceGroupRef.current);
      deviceGroupRef.current = null;
    }
    markerMeshesRef.current = [];

    if (workingDevices.length === 0) return;

    const newMarkers: THREE.Mesh[] = [];
    const group = buildDeviceGroup(workingDevices, newMarkers);
    deviceGroupRef.current = group;
    markerMeshesRef.current = newMarkers;
    scene.add(group);

    // Only auto-frame off devices if there's no model to frame against;
    // the model-load effect already frames the camera when a model exists.
    if (!sceneData?.modelUrl) {
      frameCamera();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workingDevices]);

  // Show/update/remove the pending-position preview marker as the user
  // clicks around while placing a device.
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return undefined;

    if (pendingMarkerRef.current) {
      scene.remove(pendingMarkerRef.current);
      disposeObject3D(pendingMarkerRef.current);
      pendingMarkerRef.current = null;
    }

    if (pendingPosition) {
      const activeDevice = workingDevices.find(d => d.deviceId === pickerDeviceId);
      const marker = makePendingMarker((activeDevice?.markerSize || 0.03) * 1.4);
      marker.position.set(pendingPosition[0], pendingPosition[1], pendingPosition[2]);
      pendingMarkerRef.current = marker;
      scene.add(marker);
    }
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingPosition]);

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

  function confirmPendingPosition() {
    if (!pendingPosition || !pickerDeviceId) return;
    setWorkingDevices(prev =>
      prev.map(d =>
        d.deviceId === pickerDeviceId ? { ...d, position: pendingPosition } : d,
      ),
    );
    setPendingPosition(null);
    setPickModeOn(false);
  }

  function cancelPendingPosition() {
    setPendingPosition(null);
  }

  function copyDevicesJson() {
    const payload = {
      modelUrl: sceneData?.modelUrl,
      resourceId: sceneData?.resourceId,
      resourceName: sceneData?.resourceName,
      devices: workingDevices,
      exportedAt: new Date().toISOString(),
    };
    navigator.clipboard
      .writeText(JSON.stringify(payload, null, 2))
      .then(() => {
        setCopyFeedback('Copied!');
        setTimeout(() => setCopyFeedback(''), 2000);
      })
      .catch(() => setCopyFeedback('Copy failed  check clipboard permissions.'));
  }

  const detailRows = selectedDevice ? Object.entries(selectedDevice) : [];
  const activePickerDevice = pickerDeviceId
    ? workingDevices.find(d => d.deviceId === pickerDeviceId) || null
    : null;

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
        {headerText || '3D Device Viewer'}
      </div>

      {!sceneDataJson && (
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
          }}
        >
          Upload a Device Scene JSON file in the Customize panel.
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

      {workingDevices.length > 0 && (
        <div
          style={{
            position: 'absolute',
            top: 56,
            left: 16,
            zIndex: 3,
            width: 220,
            maxHeight: 'calc(100% - 80px)',
            overflowY: 'auto',
            background: 'rgba(255,255,255,0.97)',
            border: '1px solid #e2e8f0',
            borderRadius: '10px',
            boxShadow: '0 4px 16px rgba(15,23,42,0.15)',
            padding: '12px 14px',
            fontSize: '12px',
            color: '#0f172a',
          }}
        >
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8 }}>
            Devices
          </div>

          {workingDevices.map(device => {
            const active = device.deviceId === pickerDeviceId;
            return (
              <div
                key={device.deviceId}
                onClick={() => {
                  setPickerDeviceId(device.deviceId);
                  setPendingPosition(null);
                  setPickModeOn(false);
                }}
                style={{
                  padding: '6px 8px',
                  borderRadius: 6,
                  marginBottom: 4,
                  cursor: 'pointer',
                  background: active ? '#eff6ff' : 'transparent',
                  border: active ? '1px solid #93c5fd' : '1px solid transparent',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    background: device.markerColor || '#2563eb',
                    flexShrink: 0,
                  }}
                />
                <span
                  style={{
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {device.deviceName || device.deviceId}
                </span>
                {device.position && (
                  <span style={{ marginLeft: 'auto', color: '#16a34a', fontSize: 10 }}>
                    �
                  </span>
                )}
              </div>
            );
          })}

          {activePickerDevice && (
            <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid #e2e8f0' }}>
              <div style={{ fontWeight: 600, marginBottom: 6 }}>
                {activePickerDevice.deviceName || activePickerDevice.deviceId}
              </div>

              {activePickerDevice.position && !pendingPosition && (
                <div style={{ fontSize: 11, color: '#64748b', marginBottom: 8 }}>
                  Current: {activePickerDevice.position.map(n => n.toFixed(3)).join(', ')}
                </div>
              )}

              {pendingPosition ? (
                <>
                  <div style={{ fontSize: 11, color: '#b45309', marginBottom: 8 }}>
                    New: {pendingPosition.map(n => n.toFixed(3)).join(', ')}
                  </div>
                  <button
                    type="button"
                    onClick={confirmPendingPosition}
                    style={{
                      width: '100%',
                      padding: '6px 8px',
                      borderRadius: 6,
                      border: 'none',
                      cursor: 'pointer',
                      fontWeight: 600,
                      color: 'white',
                      background: '#16a34a',
                      marginBottom: 6,
                    }}
                  >
                    Confirm Position
                  </button>
                  <button
                    type="button"
                    onClick={cancelPendingPosition}
                    style={{
                      width: '100%',
                      padding: '6px 8px',
                      borderRadius: 6,
                      border: '1px solid #cbd5e1',
                      cursor: 'pointer',
                      fontWeight: 600,
                      color: '#334155',
                      background: 'white',
                    }}
                  >
                    Cancel
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => setPickModeOn(v => !v)}
                  style={{
                    width: '100%',
                    padding: '6px 8px',
                    borderRadius: 6,
                    border: 'none',
                    cursor: 'pointer',
                    fontWeight: 600,
                    color: 'white',
                    background: pickModeOn ? '#dc2626' : '#2563eb',
                  }}
                >
                  {pickModeOn
                    ? 'Click on the model&'
                    : activePickerDevice.position
                      ? 'Update Position'
                      : 'Set Position'}
                </button>
              )}
            </div>
          )}

          <button
            type="button"
            onClick={copyDevicesJson}
            style={{
              width: '100%',
              marginTop: 12,
              padding: '6px 8px',
              borderRadius: 6,
              border: '1px solid #cbd5e1',
              cursor: 'pointer',
              fontWeight: 600,
              color: '#334155',
              background: 'white',
            }}
          >
            Copy Devices JSON
          </button>
          {copyFeedback && (
            <div style={{ fontSize: 11, color: '#16a34a', marginTop: 4, textAlign: 'center' }}>
              {copyFeedback}
            </div>
          )}
        </div>
      )}

      {selectedDevice && (
        <div
          style={{
            position: 'absolute',
            top: 12,
            right: 16,
            zIndex: 3,
            width: 240,
            maxHeight: '80%',
            overflowY: 'auto',
            background: 'rgba(255,255,255,0.97)',
            border: '1px solid #e2e8f0',
            borderRadius: '10px',
            boxShadow: '0 4px 16px rgba(15,23,42,0.15)',
            padding: '12px 14px',
            fontSize: '12px',
            color: '#0f172a',
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: 8,
            }}
          >
            <div style={{ fontWeight: 700, fontSize: 13 }}>
              {selectedDevice.deviceName || selectedDevice.deviceId}
            </div>
            <button
              type="button"
              onClick={() => setSelectedDevice(null)}
              style={{
                border: 'none',
                background: 'transparent',
                cursor: 'pointer',
                fontSize: 14,
                color: '#64748b',
                lineHeight: 1,
              }}
              aria-label="Close"
            >
              �
            </button>
          </div>
          {detailRows.map(([key, val]) => (
            <div key={key} style={{ display: 'flex', marginBottom: 4 }}>
              <div style={{ width: 90, color: '#64748b', flexShrink: 0 }}>
                {key}
              </div>
              <div style={{ wordBreak: 'break-word' }}>
                {key === 'position' && Array.isArray(val)
                  ? (val as number[]).map(n => n.toFixed(3)).join(', ')
                  : String(val)}
              </div>
            </div>
          ))}
        </div>
      )}

      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
    </div>
  );
}
