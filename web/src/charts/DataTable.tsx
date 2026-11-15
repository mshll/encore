import { useState } from "react";
import { IconButton, buttonClass } from "../ui/Button";
import { cx } from "../ui/cx";
import { Dialog, DialogClose } from "../ui/Dialog";
import { TableIcon } from "../ui/icons";
import { Tooltip } from "../ui/Tooltip";

export type TableRow = { key: string; cells: string[] };

function Table({ label, head, rows, visible }: { label: string; head: string[]; rows: TableRow[]; visible: boolean }) {
  const cell = (i: number) => cx("px-3 first:pl-0 last:pr-0", i === 0 ? "text-left" : "text-right");
  return (
    <table className="w-full border-separate border-spacing-0 text-body-sm tabular">
      <caption className="sr-only">{label}</caption>
      <thead>
        <tr>
          {head.map((h, i) => (
            <th
              key={i}
              scope="col"
              className={cx(
                cell(i),
                "sticky top-0 z-10 bg-overlay pb-2 text-caption font-medium whitespace-nowrap text-secondary",
                visible && "hairline-b",
                i === 0 && "left-0 z-20",
              )}
            >
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map(({ key, cells: [first, ...rest] }) => (
          <tr key={key}>
            <th scope="row" className={cx(cell(0), "sticky left-0 bg-overlay py-2 font-normal whitespace-nowrap text-primary")}>
              {first}
            </th>
            {rest.map((c, i) => (
              <td key={i} className={cx(cell(i + 1), "py-2 whitespace-nowrap text-primary")}>
                {c}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * The numbers behind a chart. Screen readers read the table in place; everyone else opens it from a quiet icon
 * button, in a dialog (a bottom sheet on a phone) that scrolls under a sticky header.
 */
export function DataTable({ label, head, rows }: { label: string; head: string[]; rows: TableRow[] }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className="sr-only">
        <Table label={label} head={head} rows={rows} visible={false} />
      </div>
      <Tooltip label="Show data">
        <IconButton icon={TableIcon} label={`Show data: ${label}`} size="sm" className="-mr-1.5" onClick={() => setOpen(true)} />
      </Tooltip>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title={label}
        width={head.length > 3 ? 720 : 440}
        footer={<DialogClose className={buttonClass()}>Close</DialogClose>}
      >
        <div className="max-h-96 overflow-auto overscroll-contain">
          <Table label={label} head={head} rows={rows} visible />
        </div>
      </Dialog>
    </>
  );
}
