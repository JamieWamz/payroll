import { useState } from 'react';

export interface ColumnDefinition {
  key: string;
  label: string;
  required: boolean;
}

export const TARGET_COLUMNS: ColumnDefinition[] = [
  { key: 'employeeNumber', label: 'Employee Number / ID', required: true },
  { key: 'givenName', label: 'First Name / Given Name', required: true },
  { key: 'familyName', label: 'Last Name / Family Name', required: true },
  { key: 'positionTitle', label: 'Job Title / Position', required: true },
  { key: 'startsOn', label: 'Start Date (YYYY-MM-DD)', required: true },
  { key: 'salary', label: 'Monthly Base Salary (ZMW)', required: true },
  { key: 'tpin', label: 'TPIN (Tax ID)', required: false },
  { key: 'napsaNumber', label: 'NAPSA Number', required: false },
  { key: 'nhimaNumber', label: 'NHIMA Number', required: false },
  { key: 'bankName', label: 'Bank Name', required: false },
  { key: 'accountName', label: 'Bank Account Name', required: false },
  { key: 'accountNumber', label: 'Bank Account Number', required: false },
  { key: 'branchCode', label: 'Branch Code', required: false },
  { key: 'bankCode', label: 'Bank Routing Code', required: false },
  { key: 'openingAsOf', label: 'Opening Balances As-Of Date', required: false },
  { key: 'openingTaxableIncome', label: 'Opening Taxable Income (ZMW)', required: false },
  { key: 'openingPaye', label: 'Opening PAYE Paid (ZMW)', required: false },
  { key: 'openingNapsaEmployee', label: 'Opening NAPSA Employee (ZMW)', required: false },
  { key: 'openingNapsaEmployer', label: 'Opening NAPSA Employer (ZMW)', required: false },
  { key: 'openingNapsaEarnings', label: 'Opening NAPSA Earnings (ZMW)', required: false },
];

export function autoDetectMapping(excelHeaders: string[]): Record<string, string> {
  const mapping: Record<string, string> = {};

  const sanitize = (str: string) => str.toLowerCase().replace(/[^a-z0-9]/g, '');

  const rules: Record<string, string[]> = {
    employeeNumber: ['employeenumber', 'employeeid', 'empno', 'empid', 'staffno', 'staffid', 'id', 'code'],
    givenName: ['givenname', 'firstname', 'fname', 'first', 'given'],
    familyName: ['familyname', 'lastname', 'lname', 'surname', 'family', 'last'],
    positionTitle: ['positiontitle', 'position', 'jobtitle', 'title', 'role', 'designation', 'occupation'],
    startsOn: ['startson', 'startdate', 'hiredate', 'datejoined', 'joinedon', 'joineddate'],
    salary: ['salary', 'basesalary', 'basicsalary', 'monthlysalary', 'pay', 'basepay', 'basic'],
    tpin: ['tpin', 'taxid', 'tpinno', 'zratpin'],
    napsaNumber: ['napsanumber', 'napsano', 'napsaid', 'napsa', 'ssno'],
    nhimaNumber: ['nhimanumber', 'nhimano', 'nhimaid', 'nhima'],
    bankName: ['bankname', 'bank', 'banker'],
    accountName: ['accountname', 'accountholder', 'accname'],
    accountNumber: ['accountnumber', 'accountno', 'accno', 'accountnum', 'account'],
    branchCode: ['branchcode', 'branch', 'sortcode'],
    bankCode: ['bankcode', 'routingcode', 'swift'],
    openingAsOf: ['openingasof', 'asofdate', 'openingdate', 'asof'],
    openingTaxableIncome: ['openingtaxableincome', 'openingtaxable', 'ytdtaxable', 'taxableytd'],
    openingPaye: ['openingpaye', 'ytdpaye', 'payeytd', 'taxpaidytd'],
    openingNapsaEmployee: ['openingnapsaemployee', 'ytdnapsaee', 'napsaeeytd'],
    openingNapsaEmployer: ['openingnapsaemployer', 'ytdnapsaer', 'napsaerytd'],
    openingNapsaEarnings: ['openingnapsaearnings', 'ytdnapsaearnings', 'napsaearningsytd'],
  };

  for (const target of TARGET_COLUMNS) {
    const aliases = rules[target.key] ?? [target.key.toLowerCase()];
    for (const excelHeader of excelHeaders) {
      const cleanHeader = sanitize(excelHeader);
      if (aliases.some(alias => cleanHeader === alias || cleanHeader.includes(alias))) {
        mapping[target.key] = excelHeader;
        break;
      }
    }
  }

  return mapping;
}

