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
import { buildQueryContext, QueryFormData, QueryObject } from '@superset-ui/core';

/**
 * Reads a control by name. Unlike transformProps — which receives form data
 * already camelCased by ChartProps — buildQuery is handed the raw form data,
 * so the keys here are the snake_case control names. Both spellings are
 * accepted so this can't silently read `undefined` either way.
 */
function control<T>(formData: QueryFormData, snakeCase: string, camelCase: string) {
  const bag = formData as unknown as Record<string, unknown>;
  return (bag[snakeCase] ?? bag[camelCase]) as T | undefined;
}

/** The columns the sensor roster is built from, de-duplicated and in a
 * stable order (id first, then label, then any extras shown in the popup). */
export function sensorColumns(formData: QueryFormData): string[] {
  const extras = control<string[]>(
    formData,
    'sensor_extra_columns',
    'sensorExtraColumns',
  );
  const candidates = [
    control<string>(formData, 'sensor_id_column', 'sensorIdColumn'),
    control<string>(formData, 'sensor_name_column', 'sensorNameColumn'),
    ...(Array.isArray(extras) ? extras : []),
  ];
  const seen = new Set<string>();
  const columns: string[] = [];
  candidates.forEach(name => {
    if (typeof name === 'string' && name && !seen.has(name)) {
      seen.add(name);
      columns.push(name);
    }
  });
  return columns;
}

/**
 * Two shapes of query, depending on where the sensors come from.
 *
 * Dataset mode: a raw-records query for the chosen sensor columns — the same
 * shape the Table chart uses for "Raw Records" (`columns` set, `metrics`
 * empty, so the backend doesn't group). One row per sensor.
 *
 * JSON-file mode: the scene is entirely in the uploaded file and no dataset
 * rows are needed, but Explore still requires a dataset and still fires a
 * query before rendering. A literal `SELECT 1` metric satisfies that against
 * any dataset regardless of its columns — the backend rejects a query with
 * no columns *and* no metrics ("Empty query?" / 400) — and transformProps
 * ignores the result.
 */
export default function buildQuery(formData: QueryFormData) {
  const sensorSource = control<string>(formData, 'sensor_source', 'sensorSource');
  const columns = sensorColumns(formData);

  // Mirrors the source resolution in the chart component, which keys off this
  // same control. An id column is what makes a row addressable as a sensor, so
  // without one there's nothing worth fetching.
  if (sensorSource !== 'dataset' || columns.length === 0) {
    return dummyQuery(formData);
  }

  return buildQueryContext(formData, (baseQueryObject: QueryObject) => [
    {
      ...baseQueryObject,
      columns,
      metrics: [],
      orderby: [],
    },
  ]);
}

function dummyQuery(formData: QueryFormData) {
  return buildQueryContext(formData, (baseQueryObject: QueryObject) => [
    {
      ...baseQueryObject,
      metrics: [
        {
          expressionType: 'SQL',
          sqlExpression: '1',
          label: 'dummy_metric',
        },
      ],
      row_limit: 1,
    },
  ]);
}
