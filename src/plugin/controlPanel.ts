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
import { t as coreT, validateNonEmpty } from '@superset-ui/core';
import {
  ControlPanelConfig,
  sharedControls,
} from '@superset-ui/chart-controls';

// Safe translation wrapper avoiding TranslatorSingleton crashes on module load
const t = typeof coreT === 'function' ? coreT : (str: string) => str;

const config: ControlPanelConfig = {
  controlPanelSections: [
    {
      label: t('Query'),
      expanded: true,
      controlSetRows: [
        [
          {
            name: 'cols',
            config: {
              ...sharedControls.groupby,
              label: t('Columns'),
              description: t(
                'Columns to fetch — must include your mesh-name and color-value columns',
              ),
            },
          },
        ],
        [
          {
            name: 'metrics',
            config: {
              ...sharedControls.metrics,
              validators: [validateNonEmpty],
            },
          },
        ],
        ['adhoc_filters'],
        [
          {
            name: 'row_limit',
            config: sharedControls.row_limit,
          },
        ],
      ],
    },
    {
      label: t('3D Model Viewer'),
      expanded: true,
      controlSetRows: [
        [
          {
            name: 'glb_url',
            config: {
              type: 'TextControl',
              default: '',
              renderTrigger: true,
              label: t('GLB Model URL'),
              description: t(
                'Relative path (e.g. /static/assets/Duck.glb), Base64 string, or remote HTTP URL',
              ),
            },
          },
        ],
        [
          {
            name: 'mesh_column',
            config: {
              type: 'SelectControl',
              freeForm: true,
              label: t('Mesh Name Column'),
              description: t(
                'Column whose values match mesh/object names inside the GLB file',
              ),
              renderTrigger: true,
              mapStateToProps: (state: any) => ({
                choices: (state.datasource?.columns || []).map(
                  (c: { column_name: string }) => [
                    c.column_name,
                    c.column_name,
                  ],
                ),
              }),
              validators: [validateNonEmpty],
            },
          },
        ],
        [
          {
            name: 'color_column',
            config: {
              type: 'SelectControl',
              freeForm: true,
              label: t('Color Value Column'),
              description: t(
                'Numeric column used to compute the color applied to each matching mesh',
              ),
              renderTrigger: true,
              mapStateToProps: (state: any) => ({
                choices: (state.datasource?.columns || []).map(
                  (c: { column_name: string }) => [
                    c.column_name,
                    c.column_name,
                  ],
                ),
              }),
              validators: [validateNonEmpty],
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
      controlSetRows: [
        [
          {
            name: 'header_text',
            config: {
              type: 'TextControl',
              default: '3D Model Viewer',
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