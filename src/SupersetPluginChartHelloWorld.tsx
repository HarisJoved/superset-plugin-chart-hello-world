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
import * as THREE from 'three';
// eslint-disable-next-line import/extensions
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
// eslint-disable-next-line import/extensions
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { SupersetPluginChartHelloWorldProps } from './types';

/** Maps a numeric value onto a blue -> red HSL ramp, scaled to [min, max]. */
function valueToColor(value: number, min: number, max: number): string {
  if (!Number.isFinite(value) || max === min) {
    return 'hsl(210, 75%, 50%)';
  }
  const ratio = Math.min(Math.max((value - min) / (max - min), 0), 1);
  const hue = (1 - ratio) * 220;
  return `hsl(${hue}, 75%, 50%)`;
}

/** Resolves relative path strings to valid absolute root URLs to prevent /explore/ 404s. */
function resolveGlbUrl(url?: string): string {
  if (!url || url.trim() === '') return '';
  const trimmed = url.trim();
  if (
    trimmed.startsWith('http://') ||
    trimmed.startsWith('https://') ||
    trimmed.startsWith('data:') ||
    trimmed.startsWith('/')
  ) {
    return trimmed;
  }
  return `/${trimmed}`;
}

export default function SupersetPluginChartHelloWorld(
  props: SupersetPluginChartHelloWorldProps,
) {
  const {
    data,
    height,
    width,
    boldText,
    headerFontSize,
    headerText,
    glbUrl,
    meshColumn,
    colorColumn,
    backgroundColor,
  } = props;

  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const loadedModelRef = useRef<THREE.Group | null>(null);
  const originalMaterials = useRef<Map<string, THREE.Material>>(new Map());
  const colorMapRef = useRef<Map<string, string>>(new Map());
  const animationFrameRef = useRef<number>(0);

  const [error, setError] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);

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

  function applyColorsToModel() {
    const model = loadedModelRef.current;
    if (!model) return;
    model.traverse((node) => {
      const mesh = node as THREE.Mesh;
      if (!(mesh as THREE.Mesh).isMesh) return;

      if (!originalMaterials.current.has(mesh.uuid)) {
        originalMaterials.current.set(
          mesh.uuid,
          (mesh.material as THREE.Material).clone(),
        );
      }

      const colorHex = colorMapRef.current.get(mesh.name);
      if (colorHex) {
        const material = (
          mesh.material as THREE.MeshStandardMaterial
        ).clone();
        material.color = new THREE.Color(colorHex);
        mesh.material = material;
      } else {
        const original = originalMaterials.current.get(mesh.uuid);
        if (original) {
          mesh.material = original.clone();
        }
      }
    });
  }

  // Compute mesh-name -> color map when data or columns change
  useEffect(() => {
    const rows = data || [];
    let min = Infinity;
    let max = -Infinity;
    rows.forEach((row) => {
      const v = Number((row as Record<string, unknown>)[colorColumn]);
      if (Number.isFinite(v)) {
        if (v < min) min = v;
        if (v > max) max = v;
      }
    });
    if (!Number.isFinite(min)) min = 0;
    if (!Number.isFinite(max)) max = 0;

    const map = new Map<string, string>();
    rows.forEach((row) => {
      const record = row as Record<string, unknown>;
      const meshName = record[meshColumn];
      const value = Number(record[colorColumn]);
      if (meshName != null && Number.isFinite(value)) {
        map.set(String(meshName), valueToColor(value, min, max));
      }
    });
    colorMapRef.current = map;
    applyColorsToModel();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, meshColumn, colorColumn]);

  // Main 3D WebGL Scene Initialization & GLB Loading
  useEffect(() => {
    setError('');
    setLoading(false);
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
    camera.position.set(3, 3, 3);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setPixelRatio(window.devicePixelRatio || 1);
    container.innerHTML = '';
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const ambient = new THREE.AmbientLight(0xffffff, 0.8);
    const directional = new THREE.DirectionalLight(0xffffff, 1.2);
    directional.position.set(5, 10, 7);
    scene.add(ambient, directional);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controlsRef.current = controls;

    originalMaterials.current = new Map();
    loadedModelRef.current = null;

    let fallbackMesh: THREE.Mesh | null = null;
    const resolvedUrl = resolveGlbUrl(glbUrl);

    if (resolvedUrl !== '') {
      setLoading(true);
      const loader = new GLTFLoader();

      loader.load(
        resolvedUrl,
        (gltf) => {
          setLoading(false);
          const model = gltf.scene;

          // Center and auto-fit model within camera view
          const box = new THREE.Box3().setFromObject(model);
          const center = box.getCenter(new THREE.Vector3());
          const size = box.getSize(new THREE.Vector3());
          const maxDim = Math.max(size.x, size.y, size.z);

          if (maxDim > 0) {
            const scale = 2 / maxDim;
            model.scale.set(scale, scale, scale);
          }
          model.position.sub(center.multiplyScalar(model.scale.x));

          loadedModelRef.current = model;
          scene.add(model);
          applyColorsToModel();
        },
        undefined,
        (err) => {
          setLoading(false);
          console.error('Failed to load GLB model:', err);
          setError(
            'Could not load GLB file (check for 404, invalid URL, or CSP restriction). Displaying 3D shape.',
          );

          // Add Fallback 3D shape if GLB URL fails or is blocked
          const geometry = new THREE.TorusKnotGeometry(0.8, 0.25, 100, 16);
          const material = new THREE.MeshStandardMaterial({
            color: 0x0284c7,
            roughness: 0.3,
            metalness: 0.2,
          });
          fallbackMesh = new THREE.Mesh(geometry, material);
          scene.add(fallbackMesh);
        },
      );
    } else {
      // Default rotating shape when GLB URL is empty
      const geometry = new THREE.TorusKnotGeometry(0.8, 0.25, 100, 16);
      const material = new THREE.MeshStandardMaterial({
        color: 0x0284c7,
        roughness: 0.3,
        metalness: 0.2,
      });
      fallbackMesh = new THREE.Mesh(geometry, material);
      scene.add(fallbackMesh);
    }

    const animate = () => {
      if (fallbackMesh) {
        fallbackMesh.rotation.x += 0.005;
        fallbackMesh.rotation.y += 0.008;
      }
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
      scene.traverse((node) => {
        const mesh = node as THREE.Mesh;
        if ((mesh as THREE.Mesh).isMesh) {
          mesh.geometry?.dispose();
        }
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [glbUrl]);

  // Window/Panel Resize Observer
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

  // Dynamic background update
  useEffect(() => {
    if (sceneRef.current) {
      sceneRef.current.background = new THREE.Color(
        backgroundColor || '#f8fafc',
      );
    }
  }, [backgroundColor]);

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
        {headerText || '3D Model Viewer'}
      </div>

      {loading && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 3,
            color: '#0284c7',
            fontWeight: 600,
            fontSize: '14px',
            background: 'rgba(255,255,255,0.6)',
          }}
        >
          Loading 3D Model...
        </div>
      )}

      {error && (
        <div
          style={{
            position: 'absolute',
            bottom: 12,
            left: 16,
            right: 16,
            zIndex: 4,
            fontSize: '12px',
            color: '#b91c1c',
            background: 'rgba(255,255,255,0.95)',
            border: '1px solid #fca5a5',
            borderRadius: '6px',
            padding: '8px 12px',
            boxShadow: '0 2px 4px rgba(0,0,0,0.05)',
          }}
        >
          {error}
        </div>
      )}

      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
    </div>
  );
}