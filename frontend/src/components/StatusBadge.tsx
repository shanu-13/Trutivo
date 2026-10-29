// A status label with a symbol and text; colour is decoration only.
export default function StatusBadge({ label, symbol, tone }: { label: string; symbol: string; tone: string }) {
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full border whitespace-nowrap ${tone}`}>
      <span aria-hidden="true">{symbol}</span>
      {label}
    </span>
  );
}
