import React, { useState, useEffect, useCallback } from 'react';
import api from '../api/client';
import { LoadingSpinner, EmptyState, formatDate } from '../components/ui';
import { Search, Users, Mail, Phone, ShieldCheck, User } from 'lucide-react';

/* ── tiny debounce hook ── */
function useDebounce(value, delay) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

const RoleBadge = ({ role }) => (
  <span style={{
    display: 'inline-flex', alignItems: 'center', gap: '4px',
    padding: '2px 10px', borderRadius: '20px', fontSize: '11px', fontWeight: 600,
    background: role === 'ADMIN' ? 'rgba(99,102,241,0.15)' : 'rgba(16,185,129,0.12)',
    color: role === 'ADMIN' ? '#a5b4fc' : '#6ee7b7',
  }}>
    {role === 'ADMIN' ? <ShieldCheck size={11} /> : <User size={11} />}
    {role}
  </span>
);

const CustomerCard = ({ customer }) => (
  <tr>
    <td>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        <div style={{
          width: 38, height: 38, borderRadius: '50%',
          background: 'var(--grad-primary)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontWeight: 700, fontSize: '14px', flexShrink: 0,
        }}>
          {customer.name?.[0]?.toUpperCase()}
        </div>
        <div>
          <div style={{ fontWeight: 600, fontSize: '14px', color: 'var(--txt-primary)' }}>{customer.name}</div>
          <div style={{ fontSize: '11px', color: 'var(--txt-muted)', marginTop: '2px' }}>ID #{customer.id}</div>
        </div>
      </div>
    </td>
    <td>
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--txt-secondary)', fontSize: '13px' }}>
        <Mail size={13} color="var(--txt-muted)" />
        {customer.email}
      </div>
    </td>
    <td>
      {customer.phone ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--txt-secondary)', fontSize: '13px' }}>
          <Phone size={13} color="var(--txt-muted)" />
          {customer.phone}
        </div>
      ) : (
        <span style={{ color: 'var(--txt-muted)', fontSize: '12px' }}>—</span>
      )}
    </td>
    <td>
      <RoleBadge role={customer.role} />
    </td>
    <td>
      <span style={{
        display: 'inline-flex', alignItems: 'center', gap: '4px',
        padding: '2px 10px', borderRadius: '20px', fontSize: '11px', fontWeight: 600,
        background: 'rgba(59,130,246,0.12)', color: '#93c5fd',
      }}>
        {customer.account_count ?? 0} account{customer.account_count !== 1 ? 's' : ''}
      </span>
    </td>
    <td style={{ fontSize: '12px', color: 'var(--txt-muted)' }}>
      {customer.created_at ? formatDate(customer.created_at) : '—'}
    </td>
  </tr>
);

const Customers = () => {
  const [query, setQuery]       = useState('');
  const [results, setResults]   = useState([]);
  const [loading, setLoading]   = useState(false);
  const [initialLoad, setInit]  = useState(true);
  const [totalHint, setHint]    = useState('');
  const debouncedQ = useDebounce(query, 350);

  const fetchCustomers = useCallback(async (q) => {
    setLoading(true);
    try {
      const { data } = await api.get(`/customers/search?q=${encodeURIComponent(q)}`);
      setResults(data.data || []);
      if (!q) {
        setHint(`Showing last 20 registered customers`);
      } else {
        const count = data.data?.length || 0;
        setHint(`${count} result${count !== 1 ? 's' : ''} for "${q}"`);
      }
    } catch {
      setResults([]);
      setHint('Search failed. Try again.');
    } finally {
      setLoading(false);
      setInit(false);
    }
  }, []);

  useEffect(() => { fetchCustomers(debouncedQ); }, [debouncedQ, fetchCustomers]);

  return (
    <div>
      {/* Page header */}
      <div className="page-header">
        <h1 className="page-title">Customer Directory</h1>
        <p className="page-subtitle">Search and explore all registered customers</p>
      </div>

      {/* Search card */}
      <div className="card" style={{ marginBottom: '24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
          <div style={{ position: 'relative', flex: 1, minWidth: '260px' }}>
            <Search size={16} style={{
              position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)',
              color: 'var(--txt-muted)', pointerEvents: 'none',
            }} />
            <input
              id="customer-search-input"
              type="text"
              className="form-control"
              placeholder="Search by name, email or phone…"
              value={query}
              onChange={e => setQuery(e.target.value)}
              style={{ paddingLeft: '42px', fontSize: '15px', height: '48px' }}
              autoFocus
              autoComplete="off"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery('')}
                style={{
                  position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)',
                  background: 'none', border: 'none', color: 'var(--txt-muted)', cursor: 'pointer',
                  padding: '4px', borderRadius: '4px', display: 'flex', alignItems: 'center',
                }}
              >
                ✕
              </button>
            )}
          </div>

          {/* Stats pill */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: '8px',
            padding: '8px 16px', borderRadius: 'var(--radius-md)',
            background: 'var(--clr-surface-2)', border: '1px solid var(--clr-border)',
            fontSize: '13px', color: 'var(--txt-secondary)', whiteSpace: 'nowrap',
          }}>
            <Users size={15} color="var(--clr-primary-h)" />
            {loading ? 'Searching…' : totalHint}
          </div>
        </div>
      </div>

      {/* Results */}
      <div className="card" style={{ padding: 0 }}>
        {initialLoad || loading ? (
          <LoadingSpinner />
        ) : results.length === 0 ? (
          <EmptyState
            icon="🔍"
            title={query ? `No customers found for "${query}"` : 'No customers yet'}
            description={query ? 'Try a different name, email, or phone number.' : 'Customers will appear here once registered.'}
          />
        ) : (
          <div className="table-wrap" style={{ border: 'none' }}>
            <table>
              <thead>
                <tr>
                  <th>Customer</th>
                  <th>Email</th>
                  <th>Phone</th>
                  <th>Role</th>
                  <th>Accounts</th>
                  <th>Joined</th>
                </tr>
              </thead>
              <tbody>
                {results.map(c => <CustomerCard key={c.id} customer={c} />)}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Helper text */}
      <p style={{ marginTop: '12px', fontSize: '12px', color: 'var(--txt-muted)', textAlign: 'center' }}>
        Search is case-insensitive · Results capped at 50 · Searches name, email, and phone
      </p>
    </div>
  );
};

export default Customers;
