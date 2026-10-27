"use client";

import { useId } from "react";
import { IconSearch } from "@/components/ui/icons";

/** Controlled text input with label + optional inline search icon. */
export function SearchInput({
  label,
  placeholder,
  value,
  onValueChange,
}: {
  label: string;
  placeholder: string;
  value: string;
  onValueChange: (value: string) => void;
}) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-xs font-medium text-muted">
        {label}
      </label>
      <div className="relative">
        <IconSearch className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
        <input
          id={id}
          type="search"
          value={value}
          placeholder={placeholder}
          onChange={(e) => onValueChange(e.target.value)}
          className="h-10 w-full rounded-md border border-line bg-surface pl-9 pr-3 text-sm outline-none transition-colors placeholder:text-muted/70 hover:border-line-strong focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-[-1px]"
        />
      </div>
    </div>
  );
}

/** Controlled select with visible label. */
export function SelectInput({
  label,
  value,
  options,
  onValueChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onValueChange: (value: string) => void;
}) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-xs font-medium text-muted">
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(e) => onValueChange(e.target.value)}
        className="h-10 w-full rounded-md border border-line bg-surface px-3 text-sm outline-none transition-colors hover:border-line-strong focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-[-1px]"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

/** Filter row layout primitive so pages compose consistent filter areas. */
export function FilterBar({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-4 grid gap-3 rounded-lg border border-line bg-surface p-4 sm:grid-cols-2 lg:grid-cols-4">
      {children}
    </div>
  );
}
