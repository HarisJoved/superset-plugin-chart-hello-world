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
  { id: 'light', label: 'Light sensor', description: 'Streetlight bulb — grey and dark by day, glowing amber with rays at night.' },
  { id: 'dust', label: 'Dust / air sensor', description: 'Core with a drifting particle cloud.' },
  { id: 'noise', label: 'Noise sensor', description: 'Speaker cone with expanding sound rings.' },
  { id: 'cube', label: 'Cube', description: 'Boxy sensor housing with an edge outline.' },
  { id: 'diamond', label: 'Diamond', description: 'Faceted octahedron with an equatorial band.' },
];

/**
 * Sensible starting colour per shape, used when a model hasn't had a colour
 * explicitly set in the placement editor — so a freshly-assigned "Noise
 * sensor" shape reads as purple out of the box instead of every unstyled
 * model defaulting to the same generic blue.
 *
 * "light" is a fixed exception: it ignores whatever colour it's given
 * entirely and always renders grey by day / amber by night (see
 * `buildLight`) — its entry here exists only so the model-colour swatch in
 * the placement editor has something sane to show, not because it affects
 * the marker's actual on-screen colour.
 */
export const DEFAULT_SHAPE_COLORS: Record<MarkerShapeId, string> = {
  sphere: '#2563eb',
  pin: '#ef4444',
  light: '#fbbf24',
  dust: '#a8a29e',
  noise: '#8b5cf6',
  cube: '#0ea5e9',
  diamond: '#06b6d4',
};

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
  const geometry = new THREE.BoxGeometry(size, size, size);
  const coreMesh = new THREE.Mesh(geometry, coreMaterial(color));
  group.add(coreMesh);

  // A thin edge outline reads as a housing/casing rather than a flat-shaded
  // block — cheap (one extra line object) and makes the cube legible even
  // when it's small on screen.
  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(geometry),
    new THREE.LineBasicMaterial({ color: '#0f172a', transparent: true, opacity: 0.35 }),
  );
  group.add(edges);

  return { group, coreMesh };
}

function buildDiamond(color: THREE.Color, radius: number): BuiltMarker {
  const group = new THREE.Group();
  const coreMesh = new THREE.Mesh(
    new THREE.OctahedronGeometry(radius * 1.25, 0),
    coreMaterial(color),
  );
  group.add(coreMesh);

  // A thin equatorial band gives the facets something to catch the light
  // against, instead of reading as a flat grey diamond from a distance.
  const band = new THREE.Mesh(
    new THREE.TorusGeometry(radius * 1.05, radius * 0.05, 8, 24),
    decorationMaterial(color, 0.6),
  );
  band.rotation.x = Math.PI / 2;
  group.add(band);

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

/**
 * Streetlight bulb with rays radiating from the equator — a light sensor.
 * This is the one shape with genuinely different geometRy/colour behaviour
 * for day vs night, not just an animation: by day it's a dull grey bulb
 * with no rays at all (switched off), by night it turns amber, glows, and
 * spins its rays slowly. The colour it's constructed with is intentionally
 * ignored for the bulb/rays themselves — see `DEFAULT_SHAPE_COLORS` — only
 * the dark fixture housing stays neutral regardless of day/night.
 */
function buildLight(_color: THREE.Color, radius: number): BuiltMarker {
  const group = new THREE.Group();
  const DAY_COLOR = new THREE.Color('#9ca3af');
  const NIGHT_COLOR = new THREE.Color('#fde047');

  const material = new THREE.MeshStandardMaterial({
    color: DAY_COLOR.clone(),
    emissive: DAY_COLOR.clone(),
    emissiveIntensity: 0.05,
    roughness: 0.5,
  });
  const coreMesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 16, 16), material);
  group.add(coreMesh);

  // Small dark fixture housing beneath the bulb — reads as a real light
  // fitting rather than a bare glowing ball, and doesn't change with
  // day/night since a fixture's casing doesn't glow either way.
  const housing = new THREE.Mesh(
    new THREE.CylinderGeometry(radius * 0.45, radius * 0.6, radius * 0.4, 10),
    new THREE.MeshStandardMaterial({ color: '#334155', roughness: 0.7 }),
  );
  housing.position.set(0, -radius * 0.95, 0);
  group.add(housing);

  const rayCount = 8;
  const rayLength = radius * 0.9;
  const rayGeometry = new THREE.CylinderGeometry(radius * 0.06, radius * 0.06, rayLength, 6);
  const rayMaterial = decorationMaterial(NIGHT_COLOR.clone(), 0.85);
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
  // Rays exist only at night — by day the light is switched off, so there's
  // nothing radiating out from it at all, not just a dim version of it.
  rayGroup.visible = false;
  group.add(rayGroup);

  const update = (elapsed: number, isNight: boolean) => {
    // Smoothly fades the bulb colour between day/night rather than
    // snapping, so flipping the toggle doesn't look like a hard cut.
    const target = isNight ? NIGHT_COLOR : DAY_COLOR;
    material.color.lerp(target, 0.08);
    material.emissive.lerp(target, 0.08);

    if (isNight) {
      material.emissiveIntensity = 0.55 + Math.sin(elapsed * 3) * 0.25;
      rayGroup.visible = true;
      rayMaterial.opacity = 0.7 + Math.sin(elapsed * 3) * 0.2;
      rayGroup.rotation.y = elapsed * 0.15;
    } else {
      material.emissiveIntensity = 0.05;
      rayGroup.visible = false;
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

/** Speaker cone plus two flat rings that pulse outward and fade like sonar
 * pings — a noise / audio sensor. */
function buildNoise(color: THREE.Color, radius: number): BuiltMarker {
  const group = new THREE.Group();
  // A cone reads as "speaker" far more than a plain sphere did — flipped to
  // point outward (+Z) rather than up, since markers are usually viewed
  // from roughly eye level rather than from directly overhead.
  const coreMesh = new THREE.Mesh(
    new THREE.ConeGeometry(radius * 0.55, radius * 1.1, 12),
    coreMaterial(color),
  );
  coreMesh.rotation.x = Math.PI / 2;
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
