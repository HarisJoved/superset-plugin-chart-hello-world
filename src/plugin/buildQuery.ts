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
 * This chart no longer reads any dataset rows — the scene comes entirely
 * from the uploaded JSON file (see controlPanel.ts / types.ts). Superset's
 * Explore view still requires a dataset to be selected and still fires a
 * query before rendering, so we keep this minimal purely to satisfy that
 * framework requirement; transformProps ignores the result.
 *
 * A literal SQL metric (SELECT 1) is used instead of leaving metrics
 * empty, because Superset's backend rejects a query with no columns or
 * metrics at all ("Empty query?" / 400). This metric works against any
 * dataset regardless of its actual columns.
 */
export default function buildQuery(formData: QueryFormData) {
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
