import { useEffect, useRef, useState } from 'react';
import { request } from './api';
import { EntryForm } from './components';
import type { CompanyProps } from './Workspace';

const columns = [
  ['recipientName', 'Recipient name'],
  ['recipientAccount', 'Recipient account'],
  ['accountType', 'Account type'],
  ['branchCode', 'Branch code'],
  ['amount', 'Amount'],
  ['ownReference', 'Own reference'],
  ['recipientReference', 'Recipient reference'],
] as const;

export function FnbBatch({ base, csrf }: CompanyProps) {
  const [rows, setRows] = useState<Record<string, string>[]>([{}]);
  const controllerRef = useRef<AbortController | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    controllerRef.current = controller;
    return () => controller.abort();
  }, []);
  return (
    <EntryForm
      title="FNB Zambia bank-format CSV"
      submit="Download FNB review file"
      fields={[
        {
          name: 'ownAccount',
          label: 'FNB debit account',
          hint: '11-digit own account. Do not enter banking passwords.',
          maxLength: 11,
        },
        { name: 'actionDate', label: 'FNB payment action date', type: 'date' },
      ]}
      action={async (values) => {
        const controller = controllerRef.current;
        if (!controller || controller.signal.aborted) return '';
        const csv = await request<string>(
          `${base}/operations/fnb-zambia-preview`,
          {
            csrf,
            body: { ...values, rows },
            text: true,
            signal: controller.signal,
          },
        );
        if (controller.signal.aborted) return '';
        const url = URL.createObjectURL(
          new Blob([csv], { type: 'text/csv;charset=utf-8' }),
        );
        const link = document.createElement('a');
        link.href = url;
        link.download = 'fnb-zambia-review.csv';
        document.body.append(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        return 'FNB review file downloaded with the documented headers and account control total. No payment sent. Validate the file with FNB before approving an import.';
      }}
    >
      <div className="column-editor">
        <p className="notice">
          Based on FNB's published Zambia layout. Bank acceptance has not been
          tested. ZMW ordinary bank accounts only; no eWallet, public recipients
          or notifications. Names and references must fit 20 supported
          characters. Rows are entered manually, not extracted from finalized
          payroll.
        </p>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">Row</th>
                {columns.map(([key, label]) => (
                  <th key={key} scope="col">
                    {label}
                  </th>
                ))}
                <th scope="col">Action</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={index}>
                  <td>{index + 1}</td>
                  {columns.map(([key, label]) => (
                    <td key={key}>
                      {key === 'accountType' ? (
                        <select
                          aria-label={`FNB row ${index + 1} ${label}`}
                          value={row[key] ?? ''}
                          required
                          onChange={(event) =>
                            setRows(
                              rows.map((item, i) =>
                                i === index
                                  ? { ...item, [key]: event.target.value }
                                  : item,
                              ),
                            )
                          }
                        >
                          <option value="">Select…</option>
                          <option value="1">Current</option>
                          <option value="2">Savings</option>
                          <option value="3">Transmission</option>
                        </select>
                      ) : (
                        <input
                          aria-label={`FNB row ${index + 1} ${label}`}
                          value={row[key] ?? ''}
                          required
                          maxLength={
                            key === 'amount'
                              ? 11
                              : key === 'branchCode'
                                ? 6
                                : 20
                          }
                          onChange={(event) =>
                            setRows(
                              rows.map((item, i) =>
                                i === index
                                  ? { ...item, [key]: event.target.value }
                                  : item,
                              ),
                            )
                          }
                        />
                      )}
                    </td>
                  ))}
                  <td>
                    <button
                      type="button"
                      className="secondary"
                      disabled={rows.length === 1}
                      aria-label={`Remove FNB row ${index + 1}`}
                      onClick={() =>
                        setRows(rows.filter((_, i) => i !== index))
                      }
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
            Add FNB recipient
          </button>
          <span className="muted">
            Maximum 200 review rows. Amounts need two decimal places.
          </span>
        </div>
        <label className="review-confirmation">
          <input type="checkbox" required /> I will review all accounts, amounts
          and the bank's import results before authorizing payment in FNB.
        </label>
      </div>
    </EntryForm>
  );
}
