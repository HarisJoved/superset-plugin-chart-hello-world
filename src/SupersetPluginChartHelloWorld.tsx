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
import React, { useState } from 'react';
import { SupersetPluginChartHelloWorldProps } from './types';

export default function SupersetPluginChartHelloWorld(
  props: SupersetPluginChartHelloWorldProps,
) {
  const { data, height, width, boldText, headerFontSize, headerText } = props;
  const [showRawJson, setShowRawJson] = useState(false);

  // Map font size string values to clean pixel sizes
  const fontSizes: Record<string, string> = {
    xxs: '12px',
    xs: '14px',
    s: '16px',
    m: '20px',
    l: '24px',
    xl: '30px',
    xxl: '38px',
  };

  const currentFontSize = fontSizes[headerFontSize] || '24px';
  const sampleData = data ? data.slice(0, 10) : [];
  const columns = sampleData.length > 0 ? Object.keys(sampleData[0]) : [];

  return (
    <div
      style={{
        width,
        height,
        padding: '20px',
        boxSizing: 'border-box',
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
        backgroundColor: '#f8fafc',
        color: '#1e293b',
        display: 'flex',
        flexDirection: 'column',
        gap: '16px',
        overflow: 'hidden',
        borderRadius: '12px',
        border: '1px solid #e2e8f0',
      }}
    >
      {/* HEADER BAR */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          borderBottom: '1px solid #e2e8f0',
          paddingBottom: '12px',
          flexShrink: 0,
        }}
      >
        <h2
          style={{
            margin: 0,
            fontSize: currentFontSize,
            fontWeight: boldText ? 700 : 400,
            color: '#0f172a',
            letterSpacing: '-0.02em',
          }}
        >
          {headerText || 'Hello World Plugin'}
        </h2>

        {/* View Toggle Pill */}
        <button
          onClick={() => setShowRawJson(!showRawJson)}
          style={{
            background: showRawJson ? '#0284c7' : '#ffffff',
            color: showRawJson ? '#ffffff' : '#334155',
            border: '1px solid #cbd5e1',
            borderRadius: '20px',
            padding: '6px 14px',
            fontSize: '12px',
            fontWeight: 600,
            cursor: 'pointer',
            transition: 'all 0.2s ease',
            boxShadow: '0 1px 2px rgba(0, 0, 0, 0.05)',
          }}
        >
          {showRawJson ? '📊 View Table' : '⚙️ View JSON'}
        </button>
      </div>

      {/* METRICS STATS BAR */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
          gap: '12px',
          flexShrink: 0,
        }}
      >
        <div
          style={{
            backgroundColor: '#ffffff',
            padding: '12px 16px',
            borderRadius: '8px',
            border: '1px solid #e2e8f0',
            boxShadow: '0 1px 3px rgba(0,0,0,0.02)',
          }}
        >
          <div style={{ fontSize: '11px', textTransform: 'uppercase', color: '#64748b', fontWeight: 600 }}>
            Total Rows
          </div>
          <div style={{ fontSize: '20px', fontWeight: 700, color: '#0284c7', marginTop: '2px' }}>
            {data?.length || 0}
          </div>
        </div>

        <div
          style={{
            backgroundColor: '#ffffff',
            padding: '12px 16px',
            borderRadius: '8px',
            border: '1px solid #e2e8f0',
            boxShadow: '0 1px 3px rgba(0,0,0,0.02)',
          }}
        >
          <div style={{ fontSize: '11px', textTransform: 'uppercase', color: '#64748b', fontWeight: 600 }}>
            Columns
          </div>
          <div style={{ fontSize: '20px', fontWeight: 700, color: '#10b981', marginTop: '2px' }}>
            {columns.length}
          </div>
        </div>
      </div>

      {/* MAIN CONTENT AREA */}
      <div
        style={{
          flexGrow: 1,
          backgroundColor: '#ffffff',
          borderRadius: '8px',
          border: '1px solid #e2e8f0',
          overflow: 'auto',
          boxShadow: '0 1px 3px rgba(0,0,0,0.02)',
        }}
      >
        {showRawJson ? (
          /* JSON View */
          <pre
            style={{
              margin: 0,
              padding: '16px',
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
              fontSize: '12px',
              backgroundColor: '#1e293b',
              color: '#f8fafc',
              height: '100%',
              boxSizing: 'border-box',
              overflow: 'auto',
            }}
          >
            {JSON.stringify(data, null, 2)}
          </pre>
        ) : (
          /* Data Table View */
          <div style={{ width: '100%', overflowX: 'auto' }}>
            {sampleData.length > 0 ? (
              <table
                style={{
                  width: '100%',
                  borderCollapse: 'collapse',
                  textAlign: 'left',
                  fontSize: '13px',
                }}
              >
                <thead>
                  <tr style={{ backgroundColor: '#f1f5f9', borderBottom: '1px solid #e2e8f0' }}>
                    {columns.map((col) => (
                      <th
                        key={col}
                        style={{
                          padding: '10px 14px',
                          fontWeight: 600,
                          color: '#475569',
                          textTransform: 'capitalize',
                        }}
                      >
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sampleData.map((row, idx) => (
                    <tr
                      key={idx}
                      style={{
                        borderBottom: '1px solid #f1f5f9',
                        backgroundColor: idx % 2 === 0 ? '#ffffff' : '#fafafa',
                      }}
                    >
                      {columns.map((col) => (
                        <td key={col} style={{ padding: '10px 14px', color: '#334155' }}>
                          {String(row[col] ?? '')}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div
                style={{
                  padding: '40px',
                  textAlign: 'center',
                  color: '#94a3b8',
                  fontSize: '14px',
                }}
              >
                No query results to display. Select columns & metrics in the left panel!
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}