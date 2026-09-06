import { useState } from 'react';
import { download, message, request } from './api';
import { DataTable } from './components';
import type { CompanyProps } from './Workspace';
interface Preview {
  total: number;
  errors: { row: number; message: string }[];
  reviewDigest: string;
  imported: number;
  rows: {
    row: number;
    employeeNumber: string;
    name: string;
    positionTitle: string;
    startsOn: string;
    salary: string;
  }[];
}
export function EmployeeImport({
  base,
  csrf,
  done,
}: CompanyProps & { done: (count: number) => void }) {
  const [source, setSource] = useState('');
  const [name, setName] = useState('');
  const [preview, setPreview] = useState<Preview>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const perform = async (mode: 'preview' | 'commit') => {
    setBusy(true);
    setError('');
    try {
      const result = await request<Preview>(`${base}/employee-import`, {
        csrf,
        body: {
          csv: source,
          mode,
          ...(mode === 'commit' ? { reviewDigest: preview?.reviewDigest } : {}),
        },
      });
      setPreview(result);
      if (mode === 'commit') done(result.imported);
    } catch (e) {
      setError(message(e));
      if (mode === 'commit') {
        setPreview(undefined);
        setConfirmed(false);
      }
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="import-review">
      <div className="section-heading">
        <div>
          <h2>Import employees</h2>
          <p>
            Bring in employee, employment and monthly salary records from one
            CSV file.
          </p>
        </div>
        <button
          className="secondary"
          disabled={busy}
          onClick={() => {
            void download(
              `${base}/employee-import/template`,
              'employee-import-template.csv',
            ).catch((e) => setError(message(e)));
          }}
        >
          Download CSV template
        </button>
      </div>
      <p className="notice">
        Use the template column names, dates as YYYY-MM-DD and salaries in ZMW
        without thousands separators. Maximum 250 employees per file. This
        creates new records; existing employees are never overwritten. Review
        tax opening balances in employee profiles before running payroll.
      </p>
      <label className="import-file">
        Choose employee CSV
        <input
          type="file"
          accept=".csv,text/csv"
          disabled={busy}
          onChange={(event) => {
            const file = event.target.files?.[0];
            setPreview(undefined);
            setSource('');
            setConfirmed(false);
            setError('');
            setName(file?.name ?? '');
            if (!file) return;
            if (file.size > 500000) {
              setError('Choose a CSV smaller than 500 KB.');
              return;
            }
            setBusy(true);
            void file
              .text()
              .then(setSource)
              .catch((e) => setError(message(e)))
              .finally(() => setBusy(false));
          }}
        />
        <small>
          Account numbers and identifiers should be stored as text in your
          spreadsheet to preserve leading zeros.
        </small>
      </label>
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      {!preview && (
        <button
          disabled={busy || !source}
          onClick={() => void perform('preview')}
        >
          {busy ? 'Reading file…' : 'Validate & preview'}
        </button>
      )}
      {preview && (
        <>
          <div className="import-totals">
            <div>
              <strong>
                {preview.total} employees in {name}
              </strong>
              <p>
                {preview.errors.length
                  ? `${preview.errors.length} row issues must be resolved. Nothing has been imported.`
                  : 'Validation passed. Review the records below before importing.'}
              </p>
            </div>
            <span className="badge">
              {preview.errors.length ? 'Review required' : 'Ready to import'}
            </span>
          </div>
          {preview.errors.length > 0 && (
            <ul className="import-error-list" role="alert">
              {preview.errors.map((e, i) => (
                <li key={i}>
                  Row {e.row}: {e.message}
                </li>
              ))}
            </ul>
          )}
          <DataTable
            columns={[
              'Row',
              'Employee no.',
              'Name',
              'Job title',
              'Start date',
              'Monthly salary (ZMW)',
            ]}
            rows={preview.rows.map((r) => [
              r.row,
              r.employeeNumber,
              r.name,
              r.positionTitle,
              r.startsOn,
              r.salary,
            ])}
          />
          {!preview.errors.length && (
            <>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={confirmed}
                  disabled={busy}
                  onChange={(e) => setConfirmed(e.target.checked)}
                />
                I reviewed these employees and salary amounts. Create all{' '}
                {preview.total} records.
              </label>
              <button
                disabled={!confirmed || busy}
                onClick={() => void perform('commit')}
              >
                {busy ? 'Importing…' : `Import ${preview.total} employees`}
              </button>
            </>
          )}
        </>
      )}
    </section>
  );
}
