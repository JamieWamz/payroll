import './styles.css';

export function App() {
  return (
    <main className="shell">
      <section className="hero" aria-labelledby="page-title">
        <p className="eyebrow">Zambia payroll, built carefully</p>
        <h1 id="page-title">ZamPayroll</h1>
        <p className="summary">
          The secure foundation for accurate, auditable payroll operations.
        </p>
        <div className="status" role="status">
          <span aria-hidden="true" />
          Phase 1 foundation
        </div>
        <p className="notice">
          Payroll calculations and statutory rates are not implemented yet.
        </p>
      </section>
    </main>
  );
}
