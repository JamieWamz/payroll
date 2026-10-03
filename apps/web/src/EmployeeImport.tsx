import { useState } from 'react';
import * as XLSX from 'xlsx';
import { download, message, request } from './api';
import { DataTable } from './components';
import { ExcelColumnMapper, TARGET_COLUMNS } from './ExcelColumnMapper';
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

interface SpreadsheetState {
  headers: string[];
  rows: string[][];
  fileName: string;
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
  const [unmappedSpreadsheet, setUnmappedSpreadsheet] = useState<SpreadsheetState>();

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

  const handleFileUpload = async (file: File) => {
    setPreview(undefined);
    setSource('');
    setConfirmed(false);
    setError('');
    setUnmappedSpreadsheet(undefined);
    setName(file.name);

    if (file.size > 5000000) {
      setError('Choose a spreadsheet or CSV smaller than 5 MB.');
      return;
    }

    setBusy(true);

    try {
      const extension = file.name.split('.').pop()?.toLowerCase();
      if (extension === 'xlsx' || extension === 'xls') {
        const buffer = await file.arrayBuffer();
        const workbook = XLSX.read(buffer, { type: 'array' });
        const sheetName = workbook.SheetNames[0];
        if (!sheetName) throw new Error('Excel file contains no worksheets.');
        
        const worksheet = workbook.Sheets[sheetName]!;
        const rawRows: string[][] = XLSX.utils.sheet_to_json(worksheet, { header: 1, raw: false, defval: '' });
        
        if (rawRows.length < 2) {
          throw new Error('Spreadsheet must have a header row and at least one row of employee data.');
        }

        const sheetHeaders = (rawRows[0] ?? []).map(h => String(h).trim());
        const sheetDataRows = rawRows.slice(1).map(row => row.map(cell => String(cell).trim()));

        // Check if headers match standard columns directly
        const standardKeys = TARGET_COLUMNS.map(c => c.key);
        const matchesExact = standardKeys.slice(0, 6).every(k => sheetHeaders.includes(k));

        if (matchesExact) {
          const csvText = XLSX.utils.sheet_to_csv(worksheet);
          setSource(csvText);
        } else {
          // Open mapping view
          setUnmappedSpreadsheet({
            headers: sheetHeaders,
            rows: sheetDataRows,
            fileName: file.name,
          });
        }
      } else {
        const text = await file.text();
        setSource(text);
      }
    } catch (e) {
      setError(message(e));
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
            Bring in employee, employment, monthly salary and opening tax balances from an Excel (.xlsx/.xls) or CSV file.
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
        Supports Excel spreadsheets (.xlsx, .xls) and CSV files. Standard dates should be formatted as YYYY-MM-DD and salaries in ZMW. Maximum 250 employees per file. Existing employees are never overwritten.
      </p>

      {!unmappedSpreadsheet && (
        <label className="import-file">
          Choose employee Excel or CSV file
          <input
            type="file"
            accept=".csv,.xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
            disabled={busy}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void handleFileUpload(file);
            }}
          />
          <small>
            Account numbers and TPINs are preserved with leading zeros.
          </small>
        </label>
      )}

      {unmappedSpreadsheet && (
        <ExcelColumnMapper
          sheetHeaders={unmappedSpreadsheet.headers}
          sheetDataRows={unmappedSpreadsheet.rows}
          fileName={unmappedSpreadsheet.fileName}
          onCancel={() => setUnmappedSpreadsheet(undefined)}
          onComplete={(mappedCsv) => {
            setUnmappedSpreadsheet(undefined);
            setSource(mappedCsv);
          }}
        />
      )}

      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}

      {!preview && !unmappedSpreadsheet && (
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
