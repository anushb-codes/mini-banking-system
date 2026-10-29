import React, { useEffect, useState, useCallback } from 'react';
import api from '../api/client';
import { LoadingSpinner, StatusBadge, TypeBadge } from '../components/ui';
import toast from 'react-hot-toast';
import {
  Users, CreditCard, ArrowLeftRight, TrendingUp, Flag, RotateCcw,
  CheckCircle, XCircle, Lock, Unlock, AlertTriangle, Clock, ShieldAlert, X, Loader2
} from 'lucide-react';

const formatINR = (n) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(n || 0);
const formatDate = (d) => d ? new Date(d).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—';

/* ── Confirm Modal ────────────────────────────────────────────── */
const ConfirmModal = ({ title, message, onConfirm, onCancel, confirmLabel = 'Confirm', danger = false, children }) => (
  <div className="modal-overlay" onClick={onCancel}>
    <div className="modal" style={{ maxWidth: 420 }} onClick={e => e.stopPropagation()}>
      <div className="modal-header">
        <h2 className="modal-title">{title}</h2>
        <button className="modal-close" onClick={onCancel}><X size={20} /></button>
      </div>
      <p style={{ color: 'var(--txt-secondary)', fontSize: '14px', marginBottom: '20px' }}>{message}</p>
      {children}
      <div style={{ display: 'flex', gap: '12px', marginTop: '20px' }}>
        <button className="btn btn-secondary" style={{ flex: 1 }} onClick={onCancel}>Cancel</button>
        <button className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`} style={{ flex: 2 }} onClick={onConfirm}>
          {confirmLabel}
        </button>
      </div>
    </div>
  </div>
);

/* ── Transaction Action Row ───────────────────────────────────── */
const TxnRow = ({ txn, onFlag, onUnflag, onReverse, onApprove, onReject }) => {
  const isFlagged  = txn.flagged;
  const isPending  = txn.status === 'PENDING_APPROVAL';
  const isSuccess  = txn.status === 'SUCCESS';
  const isTransfer = txn.transaction_type === 'TRANSFER';

  return (
    <tr style={{ background: isFlagged ? 'rgba(239,68,68,0.04)' : isPending ? 'rgba(245,158,11,0.04)' : undefined }}>
      <td style={{ fontSize: '12px', color: 'var(--txt-muted)' }}>
        #{txn.id}
        {isFlagged && <span title={txn.flag_reason} style={{ marginLeft: 6 }}><Flag size={12} color="#ef4444" /></span>}
        {isPending && <span style={{ marginLeft: 6 }}><Clock size={12} color="#f59e0b" /></span>}
      </td>
      <td><TypeBadge type={txn.transaction_type} /></td>
      <td style={{ fontWeight: 700 }}>{formatINR(txn.amount)}</td>
      <td style={{ fontSize: '12px', fontFamily: 'monospace', color: 'var(--txt-muted)' }}>
        {txn.from_customer_name ? <><div>{txn.from_customer_name}</div><div style={{fontSize:'10px'}}>{txn.from_account_number}</div></> : '—'}
      </td>
      <td style={{ fontSize: '12px', fontFamily: 'monospace', color: 'var(--txt-muted)' }}>
        {txn.to_customer_name ? <><div>{txn.to_customer_name}</div><div style={{fontSize:'10px'}}>{txn.to_account_number}</div></> : '—'}
      </td>
      <td><StatusBadge status={txn.status} /></td>
      <td style={{ fontSize: '11px', color: 'var(--txt-muted)' }}>{formatDate(txn.created_at)}</td>
      <td>
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
          {isPending && (
            <>
              <button className="btn btn-sm" style={{ background: 'rgba(16,185,129,0.15)', color: '#34d399', border: '1px solid rgba(16,185,129,0.3)', padding: '4px 10px' }}
                onClick={() => onApprove(txn)} title="Approve">
                <CheckCircle size={13} /> Approve
              </button>
              <button className="btn btn-sm" style={{ background: 'rgba(239,68,68,0.12)', color: '#f87171', border: '1px solid rgba(239,68,68,0.25)', padding: '4px 10px' }}
                onClick={() => onReject(txn)} title="Reject">
                <XCircle size={13} /> Reject
              </button>
            </>
          )}
          {isSuccess && isTransfer && (
            <button className="btn btn-sm" style={{ background: 'rgba(99,102,241,0.12)', color: '#a5b4fc', border: '1px solid rgba(99,102,241,0.25)', padding: '4px 10px' }}
              onClick={() => onReverse(txn)} title="Reverse transaction">
              <RotateCcw size={13} /> Reverse
            </button>
          )}
          {isFlagged ? (
            <button className="btn btn-sm" style={{ background: 'rgba(245,158,11,0.12)', color: '#fbbf24', border: '1px solid rgba(245,158,11,0.25)', padding: '4px 10px' }}
              onClick={() => onUnflag(txn)} title="Remove flag">
              <Flag size={13} /> Unflag
            </button>
          ) : (
            <button className="btn btn-sm" style={{ background: 'rgba(239,68,68,0.08)', color: '#f87171', border: '1px solid rgba(239,68,68,0.15)', padding: '4px 10px' }}
              onClick={() => onFlag(txn)} title="Flag as suspicious">
              <Flag size={13} /> Flag
            </button>
          )}
        </div>
      </td>
    </tr>
  );
};

/* ── Main Admin Panel ─────────────────────────────────────────── */
const AdminPanel = () => {
  const [tab, setTab]             = useState('overview');
  const [dashboard, setDashboard] = useState(null);
  const [customers, setCustomers] = useState([]);
  const [accounts, setAccounts]   = useState([]);
  const [txns, setTxns]           = useState([]);
  const [pending, setPending]     = useState([]);
  const [flagged, setFlagged]     = useState([]);
  const [loading, setLoading]     = useState(true);

  // Modal state
  const [modal, setModal] = useState(null); // { type, txn/account, extra }
  const [modalInput, setModalInput] = useState('');
  const [actionLoading, setActionLoading] = useState(false);

  const loadAll = useCallback(async () => {
    try {
      setLoading(true);
      const [dashRes, custRes, accRes, txnRes, pendRes, flagRes] = await Promise.all([
        api.get('/admin/dashboard'),
        api.get('/admin/customers'),
        api.get('/admin/accounts'),
        api.get('/admin/transactions?size=50'),
        api.get('/admin/transactions/pending'),
        api.get('/admin/transactions/flagged'),
      ]);
      setDashboard(dashRes.data);
      setCustomers(custRes.data);
      setAccounts(accRes.data);
      setTxns(txnRes.data.data || []);
      setPending(pendRes.data);
      setFlagged(flagRes.data);
    } catch { toast.error('Failed to load admin data'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  /* ── Actions ── */
  const doFlag = async () => {
    if (!modalInput.trim()) { toast.error('Please enter a reason'); return; }
    setActionLoading(true);
    try {
      await api.put(`/admin/transactions/${modal.txn.id}/flag`, { reason: modalInput });
      toast.success('Transaction flagged');
      setModal(null); setModalInput(''); loadAll();
    } catch (err) { toast.error(err.response?.data?.error || 'Failed'); }
    finally { setActionLoading(false); }
  };

  const doUnflag = async () => {
    setActionLoading(true);
    try {
      await api.put(`/admin/transactions/${modal.txn.id}/unflag`);
      toast.success('Flag removed');
      setModal(null); loadAll();
    } catch (err) { toast.error(err.response?.data?.error || 'Failed'); }
    finally { setActionLoading(false); }
  };

  const doReverse = async () => {
    setActionLoading(true);
    try {
      await api.put(`/admin/transactions/${modal.txn.id}/reverse`);
      toast.success('Transaction reversed successfully');
      setModal(null); loadAll();
    } catch (err) { toast.error(err.response?.data?.error || 'Reversal failed'); }
    finally { setActionLoading(false); }
  };

  const doApprove = async () => {
    setActionLoading(true);
    try {
      await api.put(`/admin/transactions/${modal.txn.id}/approve`);
      toast.success('Transaction approved — funds transferred');
      setModal(null); loadAll();
    } catch (err) { toast.error(err.response?.data?.error || 'Failed'); }
    finally { setActionLoading(false); }
  };

  const doReject = async () => {
    setActionLoading(true);
    try {
      await api.put(`/admin/transactions/${modal.txn.id}/reject`, { reason: modalInput });
      toast.success('Transaction rejected');
      setModal(null); setModalInput(''); loadAll();
    } catch (err) { toast.error(err.response?.data?.error || 'Failed'); }
    finally { setActionLoading(false); }
  };

  const doBlock = async () => {
    setActionLoading(true);
    try {
      await api.put(`/admin/accounts/${modal.account.id}/block`, { reason: modalInput || 'Admin action' });
      toast.success('Account blocked');
      setModal(null); setModalInput(''); loadAll();
    } catch (err) { toast.error(err.response?.data?.error || 'Failed'); }
    finally { setActionLoading(false); }
  };

  const doUnblock = async () => {
    setActionLoading(true);
    try {
      await api.put(`/admin/accounts/${modal.account.id}/unblock`);
      toast.success('Account unblocked');
      setModal(null); loadAll();
    } catch (err) { toast.error(err.response?.data?.error || 'Failed'); }
    finally { setActionLoading(false); }
  };

  if (loading) return <LoadingSpinner />;

  const TABS = [
    { key: 'overview', label: 'Overview', icon: TrendingUp },
    { key: 'pending',  label: `Pending${pending.length ? ` (${pending.length})` : ''}`, icon: Clock },
    { key: 'flagged',  label: `Flagged${flagged.length ? ` (${flagged.length})` : ''}`,  icon: ShieldAlert },
    { key: 'transactions', label: 'All Transactions', icon: ArrowLeftRight },
    { key: 'accounts', label: 'Accounts', icon: CreditCard },
    { key: 'customers', label: 'Customers', icon: Users },
  ];

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Admin Panel</h1>
        <p className="page-subtitle">Monitor, approve, flag, and manage all banking operations</p>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '6px', marginBottom: '28px', flexWrap: 'wrap' }}>
        {TABS.map(({ key, label, icon: Icon }) => (
          <button key={key} id={`admin-tab-${key}`}
            className={`btn ${tab === key ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setTab(key)}
            style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px' }}>
            <Icon size={15} />{label}
          </button>
        ))}
      </div>

      {/* ── Overview ─────────────────────────────────────────────── */}
      {tab === 'overview' && dashboard && (
        <>
          <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', marginBottom: '24px' }}>
            {[
              { icon: Users,       label: 'Customers',         value: dashboard.total_customers,    color: '#3b82f6' },
              { icon: CreditCard,  label: 'Accounts',          value: dashboard.total_accounts,     color: '#10b981' },
              { icon: ArrowLeftRight, label: 'Transactions',   value: dashboard.total_transactions, color: '#6366f1' },
              { icon: TrendingUp,  label: 'Total Balance',     value: formatINR(dashboard.total_balance), color: '#f59e0b' },
              { icon: Clock,       label: 'Pending Approvals', value: dashboard.pending_approvals,  color: '#f59e0b', alert: dashboard.pending_approvals > 0 },
              { icon: Flag,        label: 'Flagged Txns',      value: dashboard.flagged_transactions, color: '#ef4444', alert: dashboard.flagged_transactions > 0 },
              { icon: Lock,        label: 'Blocked Accounts',  value: dashboard.blocked_accounts,   color: '#8b5cf6', alert: dashboard.blocked_accounts > 0 },
            ].map(({ icon: Icon, label, value, color, alert }) => (
              <div key={label} className="stat-card" style={alert ? { borderColor: color } : {}}>
                <div className="stat-icon" style={{ background: color + '22' }}><Icon size={20} color={color} /></div>
                <div className="stat-value" style={{ fontSize: '24px' }}>{value}</div>
                <div className="stat-label">{label}</div>
              </div>
            ))}
          </div>

          {/* Quick alerts */}
          {dashboard.pending_approvals > 0 && (
            <div style={{ padding: '14px 18px', background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.3)', borderRadius: 'var(--radius-md)', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '12px' }}>
              <Clock size={18} color="#f59e0b" />
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, color: '#fbbf24' }}>{dashboard.pending_approvals} transaction{dashboard.pending_approvals > 1 ? 's' : ''} awaiting approval</div>
                <div style={{ fontSize: '12px', color: 'var(--txt-muted)', marginTop: '2px' }}>High-amount transfers submitted by customers require your review</div>
              </div>
              <button className="btn btn-sm" style={{ background: 'rgba(245,158,11,0.2)', color: '#fbbf24', border: '1px solid rgba(245,158,11,0.4)' }}
                onClick={() => setTab('pending')}>Review →</button>
            </div>
          )}
          {dashboard.flagged_transactions > 0 && (
            <div style={{ padding: '14px 18px', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: 'var(--radius-md)', display: 'flex', alignItems: 'center', gap: '12px' }}>
              <ShieldAlert size={18} color="#ef4444" />
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, color: '#f87171' }}>{dashboard.flagged_transactions} flagged transaction{dashboard.flagged_transactions > 1 ? 's' : ''}</div>
                <div style={{ fontSize: '12px', color: 'var(--txt-muted)', marginTop: '2px' }}>Marked as suspicious — review and take action</div>
              </div>
              <button className="btn btn-sm" style={{ background: 'rgba(239,68,68,0.12)', color: '#f87171', border: '1px solid rgba(239,68,68,0.25)' }}
                onClick={() => setTab('flagged')}>Review →</button>
            </div>
          )}
        </>
      )}

      {/* ── Pending Approvals ────────────────────────────────────── */}
      {tab === 'pending' && (
        <div className="card">
          <div className="section-header" style={{ marginBottom: '20px' }}>
            <h2 className="section-title">⏳ Pending Approvals</h2>
            <span style={{ fontSize: '13px', color: 'var(--txt-muted)' }}>High-amount transfers awaiting admin decision</span>
          </div>
          {pending.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '48px', color: 'var(--txt-muted)' }}>
              <CheckCircle size={40} style={{ marginBottom: 12, opacity: 0.4 }} />
              <div>No pending approvals. All clear!</div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {pending.map(txn => (
                <div key={txn.id} style={{ padding: '18px 20px', background: 'rgba(245,158,11,0.06)', border: '1px solid rgba(245,158,11,0.2)', borderRadius: 'var(--radius-md)' }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '16px', flexWrap: 'wrap' }}>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
                        <span style={{ fontWeight: 800, fontSize: '20px', color: '#fbbf24' }}>{formatINR(txn.amount)}</span>
                        <span className="badge badge-pending">HIGH AMOUNT</span>
                      </div>
                      <div style={{ fontSize: '13px', color: 'var(--txt-secondary)' }}>
                        <span style={{ fontWeight: 600 }}>{txn.from_customer_name}</span>
                        <span style={{ color: 'var(--txt-muted)', margin: '0 8px' }}>({txn.from_account_number})</span>
                        <span style={{ color: 'var(--txt-muted)' }}>→</span>
                        <span style={{ fontWeight: 600, marginLeft: 8 }}>{txn.to_customer_name || 'External'}</span>
                        <span style={{ color: 'var(--txt-muted)', marginLeft: 4 }}>({txn.to_account_number})</span>
                      </div>
                      <div style={{ fontSize: '12px', color: 'var(--txt-muted)', marginTop: '6px' }}>
                        Submitted: {formatDate(txn.created_at)} · TXN #{txn.id}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: '10px' }}>
                      <button className="btn" style={{ background: 'rgba(16,185,129,0.15)', color: '#34d399', border: '1px solid rgba(16,185,129,0.35)', gap: '6px' }}
                        onClick={() => setModal({ type: 'approve', txn })}>
                        <CheckCircle size={15} /> Approve
                      </button>
                      <button className="btn" style={{ background: 'rgba(239,68,68,0.12)', color: '#f87171', border: '1px solid rgba(239,68,68,0.3)', gap: '6px' }}
                        onClick={() => { setModal({ type: 'reject', txn }); setModalInput(''); }}>
                        <XCircle size={15} /> Reject
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Flagged Transactions ──────────────────────────────────── */}
      {tab === 'flagged' && (
        <div className="card">
          <div className="section-header" style={{ marginBottom: '20px' }}>
            <h2 className="section-title">🚩 Flagged Transactions</h2>
            <span style={{ fontSize: '13px', color: 'var(--txt-muted)' }}>Marked as suspicious — review and unflag or reverse</span>
          </div>
          {flagged.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '48px', color: 'var(--txt-muted)' }}>
              <Flag size={40} style={{ marginBottom: 12, opacity: 0.4 }} />
              <div>No flagged transactions</div>
            </div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead><tr><th>#</th><th>Type</th><th>Amount</th><th>From</th><th>To</th><th>Flag Reason</th><th>Status</th><th>Actions</th></tr></thead>
                <tbody>
                  {flagged.map(txn => (
                    <tr key={txn.id} style={{ background: 'rgba(239,68,68,0.04)' }}>
                      <td style={{ fontSize: '12px', color: 'var(--txt-muted)' }}>#{txn.id}</td>
                      <td><TypeBadge type={txn.transaction_type} /></td>
                      <td style={{ fontWeight: 700 }}>{formatINR(txn.amount)}</td>
                      <td style={{ fontSize: '12px' }}>{txn.from_customer_name || '—'}<br /><span style={{ fontFamily: 'monospace', color: 'var(--txt-muted)', fontSize: '10px' }}>{txn.from_account_number}</span></td>
                      <td style={{ fontSize: '12px' }}>{txn.to_customer_name || '—'}<br /><span style={{ fontFamily: 'monospace', color: 'var(--txt-muted)', fontSize: '10px' }}>{txn.to_account_number}</span></td>
                      <td style={{ fontSize: '12px', color: '#f87171', maxWidth: '200px' }}>{txn.flag_reason}</td>
                      <td><StatusBadge status={txn.status} /></td>
                      <td>
                        <div style={{ display: 'flex', gap: '6px' }}>
                          <button className="btn btn-sm" style={{ background: 'rgba(245,158,11,0.12)', color: '#fbbf24', border: '1px solid rgba(245,158,11,0.3)' }}
                            onClick={() => setModal({ type: 'unflag', txn })}>
                            <Flag size={12} /> Unflag
                          </button>
                          {txn.status === 'SUCCESS' && txn.transaction_type === 'TRANSFER' && (
                            <button className="btn btn-sm" style={{ background: 'rgba(99,102,241,0.12)', color: '#a5b4fc', border: '1px solid rgba(99,102,241,0.25)' }}
                              onClick={() => setModal({ type: 'reverse', txn })}>
                              <RotateCcw size={12} /> Reverse
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── All Transactions ──────────────────────────────────────── */}
      {tab === 'transactions' && (
        <div className="card">
          <h2 className="section-title" style={{ marginBottom: '16px' }}>All Transactions</h2>
          <div className="table-wrap">
            <table>
              <thead><tr><th>#</th><th>Type</th><th>Amount</th><th>From</th><th>To</th><th>Status</th><th>Date</th><th>Actions</th></tr></thead>
              <tbody>
                {txns.map(txn => (
                  <TxnRow key={txn.id} txn={txn}
                    onFlag={t => { setModal({ type: 'flag', txn: t }); setModalInput(''); }}
                    onUnflag={t => setModal({ type: 'unflag', txn: t })}
                    onReverse={t => setModal({ type: 'reverse', txn: t })}
                    onApprove={t => setModal({ type: 'approve', txn: t })}
                    onReject={t => { setModal({ type: 'reject', txn: t }); setModalInput(''); }}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Accounts ─────────────────────────────────────────────── */}
      {tab === 'accounts' && (
        <div className="card">
          <h2 className="section-title" style={{ marginBottom: '16px' }}>All Accounts</h2>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Account No.</th><th>Customer</th><th>Type</th><th>Balance</th><th>Status</th><th>Created</th><th>Actions</th></tr></thead>
              <tbody>
                {accounts.map(acc => (
                  <tr key={acc.id} style={{ background: acc.status === 'FROZEN' ? 'rgba(139,92,246,0.05)' : undefined }}>
                    <td style={{ fontFamily: 'monospace', fontSize: '13px' }}>{acc.account_number}</td>
                    <td>
                      <div style={{ fontWeight: 600, fontSize: '13px' }}>{acc.customer_name}</div>
                      <div style={{ fontSize: '11px', color: 'var(--txt-muted)' }}>{acc.customer_email}</div>
                    </td>
                    <td><span className="badge" style={{ background: 'rgba(59,130,246,0.12)', color: '#93c5fd' }}>{acc.account_type}</span></td>
                    <td style={{ fontWeight: 700, color: 'var(--clr-success)' }}>{formatINR(acc.balance)}</td>
                    <td>
                      <span className={`badge badge-${acc.status.toLowerCase()}`}>{acc.status}</span>
                    </td>
                    <td style={{ fontSize: '12px', color: 'var(--txt-muted)' }}>{new Date(acc.created_at).toLocaleDateString('en-IN')}</td>
                    <td>
                      {acc.status === 'ACTIVE' && (
                        <button className="btn btn-sm" style={{ background: 'rgba(139,92,246,0.12)', color: '#c4b5fd', border: '1px solid rgba(139,92,246,0.25)', gap: '5px' }}
                          onClick={() => { setModal({ type: 'block', account: acc }); setModalInput(''); }}>
                          <Lock size={12} /> Block
                        </button>
                      )}
                      {acc.status === 'FROZEN' && (
                        <button className="btn btn-sm" style={{ background: 'rgba(16,185,129,0.12)', color: '#6ee7b7', border: '1px solid rgba(16,185,129,0.25)', gap: '5px' }}
                          onClick={() => setModal({ type: 'unblock', account: acc })}>
                          <Unlock size={12} /> Unblock
                        </button>
                      )}
                      {acc.status === 'CLOSED' && <span style={{ fontSize: '12px', color: 'var(--txt-muted)' }}>Closed</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Customers ─────────────────────────────────────────────── */}
      {tab === 'customers' && (
        <div className="card">
          <h2 className="section-title" style={{ marginBottom: '16px' }}>All Customers</h2>
          <div className="table-wrap">
            <table>
              <thead><tr><th>ID</th><th>Name</th><th>Email</th><th>Phone</th><th>Role</th><th>Joined</th></tr></thead>
              <tbody>
                {customers.map(c => (
                  <tr key={c.id}>
                    <td style={{ color: 'var(--txt-muted)', fontSize: '12px' }}>#{c.id}</td>
                    <td style={{ fontWeight: 600 }}>{c.name}</td>
                    <td style={{ fontSize: '13px' }}>{c.email}</td>
                    <td style={{ fontSize: '13px', color: 'var(--txt-muted)' }}>{c.phone || '—'}</td>
                    <td><span className={`badge ${c.role === 'ADMIN' ? 'badge-reversed' : 'badge-success'}`}>{c.role}</span></td>
                    <td style={{ fontSize: '12px', color: 'var(--txt-muted)' }}>{new Date(c.created_at).toLocaleDateString('en-IN')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ─── Action Modals ─────────────────────────────────────────── */}

      {modal?.type === 'flag' && (
        <ConfirmModal title="🚩 Flag Transaction" danger
          message={`Flag transaction #${modal.txn.id} (${formatINR(modal.txn.amount)}) as suspicious?`}
          onConfirm={doFlag} onCancel={() => setModal(null)} confirmLabel={actionLoading ? 'Flagging…' : 'Flag Transaction'}>
          <div className="form-group">
            <label>Reason for flagging *</label>
            <input className="form-control" placeholder="e.g. Unusual transaction pattern, large unusual transfer…"
              value={modalInput} onChange={e => setModalInput(e.target.value)} autoFocus />
          </div>
        </ConfirmModal>
      )}

      {modal?.type === 'unflag' && (
        <ConfirmModal title="Remove Flag" message={`Remove the flag from transaction #${modal.txn.id}?`}
          onConfirm={doUnflag} onCancel={() => setModal(null)} confirmLabel={actionLoading ? 'Removing…' : 'Remove Flag'} />
      )}

      {modal?.type === 'reverse' && (
        <ConfirmModal title="↩️ Reverse Transaction" danger
          message={`Reverse transaction #${modal.txn.id}? This will move ${formatINR(modal.txn.amount)} back to the sender. A new reversal transaction will be created.`}
          onConfirm={doReverse} onCancel={() => setModal(null)} confirmLabel={actionLoading ? 'Reversing…' : 'Confirm Reversal'} />
      )}

      {modal?.type === 'approve' && (
        <ConfirmModal title="✅ Approve Transaction"
          message={`Approve transfer of ${formatINR(modal.txn.amount)} from ${modal.txn.from_customer_name} to ${modal.txn.to_customer_name}? Funds will be moved immediately.`}
          onConfirm={doApprove} onCancel={() => setModal(null)} confirmLabel={actionLoading ? 'Approving…' : 'Approve & Transfer'} />
      )}

      {modal?.type === 'reject' && (
        <ConfirmModal title="❌ Reject Transaction" danger
          message={`Reject transaction #${modal.txn.id} (${formatINR(modal.txn.amount)})? No funds will be moved.`}
          onConfirm={doReject} onCancel={() => setModal(null)} confirmLabel={actionLoading ? 'Rejecting…' : 'Reject Transaction'}>
          <div className="form-group">
            <label>Rejection reason (optional)</label>
            <input className="form-control" placeholder="e.g. Suspicious activity, compliance hold…"
              value={modalInput} onChange={e => setModalInput(e.target.value)} />
          </div>
        </ConfirmModal>
      )}

      {modal?.type === 'block' && (
        <ConfirmModal title="🔒 Block Account" danger
          message={`Block account ${modal.account.account_number} belonging to ${modal.account.customer_name}? All transactions will be prevented.`}
          onConfirm={doBlock} onCancel={() => setModal(null)} confirmLabel={actionLoading ? 'Blocking…' : 'Block Account'}>
          <div className="form-group">
            <label>Block reason (optional)</label>
            <input className="form-control" placeholder="e.g. Fraud suspected, compliance hold…"
              value={modalInput} onChange={e => setModalInput(e.target.value)} />
          </div>
        </ConfirmModal>
      )}

      {modal?.type === 'unblock' && (
        <ConfirmModal title="🔓 Unblock Account"
          message={`Unblock account ${modal.account.account_number}? Customer ${modal.account.customer_name} will regain full access.`}
          onConfirm={doUnblock} onCancel={() => setModal(null)} confirmLabel={actionLoading ? 'Unblocking…' : 'Unblock Account'} />
      )}
    </div>
  );
};

export default AdminPanel;
