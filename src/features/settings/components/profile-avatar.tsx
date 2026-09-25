import { getColorStyle } from "@/features/leads/schemas/colors";
import { cn } from "@/lib/utils";

const sizes = {
  sm: "size-8 text-xs",
  md: "size-10 text-sm",
  lg: "size-20 text-xl",
  xl: "size-28 text-3xl",
} as const;

function initials(name: string) {
  return name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toLocaleUpperCase("pt-BR") || "?";
}

export function ProfileAvatar({
  name,
  avatarUrl,
  avatarColor,
  size = "md",
  className,
}: {
  name: string;
  avatarUrl?: string | null;
  avatarColor?: string | null;
  size?: keyof typeof sizes;
  className?: string;
}) {
  if (avatarUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- URL pública do Storage varia por ambiente.
      <img src={avatarUrl} alt={name} className={cn("shrink-0 rounded-full object-cover ring-1 ring-border", sizes[size], className)} />
    );
  }
  return (
    <span aria-hidden className={cn("flex shrink-0 items-center justify-center rounded-full border font-semibold", sizes[size], getColorStyle(avatarColor).badge, className)}>
      {initials(name)}
    </span>
  );
}
