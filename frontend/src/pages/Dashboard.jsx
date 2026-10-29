import React, { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import api from '../api/client';
import { formatCurrency, LoadingSpinner, StatusBadge, TypeBadge } from '../components/ui';
import { TrendingUp, CreditCard, ArrowLeftRight, ShieldCheck, Plus } from 'lucide-react';
import { Link } from 'react-router-dom';

const StatCard = ({ icon: Icon, label, value, color, sub }) => (
  <div className="stat-card">
    <div className="stat-icon" style={{ background: color + '22' }}>
      <Icon size={22} color={color} />
    </div>
    <div className="stat-value">{value}</div>
    <div className="stat-label">{label}</div>
    {sub && <div className="stat-change up">{sub}</div>}
  </div>
);

const Dashboard = () => {
  const { user } = useAuth();
  const [accounts, setAccounts]   = useState([]);
  const [recentTxns, setRecent]   = useState([]);
  const [loading, setLoading]     = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        const { data: accs } = await api.get('/accounts');
        setAccounts(accs);
        // Fetch recent txns for first account
        if (accs.length > 0) {
          const { data: txns } = await api.get(`/accounts/${accs[0].id}/transactions?page=0&size=5`);
          setRecent(txns.data || []);
        }
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const totalBalance   = accounts.reduce((s, a) => s + parseFloat(a.balance || 0), 0);
  const activeAccounts = accounts.filter(a => a.status === 'ACTIVE').length;

  if (loading) return <LoadingSpinner />;

  return (
    <div>
      {/* Header */}
      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <h1 className="page-title">Good morning, {user?.name?.split(' ')[0]} 👋</h1>
            <p className="page-subtitle">Here's your financial overview for today</p>
          </div>
          <Link to="/accounts" className="btn btn-primary">
            <Plus size={16} /> New Account
          </Link>
        </div>
      </div>

      {/* Stats */}
      <div className="stat-grid">
        <StatCard icon={TrendingUp}      label="Total Balance"       value={formatCurrency(totalBalance)}   color="#10b981" />
        <StatCard icon={CreditCard}      label="Active Accounts"     value={activeAccounts}                  color="#3b82f6" sub={`${accounts.length} total`} />
        <StatCard icon={ArrowLeftRight}  label="Recent Transactions"  value={recentTxns.length}               color="#6366f1" />
        <StatCard icon={ShieldCheck}     label="Account Status"      value="Secure"                          color="#f59e0b" />
      </div>

      {/* Account Cards Row */}
      <div className="section-header">
        <h2 className="section-title">Your Accounts</h2>
        <Link to="/accounts" className="btn btn-secondary btn-sm">View All</Link>
      </div>
      <div style={{ display: 'flex', gap: '20px', overflowX: 'auto', paddingBottom: '8px', marginBottom: '32px' }}>
        {accounts.length === 0 ? (
          <div className="card" style={{ flex: 1, textAlign: 'center', padding: '40px', color: 'var(--txt-muted)' }}>
            No accounts yet. <Link to="/accounts" style={{ color: 'var(--clr-primary-h)' }}>Create one →</Link>
          </div>
        ) : accounts.map(acc => (
          <div key={acc.id} className="account-card">
            <div className={`account-status-badge badge-${acc.status.toLowerCase()}`}>{acc.status}</div>
            <div className="account-number">•••• {acc.account_number?.slice(-4)}</div>
            <div className="account-balance-label">Available Balance</div>
            <div className="account-balance">{formatCurrency(acc.balance)}</div>
            <span className="account-type-badge">{acc.account_type}</span>
          </div>
        ))}
      </div>

      {/* Recent Transactions */}
      <div className="card">
        <div className="section-header">
          <h2 className="section-title">Recent Transactions</h2>
          <Link to="/transactions" className="btn btn-secondary btn-sm">View All</Link>
        </div>
        {recentTxns.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px', color: 'var(--txt-muted)', fontSize: '14px' }}>
            No transactions yet
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Type</th>
                  <th>Amount</th>
                  <th>Status</th>
                  <th>Date</th>
                </tr>
              </thead>
              <tbody>
                {recentTxns.map(txn => (
                  <tr key={txn.id}>
                    <td><TypeBadge type={txn.transaction_type} /></td>
                    <td style={{ fontWeight: 600, color: txn.transaction_type === 'DEPOSIT' ? 'var(--clr-success)' : 'var(--clr-danger)' }}>
                      {txn.transaction_type === 'DEPOSIT' ? '+' : '-'}{formatCurrency(txn.amount)}
                    </td>
                    <td><StatusBadge status={txn.status} /></td>
                    <td style={{ fontSize: '12px', color: 'var(--txt-muted)' }}>
                      {new Date(txn.created_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

export default Dashboard;
