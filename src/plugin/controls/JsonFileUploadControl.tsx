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
import React, { useCallback, useState } from 'react';

interface JsonFileUploadControlProps {
  value?: string;
  onChange?: (value: string) => void;
  label?: string;
  description?: string;
}

/**
 * A Superset "custom control" — passed directly as a component reference
 * in controlPanel.ts rather than a string control-type name. Reads a local
 * .json file via FileReader, validates it parses, and stores the raw JSON
 * text into form data via onChange (Superset persists this as a normal
 * string form-data field, same as any TextControl).
 */
export default function JsonFileUploadControl({
  value,
  onChange,
  label,
  description,
}: JsonFileUploadControlProps) {
  const [fileName, setFileName] = useState<string>('');
  const [error, setError] = useState<string>('');

  const handleFile = useCallback(
    (file: File) => {
      setError('');
      const reader = new FileReader();
      reader.onload = () => {
        const text = String(reader.result || '');
        try {
          const parsed = JSON.parse(text);
          if (!parsed || !Array.isArray(parsed.devices)) {
            setError('JSON must have a top-level "devices" array.');
            return;
          }
          setFileName(file.name);
          if (onChange) onChange(text);
        } catch (e) {
          setError('Could not parse file as JSON.');
        }
      };
      reader.onerror = () => setError('Could not read file.');
      reader.readAsText(file);
    },
    [onChange],
  );

  return (
    <div style={{ marginBottom: 8 }}>
      {label && (
        <div style={{ fontWeight: 600, marginBottom: 4, fontSize: 12 }}>
          {label}
        </div>
      )}
      {description && (
        <div style={{ fontSize: 11, color: '#8e94a1', marginBottom: 6 }}>
          {description}
        </div>
      )}
      <input
        type="file"
        accept=".json,application/json"
        onChange={e => {
          const file = e.target.files && e.target.files[0];
          if (file) handleFile(file);
        }}
      />
      {fileName && (
        <div style={{ fontSize: 12, color: '#16a34a', marginTop: 4 }}>
          Loaded {fileName} ({value ? value.length : 0} chars)
        </div>
      )}
      {!fileName && value && (
        <div style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>
          Existing scene data loaded ({value.length} chars). Choose a file to
          replace it.
        </div>
      )}
      {error && (
        <div style={{ fontSize: 12, color: '#dc2626', marginTop: 4 }}>
          {error}
        </div>
      )}
    </div>
  );
}