export function ExcelColumnMapper({
  sheetHeaders,
  sheetDataRows,
  fileName,
  onComplete,
  onCancel,
}: {
  sheetHeaders: string[];
  sheetDataRows: string[][];
  fileName: string;
  onComplete: (csvContent: string) => void;
  onCancel: () => void;
}) {
  const [mapping, setMapping] = useState<Record<string, string>>(() => autoDetectMapping(sheetHeaders));
  const [error, setError] = useState<string>('');

  const requiredMissing = TARGET_COLUMNS.filter(c => c.required && !mapping[c.key]);

  const handleConfirm = () => {
    if (requiredMissing.length > 0) {
      setError(`Please map all required columns: ${requiredMissing.map(c => c.label).join(', ')}`);
      return;
    }

    // Build standard CSV
    const targetKeys = TARGET_COLUMNS.map(c => c.key);
    const headerRow = targetKeys.join(',');

    const csvRows = sheetDataRows.map((row) => {
      return targetKeys.map((key) => {
        const mappedExcelHeader = mapping[key];
        if (!mappedExcelHeader) return '';
        const colIndex = sheetHeaders.indexOf(mappedExcelHeader);
        if (colIndex === -1) return '';
        const val = row[colIndex] ?? '';
        // Escape quotes if needed
        if (val.includes(',') || val.includes('"') || val.includes('\n')) {
          return `"${val.replace(/"/g, '""')}"`;
        }
        return val;
      }).join(',');
    });

    const csvOutput = [headerRow, ...csvRows].join('\n');
    onComplete(csvOutput);
  };

  return (
    <div className="card column-mapper" style={{ border: '1px solid var(--border-color, #e0e0e0)', borderRadius: '8px', padding: '1.5rem', margin: '1rem 0' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <div>
          <h3>Map columns from "{fileName}"</h3>
          <p className="muted" style={{ margin: 0 }}>
            Match the columns from your Excel spreadsheet to the standard ZamPayroll fields.
          </p>
        </div>
        <button type="button" className="secondary" onClick={onCancel}>
          Cancel
        </button>
      </div>

      {error && (
        <p className="notice error" role="alert" style={{ marginBottom: '1rem' }}>
          {error}
        </p>
      )}

      <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '1.5rem' }}>
        <thead>
          <tr style={{ borderBottom: '2px solid var(--border-color, #eee)', textAlign: 'left' }}>
            <th style={{ padding: '0.5rem' }}>ZamPayroll Field</th>
            <th style={{ padding: '0.5rem' }}>Status</th>
            <th style={{ padding: '0.5rem' }}>Your Excel Header</th>
            <th style={{ padding: '0.5rem' }}>Sample Data (Row 1)</th>
          </tr>
        </thead>
        <tbody>
          {TARGET_COLUMNS.map((col) => {
            const mappedHeader = mapping[col.key] ?? '';
            const colIndex = mappedHeader ? sheetHeaders.indexOf(mappedHeader) : -1;
            const sampleVal = colIndex !== -1 && sheetDataRows[0] ? sheetDataRows[0][colIndex] : '';

            return (
              <tr key={col.key} style={{ borderBottom: '1px solid var(--border-color, #f0f0f0)' }}>
                <td style={{ padding: '0.5rem 0.5rem 0.5rem 0' }}>
                  <strong>{col.label}</strong>
                  {col.required && <span style={{ color: '#d93025', marginLeft: '4px' }}>*</span>}
                </td>
                <td style={{ padding: '0.5rem' }}>
                  {mappedHeader ? (
                    <span style={{ color: '#188038', fontSize: '0.85rem', fontWeight: 600 }}>Mapped ✓</span>
                  ) : col.required ? (
                    <span style={{ color: '#d93025', fontSize: '0.85rem', fontWeight: 600 }}>Required</span>
                  ) : (
                    <span style={{ color: '#70757a', fontSize: '0.85rem' }}>Optional</span>
                  )}
                </td>
                <td style={{ padding: '0.5rem' }}>
                  <select
                    value={mappedHeader}
                    onChange={(e) => {
                      setError('');
                      const val = e.target.value;
                      setMapping((prev) => {
                        const next = { ...prev };
                        if (val) next[col.key] = val;
                        else delete next[col.key];
                        return next;
                      });
                    }}
                    style={{ width: '100%', padding: '0.4rem', borderRadius: '4px', border: '1px solid #ccc' }}
                  >
                    <option value="">-- Do not import --</option>
                    {sheetHeaders.map((h) => (
                      <option key={h} value={h}>
                        {h}
                      </option>
                    ))}
                  </select>
                </td>
                <td style={{ padding: '0.5rem', color: '#5f6368', fontSize: '0.9rem', maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {sampleVal || <em style={{ color: '#9aa0a6' }}>— empty —</em>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <div style={{ display: 'flex', gap: '1rem', justifyContent: 'flex-end' }}>
        <button type="button" className="secondary" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className="primary" onClick={handleConfirm} disabled={requiredMissing.length > 0}>
          Confirm Column Mapping & Continue →
        </button>
      </div>
    </div>
  );
}
