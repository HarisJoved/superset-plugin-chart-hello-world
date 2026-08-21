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
import * as THREE from 'three';

/**
 * Built-in procedural marker shapes. There's no 3D-file import here (that's
 * explicitly out of scope for now) — every shape below is built from plain
 * three.js primitives, cheap to construct per marker, and needs no loading
 * state or network fetch.
 */
export type MarkerShapeId =
  | 'sphere'
  | 'pin'
  | 'light'
  | 'dust'
  | 'noise'
  | 'cube'
  | 'diamond';

export const DEFAULT_MARKER_SHAPE: MarkerShapeId = 'sphere';

export interface MarkerShapeOption {
  id: MarkerShapeId;
  label: string;
  description: string;
}

export const MARKER_SHAPE_OPTIONS: MarkerShapeOption[] = [
  { id: 'sphere', label: 'Sphere', description: 'Plain sphere — works for any sensor.' },
  { id: 'pin', label: 'Pin', description: 'Map-pin, tip sits exactly on the sensor.' },
  { id: 'light', label: 'Light sensor', description: 'Bulb with rays.' },
  { id: 'dust', label: 'Dust / air sensor', description: 'Core with a scattered particle cloud.' },
  { id: 'noise', label: 'Noise sensor', description: 'Core with expanding sound rings.' },
  { id: 'cube', label: 'Cube', description: 'Simple cube marker.' },
  { id: 'diamond', label: 'Diamond', description: 'Faceted octahedron marker.' },
];

export interface BuiltMarker {
  /** Root object — position this at the device's location and add it to
   * the scene. Contains the hit-testable core plus any decoration. */
  group: THREE.Group;
  /** The single mesh that should be raycast against for clicks — set
   * `userData.device` on this and push it into the raycast list. Every
   * shape below exposes exactly one, sized close to `radius`, so hit
   * testing stays simple regardless of which shape is active. */
  coreMesh: THREE.Mesh;
  /** Called once per rendered frame with elapsed seconds since the marker
   * was built and whether day/night mode is currently "night". Shapes that
   * don't animate, or don't care about night, simply omit this. */
  update?: (elapsed: number, isNight: boolean) => void;
}

function coreMaterial(color: THREE.Color): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color,
    // A touch of self-illumination keeps markers readable when they sit in
    // the model's shadow, without washing the chosen colour out.
    emissive: color,
    emissiveIntensity: 0.25,
    roughness: 0.4,
  });
}

function decorationMaterial(
  color: THREE.Color,
  opacity: number,
): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
}

function buildSphere(color: THREE.Color, radius: number): BuiltMarker {
  const group = new THREE.Group();
  const coreMesh = new THREE.Mesh(
    new THREE.SphereGeometry(radius, 20, 20),
    coreMaterial(color),
  );
  group.add(coreMesh);
  return { group, coreMesh };
}

function buildCube(color: THREE.Color, radius: number): BuiltMarker {
  const group = new THREE.Group();
  const size = radius * 1.6;
  const coreMesh = new THREE.Mesh(
    new THREE.BoxGeometry(size, size, size),
    coreMaterial(color),
  );
  group.add(coreMesh);
  return { group, coreMesh };
}

function buildDiamond(color: THREE.Color, radius: number): BuiltMarker {
  const group = new THREE.Group();
  const coreMesh = new THREE.Mesh(
    new THREE.OctahedronGeometry(radius * 1.25, 0),
    coreMaterial(color),
  );
  group.add(coreMesh);
  return { group, coreMesh };
}

/** Classic map pin: the tip sits at the group's local origin (i.e. exactly
 * on the device's placed position), with the round head above it. */
function buildPin(color: THREE.Color, radius: number): BuiltMarker {
  const group = new THREE.Group();
  const headRadius = radius * 1.1;
  const stemHeight = radius * 2.4;

  const coreMesh = new THREE.Mesh(
    new THREE.SphereGeometry(headRadius, 18, 18),
    coreMaterial(color),
  );
  coreMesh.position.set(0, stemHeight, 0);
  group.add(coreMesh);

  const stem = new THREE.Mesh(
    new THREE.ConeGeometry(headRadius * 0.55, stemHeight, 14),
    coreMaterial(color),
  );
  // A cone's local origin is its centre, tip pointing +Y by default — flip
  // it point-down and lift so the tip lands exactly at the origin.
  stem.rotation.z = Math.PI;
  stem.position.set(0, stemHeight / 2, 0);
  group.add(stem);

  return { group, coreMesh };
}

/** Bulb with rays radiating out from the equator — a light/lighting sensor.
 * At night it glows (pulsing emissive, slowly spinning rays); by day it
 * reads as switched off, same as a real streetlight would. */
