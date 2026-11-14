import { useId, useState } from "react";

export type TableRow = { key: string; cells: string[] };

export function DataTable({ label, head, rows }: { label: string; head: string[]; rows: TableRow[] }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <>
      <button
        type="button"
        className="self-start rounded-xs text-caption phone:flex phone:h-11 phone:items-center text-secondary underline decoration-line-strong underline-offset-2 hover:text-primary hover:decoration-current"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((v) => !v)}
      >
        {open ? "Hide data" : "View data"}
      </button>
      <div id={id} className={open ? "max-h-80 overflow-auto" : "sr-only"}>
        <table className="w-full text-caption tabular">
          <caption className="sr-only">{label}</caption>
          <thead>
            <tr className="text-secondary">
              {head.map((h, i) => (
                <th key={h} scope="col" className={`py-1.5 font-medium ${i > 0 ? "text-right" : "text-left"}`}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(({ key, cells: [first, ...rest] }) => (
              <tr key={key} className="hairline-t">
                <th scope="row" className="py-1.5 text-left font-normal">
                  {first}
                </th>
                {rest.map((c, i) => (
                  <td key={i} className="py-1.5 text-right">
                    {c}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
