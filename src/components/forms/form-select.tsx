"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

const EMPTY_VALUE = "__form_select_empty__";

type FormSelectProps = {
  id?: string;
  name?: string;
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  options: ReadonlyArray<{ value: string; label: string }>;
  emptyLabel?: string;
  disabled?: boolean;
  required?: boolean;
  className?: string;
  "aria-label"?: string;
  "aria-invalid"?: boolean;
  "aria-describedby"?: string;
};

export function FormSelect({
  value,
  defaultValue,
  onValueChange,
  options,
  emptyLabel,
  className,
  ...props
}: FormSelectProps) {
  const controlledValue = value === undefined ? undefined : value || EMPTY_VALUE;
  const initialValue = defaultValue === undefined ? undefined : defaultValue || EMPTY_VALUE;
  const selectItems = [
    ...(emptyLabel ? [{ value: EMPTY_VALUE, label: emptyLabel }] : []),
    ...options,
  ];
  const labels = new Map(selectItems.map((option) => [option.value, option.label]));

  return (
    <Select
      items={selectItems}
      name={props.name}
      value={controlledValue}
      defaultValue={initialValue}
      onValueChange={(nextValue) => {
        onValueChange?.(!nextValue || nextValue === EMPTY_VALUE ? "" : nextValue);
      }}
      itemToStringLabel={(itemValue) => labels.get(String(itemValue)) ?? String(itemValue)}
      itemToStringValue={(itemValue) => itemValue === EMPTY_VALUE ? "" : String(itemValue)}
      required={props.required}
      disabled={props.disabled}
    >
      <SelectTrigger
        id={props.id}
        className={cn("h-11 w-full bg-background sm:h-10", className)}
        aria-label={props["aria-label"]}
        aria-invalid={props["aria-invalid"]}
        aria-describedby={props["aria-describedby"]}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent align="start">
        {emptyLabel ? <SelectItem value={EMPTY_VALUE}>{emptyLabel}</SelectItem> : null}
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
