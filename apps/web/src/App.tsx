import { useEffect, useState } from 'react';

import './styles.css';

type RuntimeState = 'checking' | 'ready' | 'unavailable';

const foundations = [
  {
    detail:
      'TypeScript workspace, PostgreSQL migrations, Docker services, CI, and hardened runtime defaults.',
    label: 'Platform',
    state: 'Complete',
  },
  {
    detail:
      'Company, global users, memberships, roles, permissions, and transaction-scoped tenant isolation.',
    label: 'Tenant & identity',
    state: 'Complete',
  },
  {
    detail:
      'Argon2id credentials, opaque sessions, CSRF secrets, authorization principals, and append-only audit storage.',
    label: 'Security core',
    state: 'Internal foundation',
  },
  {
    detail:
      'Minimal employee identity, effective-dated employment, guarded archival, and cross-company protection.',
    label: 'Workforce',
    state: 'Complete',
  },
] as const;

const nextMilestones = [
  'Effective-dated compensation',
  'Payroll periods and draft runs',
  'Verified statutory configuration',
  'Auditable calculation engine',
] as const;

export function App() {
  const [runtimeState, setRuntimeState] = useState<RuntimeState>('checking');

  useEffect(() => {
    const controller = new AbortController();

    void fetch('/api/health/ready', {
      headers: { accept: 'application/json' },
      signal: controller.signal,
    })
      .then((response) => {
        if (!response.ok) {
          throw new Error('API readiness check failed');
        }
        return response.json() as Promise<{ status?: string }>;
      })
      .then((payload) => {
        setRuntimeState(payload.status === 'ready' ? 'ready' : 'unavailable');
      })
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === 'AbortError')) {
          setRuntimeState('unavailable');
        }
      });

    return () => {
      controller.abort();
    };
  }, []);

  const runtimeLabel =
    runtimeState === 'ready'
      ? 'System ready'
      : runtimeState === 'checking'
        ? 'Checking runtime'
        : 'Runtime starting';

  return (
    <main className="shell">
      <div className="ambient ambient-one" aria-hidden="true" />
      <div className="ambient ambient-two" aria-hidden="true" />

      <nav className="topbar" aria-label="Product status">
        <a className="brand" href="#top" aria-label="ZamPayroll home">
          <span className="brand-mark" aria-hidden="true">
            Z
          </span>
          <span>ZamPayroll</span>
        </a>
        <div className="phase-pill">
          <span aria-hidden="true" />
          Phase 2 · Domain foundation
        </div>
      </nav>

      <section className="hero" id="top" aria-labelledby="page-title">
        <div className="hero-copy">
          <p className="eyebrow">Zambia payroll, built carefully</p>
          <h1 id="page-title">
            Payroll built from <span>rules you can prove.</span>
          </h1>
          <p className="summary">
            The secure, tenant-isolated foundation for accurate and auditable
            Zambian payroll operations is taking shape.
          </p>
          <div className="hero-actions">
            <a className="primary-action" href="#progress">
              Explore progress
              <span aria-hidden="true">↘</span>
            </a>
            <div
              className={`runtime runtime-${runtimeState}`}
              role="status"
              aria-live="polite"
            >
              <span className="runtime-dot" aria-hidden="true" />
              {runtimeLabel}
            </div>
          </div>
        </div>

        <aside className="principle-card" aria-label="Engineering principle">
          <div className="card-index">01</div>
          <p>Core engineering principle</p>
          <blockquote>
            Never guess a statutory rule. Every calculation must be versioned,
            reproducible, and backed by an authoritative source.
          </blockquote>
          <div className="rule-line" aria-hidden="true" />
        </aside>
      </section>

      <section className="progress-section" id="progress">
        <header className="section-heading">
          <div>
            <p className="eyebrow">Implemented foundations</p>
            <h2>What exists today</h2>
          </div>
          <p>
            Production-minded internals first. Business routes remain closed
            until the authentication boundary is complete.
          </p>
        </header>

        <div className="foundation-grid">
          {foundations.map((foundation, index) => (
            <article className="foundation-card" key={foundation.label}>
              <div className="foundation-meta">
                <span>0{index + 1}</span>
                <span className="foundation-state">{foundation.state}</span>
              </div>
              <h3>{foundation.label}</h3>
              <p>{foundation.detail}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="roadmap-section" aria-labelledby="roadmap-title">
        <div className="roadmap-copy">
          <p className="eyebrow">Next in the build</p>
          <h2 id="roadmap-title">From employee records to trusted payroll.</h2>
          <p>
            Compensation and payroll structures come next. PAYE, NAPSA, and
            NHIMA logic will only follow reviewed, effective-dated statutory
            sources—never placeholder rates.
          </p>
        </div>
        <ol className="milestone-list">
          {nextMilestones.map((milestone, index) => (
            <li key={milestone}>
              <span>{String(index + 1).padStart(2, '0')}</span>
              {milestone}
            </li>
          ))}
        </ol>
      </section>

      <footer>
        <p>Built for Zambian SMEs and accounting firms.</p>
        <p>Foundation preview · Not yet production-ready</p>
      </footer>
    </main>
  );
}
