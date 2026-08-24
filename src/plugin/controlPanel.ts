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
import SensorSceneControl from './controls/SensorSceneControl';

// Safe translation wrapper avoiding TranslatorSingleton crashes on module load
const t = typeof coreT === 'function' ? coreT : (str: string) => str;

interface DatasourceLike {
  columns?: { column_name?: string; verbose_name?: string | null }[];
}

/**
 * `[value, label]` pairs for every column on the selected dataset. Written
 * out locally rather than imported from chart-controls so the plugin doesn't
 * depend on which helpers a given Superset version happens to export.
 */
function columnChoices(state: unknown): [string, string][] {
  const datasource = (state as { datasource?: DatasourceLike } | undefined)
    ?.datasource;
  return (datasource?.columns || [])
    .map(column => column.column_name)
    .filter((name): name is string => Boolean(name))
    .sort((a, b) => a.localeCompare(b))
    .map(name => [name, name]);
}

/**
 * Every section below uses `tabOverride: 'customize'`, which moves it out
 * of Superset's default "Data" tab and into "Customize" instead. We don't
 * define any Query-tab sections at all, so the Data tab is effectively
 * empty — this chart doesn't run a real analytical query; the scene comes
 * entirely from the uploaded JSON file.
 */
const config: ControlPanelConfig = {
  controlPanelSections: [
    // The only section without `tabOverride`, so this is what fills the Data
    // tab. It's only used when sensors come from the dataset rather than an
    // uploaded file; buildQuery falls back to a no-op query when no id
    // column is picked, so leaving it blank costs nothing.
    {
      label: t('Sensor Data'),
      expanded: true,
      description: t(
        'Map dataset columns to sensors — one row per sensor. Positions are not read from the dataset; you place each sensor on the model yourself under Customize, and the placements are saved with the chart.',
      ),
      controlSetRows: [
        [
          {
            name: 'sensor_id_column',
            config: {
              type: 'SelectControl',
              label: t('Sensor ID Column'),
              description: t(
                'Column uniquely identifying each sensor (e.g. Device_ID). Placements are keyed on this value, so changing it re-keys every placement.',
              ),
              default: null,
              freeForm: false,
              clearable: true,
              mapStateToProps: (state: unknown) => ({
                choices: columnChoices(state),
              }),
            },
          },
        ],
        [
          {
            name: 'sensor_name_column',
            config: {
              type: 'SelectControl',
              label: t('Sensor Label Column'),
              description: t(
                'Column used for the marker label and the editor list (e.g. Full_Device_Name). Falls back to the ID column.',
              ),
              default: null,
              freeForm: false,
              clearable: true,
              mapStateToProps: (state: unknown) => ({
                choices: columnChoices(state),
              }),
            },
          },
        ],
        [
          {
            name: 'sensor_extra_columns',
            config: {
              type: 'SelectControl',
              multi: true,
              label: t('Extra Columns'),
              description: t(
                'Additional columns to fetch and show in the popup when a marker is clicked (e.g. Model_Name).',
              ),
              default: [],
              freeForm: false,
              clearable: true,
              mapStateToProps: (state: unknown) => ({
                choices: columnChoices(state),
              }),
            },
          },
        ],
        ['adhoc_filters'],
        ['row_limit'],
      ],
    },
    {
      label: t('Sensor Scene'),
      expanded: true,
      tabOverride: 'customize',
      controlSetRows: [
        [
          {
            name: 'sensor_source',
            config: {
              type: 'SelectControl',
              label: t('Sensor Source'),
              default: 'json',
              renderTrigger: true,
              clearable: false,
              choices: [
                ['json', t('Uploaded JSON file')],
                ['dataset', t('Dataset rows')],
              ],
              description: t(
                'Where the list of sensors comes from. "Uploaded JSON file" reads devices and their positions from the file below. "Dataset rows" builds one sensor per row of the dataset using the columns mapped in the Data tab — positions are not read from the dataset, you place each sensor yourself and the placements are saved with the chart.',
              ),
            },
          },
        ],
        [
          {
            name: 'model_url',
            config: {
              type: 'TextControl',
              default: '',
              renderTrigger: true,
              label: t('3D Model URL'),
              description: t(
                'URL of a hosted .glb/.gltf file. Overrides "modelUrl" from an uploaded JSON file, and is the only way to set the model when sensors come from a dataset. The host must send CORS headers (Access-Control-Allow-Origin); sharing links from SharePoint/OneDrive/Google Drive will not work.',
              ),
            },
          },
        ],
        [
          {
            name: 'scene_data_json',
            config: {
              type: SensorSceneControl,
              renderTrigger: true,
              label: t('Sensors'),
              description: t(
                'Optionally upload a .json file with a top-level "devices" array (each needing a deviceId and a position [x,y,z]). Whichever source the sensors come from, the list below is where you place them on the model and set their colour and size — those edits are stored here and saved with the chart.',
              ),
              default: '',
            },
          },
        ],
      ],
    },
    {
      label: t('Viewer'),
      expanded: true,
      tabOverride: 'customize',
      controlSetRows: [
        [
          {
            name: 'day_background_color',
            config: {
              type: 'ColorPickerControl',
              default: { r: 248, g: 250, b: 252, a: 1 },
              renderTrigger: true,
              label: t('Day Background Color'),
              description: t(
                'Viewer background while Day mode is active (toggle in the 3D view).',
              ),
            },
          },
          {
            name: 'night_background_color',
            config: {
              type: 'ColorPickerControl',
              default: { r: 11, g: 15, b: 23, a: 1 },
              renderTrigger: true,
              label: t('Night Background Color'),
              description: t(
                'Viewer background while Night mode is active (toggle in the 3D view).',
              ),
            },
          },
        ],
        [
          {
            name: 'camera_zoom',
            config: {
              type: 'TextControl',
              isFloat: true,
              default: 1,
              renderTrigger: true,
              label: t('Camera Zoom'),
              description: t(
                'How tightly the initial view frames the model. 1 fits the whole model to the viewport; raise it (e.g. 1.5) to start closer in, lower it to pull back.',
              ),
            },
          },
        ],
        [
          {
            name: 'show_labels',
            config: {
              type: 'CheckboxControl',
              default: true,
              renderTrigger: true,
              label: t('Show Sensor Labels'),
              description: t(
                'Draw each sensor name next to its marker. Turn off to de-clutter scenes with many sensors — names are still shown when you click a marker.',
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
              default: '3D Viewer',
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
