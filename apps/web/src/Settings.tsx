import { useState } from 'react';
import { request } from './api';
import { ActionButton, DataTable, EntryForm, Loading } from './components';
import { useRemote } from './useRemote';
import type { CompanyProps, Configuration } from './Workspace';

export function Settings({ base, csrf }: CompanyProps) {
  const [revision, setRevision] = useState(0);
  const company = useRemote<{ name: string; code: string; version: number }>(
    base,
    revision,
  );
  const settings = useRemote<{
    details: Record<string, string>;
    version: number;
  }>(`${base}/payroll-settings`, revision);
  return (
    <>
      <p className="page-description">
        Business identity and statutory registrations appear on payroll
        documents. Save these before calculating payroll.
      </p>
      {company.data ? (
        <EntryForm
          key={`company:${revision}`}
          title="Business details"
          submit="Save business name"
          fields={[
            {
              name: 'name',
              label: 'Registered business name',
              defaultValue: company.data.name,
            },
          ]}
          action={async (values) => {
            await request(base, {
              csrf,
              method: 'PATCH',
              body: { ...values, expectedVersion: company.data!.version },
            });
            setRevision((v) => v + 1);
            return 'Business name saved.';
          }}
        >
          <p className="muted">Workspace code: {company.data.code}</p>
        </EntryForm>
      ) : (
        <Loading error={company.error} />
      )}
      {settings.data ? (
        <EntryForm
          key={`settings:${revision}`}
          title="Statutory registrations & contact"
          submit="Save payroll settings"
          fields={[
            ['tpin', 'Employer TPIN'],
            ['napsaNumber', 'NAPSA employer number'],
            ['nhimaNumber', 'NHIMA employer number'],
            ['address', 'Business address'],
            ['contactEmail', 'Payroll contact email'],
          ].map(([name, label]) => ({
            name: name!,
            label: label!,
            optional: true,
            defaultValue: settings.data!.details[name!] ?? '',
            ...(name === 'contactEmail' ? { type: 'email' } : {}),
          }))}
          action={async (values) => {
            const details = Object.fromEntries(
              [
                'tpin',
                'napsaNumber',
                'nhimaNumber',
                'address',
                'contactEmail',
              ].map((k) => [k, values[k] ?? '']),
            );
            await request(`${base}/payroll-settings`, {
              csrf,
              method: 'PUT',
              body: { details, expectedVersion: settings.data!.version },
            });
            setRevision((v) => v + 1);
            return 'Payroll settings saved.';
          }}
        />
      ) : (
        <Loading error={settings.error} />
      )}
    </>
  );
}
interface Rule extends Configuration {
  rowVersion: number;
  parameters: Record<string, unknown>;
  sources: {
    authority: string;
    title: string;
    uri: string;
    accessedOn: string;
  }[];
  verification: { verifiedAt: string; verifiedByMembershipId: string } | null;
}
export function StatutoryRules({ base, csrf }: CompanyProps) {
  const [revision, setRevision] = useState(0);
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState('');
  const { data, error } = useRemote<{ items: Rule[] }>(
    `${base}/statutory-configurations?limit=100`,
    revision,
  );
  return (
    <>
      <div className="page-intro">
        <p>
          Versioned PAYE, NAPSA and NHIMA rules, with source evidence and
          recorded reviewer verification.
        </p>
        <button onClick={() => setCreating(!creating)}>
          {creating ? 'Close rule form' : 'Add statutory rules'}
        </button>
      </div>
      <p className="notice">
        Use authoritative rules applicable to the payroll dates. No current-year
        rates are activated automatically. Verification records your review; it
        is not regulatory certification.
      </p>
      {creating && (
        <CreateRules
          base={base}
          csrf={csrf}
          done={() => {
            setCreating(false);
            setRevision((v) => v + 1);
          }}
        />
      )}
      <section className="card">
        <h2>Statutory configuration register</h2>
        {data ? (
          <DataTable
            columns={[
              'Version',
              'Effective from',
              'Effective to',
              'Status',
              '',
            ]}
            rows={data.items.map((r) => [
              r.version,
              r.effectiveFrom,
              r.effectiveTo ?? 'Open-ended',
              <span className={`badge ${r.status}`}>{r.status}</span>,
              <button
                className="text-button"
                onClick={() => setSelected(selected === r.id ? '' : r.id)}
              >
                Review evidence
              </button>,
            ])}
            empty="Add sourced rules, review their parameters and verify a version before preparing payroll."
          />
        ) : (
          <Loading error={error} />
        )}
      </section>
      {selected && (
        <RuleDetail
          key={`${selected}:${revision}`}
          base={base}
          csrf={csrf}
          id={selected}
          changed={() => setRevision((v) => v + 1)}
        />
      )}
    </>
  );
}
function CreateRules({
  base,
  csrf,
  done,
}: CompanyProps & { done: () => void }) {
  const [bands, setBands] = useState([
    { upTo: '', ratePercent: '' },
    { upTo: '', ratePercent: '' },
    { upTo: '', ratePercent: '' },
    { upTo: '', ratePercent: '' },
  ]);
  const [treatments, setTreatments] = useState([
    {
      code: 'BASE_SALARY',
      paye: 'taxable',
      napsa: 'included',
      nhima: 'included',
    },
  ]);
  const fields = [
    {
      name: 'version',
      label: 'Version name',
      hint: 'For example ZM-2026-REVIEW-1.',
    },
    { name: 'effectiveFrom', label: 'Effective from', type: 'date' },
    {
      name: 'effectiveTo',
      label: 'Effective to (optional)',
      type: 'date',
      optional: true,
    },
    ...['napsa', 'nhima'].flatMap((a) => [
      {
        name: `${a}EmployeeRate`,
        label: `${a.toUpperCase()} employee rate (%)`,
      },
      {
        name: `${a}EmployerRate`,
        label: `${a.toUpperCase()} employer rate (%)`,
      },
      {
        name: `${a}EmployeeCap`,
        label: `${a.toUpperCase()} employee monthly cap (ZMW)`,
        optional: true,
        hint: 'Leave blank only if the reviewed rule is uncapped.',
      },
      {
        name: `${a}EmployerCap`,
        label: `${a.toUpperCase()} employer monthly cap (ZMW)`,
        optional: true,
      },
    ]),
    { name: 'accessedOn', label: 'Evidence accessed on', type: 'date' },
    ...['zra', 'napsa', 'nhima'].flatMap((a) => [
      { name: `${a}SourceTitle`, label: `${a.toUpperCase()} source title` },
      {
        name: `${a}SourceUri`,
        label: `${a.toUpperCase()} official source URL`,
        type: 'url',
      },
    ]),
  ];
  return (
    <EntryForm
      title="Create a sourced rule version"
      submit="Save draft rules"
      fields={fields}
      action={async (values) => {
        const parameters = {
          schemaVersion: 'ZAMBIA-MONTHLY-1',
          paye: {
            bands: bands.map((b, i) => ({
              upTo: i === bands.length - 1 ? null : b.upTo,
              ratePercent: b.ratePercent,
            })),
          },
          ...Object.fromEntries(
            ['napsa', 'nhima'].map((a) => [
              a,
              {
                employeeRatePercent: values[`${a}EmployeeRate`],
                employerRatePercent: values[`${a}EmployerRate`],
                employeeMonthlyCap: values[`${a}EmployeeCap`] ?? null,
                employerMonthlyCap: values[`${a}EmployerCap`] ?? null,
              },
            ]),
          ),
          componentTreatments: Object.fromEntries(
            treatments.map(({ code, ...t }) => [code, t]),
          ),
        };
        if (new Set(treatments.map((t) => t.code)).size !== treatments.length)
          throw new Error('Component codes must be unique.');
        await request(`${base}/statutory-configurations`, {
          csrf,
          body: {
            version: values.version,
            effectiveFrom: values.effectiveFrom,
            ...(values.effectiveTo ? { effectiveTo: values.effectiveTo } : {}),
            parameters,
            sources: ['zra', 'napsa', 'nhima'].map((a) => ({
              authority: a,
              title: values[`${a}SourceTitle`],
              uri: values[`${a}SourceUri`],
              accessedOn: values.accessedOn,
            })),
          },
        });
        done();
        return 'Draft rules saved.';
      }}
    >
      <div className="full-width">
        <h3>Monthly PAYE bands</h3>
        <p className="muted">
          Enter cumulative upper bounds in ascending order. The last band has no
          upper limit.
        </p>
        {bands.map((b, i) => (
          <div className="mapping-row" key={i}>
            <label>
              Band {i + 1} upper bound (ZMW)
              <input
                required={i !== bands.length - 1}
                disabled={i === bands.length - 1}
                value={i === bands.length - 1 ? 'Unlimited' : b.upTo}
                onChange={(e) =>
                  setBands((items) =>
                    items.map((x, j) =>
                      j === i ? { ...x, upTo: e.target.value } : x,
                    ),
                  )
                }
              />
            </label>
            <label>
              Band {i + 1} rate (%)
              <input
                required
                value={b.ratePercent}
                onChange={(e) =>
                  setBands((items) =>
                    items.map((x, j) =>
                      j === i ? { ...x, ratePercent: e.target.value } : x,
                    ),
                  )
                }
              />
            </label>
            <button
              type="button"
              className="secondary"
              disabled={bands.length === 1}
              onClick={() =>
                setBands((items) => items.filter((_, j) => j !== i))
              }
            >
              Remove band
            </button>
          </div>
        ))}
        <button
          type="button"
          className="secondary"
          disabled={bands.length >= 20}
          onClick={() =>
            setBands((items) => [...items, { upTo: '', ratePercent: '' }])
          }
        >
          Add band
        </button>
        <h3 className="spaced-heading">Earnings treatment</h3>
        <p className="muted">
          Review the treatment for basic salary and every allowance code used by
          the business.
        </p>
        {treatments.map((t, i) => (
          <div className="treatment-row" key={i}>
            <label>
              Component code
              <input
                required
                value={t.code}
                onChange={(e) =>
                  setTreatments((items) =>
                    items.map((x, j) =>
                      j === i ? { ...x, code: e.target.value } : x,
                    ),
                  )
                }
              />
            </label>
            {(['paye', 'napsa', 'nhima'] as const).map((key) => (
              <label key={key}>
                {key.toUpperCase()}
                <select
                  value={t[key]}
                  onChange={(e) =>
                    setTreatments((items) =>
                      items.map((x, j) =>
                        j === i ? { ...x, [key]: e.target.value } : x,
                      ),
                    )
                  }
                >
                  {(key === 'paye'
                    ? ['taxable', 'exempt']
                    : ['included', 'excluded']
                  ).map((v) => (
                    <option key={v} value={v}>
                      {v}
                    </option>
                  ))}
                </select>
              </label>
            ))}
            <button
              type="button"
              className="secondary"
              disabled={i === 0}
              onClick={() =>
                setTreatments((items) => items.filter((_, j) => j !== i))
              }
            >
              Remove
            </button>
          </div>
        ))}
        <button
          type="button"
          className="secondary"
          onClick={() =>
            setTreatments((items) => [
              ...items,
              {
                code: '',
                paye: 'taxable',
                napsa: 'included',
                nhima: 'excluded',
              },
            ])
          }
        >
          Add allowance treatment
        </button>
      </div>
    </EntryForm>
  );
}
function RuleDetail({
  base,
  csrf,
  id,
  changed,
}: CompanyProps & { id: string; changed: () => void }) {
  const { data, error } = useRemote<Rule>(
    `${base}/statutory-configurations/${id}`,
  );
  const [attested, setAttested] = useState(false);
  if (!data) return <Loading error={error} />;
  return (
    <section className="card">
      <h2>Review {data.version}</h2>
      <DataTable
        columns={['Authority', 'Evidence', 'Accessed']}
        rows={data.sources.map((s) => [
          s.authority.toUpperCase(),
          <a href={s.uri} target="_blank" rel="noreferrer">
            {s.title} ↗
          </a>,
          s.accessedOn,
        ])}
      />
      <details className="rule-parameters" open>
        <summary>Stored calculation parameters</summary>
        <pre>{JSON.stringify(data.parameters, null, 2)}</pre>
      </details>
      {data.verification && (
        <p className="muted">
          Verified {data.verification.verifiedAt} by membership{' '}
          {data.verification.verifiedByMembershipId}.
        </p>
      )}
      {data.status === 'draft' && (
        <>
          <label className="review-confirmation">
            <input
              type="checkbox"
              checked={attested}
              onChange={(e) => setAttested(e.target.checked)}
            />
            I reviewed the official sources, effective dates, rates, caps,
            component treatments and rounding for this version.
          </label>
          <ActionButton
            disabled={!attested}
            className="primary"
            action={async () => {
              await request(`${base}/statutory-configurations/${id}/verify`, {
                csrf,
                body: {
                  expectedRowVersion: data.rowVersion,
                  evidenceAttestation: true,
                },
              });
              changed();
            }}
          >
            Verify statutory rules
          </ActionButton>
        </>
      )}
      {data.status === 'verified' && (
        <ActionButton
          action={async () => {
            await request(`${base}/statutory-configurations/${id}/retire`, {
              csrf,
              body: { expectedRowVersion: data.rowVersion },
            });
            changed();
          }}
        >
          Retire version
        </ActionButton>
      )}
    </section>
  );
}
