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

/**
 * A tiny pub/sub bridge between the sensor editor (which lives in the
 * Explore *control panel*, next to the JSON upload) and the 3D viewer
 * (which lives in the chart area). They are two separate React trees, so
 * they cannot share state through props or context — but they are loaded
 * from the same plugin bundle on the same page, so a module-level
 * singleton is enough.
 *
 * Two directions of traffic:
 *  - control panel → viewer: "arm pick mode for device X" (`setPickTarget`)
 *  - viewer → control panel: "the user clicked the model at [x,y,z]"
 *    (`emitPick`), plus the model's measured size (`setModelInfo`) so the
 *    editor can pick sensible marker-size slider bounds.
 *
 * The singleton is anchored on `window` rather than in module scope so it
 * survives the plugin bundle being evaluated more than once (which can
 * happen with Superset's dynamic plugin loading).
 */

export type Position3 = [number, number, number];

export interface ModelInfo {
  /** Largest bounding-box dimension of the loaded model, in world units. */
  maxDim: number;
}

type PickListener = (deviceId: string, position: Position3) => void;
type StateListener = () => void;

interface BridgeState {
  /** deviceId currently awaiting a click on the model, or null. */
  pickTarget: string | null;
  modelInfo: ModelInfo | null;
  stateListeners: Set<StateListener>;
  pickListeners: Set<PickListener>;
}

const BRIDGE_KEY = '__supersetDeviceViewerSensorBridge__';

function getBridge(): BridgeState {
  const host = window as unknown as Record<string, BridgeState | undefined>;
  if (!host[BRIDGE_KEY]) {
    host[BRIDGE_KEY] = {
      pickTarget: null,
      modelInfo: null,
      stateListeners: new Set(),
      pickListeners: new Set(),
    };
  }
  return host[BRIDGE_KEY] as BridgeState;
}

function notify() {
  getBridge().stateListeners.forEach(listener => listener());
}

/** Subscribe to pickTarget / modelInfo changes. Returns an unsubscribe fn. */
export function subscribeState(listener: StateListener): () => void {
  const bridge = getBridge();
  bridge.stateListeners.add(listener);
  return () => bridge.stateListeners.delete(listener);
}

export function getPickTarget(): string | null {
  return getBridge().pickTarget;
}

/** Arm (or disarm, with null) click-to-place mode for a device. */
export function setPickTarget(deviceId: string | null) {
  getBridge().pickTarget = deviceId;
  notify();
}

export function getModelInfo(): ModelInfo | null {
  return getBridge().modelInfo;
}

export function setModelInfo(info: ModelInfo | null) {
  getBridge().modelInfo = info;
  notify();
}

/** Called by the control panel to hear about clicks on the model. */
export function subscribePick(listener: PickListener): () => void {
  const bridge = getBridge();
  bridge.pickListeners.add(listener);
  return () => bridge.pickListeners.delete(listener);
}

/** Called by the viewer when the user clicks the model in pick mode. */
export function emitPick(deviceId: string, position: Position3) {
  getBridge().pickListeners.forEach(listener => listener(deviceId, position));
}
