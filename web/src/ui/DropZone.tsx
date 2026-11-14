import { useRef, useState, type ReactNode } from "react";
import { Button } from "./Button";
import { cx } from "./cx";

/**
 * A region that takes dropped files, with a button that opens the file picker.
 * At rest it is plain content; while files are dragged over it, it outlines itself as the target.
 */
export function DropZone({
  onFiles,
  accept,
  multiple = true,
  disabled = false,
  title,
  description,
  button = "Choose files",
  className,
}: {
  onFiles: (files: File[]) => void;
  accept?: string;
  multiple?: boolean;
  disabled?: boolean;
  title: string;
  description?: ReactNode;
  button?: string;
  className?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const take = (list: FileList | null) => {
    const files = [...(list ?? [])];
    if (files.length > 0) onFiles(files);
  };
  return (
    <div
      onDragOver={(e) => {
        if (disabled) return;
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        if (!disabled) take(e.dataTransfer.files);
      }}
      className={cx(
        "-m-3 flex flex-col items-start gap-3 rounded-lg p-3 outline-offset-0 transition-[background-color,outline-color] duration-150 ease-out",
        over ? "bg-fill outline-2 outline-dashed outline-focus" : "outline-transparent",
        disabled && "opacity-50",
        className,
      )}
    >
      <div className="flex max-w-lg flex-col gap-1">
        <p className="font-medium text-primary">{title}</p>
        {description && <p className="text-secondary text-pretty">{description}</p>}
      </div>
      <Button disabled={disabled} onClick={() => input.current?.click()}>
        {button}
      </Button>
      <input
        ref={input}
        type="file"
        accept={accept}
        multiple={multiple}
        tabIndex={-1}
        aria-hidden
        className="sr-only"
        onChange={(e) => {
          take(e.target.files);
          e.target.value = "";
        }}
      />
    </div>
  );
}
