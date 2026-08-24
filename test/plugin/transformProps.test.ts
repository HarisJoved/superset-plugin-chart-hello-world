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
import { ChartProps, supersetTheme } from '@superset-ui/core';
import transformProps from '../../src/plugin/transformProps';

describe('SupersetPluginChartHelloWorld transformProps', () => {
  const formData = {
    datasource: '3__table',
    granularity_sqla: 'ds',
    boldText: true,
    headerFontSize: 'xs',
    headerText: 'my text',
    sceneDataJson: '{"devices":[{"deviceId":"d1","deviceName":"Test Device","modelId":"m1","modelName":"Test Model","position":[0,0,0]}]}',
    dayBackgroundColor: { r: 248, g: 250, b: 252, a: 1 },
    nightBackgroundColor: { r: 11, g: 15, b: 23, a: 1 },
    cameraZoom: 1,
    showLabels: true,
  };
  const chartProps = new ChartProps({
    formData,
    width: 800,
    height: 600,
    theme: supersetTheme,
    queriesData: [{ data: [] }],
  });

  it('should transform chart props for viz', () => {
    expect(transformProps(chartProps)).toEqual({
      width: 800,
      height: 600,
      boldText: true,
      headerFontSize: 'xs',
      headerText: 'my text',
      sceneDataJson: '{"devices":[{"deviceId":"d1","deviceName":"Test Device","modelId":"m1","modelName":"Test Model","position":[0,0,0]}]}',
      dayBackgroundColor: { r: 248, g: 250, b: 252, a: 1 },
      nightBackgroundColor: { r: 11, g: 15, b: 23, a: 1 },
      cameraZoom: 1,
      showLabels: true,
      sensorSource: 'json',
      modelUrl: '',
      data: [],
      sensorIdColumn: undefined,
      sensorNameColumn: undefined,
      sensorExtraColumns: [],
    });
  });

  it('passes dataset rows and the column mapping through', () => {
    const rows = [
      {
        Device_ID: 'Aelita2S-001',
        Model_Name: 'Coolon-Light',
        Full_Device_Name: 'urn:ngsi-v2:Coolon-Light:Aelita2S-001',
      },
    ];
    const props = transformProps(
      new ChartProps({
        formData: {
          ...formData,
          sensorSource: 'dataset',
          modelUrl: '  https://example.com/tower.glb  ',
          sensorIdColumn: 'Device_ID',
          sensorNameColumn: 'Full_Device_Name',
          sensorExtraColumns: ['Model_Name'],
        },
        width: 800,
        height: 600,
        theme: supersetTheme,
        queriesData: [{ data: rows }],
      }),
    );
    expect(props.sensorSource).toEqual('dataset');
    expect(props.data).toEqual(rows);
    expect(props.sensorIdColumn).toEqual('Device_ID');
    expect(props.sensorExtraColumns).toEqual(['Model_Name']);
    // Trimmed, so a stray copy-paste space can't break the GLB fetch.
    expect(props.modelUrl).toEqual('https://example.com/tower.glb');
  });

  it('falls back to a plain fit when cameraZoom is blank or invalid', () => {
    const props = transformProps(
      new ChartProps({
        formData: { ...formData, cameraZoom: '' },
        width: 800,
        height: 600,
        theme: supersetTheme,
        queriesData: [{ data: [] }],
      }),
    );
    expect(props.cameraZoom).toEqual(1);
  });

  it('respects an explicitly disabled label toggle', () => {
    const props = transformProps(
      new ChartProps({
        formData: { ...formData, showLabels: false },
        width: 800,
        height: 600,
        theme: supersetTheme,
        queriesData: [{ data: [] }],
      }),
    );
    expect(props.showLabels).toEqual(false);
  });
});