function buildLight(color: THREE.Color, radius: number): BuiltMarker {
  const group = new THREE.Group();
  const material = coreMaterial(color);
  const coreMesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 16, 16), material);
  group.add(coreMesh);

  const rayCount = 8;
  const rayLength = radius * 0.9;
  const rayGeometry = new THREE.CylinderGeometry(
    radius * 0.06,
    radius * 0.06,
    rayLength,
    6,
  );
  const rayMaterial = decorationMaterial(color, 0.85);
  const rayGroup = new THREE.Group();
  for (let i = 0; i < rayCount; i += 1) {
    const angle = (i / rayCount) * Math.PI * 2;
    const ray = new THREE.Mesh(rayGeometry, rayMaterial);
    const inner = radius * 1.15;
    const outer = inner + rayLength;
    const mid = (inner + outer) / 2;
    ray.position.set(Math.cos(angle) * mid, 0, Math.sin(angle) * mid);
    // Cylinders default to standing on Y; lay them flat and point outward.
    ray.rotation.z = Math.PI / 2;
    ray.rotation.y = -angle;
    rayGroup.add(ray);
  }
  group.add(rayGroup);

  const DAY_EMISSIVE = 0.06;
  const update = (elapsed: number, isNight: boolean) => {
    if (isNight) {
      material.emissiveIntensity = 0.6 + Math.sin(elapsed * 3) * 0.25;
      rayMaterial.opacity = 0.65 + Math.sin(elapsed * 3) * 0.2;
      rayGroup.rotation.y = elapsed * 0.15;
    } else {
      material.emissiveIntensity = DAY_EMISSIVE;
      rayMaterial.opacity = 0.12;
    }
  };

  return { group, coreMesh, update };
}

/** Small core plus a fixed scatter of tiny "particles" — dust / air-quality
 * sensor. The offsets are a deterministic fan-out (not random per render),
 * so the shape doesn't jitter every time markers rebuild; each particle
 * drifts around the core on its own slow orbit once animated. */
function buildDust(color: THREE.Color, radius: number): BuiltMarker {
  const group = new THREE.Group();
  const coreMesh = new THREE.Mesh(
    new THREE.SphereGeometry(radius * 0.6, 14, 14),
    coreMaterial(color),
  );
  group.add(coreMesh);

  const particleGeometry = new THREE.SphereGeometry(radius * 0.18, 6, 6);
  const particleMaterial = decorationMaterial(color, 0.75);
  const particleCount = 10;
  const particles: {
    mesh: THREE.Mesh;
    baseAngle: number;
    distance: number;
    elevation: number;
    speed: number;
  }[] = [];
  for (let i = 0; i < particleCount; i += 1) {
    // Deterministic pseudo-scatter: golden-angle spiral in azimuth, a small
    // fixed set of elevations/distances so particles read as a cloud
    // rather than a ring.
    const baseAngle = i * 2.399963; // golden angle, radians
    const elevation = ((i % 3) - 1) * radius * 0.5;
    const distance = radius * (1.1 + (i % 4) * 0.22);
    const mesh = new THREE.Mesh(particleGeometry, particleMaterial);
    mesh.position.set(
      Math.cos(baseAngle) * distance,
      elevation,
      Math.sin(baseAngle) * distance,
    );
    group.add(mesh);
    // Alternate drift direction and vary speed a little per particle so the
    // cloud reads as loosely drifting rather than rigidly rotating in lockstep.
    const speed = (0.25 + (i % 3) * 0.12) * (i % 2 === 0 ? 1 : -1);
    particles.push({ mesh, baseAngle, distance, elevation, speed });
  }

  const update = (elapsed: number) => {
    particles.forEach(p => {
      const angle = p.baseAngle + elapsed * p.speed;
      const bob = Math.sin(elapsed * 1.3 + p.baseAngle) * radius * 0.15;
      p.mesh.position.set(
        Math.cos(angle) * p.distance,
        p.elevation + bob,
        Math.sin(angle) * p.distance,
      );
    });
  };

  return { group, coreMesh, update };
}

/** Core plus two flat rings that pulse outward and fade like sonar pings —
 * a noise / audio sensor. */
function buildNoise(color: THREE.Color, radius: number): BuiltMarker {
  const group = new THREE.Group();
  const coreMesh = new THREE.Mesh(
    new THREE.SphereGeometry(radius * 0.65, 14, 14),
    coreMaterial(color),
  );
  group.add(coreMesh);

  const inner = radius * 1.1;
  const outer = radius * 1.35;
  const ringGeometry = new THREE.RingGeometry(inner, outer, 24);
  // Two rings (one flat/up, one facing the camera side-on) per pulse, at two
  // offset phases, so pings continuously radiate rather than blinking as one.
  const pulses: { mesh: THREE.Mesh; material: THREE.MeshBasicMaterial; offsetSec: number }[] = [];
  [0, 0.8].forEach(offsetSec => {
    const material = decorationMaterial(color, 0.55);
    const ringUp = new THREE.Mesh(ringGeometry, material);
    ringUp.rotation.x = Math.PI / 2;
    group.add(ringUp);
    const ringSide = new THREE.Mesh(ringGeometry, material);
    group.add(ringSide);
    pulses.push({ mesh: ringUp, material, offsetSec });
  });

  const PERIOD = 1.6;
  const update = (elapsed: number) => {
    pulses.forEach(p => {
      const t = (((elapsed + p.offsetSec) % PERIOD) + PERIOD) % PERIOD / PERIOD;
      const scale = 1 + t * 0.9;
      p.mesh.scale.setScalar(scale);
      p.material.opacity = 0.55 * (1 - t);
    });
  };

  return { group, coreMesh, update };
}

const BUILDERS: Record<
  MarkerShapeId,
  (color: THREE.Color, radius: number) => BuiltMarker
> = {
  sphere: buildSphere,
  pin: buildPin,
  light: buildLight,
  dust: buildDust,
  noise: buildNoise,
  cube: buildCube,
  diamond: buildDiamond,
};

export function buildMarkerShape(
  shape: MarkerShapeId | string | undefined,
  color: THREE.Color,
  radius: number,
): BuiltMarker {
  const builder = BUILDERS[(shape as MarkerShapeId) || DEFAULT_MARKER_SHAPE];
  return (builder || buildSphere)(color, radius);
}
