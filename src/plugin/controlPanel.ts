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
import { t as coreT } from '@superset-ui/core';
import { ControlPanelConfig } from '@superset-ui/chart-controls';
import JsonFileUploadControl from './controls/JsonFileUploadControl';

// Safe translation wrapper avoiding TranslatorSingleton crashes on module load
const t = typeof coreT === 'function' ? coreT : (str: string) => str;

/**
 * Every section below uses `tabOverride: 'customize'`, which moves it out
 * of Superset's default "Data" tab and into "Customize" instead. We don't
 * define any Query-tab sections at all, so the Data tab is effectively
 * empty — this chart doesn't run a real analytical query; the scene comes
 * entirely from the uploaded JSON file.
 */
const config: ControlPanelConfig = {
  controlPanelSections: [
    {
      label: t('Sensor Scene'),
      expanded: true,
      tabOverride: 'customize',
      controlSetRows: [
        [
          {
            name: 'scene_data_json',
            config: {
              type: JsonFileUploadControl,
              renderTrigger: true,
              label: t('Sensor Scene JSON'),
              description: t(
                'Upload a .json file with a top-level "devices" array, and optionally a "modelUrl" pointing to a hosted .glb file. Each device needs a deviceId, a position [x,y,z], and optionally deviceName, modelName, markerColor, and markerSize. Click a marker in the viewer to see its full data.',
              ),
              default: '',
            },
          },
        ],
        [
          {
            name: 'background_color',
            config: {
              type: 'TextControl',
              default: '#f8fafc',
              renderTrigger: true,
              label: t('Background Color'),
              description: t(
                'Hex color for the viewer background, e.g. #f8fafc',
              ),
            },
          },
        ],
      ],
    },
    {
      label: t('Header'),
      expanded: false,
      tabOverride: 'customize',
      controlSetRows: [
        [
          {
            name: 'header_text',
            config: {
              type: 'TextControl',
              default: '3D Device Viewer',
              renderTrigger: true,
              label: t('Header Text'),
              description: t('Optional caption overlaid on the viewer'),
            },
          },
        ],
        [
          {
            name: 'bold_text',
            config: {
              type: 'CheckboxControl',
              label: t('Bold Text'),
              renderTrigger: true,
              default: true,
              description: t('A checkbox to make the header bold'),
            },
          },
        ],
        [
          {
            name: 'header_font_size',
            config: {
              type: 'SelectControl',
              label: t('Font Size'),
              default: 'xl',
              choices: [
                ['xxs', 'xx-small'],
                ['xs', 'x-small'],
                ['s', 'small'],
                ['m', 'medium'],
                ['l', 'large'],
                ['xl', 'x-large'],
                ['xxl', 'xx-large'],
              ],
              renderTrigger: true,
              description: t('The size of your header font'),
            },
          },
        ],
      ],
    },
  ],
};

export default config;
