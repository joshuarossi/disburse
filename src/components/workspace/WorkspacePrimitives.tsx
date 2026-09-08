import type { ReactNode } from 'react';
import { Search, ArrowUpRight, type LucideIcon } from 'lucide-react';
import { Link } from 'react-router-dom';

export function PageHeader({
  title,
  description,
  actions,
  eyebrow,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  eyebrow?: string;
}) {
  return (
    <header className="workspace-page-header">
      <div>
        {eyebrow && <p className="workspace-eyebrow">{eyebrow}</p>}
        <h1>{title}</h1>
        {description && <p className="workspace-description">{description}</p>}
      </div>
      {actions && <div className="workspace-header-actions">{actions}</div>}
    </header>
  );
}
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="workspace-empty">
      <div className="workspace-empty-icon">
        <Icon size={24} strokeWidth={1.5} />
      </div>
      <h3>{title}</h3>
      <p>{description}</p>
      {action && (
        <div className="mt-5 flex flex-wrap justify-center gap-3">{action}</div>
      )}
    </div>
  );
}
export function StatusBadge({
  status,
  label,
}: {
  status: string;
  label?: string;
}) {
  const labels: Record<string, string> = {
    draft: 'Draft',
    pending: 'Needs approval',
    proposed: 'Awaiting signatures',
    scheduled: 'Scheduled',
    relaying: 'Processing',
    executed: 'Paid',
    received: 'Received',
    failed: 'Needs attention',
    cancelled: 'Cancelled',
    active: 'Active',
    paused: 'Paused',
    unpaid: 'Unpaid',
    in_payment: 'Payment in progress',
    paid: 'Paid',
    ready: 'Ready to pay',
    incomplete: 'Details needed',
    archived: 'Archived',
    overdue: 'Overdue',
    void: 'Voided',
  };
  return (
    <span className="workspace-status" data-status={status}>
      <span aria-hidden="true" />
      {label ?? labels[status] ?? status}
    </span>
  );
}
export function SearchField({
  value,
  onChange,
  placeholder = 'Search',
  label,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  label?: string;
}) {
  return (
    <div className="workspace-search">
      <Search size={16} />
      <input
        aria-label={label ?? placeholder}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}
export function Metric({
  label,
  value,
  detail,
  href,
  tone,
}: {
  label: string;
  value: ReactNode;
  detail?: string;
  href?: string;
  tone?: 'warning' | 'success';
}) {
  const content = (
    <>
      <div className="workspace-metric-label">
        {label}
        {href && <ArrowUpRight size={15} />}
      </div>
      <div className="workspace-metric-value" data-tone={tone}>
        {value}
      </div>
      {detail && <p className="workspace-metric-detail">{detail}</p>}
    </>
  );
  return href ? (
    <Link to={href} className="workspace-metric">
      {content}
    </Link>
  ) : (
    <div className="workspace-metric">{content}</div>
  );
}
export function LoadingRows({ count = 5 }: { count?: number }) {
  return (
    <div
      role="status"
      aria-label="Loading records"
      className="workspace-loading"
    >
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="workspace-skeleton" />
      ))}
    </div>
  );
}
export function Notice({
  children,
  tone = 'error',
}: {
  children: ReactNode;
  tone?: 'error' | 'info' | 'success';
}) {
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className="workspace-notice min-w-0 break-words [overflow-wrap:anywhere]"
      data-tone={tone}
    >
      {children}
    </div>
  );
}
