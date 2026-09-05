import { useEffect, useRef, useState } from 'react';
import { message, request } from './api';
import { DataTable, EntryForm, Loading } from './components';
import { useRemote } from './useRemote';
import type { CompanyProps, Operations } from './Workspace';

const fields = {
  employeeNumber: 'Employee number',
  employeeName: 'Employee name',
  employeeTpin: 'Employee TPIN',
  employerTpin: 'Employer TPIN',
  accountNumber: 'Account number',
  bankCode: 'Bank code',
  branchCode: 'Branch code',
  reference: 'Payment reference',
  grossPay: 'Gross pay',
  taxableIncome: 'Taxable income',
  paye: 'PAYE',
  napsa: 'NAPSA',
  nhima: 'NHIMA',
  netPay: 'Net pay',
  paymentDate: 'Payment date',
  taxYear: 'Tax year',
  taxMonth: 'Tax month',
} as const;
type ExportField = keyof typeof fields;
interface Column {
  field: ExportField;
  header: string;
}
interface Template {
  id: string;
  name: string;
  bank?: string;
  columns: Column[];
}

export function ExportWorkspace({
  base,
  csrf,
  purpose,
}: CompanyProps & { purpose: 'salary_batch' | 'paye_return' }) {
  const salary = purpose === 'salary_batch';
  const [revision, setRevision] = useState(0);
  const [selected, setSelected] = useState('');
  const [columns, setColumns] = useState<Column[]>(() =>
    (salary
      ? (['accountNumber', 'netPay', 'reference'] as const)
      : (['employeeTpin', 'taxableIncome', 'paye'] as const)
    ).map((field) => ({ field, header: fields[field] })),
  );
  const { data, error } = useRemote<Operations>(`${base}/operations`, revision);
  const templates: Template[] = (data?.items ?? [])
    .filter(
      (item) =>
        item.kind === 'export_template' && item.settings['purpose'] === purpose,
    )
    .map((item) => ({ id: item.id, ...item.settings }) as unknown as Template);
  const template = templates.find((item) => item.id === selected);
  return (
    <>
      <p className="notice">
        {salary
          ? 'Bank directory and configurable CSV previews—not live bank integrations. No funds can be sent from this workspace. Obtain your bank’s approved file layout and onboarding requirements.'
          : 'ZRA TaxOnline PAYE return preparation. The current portal upload schema has not been verified. These configurable CSV previews are not certified return files and do not submit anything to ZRA.'}
      </p>
      {salary && (
        <section className="card">
          <h2>Bank connection directory</h2>
          <p className="muted">
            Bank names are a directory, not a compatibility guarantee.
          </p>
          {data ? (
            <div className="bank-grid">
              {data.banks.map((bank) => (
                <div key={bank.name}>
                  <strong>{bank.name}</strong>
                  <small>Not connected</small>
                </div>
              ))}
            </div>
          ) : (
            <Loading error={error} />
          )}
        </section>
      )}
      <section className="card">
        <h2>{salary ? 'Salary batch' : 'PAYE return'} templates</h2>
        <p className="muted">
          Saved versions are retained unchanged. Latest 100 operations settings
          are listed.
        </p>
        {data ? (
          <DataTable
            columns={['Name', salary ? 'Bank' : 'Service', 'Columns', 'Status']}
            rows={templates.map((item) => [
              item.name,
              item.bank ?? 'ZRA TaxOnline',
              item.columns.length,
              'Operator-defined · Unverified',
            ])}
          />
        ) : (
          <Loading error={error} />
        )}
      </section>
      <EntryForm
        title="Define an export template"
        submit="Save template version"
        fields={[
          { name: 'name', label: 'Template name', maxLength: 100 },
          ...(salary
            ? [
                {
                  name: 'bank',
                  label: 'Bank',
                  options: (data?.banks ?? []).map((bank) => ({
                    value: bank.name,
                    label: bank.name,
                  })),
                },
              ]
            : []),
          {
            name: 'sourceReference',
            label: 'Layout source / document reference',
            hint: 'Use the bank or ZRA-supplied layout reference. Saving does not certify it.',
            maxLength: 500,
          },
          {
            name: 'delimiter',
            label: 'Delimiter',
            options: [
              { value: ',', label: 'Comma' },
              { value: ';', label: 'Semicolon' },
              { value: '\t', label: 'Tab' },
            ],
          },
          {
            name: 'header',
            label: 'Include header row?',
            options: [
              { value: 'yes', label: 'Yes' },
              { value: 'no', label: 'No' },
            ],
          },
        ]}
        action={async (values) => {
          await request(`${base}/operations`, {
            csrf,
            body: {
              kind: 'export_template',
              settings: {
                ...values,
                purpose,
                header: values['header'] === 'yes',
                columns,
              },
            },
          });
          setRevision((value) => value + 1);
          return 'Template version saved. Validate its layout with the receiving institution before use.';
        }}
      >
        <div className="column-editor">
          <h3>Column mapping</h3>
          <p className="muted">
            Starter mappings are illustrative, not an official layout. Fields
            export in the order below.
          </p>
          {columns.map((column, index) => (
            <div className="mapping-row" key={index}>
              <label>
                Column {index + 1} heading
                <input
                  value={column.header}
                  required
                  maxLength={100}
                  onChange={(event) =>
                    setColumns(
                      columns.map((item, i) =>
                        i === index
                          ? { ...item, header: event.target.value }
                          : item,
                      ),
                    )
                  }
                />
              </label>
              <label>
                Source field
                <select
                  value={column.field}
                  onChange={(event) =>
                    setColumns(
                      columns.map((item, i) =>
                        i === index
                          ? {
                              ...item,
                              field: event.target.value as ExportField,
                            }
                          : item,
                      ),
                    )
                  }
                >
                  {Object.entries(fields).map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                className="secondary"
                onClick={() =>
                  setColumns(columns.filter((_, i) => i !== index))
                }
                aria-label={`Remove column ${index + 1}`}
              >
                Remove
              </button>
            </div>
          ))}
          <button
            className="secondary"
            type="button"
            disabled={columns.length >= Object.keys(fields).length}
            onClick={() => {
              const field = (Object.keys(fields) as ExportField[]).find(
                (key) => !columns.some((item) => item.field === key),
              );
              if (field)
                setColumns([...columns, { field, header: fields[field] }]);
            }}
          >
            Add column
          </button>
        </div>
      </EntryForm>
      <section className="card">
        <h2>Prepare a CSV preview</h2>
        <p>
          Enter review data against a saved template. Rows are not saved; they
          are sent to the API for validation and download. Automatic extraction
          from finalized payroll is not yet connected.
        </p>
        <label>
          Export template
          <select
            value={selected}
            onChange={(event) => setSelected(event.target.value)}
          >
            <option value="">Select…</option>
            {templates.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        {template && (
          <PreviewRows
            key={template.id}
            template={template}
            base={base}
            csrf={csrf}
          />
        )}
      </section>
    </>
  );
}

function PreviewRows({
  template,
  base,
  csrf,
}: CompanyProps & { template: Template }) {
  const controllerRef = useRef<AbortController | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    controllerRef.current = controller;
    return () => controller.abort();
  }, []);
  const [rows, setRows] = useState<Record<string, string>[]>([{}]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState('');
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        const controller = controllerRef.current;
        if (busy || !controller || controller.signal.aborted) return;
        setBusy(true);
        setError('');
        setResult('');
        void request<string>(`${base}/operations/export-preview`, {
          csrf,
          body: { templateId: template.id, rows },
          text: true,
          signal: controller.signal,
        })
          .then((csv) => {
            if (controller.signal.aborted) return;
            const url = URL.createObjectURL(
              new Blob([csv], { type: 'text/csv;charset=utf-8' }),
            );
            const link = document.createElement('a');
            link.href = url;
            link.download = 'payroll-preview.csv';
            document.body.append(link);
            link.click();
            link.remove();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
            setResult(
              'CSV preview downloaded. No payment or return was submitted.',
            );
          })
          .catch((failure: unknown) => setError(message(failure)))
          .finally(() => setBusy(false));
      }}
    >
      <fieldset disabled={busy}>
        <p className="muted">
          Use exact amounts with two decimal places. Preserve leading zeros in
          accounts and TPINs. Maximum 200 preview rows in this screen.
        </p>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">Row</th>
                {template.columns.map((column) => (
                  <th scope="col" key={column.field}>
                    {column.header}
                  </th>
                ))}
                <th scope="col">Action</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={index}>
                  <td>{index + 1}</td>
                  {template.columns.map((column) => (
                    <td key={column.field}>
                      <input
                        aria-label={`Row ${index + 1} ${column.header}`}
                        value={row[column.field] ?? ''}
                        required
                        maxLength={500}
                        onChange={(event) =>
                          setRows(
                            rows.map((item, i) =>
                              i === index
                                ? {
                                    ...item,
                                    [column.field]: event.target.value,
                                  }
                                : item,
                            ),
                          )
                        }
                      />
                    </td>
                  ))}
                  <td>
                    <button
                      type="button"
                      className="secondary"
                      disabled={rows.length === 1}
                      onClick={() =>
                        setRows(rows.filter((_, i) => i !== index))
                      }
                      aria-label={`Remove row ${index + 1}`}
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="button-row">
          <button
            type="button"
            className="secondary"
            disabled={rows.length >= 200}
            onClick={() => setRows([...rows, {}])}
          >
            Add row
          </button>
          <button type="submit">
            {busy ? 'Preparing…' : 'Download CSV preview'}
          </button>
        </div>
      </fieldset>
      {error && (
        <p role="alert" className="notice error">
          {error}
        </p>
      )}
      {result && (
        <p role="status" className="notice success">
          {result}
        </p>
      )}
    </form>
  );
}
