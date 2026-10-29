import React, { useEffect, useState, useCallback } from 'react';
import api from '../api/client';
import { formatCurrency, LoadingSpinner, StatusBadge, TypeBadge, EmptyState } from '../components/ui';
import toast from 'react-hot-toast';
import { v4 as uuidv4 } from 'uuid';
import { ArrowDownLeft, ArrowUpRight, ArrowLeftRight, X, Loader2, Search, CheckCircle, AlertCircle, BookUser, ShieldCheck, Flag } from 'lucide-react';

const HIGH_AMOUNT_THRESHOLD = 25000;

/* ─── tiny debounce hook ─────────────────────────────────────── */
function useDebounce(value, delay) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

/* ─── Account Number Search Input ───────────────────────────── */
const AccountNumberSearch = ({ value, onChange, onResolve, beneficiaries }) => {
  const [status, setStatus]     = useState('idle'); // idle | loading | found | notfound
  const [resolved, setResolved] = useState(null);
  const [showBenes, setShowBenes] = useState(false);
  const debouncedVal = useDebounce(value, 500);

  // Live lookup when user types
  useEffect(() => {
    if (!debouncedVal || debouncedVal.length < 5) {
      setStatus('idle');
      setResolved(null);
      onResolve(null);
      return;
    }
    setStatus('loading');
    api.get(`/accounts/lookup?account_number=${encodeURIComponent(debouncedVal.trim())}`)
      .then(({ data }) => {
        setResolved(data);
        setStatus('found');
        onResolve(data);
      })
      .catch(() => {
        setResolved(null);
        setStatus('notfound');
        onResolve(null);
      });
  }, [debouncedVal]);

  // Quick-select a beneficiary
  const pickBeneficiary = (b) => {
    onChange(b.account_number);
    setShowBenes(false);
  };

  return (
    <div style={{ position: 'relative' }}>
      {/* Input row */}
      <div style={{ display: 'flex', gap: '8px' }}>
        <div style={{ position: 'relative', flex: 1 }}>
          <span style={{
            position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)',
            color: 'var(--txt-muted)', pointerEvents: 'none',
          }}>
            <Search size={15} />
          </span>
          <input
            id="transfer-to-account"
            type="text"
            className="form-control"
            placeholder="e.g. ACC1000000003"
            value={value}
            onChange={e => onChange(e.target.value.toUpperCase())}
            style={{ paddingLeft: '38px', paddingRight: status !== 'idle' ? '38px' : '14px', fontFamily: 'monospace', letterSpacing: '0.5px' }}
            autoComplete="off"
          />
          {/* Status icon */}
          {status === 'loading' && (
            <span style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)' }}>
              <Loader2 size={16} color="var(--txt-muted)" style={{ animation: 'spin 0.7s linear infinite' }} />
            </span>
          )}
          {status === 'found' && (
            <span style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)' }}>
              <CheckCircle size={16} color="var(--clr-success)" />
            </span>
          )}
          {status === 'notfound' && (
            <span style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)' }}>
              <AlertCircle size={16} color="var(--clr-danger)" />
            </span>
          )}
        </div>

        {/* Beneficiaries picker button */}
        {beneficiaries.length > 0 && (
          <button type="button" className="btn btn-secondary" title="Pick from saved beneficiaries"
            onClick={() => setShowBenes(p => !p)}
            style={{ padding: '10px 14px', flexShrink: 0 }}>
            <BookUser size={16} />
          </button>
        )}
      </div>

      {/* Beneficiaries dropdown */}
      {showBenes && (
        <div style={{
          position: 'absolute', top: '44px', left: 0, right: 0, zIndex: 50,
          background: 'var(--clr-surface-2)', border: '1px solid var(--clr-border-2)',
          borderRadius: 'var(--radius-md)', overflow: 'hidden', boxShadow: 'var(--shadow-md)',
        }}>
          <div style={{ padding: '8px 12px', fontSize: '11px', color: 'var(--txt-muted)', borderBottom: '1px solid var(--clr-border)', textTransform: 'uppercase', letterSpacing: '0.8px' }}>
            Saved Beneficiaries
          </div>
          {beneficiaries.map(b => (
            <div key={b.id} onClick={() => pickBeneficiary(b)}
              style={{
                padding: '10px 14px', cursor: 'pointer', display: 'flex', gap: '10px', alignItems: 'center',
                transition: 'background 0.15s',
              }}
              onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
            >
              <div style={{
                width: 32, height: 32, borderRadius: '50%', background: 'var(--grad-primary)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: '13px', flexShrink: 0,
              }}>
                {b.account_holder_name?.[0]?.toUpperCase()}
              </div>
              <div>
                <div style={{ fontSize: '13px', fontWeight: 600 }}>{b.nickname || b.account_holder_name}</div>
                <div style={{ fontSize: '11px', fontFamily: 'monospace', color: 'var(--txt-muted)' }}>{b.account_number}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Resolved account preview */}
      {status === 'found' && resolved && (
        <div style={{
          marginTop: '8px', padding: '10px 14px', background: 'rgba(16,185,129,0.08)',
          border: '1px solid rgba(16,185,129,0.2)', borderRadius: 'var(--radius-sm)',
          display: 'flex', alignItems: 'center', gap: '10px',
        }}>
          <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'var(--grad-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: '13px', flexShrink: 0 }}>
            {resolved.holder_name?.[0]?.toUpperCase()}
          </div>
          <div>
            <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--clr-success)' }}>{resolved.holder_name}</div>
            <div style={{ fontSize: '11px', color: 'var(--txt-muted)' }}>{resolved.account_type} · {resolved.status}</div>
          </div>
          <div style={{ marginLeft: 'auto', fontSize: '11px', color: 'var(--txt-muted)' }}>ID #{resolved.id}</div>
        </div>
      )}
      {status === 'notfound' && debouncedVal.length >= 5 && (
        <div style={{ marginTop: '8px', padding: '8px 14px', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 'var(--radius-sm)', fontSize: '13px', color: 'var(--clr-danger)' }}>
          ✗ Account number not found. Check and try again.
        </div>
      )}
    </div>
  );
};

/* ─── Main Transactions Page ─────────────────────────────────── */
const OPERATIONS = [
  { key: 'deposit',  label: 'Deposit',  icon: ArrowDownLeft,  color: '#10b981' },
  { key: 'withdraw', label: 'Withdraw', icon: ArrowUpRight,   color: '#ef4444' },
  { key: 'transfer', label: 'Transfer', icon: ArrowLeftRight, color: '#3b82f6' },
];

const Transactions = () => {
  const [accounts, setAccounts]     = useState([]);
  const [beneficiaries, setBenes]   = useState([]);
  const [txns, setTxns]             = useState([]);
  const [loading, setLoading]       = useState(true);
  const [activeOp, setActiveOp]     = useState(null);
  const [submitting, setSubmit]     = useState(false);
  const [page, setPage]             = useState(0);
  const [pagination, setPagination] = useState({});
  const [filters, setFilters]       = useState({ type: '', status: '' });
  const [selectedAcc, setSelAcc]    = useState('');
  const [flaggedBanner, setFlaggedBanner] = useState([]); // flagged txns visible to user

  // Transfer: store the typed account number + resolved ID separately
  const [toAccNumber, setToAccNumber]   = useState('');
  const [resolvedToAcc, setResolvedToAcc] = useState(null);

  // OTP flow for high-amount transfers
  const [otpModal, setOtpModal]         = useState(false);
  const [otpCode, setOtpCode]           = useState('');
  const [demoOtp, setDemoOtp]           = useState('');   // shown on screen (demo)
  const [otpSubmitting, setOtpSubmit]   = useState(false);
  const [pendingPayload, setPendingPayload] = useState(null);

  const [form, setForm] = useState({
    account_id: '', amount: '', idempotency_key: uuidv4(),
  });

  /* ── load accounts + beneficiaries ── */
  useEffect(() => {
    const init = async () => {
      try {
        const [{ data: accs }, { data: benes }] = await Promise.all([
          api.get('/accounts'),
          api.get('/beneficiaries'),
        ]);
        setAccounts(accs);
        setBenes(benes);
        if (accs.length > 0) {
          setSelAcc(accs[0].id);
          setForm(f => ({ ...f, account_id: accs[0].id }));
        }
      } catch { /* handled below */ }
      finally { setLoading(false); }
    };
    init();
  }, []);

  /* ── load transactions ── */
  const loadTxns = useCallback(async (acc, pg = 0) => {
    if (!acc) return;
    try {
      const params = new URLSearchParams({ page: pg, size: 10, ...filters });
      const { data } = await api.get(`/accounts/${acc}/transactions?${params}`);
      const rows = data.data || [];
      setTxns(rows);
      setPagination(data.pagination || {});
      // Collect any flagged transactions to surface as banner alerts
      const flagged = rows.filter(t => t.flagged);
      if (pg === 0) setFlaggedBanner(flagged);
    } catch { toast.error('Failed to load transactions'); }
  }, [filters]);

  useEffect(() => { if (selectedAcc) loadTxns(selectedAcc, page); }, [selectedAcc, page, filters, loadTxns]);

  /* ── open operation panel ── */
  const openOp = (key) => {
    setActiveOp(key);
    setToAccNumber('');
    setResolvedToAcc(null);
    setForm(f => ({ ...f, amount: '', idempotency_key: uuidv4() }));
  };

  /* ── submit form ── */
  const handleSubmit = async (e) => {
    e.preventDefault();

    if (activeOp === 'transfer') {
      if (!resolvedToAcc) { toast.error('Please enter a valid destination account number'); return; }
      if (resolvedToAcc.status !== 'ACTIVE') { toast.error(`Destination account is ${resolvedToAcc.status}`); return; }
      if (resolvedToAcc.id === parseInt(form.account_id)) { toast.error('Source and destination accounts cannot be the same'); return; }

      // HIGH-AMOUNT: trigger OTP flow instead of direct transfer
      if (parseFloat(form.amount) >= HIGH_AMOUNT_THRESHOLD) {
        setSubmit(true);
        try {
          const payload = {
            from_account_id: parseInt(form.account_id),
            to_account_id:   resolvedToAcc.id,
            amount:          parseFloat(form.amount),
            idempotency_key: form.idempotency_key,
          };
          const { data } = await api.post('/transactions/request-otp', payload);
          setDemoOtp(data.otp);
          setPendingPayload(payload);
          setOtpCode('');
          setOtpModal(true);
          toast(`OTP sent! (Demo: ${data.otp})`, { icon: '🔐', duration: 8000 });
        } catch (err) {
          toast.error(err.response?.data?.error || 'Failed to generate OTP');
        } finally { setSubmit(false); }
        return;
      }
    }

    setSubmit(true);
    try {
      let endpoint, payload;
      if (activeOp === 'deposit') {
        endpoint = '/transactions/deposit';
        payload  = { account_id: parseInt(form.account_id), amount: parseFloat(form.amount), idempotency_key: form.idempotency_key };
      } else if (activeOp === 'withdraw') {
        endpoint = '/transactions/withdraw';
        payload  = { account_id: parseInt(form.account_id), amount: parseFloat(form.amount), idempotency_key: form.idempotency_key };
      } else {
        endpoint = '/transactions/transfer';
        payload  = { from_account_id: parseInt(form.account_id), to_account_id: resolvedToAcc.id, amount: parseFloat(form.amount), idempotency_key: form.idempotency_key };
      }
      await api.post(endpoint, payload);
      toast.success(`${activeOp.charAt(0).toUpperCase() + activeOp.slice(1)} successful! 🎉`);
      setActiveOp(null); setToAccNumber(''); setResolvedToAcc(null);
      setForm(f => ({ ...f, amount: '', idempotency_key: uuidv4() }));
      loadTxns(selectedAcc, 0);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Transaction failed');
    } finally { setSubmit(false); }
  };

  /* ── OTP verification submit ── */
  const handleOtpSubmit = async (e) => {
    e.preventDefault();
    if (!otpCode.trim()) { toast.error('Please enter the OTP'); return; }
    setOtpSubmit(true);
    try {
      const { data } = await api.post('/transactions/verify-otp', { otp: otpCode });
      toast.success('OTP verified! Transfer submitted for admin approval 🎉');
      setOtpModal(false); setOtpCode(''); setDemoOtp(''); setPendingPayload(null);
      setActiveOp(null); setToAccNumber(''); setResolvedToAcc(null);
      setForm(f => ({ ...f, amount: '', idempotency_key: uuidv4() }));
      loadTxns(selectedAcc, 0);
    } catch (err) {
      toast.error(err.response?.data?.error || 'OTP verification failed');
    } finally { setOtpSubmit(false); }
  };

  if (loading) return <LoadingSpinner />;

  const activeAccount = accounts.find(a => a.id === parseInt(form.account_id));

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Transactions</h1>
        <p className="page-subtitle">Deposit, withdraw, and transfer funds securely</p>
      </div>

      {/* ── Flagged Transaction Alert Banner ── */}
      {flaggedBanner.length > 0 && (
        <div style={{
          marginBottom: '20px',
          padding: '14px 18px',
          background: 'rgba(239,68,68,0.08)',
          border: '1px solid rgba(239,68,68,0.3)',
          borderRadius: 'var(--radius-md)',
          display: 'flex',
          alignItems: 'flex-start',
          gap: '12px',
        }}>
          <Flag size={18} color="#f87171" style={{ flexShrink: 0, marginTop: '2px' }} />
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, color: '#f87171', marginBottom: '6px', fontSize: '14px' }}>
              ⚠️ {flaggedBanner.length} transaction{flaggedBanner.length > 1 ? 's have' : ' has'} been flagged by our security team
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {flaggedBanner.map(t => (
                <div key={t.id} style={{ fontSize: '13px', color: 'var(--txt-secondary)' }}>
                  <span style={{ fontFamily: 'monospace', color: 'var(--txt-primary)' }}>#{t.id}</span>
                  {' '}·{' '}
                  <span style={{ textTransform: 'capitalize', color: '#fca5a5' }}>{t.transaction_type.toLowerCase()}</span>
                  {' of '}₹{parseFloat(t.amount).toLocaleString('en-IN')}
                  {t.flag_reason && (
                    <span style={{ color: 'var(--txt-muted)' }}> — {t.flag_reason}</span>
                  )}
                </div>
              ))}
            </div>
            <div style={{ marginTop: '8px', fontSize: '12px', color: 'var(--txt-muted)' }}>
              Please contact support if you believe this is an error.
            </div>
          </div>
          <button
            onClick={() => setFlaggedBanner([])}
            style={{ background: 'none', border: 'none', color: 'var(--txt-muted)', cursor: 'pointer', padding: '2px', flexShrink: 0 }}
            title="Dismiss"
          >
            <X size={16} />
          </button>
        </div>
      )}

      {/* Operation selector cards */}
      <div style={{ display: 'flex', gap: '16px', marginBottom: '28px', flexWrap: 'wrap' }}>
        {OPERATIONS.map(({ key, label, icon: Icon, color }) => (
          <button
            key={key}
            id={`op-${key}`}
            onClick={() => openOp(key)}
            style={{
              flex: '1', minWidth: '160px', cursor: 'pointer', display: 'flex', alignItems: 'center',
              gap: '12px', padding: '18px 20px', background: activeOp === key ? `${color}18` : 'var(--clr-surface)',
              border: `1px solid ${activeOp === key ? color : 'var(--clr-border)'}`,
              borderRadius: 'var(--radius-lg)', transition: 'all 0.2s',
            }}
          >
            <div style={{ width: 44, height: 44, borderRadius: '12px', background: `${color}22`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <Icon size={22} color={color} />
            </div>
            <div style={{ textAlign: 'left' }}>
              <div style={{ fontWeight: 700, fontSize: '15px', color: activeOp === key ? color : 'var(--txt-primary)' }}>{label}</div>
              <div style={{ fontSize: '12px', color: 'var(--txt-muted)', marginTop: '2px' }}>
                {key === 'deposit' ? 'Add funds to account' : key === 'withdraw' ? 'Withdraw cash' : 'Send to any account'}
              </div>
            </div>
          </button>
        ))}
      </div>

      {/* Operation form */}
      {activeOp && (
        <div className="card" style={{ marginBottom: '28px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '24px' }}>
            <h2 className="section-title" style={{ textTransform: 'capitalize' }}>
              {activeOp === 'deposit' ? '⬇️' : activeOp === 'withdraw' ? '⬆️' : '↔️'} {activeOp} Funds
            </h2>
            <button className="modal-close" onClick={() => setActiveOp(null)}><X size={20} /></button>
          </div>

          <form onSubmit={handleSubmit}>
            <div className={activeOp === 'transfer' ? '' : 'grid-2'}>

              {/* Source account selector */}
              <div className="form-group">
                <label>{activeOp === 'transfer' ? 'From Account (yours)' : 'Account'}</label>
                <select className="form-control" value={form.account_id}
                  onChange={e => setForm({ ...form, account_id: e.target.value })} required>
                  {accounts.filter(a => a.status === 'ACTIVE').map(a => (
                    <option key={a.id} value={a.id}>
                      {a.account_number} — {a.account_type} ({formatCurrency(a.balance)})
                    </option>
                  ))}
                </select>
                {activeAccount && (
                  <div style={{ marginTop: '6px', fontSize: '12px', color: 'var(--txt-muted)' }}>
                    Available: <span style={{ color: 'var(--clr-success)', fontWeight: 600 }}>{formatCurrency(activeAccount.balance)}</span>
                  </div>
                )}
              </div>

              {/* Transfer: destination account number lookup */}
              {activeOp === 'transfer' && (
                <div className="form-group" style={{ marginTop: '4px' }}>
                  <label>To Account Number
                    <span style={{ marginLeft: '8px', fontSize: '11px', fontWeight: 400, color: 'var(--txt-muted)' }}>
                      (type account number, e.g. ACC1000000003)
                    </span>
                  </label>
                  <AccountNumberSearch
                    value={toAccNumber}
                    onChange={setToAccNumber}
                    onResolve={setResolvedToAcc}
                    beneficiaries={beneficiaries}
                  />
                </div>
              )}

              {/* Amount */}
              <div className="form-group" style={activeOp === 'transfer' ? { marginTop: '4px' } : {}}>
                <label>Amount (₹)</label>
                <div style={{ position: 'relative' }}>
                  <span style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--txt-muted)', fontSize: '15px', fontWeight: 600, pointerEvents: 'none' }}>₹</span>
                  <input
                    id={`amount-${activeOp}`}
                    type="number"
                    className="form-control"
                    placeholder="0.00"
                    min="0.01"
                    step="0.01"
                    value={form.amount}
                    onChange={e => setForm({ ...form, amount: e.target.value })}
                    required
                    style={{ paddingLeft: '30px' }}
                  />
                </div>
              </div>
            </div>

            {/* Idempotency key */}
            <div className="form-group">
              <label style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                Idempotency Key
                <span style={{ fontSize: '11px', fontWeight: 400, color: 'var(--txt-muted)' }}>— auto-generated, prevents duplicate charges on retry</span>
              </label>
              <input type="text" className="form-control" value={form.idempotency_key} readOnly
                style={{ fontFamily: 'monospace', fontSize: '12px', color: 'var(--txt-muted)', cursor: 'default' }} />
            </div>

            {/* Transfer summary */}
            {activeOp === 'transfer' && resolvedToAcc && form.amount && (
              <div style={{
                padding: '14px 16px', background: 'rgba(59,130,246,0.06)', border: '1px solid rgba(59,130,246,0.2)',
                borderRadius: 'var(--radius-md)', marginBottom: '20px', fontSize: '13px',
              }}>
                <div style={{ fontWeight: 600, marginBottom: '6px', color: 'var(--clr-primary-h)' }}>Transfer Summary</div>
                <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--txt-muted)' }}>
                  <span>From</span>
                  <span style={{ color: 'var(--txt-primary)', fontFamily: 'monospace' }}>{accounts.find(a => a.id === parseInt(form.account_id))?.account_number}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--txt-muted)', marginTop: '4px' }}>
                  <span>To</span>
                  <span style={{ color: 'var(--txt-primary)' }}>{resolvedToAcc.holder_name} ({resolvedToAcc.account_number})</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '8px', paddingTop: '8px', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                  <span style={{ fontWeight: 700, color: 'var(--txt-primary)' }}>Amount</span>
                  <span style={{ fontWeight: 800, color: 'var(--clr-primary-h)', fontSize: '15px' }}>{formatCurrency(parseFloat(form.amount) || 0)}</span>
                </div>
              </div>
            )}

            {/* Submit */}
            <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
              <button type="button" className="btn btn-secondary" onClick={() => setActiveOp(null)}>Cancel</button>
              <button
                id={`submit-${activeOp}`}
                type="submit"
                className="btn btn-primary btn-lg"
                style={{ minWidth: '200px' }}
                disabled={submitting || (activeOp === 'transfer' && !resolvedToAcc)}
              >
                {submitting
                  ? <><Loader2 size={18} /> Processing…</>
                  : `Confirm ${activeOp.charAt(0).toUpperCase() + activeOp.slice(1)}`}
              </button>
              {activeOp === 'transfer' && !resolvedToAcc && (
                <span style={{ fontSize: '12px', color: 'var(--txt-muted)' }}>Enter a valid destination account number to proceed</span>
              )}
            </div>
          </form>
        </div>
      )}

      {/* Transaction History */}
      <div className="card">
        <div className="section-header">
          <h2 className="section-title">Transaction History</h2>
          <select className="form-control" style={{ width: 'auto', minWidth: '220px' }} value={selectedAcc}
            onChange={e => { setSelAcc(e.target.value); setPage(0); }}>
            {accounts.map(a => <option key={a.id} value={a.id}>{a.account_number}</option>)}
          </select>
        </div>

        {/* Filters */}
        <div className="filter-bar">
          <select className="form-control" value={filters.type}
            onChange={e => { setFilters({ ...filters, type: e.target.value }); setPage(0); }}>
            <option value="">All Types</option>
            <option value="DEPOSIT">Deposit</option>
            <option value="WITHDRAWAL">Withdrawal</option>
            <option value="TRANSFER">Transfer</option>
          </select>
          <select className="form-control" value={filters.status}
            onChange={e => { setFilters({ ...filters, status: e.target.value }); setPage(0); }}>
            <option value="">All Statuses</option>
            <option value="SUCCESS">Success</option>
            <option value="PENDING_APPROVAL">Pending Approval</option>
            <option value="PENDING">Pending</option>
            <option value="FAILED">Failed</option>
            <option value="REVERSED">Reversed</option>
          </select>
        </div>

        {txns.length === 0 ? (
          <EmptyState icon="📋" title="No transactions found" description="Start by making a deposit." />
        ) : (
          <>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>#</th><th>Type</th><th>Amount</th><th>From</th><th>To</th><th>Status</th><th>Flag</th><th>Date</th></tr>
                </thead>
                <tbody>
                  {txns.map(txn => {
                    const isCredit = txn.to_account_id === parseInt(selectedAcc);
                    return (
                      <tr key={txn.id}>
                        <td style={{ color: 'var(--txt-muted)', fontSize: '12px' }}>#{txn.id}</td>
                        <td><TypeBadge type={txn.transaction_type} /></td>
                        <td style={{ fontWeight: 700, color: isCredit || txn.transaction_type === 'DEPOSIT' ? 'var(--clr-success)' : 'var(--clr-danger)' }}>
                          {isCredit || txn.transaction_type === 'DEPOSIT' ? '+' : '-'}{formatCurrency(txn.amount)}
                        </td>
                        <td style={{ fontSize: '12px', fontFamily: 'monospace', color: 'var(--txt-muted)' }}>{txn.from_account_number || '—'}</td>
                        <td style={{ fontSize: '12px', fontFamily: 'monospace', color: 'var(--txt-muted)' }}>{txn.to_account_number   || '—'}</td>
                        <td><StatusBadge status={txn.status} /></td>
                        <td>
                          {txn.flagged ? (
                            <span
                              title={txn.flag_reason || 'Flagged by admin'}
                              style={{
                                display: 'inline-flex', alignItems: 'center', gap: '4px',
                                padding: '2px 8px', borderRadius: '20px', fontSize: '11px', fontWeight: 600,
                                background: 'rgba(239,68,68,0.15)', color: '#f87171',
                                cursor: 'help',
                              }}
                            >
                              <Flag size={11} /> Flagged
                            </span>
                          ) : (
                            <span style={{ color: 'var(--txt-muted)', fontSize: '12px' }}>—</span>
                          )}
                        </td>
                        <td style={{ fontSize: '12px', color: 'var(--txt-muted)' }}>
                          {new Date(txn.created_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}
                        </td>
                      </tr>

                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {pagination.totalPages > 1 && (
              <div className="pagination">
                <button className="page-btn" disabled={page === 0} onClick={() => setPage(p => p - 1)}>‹</button>
                {Array.from({ length: pagination.totalPages }, (_, i) => (
                  <button key={i} className={`page-btn${i === page ? ' active' : ''}`} onClick={() => setPage(i)}>{i + 1}</button>
                ))}
                <button className="page-btn" disabled={page >= pagination.totalPages - 1} onClick={() => setPage(p => p + 1)}>›</button>
              </div>
            )}
          </>
        )}
      </div>

      {/* ── OTP Verification Modal ─── */}
      {otpModal && (
        <div className="modal-overlay">
          <div className="modal" style={{ maxWidth: 420 }}>
            <div className="modal-header">
              <h2 className="modal-title">🔐 OTP Verification Required</h2>
            </div>
            <div style={{ padding: '14px 18px', background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.25)', borderRadius: 'var(--radius-md)', marginBottom: '20px' }}>
              <div style={{ fontWeight: 600, color: '#fbbf24', marginBottom: '6px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <ShieldCheck size={16} /> High-Value Transfer
              </div>
              <div style={{ fontSize: '13px', color: 'var(--txt-secondary)' }}>
                Transfers ≥ ₹{HIGH_AMOUNT_THRESHOLD.toLocaleString('en-IN')} require OTP verification and admin approval before funds move.
              </div>
            </div>

            {demoOtp && (
              <div style={{ padding: '12px 16px', background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.2)', borderRadius: 'var(--radius-md)', marginBottom: '20px', textAlign: 'center' }}>
                <div style={{ fontSize: '11px', color: 'var(--txt-muted)', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '1px' }}>Demo OTP (would be sent via SMS)</div>
                <div style={{ fontSize: '32px', fontWeight: 800, fontFamily: 'monospace', letterSpacing: '8px', color: 'var(--clr-success)' }}>{demoOtp}</div>
                <div style={{ fontSize: '11px', color: 'var(--txt-muted)', marginTop: '6px' }}>Valid for 5 minutes</div>
              </div>
            )}

            <form onSubmit={handleOtpSubmit}>
              <div className="form-group">
                <label>Enter 6-digit OTP</label>
                <input
                  id="otp-input"
                  type="text"
                  className="form-control"
                  placeholder="_ _ _ _ _ _"
                  maxLength={6}
                  value={otpCode}
                  onChange={e => setOtpCode(e.target.value.replace(/\D/g, ''))}
                  style={{ textAlign: 'center', fontSize: '24px', fontFamily: 'monospace', letterSpacing: '8px', fontWeight: 700 }}
                  autoFocus
                />
              </div>
              <div style={{ display: 'flex', gap: '12px', marginTop: '8px' }}>
                <button type="button" className="btn btn-secondary" style={{ flex: 1 }}
                  onClick={() => { setOtpModal(false); setOtpCode(''); setDemoOtp(''); }}>
                  Cancel
                </button>
                <button id="otp-verify-btn" type="submit" className="btn btn-primary" style={{ flex: 2 }} disabled={otpSubmitting || otpCode.length !== 6}>
                  {otpSubmitting ? <><Loader2 size={16} /> Verifying…</> : 'Verify & Submit'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default Transactions;
