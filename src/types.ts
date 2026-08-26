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
import { QueryFormData } from '@superset-ui/core';

export interface SupersetPluginChartHelloWorldStylesProps {
  height: number;
  width: number;
  headerFontSize: string;
  boldText: boolean;
}

/**
 * One device entry in the uploaded JSON file. `position` is a plain
 * [x, y, z] tuple (not an {x,y,z} object) to match the exported format.
 * Extra fields (anything beyond what's listed) are preserved and shown
 * in the click info panel, since upstream exports may carry additional
 * metadata we don't need to know about in advance.
 *
 * Only `deviceId` is required: a sensor sourced from a dataset row exists
 * before anyone has placed it, so it has no position (and no colour or size)
 * until the user picks one on the model.
 */
export interface DeviceDatum {
  deviceId: string;
  modelId?: string;
  modelName?: string;
  deviceName?: string;
  position?: [number, number, number];
  markerColor?: string;
  markerSize?: number;
  [key: string]: unknown;
}

/**
 * Whether a device has a usable position. Shared by the viewer (which only
 * draws placed sensors) and the editor (which badges the unplaced ones), and
 * strict about the contents because positions can arrive from a hand-edited
 * JSON file.
 */
export function isPlaced(device: DeviceDatum): boolean {
  const { position } = device;
  return (
    Array.isArray(position) &&
    position.length === 3 &&
    position.every(n => typeof n === 'number' && Number.isFinite(n))
  );
}

import { MarkerShapeId } from './markerShapes';

export interface SceneData {
  modelUrl?: string;
  resourceId?: string;
  resourceName?: string;
  devices: DeviceDatum[];
  exportedAt?: string;
  /** Optional uniform scale applied to the loaded model. Defaults to 1. */
  modelScale?: number;
  /** Optional [x,y,z] offset applied to the loaded model's position. */
  modelOffset?: [number, number, number];
  /** Saved camera bookmarks — named points in the model the viewer's
   * Location filter can jump the camera to. */
  pois?: LocationPoi[];
  /** Marker shape per sensor model, keyed the same way as the placement
   * editor's model groups (parsed NGSI model name, or the "other sensors"
   * bucket key). Every sensor under a model renders with its shape — there
   * is no per-sensor override. */
  modelShapes?: Record<string, MarkerShapeId>;
}

/**
 * A named point of interest in the model — set up once in the Customize
 * panel (by clicking the model or typing coordinates), then picked from the
 * Location filter in the viewer to fly the camera there.
 */
export interface LocationPoi {
  id: string;
  name: string;
  position: [number, number, number];
  /** How far back the camera sits when flying here, in the model's world
   * units. Falls back to a size-appropriate default when unset. */
  zoomDistance?: number;
  /** Devices physically assigned to this location. One location per
   * device — assigning a device here must remove it from wherever else it
   * was assigned. Absent on scenes saved before this field existed; treat
   * as `[]` rather than assuming it's always present. */
  deviceIds?: string[];
}

/** Where the list of sensors comes from. */
export type SensorSource = 'json' | 'dataset';

/** One row of the sensor dataset, as returned by the chart data API. */
export type SensorRow = Record<string, unknown>;

/** What a Superset `ColorPickerControl` produces — r/g/b are 0-255, a is 0-1. */
export interface RgbaColor {
  r: number;
  g: number;
  b: number;
  a?: number;
}

interface SupersetPluginChartHelloWorldCustomizeProps {
  headerText: string;
  sceneDataJson: string;
  /** Viewer background while Day mode is active. Accepts the ColorPickerControl's
   * {r,g,b,a} shape, or a plain hex string for backward compatibility with
   * charts saved before this was a colour picker. */
  dayBackgroundColor?: RgbaColor | string;
  nightBackgroundColor?: RgbaColor | string;
  /** Multiplier on the auto-fit camera distance. 1 = fit model to viewport. */
  cameraZoom?: number;
  /** Whether to draw the billboard name label next to each marker. */
  showLabels?: boolean;
  sensorSource?: SensorSource;
  /** Overrides `modelUrl` from the uploaded JSON when set. */
  modelUrl?: string;
}

/**
 * Dataset-mode inputs. The dataset supplies the sensor *roster* only —
 * there are no coordinate columns, so positions (plus colour and size) are
 * placed by hand and stored in `sceneDataJson`'s devices array, keyed by the
 * value of `sensorIdColumn`.
 */
interface SupersetPluginChartHelloWorldDataProps {
  data: SensorRow[];
  sensorIdColumn?: string;
  sensorNameColumn?: string;
  sensorExtraColumns?: string[];
}

export type SupersetPluginChartHelloWorldQueryFormData = QueryFormData &
  SupersetPluginChartHelloWorldStylesProps &
  SupersetPluginChartHelloWorldCustomizeProps;

export type SupersetPluginChartHelloWorldProps =
  SupersetPluginChartHelloWorldStylesProps &
    SupersetPluginChartHelloWorldCustomizeProps &
    SupersetPluginChartHelloWorldDataProps;
