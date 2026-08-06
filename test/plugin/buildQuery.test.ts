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
import buildQuery from '../../src/plugin/buildQuery';

describe('SupersetPluginChartHelloWorld buildQuery', () => {
  const formData = {
    datasource: '5__table',
    granularity_sqla: 'ds',
    viz_type: 'my_chart',
  };

  it('should build a minimal query with row_limit 1', () => {
    const queryContext = buildQuery(formData);
    const [query] = queryContext.queries;
    expect(query.row_limit).toEqual(1);
  });

  it('should include a dataset-agnostic metric so the query is non-empty', () => {
    const queryContext = buildQuery(formData);
    const [query] = queryContext.queries;
    expect(query.metrics).toEqual([
      {
        expressionType: 'SQL',
        sqlExpression: '1',
        label: 'dummy_metric',
      },
    ]);
  });
});
