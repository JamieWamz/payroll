import { useState, type ReactNode } from 'react';
import { message } from './api';
export interface Field {
  name: string;
  label: string;
  type?: string;
  optional?: boolean;
  options?: { value: string; label: string }[];
  hint?: string;
  maxLength?: number;
}
export function EntryForm({
  title,
  fields,
  submit,
  action,
  children,
}: {
  title: string;
  fields: Field[];
  submit: string;
  action: (values: Record<string, string>) => Promise<string>;
  children?: ReactNode;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState('');
  return (
    <section className="card">
      <h2>{title}</h2>
      <form
        onChange={() => {
          setResult('');
          setError('');
        }}
        onSubmit={(event) => {
          event.preventDefault();
          if (busy) return;
          const values = Object.fromEntries(
            [...new FormData(event.currentTarget)].filter(
              ([, value]) => value !== '',
            ),
          ) as Record<string, string>;
          setBusy(true);
          setError('');
          setResult('');
          void action(values)
            .then(setResult)
            .catch((failure: unknown) => setError(message(failure)))
            .finally(() => setBusy(false));
        }}
      >
        <fieldset disabled={busy} className="fields">
          {fields.map((field) => (
            <label key={field.name}>
              {field.label}
              {field.options ? (
                <select
                  name={field.name}
                  required={!field.optional}
                  defaultValue=""
                >
                  <option value="">Select…</option>
                  {field.options.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  name={field.name}
                  type={field.type ?? 'text'}
                  required={!field.optional}
                  maxLength={field.maxLength ?? 240}
                />
              )}
              {field.hint && <small>{field.hint}</small>}
            </label>
          ))}
          {children}
          <div className="form-actions">
            <button type="submit">{busy ? 'Working…' : submit}</button>
          </div>
        </fieldset>
        {error && (
          <p className="notice error" role="alert">
            {error}
          </p>
        )}
        {result && (
          <p className="notice success" role="status">
            {result}
          </p>
        )}
      </form>
    </section>
  );
}
export function DataTable({
  columns,
  rows,
  empty = 'No records yet.',
}: {
  columns: string[];
  rows: ReactNode[][];
  empty?: string;
}) {
  return rows.length === 0 ? (
    <p className="empty">{empty}</p>
  ) : (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column} scope="col">
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index}>
              {row.map((cell, cellIndex) => (
                <td key={cellIndex}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
export function Loading({ error }: { error: string }) {
  return error ? (
    <p className="notice error" role="alert">
      {error}
    </p>
  ) : (
    <p className="empty" role="status">
      Loading company records…
    </p>
  );
}
