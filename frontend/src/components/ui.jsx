import React from 'react';

export const formatCurrency = (amount) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(amount ?? 0);

export const formatDate = (dateStr) =>
  new Date(dateStr).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });

export const StatusBadge = ({ status }) => {
  const map = {
    SUCCESS:          'badge-success',
    PENDING:          'badge-pending',
    PENDING_APPROVAL: 'badge-warning',
    FAILED:           'badge-failed',
    REVERSED:         'badge-reversed',
  };
  const label = status === 'PENDING_APPROVAL' ? 'PENDING APPROVAL' : status;
  return <span className={`badge ${map[status] || 'badge-pending'}`}>{label}</span>;
};

export const TypeBadge = ({ type }) => {
  const map = {
    DEPOSIT:    'badge-deposit',
    WITHDRAWAL: 'badge-withdrawal',
    TRANSFER:   'badge-transfer',
  };
  const icons = { DEPOSIT: '↓', WITHDRAWAL: '↑', TRANSFER: '⇄' };
  return (
    <span className={`badge ${map[type] || ''}`}>
      {icons[type]} {type}
    </span>
  );
};

export const AccountStatusBadge = ({ status }) => {
  const map = { ACTIVE: 'badge-active', FROZEN: 'badge-frozen', CLOSED: 'badge-closed' };
  return <span className={`badge ${map[status] || ''}`}>{status}</span>;
};

export const LoadingSpinner = () => (
  <div className="loading-spinner">
    <div className="spinner" />
    Loading…
  </div>
);

export const EmptyState = ({ icon = '📭', title = 'Nothing here', description = '' }) => (
  <div className="empty-state">
    <div className="empty-state-icon">{icon}</div>
    <h3>{title}</h3>
    {description && <p>{description}</p>}
  </div>
);
