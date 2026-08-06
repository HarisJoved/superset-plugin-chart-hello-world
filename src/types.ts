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
 */
export interface DeviceDatum {
  modelId: string;
  modelName: string;
  deviceId: string;
  deviceName: string;
  position: [number, number, number];
  markerColor?: string;
  markerSize?: number;
  [key: string]: unknown;
}

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
}

interface SupersetPluginChartHelloWorldCustomizeProps {
  headerText: string;
  sceneDataJson: string;
  backgroundColor: string;
}

export type SupersetPluginChartHelloWorldQueryFormData = QueryFormData &
  SupersetPluginChartHelloWorldStylesProps &
  SupersetPluginChartHelloWorldCustomizeProps;

export type SupersetPluginChartHelloWorldProps =
  SupersetPluginChartHelloWorldStylesProps &
    SupersetPluginChartHelloWorldCustomizeProps;
