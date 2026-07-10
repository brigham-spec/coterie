import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
} from "react";

// Presentational primitives ported from the Coterie prototype. Pure styling over
// the design tokens in globals.css — no client state, safe in server components.

export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

// ── Button ──────────────────────────────────────────────────────────────────
type ButtonVariant = "default" | "gold" | "primary";

const buttonVariants: Record<ButtonVariant, string> = {
  default: "border-line-2 bg-surface text-ink-2 hover:bg-surface-2",
  gold: "border-gold-line bg-gold-bg text-gold-ink hover:brightness-[0.98]",
  primary: "border-ink bg-ink text-white hover:bg-[#2a2920]",
};

export function Button({
  variant = "default",
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  return (
    <button
      className={cn(
        "inline-flex items-center gap-1.5 rounded-sm border px-3.5 py-1.5 text-xs font-medium transition-colors disabled:pointer-events-none disabled:opacity-50",
        buttonVariants[variant],
        className,
      )}
      {...props}
    />
  );
}

// ── Card ──────────────────────────────────────────────────────────────────
export function Card({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "mb-4 overflow-hidden rounded-md border border-line bg-surface shadow-card",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function CardHeader({
  title,
  action,
}: {
  title: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between border-b border-line bg-surface-2 px-[1.1rem] py-2.5">
      <span className="text-[10px] font-medium tracking-[0.07em] text-ink-3 uppercase">
        {title}
      </span>
      {action}
    </div>
  );
}

// ── Page title (serif, matching the prototype topbar/section heads) ─────────
export function PageTitle({
  title,
  subtitle,
}: {
  title: string;
  subtitle?: string;
}) {
  return (
    <div>
      <h1 className="font-serif text-[15px] text-ink">{title}</h1>
      {subtitle ? <p className="mt-0.5 text-[11px] text-ink-3">{subtitle}</p> : null}
    </div>
  );
}

// ── Form field (label + control) ───────────────────────────────────────────
const fieldLabel =
  "mb-1 block text-[10px] font-medium tracking-[0.06em] text-ink-2 uppercase";
const fieldControl =
  "w-full rounded-sm border border-line-2 bg-surface px-3 py-1.5 text-xs text-ink outline-none focus:border-gold-line";

export function Field({
  label,
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  return (
    <label className={cn("block", className)}>
      <span className={fieldLabel}>{label}</span>
      <input className={fieldControl} {...props} />
    </label>
  );
}

export function SelectField({
  label,
  className,
  children,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & { label: string }) {
  return (
    <label className={cn("block", className)}>
      <span className={fieldLabel}>{label}</span>
      <select className={fieldControl} {...props}>
        {children}
      </select>
    </label>
  );
}

// ── Table ──────────────────────────────────────────────────────────────────
export function Table({
  head,
  children,
}: {
  head: ReactNode;
  children: ReactNode;
}) {
  return (
    <table className="w-full border-collapse text-xs">
      <thead className="bg-surface-2">
        <tr>{head}</tr>
      </thead>
      <tbody>{children}</tbody>
    </table>
  );
}

export function Th({ children }: { children: ReactNode }) {
  return (
    <th className="border-b border-line px-[0.9rem] py-2 text-left text-[9.5px] font-medium tracking-[0.08em] text-ink-3 uppercase">
      {children}
    </th>
  );
}

export function Tr({ children }: { children: ReactNode }) {
  return (
    <tr className="last:[&>td]:border-b-0 hover:bg-surface-2">{children}</tr>
  );
}

export function Td({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <td
      className={cn(
        "border-b border-line px-[0.9rem] py-2.5 align-middle text-ink",
        className,
      )}
    >
      {children}
    </td>
  );
}

// ── Status badge (lifecycle / billing → semantic color) ─────────────────────
const statusStyles: Record<string, string> = {
  // Company lifecycle.
  prospect: "bg-slate-bg text-slate-ink",
  member: "bg-teal-bg text-teal-ink",
  strategic_partner: "border border-gold-line bg-gold-bg text-gold-ink",
  former: "bg-surface-3 text-ink-2",
  // Invoice billing (derived — see @/lib/invoice-status).
  draft: "bg-surface-3 text-ink-2",
  sent: "bg-slate-bg text-slate-ink",
  partial: "bg-amber-bg text-amber-ink",
  paid: "bg-teal-bg text-teal-ink",
  void: "bg-red-bg text-red-ink",
  // Project pipeline stages (see @/lib/project-stages).
  concept: "bg-slate-bg text-slate-ink",
  pre_development: "bg-purple-bg text-purple-ink",
  entitlements: "bg-amber-bg text-amber-ink",
  planning_board: "bg-amber-bg text-amber-ink",
  capital_raise: "border border-gold-line bg-gold-bg text-gold-ink",
  construction_docs: "bg-teal-bg text-teal-ink",
  under_construction: "bg-teal-bg text-teal-ink",
  stabilization: "bg-teal-bg text-teal-ink",
  completed: "bg-teal-bg text-teal-ink",
  on_hold: "bg-red-bg text-red-ink",
  // Event stages (see @/lib/event-stages). `completed` reuses the teal above.
  planning: "bg-slate-bg text-slate-ink",
  invitations_sent: "bg-purple-bg text-purple-ink",
  confirmed: "border border-gold-line bg-gold-bg text-gold-ink",
  cancelled: "bg-red-bg text-red-ink",
  // Introduction lifecycle stages (see @/lib/intro-stages).
  suggested: "bg-slate-bg text-slate-ink",
  drafted: "bg-purple-bg text-purple-ink",
  made: "bg-amber-bg text-amber-ink",
  connected: "bg-amber-bg text-amber-ink",
  meeting_set: "border border-gold-line bg-gold-bg text-gold-ink",
  collaborating: "bg-teal-bg text-teal-ink",
  value_created: "bg-teal-bg text-teal-ink",
  dormant: "bg-red-bg text-red-ink",
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={cn(
        "inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium whitespace-nowrap capitalize",
        statusStyles[status] ?? "bg-surface-3 text-ink-2",
      )}
    >
      {status.replace(/_/g, " ")}
    </span>
  );
}

// ── Tag badge (network tag → semantic tone) ────────────────────────────────
// Tone comes from the tag vocabulary (@/lib/tags); Tailwind's JIT needs full
// literal class strings, so tones map to a static Record — never build the
// class name dynamically.
const tagToneStyles: Record<string, string> = {
  teal: "border border-teal-line bg-teal-bg text-teal-ink",
  gold: "border border-gold-line bg-gold-bg text-gold-ink",
  purple: "border border-purple-line bg-purple-bg text-purple-ink",
  red: "border border-red-line bg-red-bg text-red-ink",
  slate: "border border-line-2 bg-surface-2 text-ink-2",
};

export function TagBadge({
  label,
  tone,
  title,
}: {
  label: string;
  tone: string;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex rounded-full px-2 py-0.5 text-[9.5px] font-medium whitespace-nowrap",
        tagToneStyles[tone] ?? tagToneStyles.slate,
      )}
    >
      {label}
    </span>
  );
}
