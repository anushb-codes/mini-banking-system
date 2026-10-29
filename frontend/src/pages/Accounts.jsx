import React, { useEffect, useState } from 'react';
import api from '../api/client';
import { formatCurrency, LoadingSpinner, EmptyState, AccountStatusBadge } from '../components/ui';
import toast from 'react-hot-toast';
import { Plus, X, Loader2 } from 'lucide-react';

const Accounts = () => {
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading]   = useState(true);
  const [showModal, setModal]   = useState(false);
  const [creating, setCreating] = useState(false);
  const [accType, setAccType]   = useState('SAVINGS');

  const load = async () => {
    try {
      const { data } = await api.get('/accounts');
      setAccounts(data);
    } catch { toast.error('Failed to load accounts'); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const createAccount = async (e) => {
    e.preventDefault();
    setCreating(true);
    try {
      await api.post('/accounts', { account_type: accType });
      toast.success('Account created successfully!');
      setModal(false);
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to create account');
    } finally { setCreating(false); }
  };

  if (loading) return <LoadingSpinner />;

  return (
    <div>
      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <h1 className="page-title">Accounts</h1>
            <p className="page-subtitle">Manage your bank accounts</p>
          </div>
          <button id="open-create-account" className="btn btn-primary" onClick={() => setModal(true)}>
            <Plus size={16} /> New Account
          </button>
        </div>
      </div>

      {/* Account Cards Grid */}
      {accounts.length === 0 ? (
        <EmptyState icon="🏦" title="No accounts yet" description="Create your first bank account to get started." />
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '20px', marginBottom: '32px' }}>
          {accounts.map(acc => (
            <div key={acc.id} className="account-card">
              <div className={`account-status-badge badge-${acc.status.toLowerCase()}`}>{acc.status}</div>
              <div className="account-number">{acc.account_number}</div>
              <div className="account-balance-label">Available Balance</div>
              <div className="account-balance">{formatCurrency(acc.balance)}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span className="account-type-badge">{acc.account_type}</span>
                <span style={{ fontSize: '12px', opacity: 0.7 }}>
                  Opened {new Date(acc.created_at).toLocaleDateString('en-IN')}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Account Details Table */}
      {accounts.length > 0 && (
        <div className="card">
          <h2 className="section-title" style={{ marginBottom: '16px' }}>Account Details</h2>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Account Number</th>
                  <th>Type</th>
                  <th>Balance</th>
                  <th>Status</th>
                  <th>Created</th>
                  <th>Version</th>
                </tr>
              </thead>
              <tbody>
                {accounts.map(acc => (
                  <tr key={acc.id}>
                    <td style={{ fontFamily: 'monospace', fontSize: '13px' }}>{acc.account_number}</td>
                    <td><span className="badge" style={{ background: 'rgba(59,130,246,0.12)', color: '#93c5fd' }}>{acc.account_type}</span></td>
                    <td style={{ fontWeight: 700, color: 'var(--clr-success)' }}>{formatCurrency(acc.balance)}</td>
                    <td><AccountStatusBadge status={acc.status} /></td>
                    <td style={{ fontSize: '12px', color: 'var(--txt-muted)' }}>{new Date(acc.created_at).toLocaleDateString('en-IN')}</td>
                    <td style={{ fontSize: '12px', color: 'var(--txt-muted)' }}>v{acc.version}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Create Modal */}
      {showModal && (
        <div className="modal-overlay" onClick={() => setModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="modal-title">Open New Account</h2>
              <button className="modal-close" onClick={() => setModal(false)}><X size={20} /></button>
            </div>
            <form onSubmit={createAccount}>
              <div className="form-group">
                <label htmlFor="new-acc-type">Account Type</label>
                <select id="new-acc-type" className="form-control" value={accType} onChange={e => setAccType(e.target.value)}>
                  <option value="SAVINGS">Savings Account</option>
                  <option value="CURRENT">Current Account</option>
                </select>
              </div>
              <div style={{ padding: '16px', background: 'var(--clr-surface-2)', borderRadius: 'var(--radius-md)', marginBottom: '20px', fontSize: '13px', color: 'var(--txt-muted)' }}>
                {accType === 'SAVINGS'
                  ? '💰 Savings accounts earn interest and are ideal for personal savings.'
                  : '🏢 Current accounts are designed for businesses with higher transaction volumes.'}
              </div>
              <div style={{ display: 'flex', gap: '12px' }}>
                <button type="button" className="btn btn-secondary" style={{ flex: 1 }} onClick={() => setModal(false)}>Cancel</button>
                <button id="confirm-create-account" type="submit" className="btn btn-primary" style={{ flex: 2 }} disabled={creating}>
                  {creating ? <><Loader2 size={16} /> Creating…</> : 'Open Account'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default Accounts;
