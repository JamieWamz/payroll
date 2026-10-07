export type Theme = 'dark' | 'light';

export function ThemeToggle({
  theme,
  toggle,
}: {
  theme: Theme;
  toggle: () => void;
}) {
  const nextTheme = theme === 'dark' ? 'light' : 'dark';
  return (
    <button
      type="button"
      className="theme-toggle secondary"
      aria-label={`Switch to ${nextTheme} mode`}
      onClick={toggle}
    >
      <span aria-hidden="true">{theme === 'dark' ? '☀' : '◐'}</span>
      {theme === 'dark' ? 'Light mode' : 'Dark mode'}
    </button>
  );
}
