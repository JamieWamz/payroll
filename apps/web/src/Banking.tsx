import { useEffect, useRef, useState } from 'react';
import { download, message, request, saveFile } from './api';
import { ActionButton, DataTable, Loading } from './components';
import { ExportWorkspace } from './exports';
import { useRemote } from './useRemote';
import { currency, type Run } from './payroll-types';
import type { CompanyProps } from './Workspace';

interface Bank {
  name: string;
  channel: string;
  finding: string;
  nextStep: string;
  reviewedOn: string;
  connectionStatus: 'not_connected';
  sources: { title: string; uri: string }[];
}
interface Catalog {
  banks: Bank[];
  requirements: string[];
  registerSource: string;
}
interface Payment {
  employeeNumber: string;
  employeeName: string;
  reference: string;
  amount: string;
  paymentDate: string;
}
interface StatementEntry {
  transactionId: string;
  bookingDate: string;
  reference: string;
  amount: string;
  currency: string;
}
interface Reconciliation {
  summary: {
    expected: number;
    statementEntries: number;
    matched: number;
    missing: number;
    exceptions: number;
    noPaymentDue: number;
    unmatched: number;
  };
  results: (Payment & { status: string; entries: StatementEntry[] })[];
  unmatched: StatementEntry[];
}
const statuses: Record<string, string> = {
  matched: 'Matched in upload',
  missing: 'No matching entry',
  amount_mismatch: 'Amount or direction differs',
  multiple_entries: 'Multiple entries — review',
  no_payment_due: 'No payment due',
};
export function Banking(props: CompanyProps) {
  const [tab, setTab] = useState('Bank access');
  const [bankName, setBankName] = useState('First National Bank Zambia');
  const catalog = useRemote<Catalog>(`${props.base}/banking/catalog`);
  const bank = catalog.data?.banks.find((b) => b.name === bankName);
  return (
    <>
      <p className="page-description">
        Prepare salary files, review bank access and reconcile statements
        against finalized payroll.
      </p>
      <div className="bank-tabs" role="group" aria-label="Banking tools">
        {['Bank access', 'Salary files', 'Reconciliation'].map((label) => (
          <button
            key={label}
            className={tab === label ? 'primary' : 'secondary'}
            aria-pressed={tab === label}
            onClick={() => setTab(label)}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === 'Salary files' ? (
        <ExportWorkspace {...props} purpose="salary_batch" />
      ) : !catalog.data ? (
        <Loading error={catalog.error} />
      ) : (
        <>
          <section className="card bank-selector">
            <label>
              Employer’s funding bank
              <select
                value={bankName}
                onChange={(event) => setBankName(event.target.value)}
              >
                {catalog.data.banks.map((item) => (
                  <option key={item.name}>{item.name}</option>
                ))}
              </select>
            </label>
            <span className="badge">Live connection not active</span>
          </section>
          {tab === 'Bank access' && bank && (
            <>
              <section className="card">
                <div className="page-intro">
                  <div>
                    <p className="eyebrow">BANK ACCESS</p>
                    <h2>{bank.name}</h2>
                  </div>
                  <ActionButton
                    action={() =>
                      download(
                        `${props.base}/banking/request-brief?bank=${encodeURIComponent(bank.name)}`,
                        'bank-integration-request.txt',
                      )
                    }
                  >
                    Download bank request brief
                  </ActionButton>
                </div>
                <h3>{bank.channel}</h3>
                <p>{bank.finding}</p>
                <p className="notice">{bank.nextStep}</p>
                <p className="muted">
                  The request brief is for you to send to your bank. Downloading
                  it does not apply for access or connect an account.
                </p>
                <div className="bank-source-links">
                  {bank.sources.map((source) => (
                    <a
                      key={source.uri}
                      href={source.uri}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {source.title} ↗
                    </a>
                  ))}
                </div>
                <p className="muted">
                  Public information reviewed {bank.reviewedOn}. Confirm the
                  bank’s current Zambia offering during onboarding.
                </p>
              </section>
              <section className="card">
                <h2>What to confirm with the bank</h2>
                <ol className="bank-requirements">
                  {catalog.data.requirements.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ol>
              </section>
              <section className="card">
                <h2>Coverage across Zambia</h2>
                <p>
                  All 15 banks in the{' '}
                  <a
                    href={catalog.data.registerSource}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Bank of Zambia register ↗
                  </a>{' '}
                  are included in the access guide. Salary file preparation is
                  available now; live payments and automatic statement feeds
                  need bank-approved integration access.
                </p>
                <DataTable
                  columns={['Bank', 'Channel to discuss', 'Access']}
                  rows={catalog.data.banks.map((item) => [
                    item.name,
                    item.channel,
                    <button
                      className="text-button"
                      onClick={() => setBankName(item.name)}
                    >
                      View requirements
                    </button>,
                  ])}
                />
              </section>
            </>
          )}
          {tab === 'Reconciliation' && (
            <ReconciliationWorkspace
              {...props}
              key={bankName}
              bank={bankName}
            />
          )}
        </>
      )}
    </>
  );
}
function ReconciliationWorkspace(props: CompanyProps & { bank: string }) {
  const runs = useRemote<{ items: Run[] }>(
    `${props.base}/payroll-runs?limit=100`,
  );
  const [runId, setRunId] = useState('');
  const finalized =
    runs.data?.items.filter((run) => run.status === 'finalized') ?? [];
  const selected = finalized.find((run) => run.id === runId) ?? finalized[0];
  return (
    <>
      <section className="card">
        <h2>Review a bank statement</h2>
        <p>
          Compare individual salary debits with finalized payroll using the
          payment reference, exact amount and ZMW currency. Upload a statement
          from the employer’s funding account.
        </p>
        <label>
          Payroll to reconcile
          <select
            value={selected?.id ?? ''}
            onChange={(event) => setRunId(event.target.value)}
          >
            <option value="">Select finalized payroll</option>
            {finalized.map((run) => (
              <option key={run.id} value={run.id}>
                {run.code} · {run.paymentDate}
              </option>
            ))}
          </select>
        </label>
        {!runs.data && <Loading error={runs.error} />}
        {runs.data && !selected && (
          <p className="empty">
            Finalize payroll before reviewing its bank payments.
          </p>
        )}
      </section>
      {selected && (
        <StatementReview {...props} run={selected} key={selected.id} />
      )}
    </>
  );
}
function StatementReview({
  base,
  csrf,
  bank,
  run,
}: CompanyProps & { bank: string; run: Run }) {
  const path = `${base}/payroll-runs/${run.id}/banking`;
  const expected = useRemote<{ items: Payment[] }>(`${path}/instructions`);
  const [csv, setCsv] = useState('');
  const [filename, setFilename] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<Reconciliation>();
  const [lastBody, setLastBody] = useState<{
    bank: string;
    from: string;
    to: string;
    csv: string;
  }>();
  const controller = useRef<AbortController | null>(null);
  useEffect(() => {
    const active = new AbortController();
    controller.current = active;
    return () => active.abort();
  }, []);
  const [year, month] = run.paymentDate.split('-').map(Number);
  return (
    <>
      <section className="card">
        <div className="page-intro">
          <h2>Expected salary payments</h2>
          <ActionButton
            action={() =>
              download(
                `${base}/payroll-runs/${run.id}/documents/payments`,
                'payment-instructions.csv',
              )
            }
          >
            Download payment instructions
          </ActionButton>
        </div>
        <p className="muted">
          Use these references in your bank payment file. The download is a
          review schedule; your bank’s accepted import layout still applies.
        </p>
        {expected.data ? (
          <DataTable
            columns={['Employee', 'Payment reference', 'Net pay']}
            rows={expected.data.items
              .slice(0, 100)
              .map((item) => [
                `${item.employeeNumber} · ${item.employeeName}`,
                <code>{item.reference}</code>,
                currency({ amount: item.amount, currency: 'ZMW', scale: 2 }),
              ])}
          />
        ) : (
          <Loading error={expected.error} />
        )}
        {expected.data && expected.data.items.length > 100 && (
          <p className="muted">
            Showing the first 100 payments. The download includes all payments.
          </p>
        )}
      </section>
      <section className="card">
        <div className="page-intro">
          <h2>Upload statement CSV</h2>
          <ActionButton
            action={() =>
              download(
                `${base}/banking/statement-template`,
                'statement-import-template.csv',
              )
            }
          >
            Download statement template
          </ActionButton>
        </div>
        <p>
          Map your bank export to these headers:{' '}
          <code>transactionId, bookingDate, reference, amount, currency</code>.
          Use YYYY-MM-DD dates and signed amounts with two decimal places:
          debits are negative, credits are positive. Maximum 500 KB and 5,000
          entries.
        </p>
        <p className="notice">
          Matching is based on the uploaded file. It does not confirm payment
          with the bank or mark payroll as paid. Consolidated batch debits,
          fees, returns and reversals need review. Statement contents are not
          saved.
        </p>
        <form
          onChange={() => {
            setResult(undefined);
            setLastBody(undefined);
          }}
          onSubmit={(event) => {
            event.preventDefault();
            if (busy || !csv) return;
            const active = controller.current;
            if (!active || active.signal.aborted) return;
            const form = new FormData(event.currentTarget);
            const body = {
              bank,
              from: String(form.get('from')),
              to: String(form.get('to')),
              csv,
            };
            setBusy(true);
            setError('');
            setResult(undefined);
            void request<Reconciliation>(`${path}/reconcile`, {
              csrf,
              body,
              signal: active.signal,
            })
              .then((value) => {
                if (!active.signal.aborted) {
                  setResult(value);
                  setLastBody(body);
                }
              })
              .catch((failure: unknown) => {
                if (!active.signal.aborted) setError(message(failure));
              })
              .finally(() => {
                if (!active.signal.aborted) setBusy(false);
              });
          }}
        >
          <fieldset className="fields" disabled={busy}>
            <label>
              Statement from
              <input
                type="date"
                name="from"
                required
                defaultValue={`${run.paymentDate.slice(0, 7)}-01`}
              />
            </label>
            <label>
              Statement to
              <input
                type="date"
                name="to"
                required
                defaultValue={new Date(Date.UTC(year!, month!, 0))
                  .toISOString()
                  .slice(0, 10)}
              />
            </label>
            <label className="full-width">
              Bank statement CSV
              <input
                type="file"
                accept=".csv,text/csv"
                required
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  const active = controller.current;
                  setCsv('');
                  setFilename('');
                  setError('');
                  if (!file || !active || active.signal.aborted) return;
                  if (file.size > 500_000) {
                    setError('Statement CSV must be at most 500 KB.');
                    return;
                  }
                  setBusy(true);
                  void file
                    .text()
                    .then((text) => {
                      if (!active.signal.aborted) {
                        setCsv(text);
                        setFilename(file.name);
                      }
                    })
                    .catch((failure: unknown) => {
                      if (!active.signal.aborted) setError(message(failure));
                    })
                    .finally(() => {
                      if (!active.signal.aborted) setBusy(false);
                    });
                }}
              />
            </label>
            <div className="form-actions">
              <button disabled={!csv || !expected.data} type="submit">
                {busy ? 'Working…' : 'Review statement matches'}
              </button>
              {filename && <span className="muted">{filename}</span>}
            </div>
          </fieldset>
        </form>
        {error && (
          <p className="notice error" role="alert">
            {error}
          </p>
        )}
      </section>
      {result && (
        <section className="card">
          <div className="page-intro">
            <h2>Statement review results</h2>
            <ActionButton
              action={async () => {
                const active = controller.current;
                if (!lastBody || !active || active.signal.aborted) return;
                const file = await request<Blob>(
                  `${path}/reconcile?format=csv`,
                  { csrf, body: lastBody, blob: true, signal: active.signal },
                );
                if (!active.signal.aborted)
                  saveFile(file, 'statement-reconciliation.csv');
              }}
            >
              Download reconciliation CSV
            </ActionButton>
          </div>
          <p role="status">
            {result.summary.matched} matched · {result.summary.missing} missing
            · {result.summary.exceptions} exceptions ·{' '}
            {result.summary.unmatched} unmatched statement entries
          </p>
          <DataTable
            columns={[
              'Employee',
              'Reference',
              'Expected net',
              'Result',
              'Statement entries',
            ]}
            rows={result.results
              .slice(0, 100)
              .map((item) => [
                item.employeeName,
                item.reference,
                currency({ amount: item.amount, currency: 'ZMW', scale: 2 }),
                statuses[item.status] ?? item.status,
                item.entries
                  .map((entry) => `${entry.transactionId}: ${entry.amount}`)
                  .join('; ') || '—',
              ])}
          />
          <h3 className="spaced-heading">Other statement entries</h3>
          <DataTable
            columns={['Transaction', 'Date', 'Reference', 'Amount']}
            rows={result.unmatched
              .slice(0, 100)
              .map((entry) => [
                entry.transactionId,
                entry.bookingDate,
                entry.reference || '—',
                currency({ amount: entry.amount, currency: 'ZMW', scale: 2 }),
              ])}
            empty="All uploaded entries have a payroll reference."
          />
          <p className="muted">
            Tables show up to 100 rows each. The download includes the complete
            review. Multiple entries can include duplicate debits or reversals;
            investigate them before considering a payment settled.
          </p>
        </section>
      )}
    </>
  );
}
