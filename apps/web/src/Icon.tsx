const paths = {
  Overview: 'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',
  People:
    'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8 M22 21v-2a4 4 0 0 0-3-3.87 M16 3.13a4 4 0 0 1 0 7.75',
  Payroll: 'M3 5h18v14H3z M3 9h18 M7 14h3 M15 14h2',
  'Payroll periods': 'M4 5h16v16H4z M8 3v4 M16 3v4 M4 11h16 M8 15h2 M14 15h2',
  Gratuity: 'M12 3v18 M17 7H9a3 3 0 0 0 0 6h6a3 3 0 0 1 0 6H6',
  Compliance: 'M12 3 3 7v5c0 5 9 9 9 9s9-4 9-9V7z M8 12l3 3 5-6',
  'Bank batches':
    'm3 8 9-5 9 5 M3 8h18 M5 11v7 M10 11v7 M15 11v7 M20 11v7 M3 21h18',
  'ZRA returns': 'M5 3h10l4 4v14H5z M14 3v5h5 M8 12h8 M8 16h5',
  Reports: 'M4 3v18h17 M8 17v-5 M13 17V7 M18 17v-8',
  'Statutory rules': 'M5 3h14v18H5z M9 7h6 M9 12h6 M9 17h3',
  Settings: 'M4 7h16 M4 17h16 M8 4v6 M16 14v6',
  Setup: 'M5 5h14v16H5z M9 3h6v4H9z m8 9-5 5-3-3',
  Team: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8 M19 6v6 M16 9h6',
};
export function Icon({ name }: { name: keyof typeof paths }) {
  return (
    <svg
      aria-hidden="true"
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={paths[name]} />
    </svg>
  );
}
