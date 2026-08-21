import type { ReactNode } from 'react';

export function Card({
  title,
  action,
  children,
  padded = true,
}: {
  title?: string;
  action?: ReactNode;
  children: ReactNode;
  padded?: boolean;
}) {
  return (
    <section className="card">
      {title !== undefined && (
        <header className="card-head">
          <h2 className="card-title">{title}</h2>
          {action}
        </header>
      )}
      {padded ? <div className="card-body">{children}</div> : children}
    </section>
  );
}

export function Skeleton({
  width,
  height = 12,
}: {
  width: string | number;
  height?: number;
}) {
  return <div className="skeleton" style={{ width, height }} />;
}

export function StatusPill({ status }: { status: string }) {
  return <span className={`pill ${status}`}>{status}</span>;
}

const currency = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});

export const formatCurrency = (value: number): string => currency.format(value);

export const formatDate = (iso: string): string =>
  new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
