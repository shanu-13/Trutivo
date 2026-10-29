// A small document mark with the file type, used for resume files.
export default function FileIcon({ label = 'PDF', className = 'h-10 w-8' }: { label?: string; className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 32 40" className={`shrink-0 ${className}`} fill="none">
      <path d="M4 1.5h16.5L30.5 11.5V37a1.5 1.5 0 0 1-1.5 1.5H4A1.5 1.5 0 0 1 2.5 37V3A1.5 1.5 0 0 1 4 1.5Z" className="fill-white stroke-slate-300" strokeWidth="1.5" />
      <path d="M20.5 1.5V10a1.5 1.5 0 0 0 1.5 1.5h8.5" className="stroke-slate-300" strokeWidth="1.5" />
      <rect x="0" y="22" width="22" height="11" rx="2" className="fill-ink" />
      <text x="11" y="30" textAnchor="middle" className="fill-white" fontSize="7" fontWeight="700" fontFamily="inherit">
        {label}
      </text>
    </svg>
  );
}
