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
import { ChartProps } from '@superset-ui/core';
import { SensorRow } from '../types';

export default function transformProps(chartProps: ChartProps) {
  const { width, height, formData, queriesData } = chartProps;
  const {
    boldText,
    headerFontSize,
    headerText,
    sceneDataJson,
    dayBackgroundColor,
    nightBackgroundColor,
    cameraZoom,
    showLabels,
    sensorSource,
    modelUrl,
    sensorIdColumn,
    sensorNameColumn,
    sensorExtraColumns,
  } = formData;

  const parsedZoom = Number(cameraZoom);
  // In JSON-file mode this is the single dummy row from buildQuery's no-op
  // query, which the chart ignores.
  const data = (queriesData?.[0]?.data || []) as SensorRow[];

  return {
    width,
    height,
    boldText,
    headerFontSize,
    headerText,
    sceneDataJson,
    dayBackgroundColor,
    nightBackgroundColor,
    // TextControl hands back a string; fall back to a plain fit when it's
    // blank or nonsense rather than pushing the camera to NaN.
    cameraZoom: Number.isFinite(parsedZoom) && parsedZoom > 0 ? parsedZoom : 1,
    showLabels: showLabels !== false,
    sensorSource: sensorSource === 'dataset' ? 'dataset' : 'json',
    modelUrl: typeof modelUrl === 'string' ? modelUrl.trim() : '',
    data,
    sensorIdColumn,
    sensorNameColumn,
    sensorExtraColumns: Array.isArray(sensorExtraColumns)
      ? sensorExtraColumns
      : [],
  };
}
