import React, { useEffect, useState } from 'react';
import api from '../api/client';
import { LoadingSpinner, EmptyState, formatCurrency } from '../components/ui';
import toast from 'react-hot-toast';
import { Plus, Trash2, X, Loader2 } from 'lucide-react';

const Beneficiaries = () => {
  const [beneficiaries, setBeneficiaries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setModal] = useState(false);
  const [form, setForm] = useState({ account_id: '', nickname: '' });
  const [saving, setSaving] = useState(false);

  const load = async () => {
    try {
      const { data } = await api.get('/beneficiaries');
      setBeneficiaries(data);
    } catch { toast.error('Failed to load beneficiaries'); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const addBeneficiary = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post('/beneficiaries', { account_id: parseInt(form.account_id), nickname: form.nickname });
      toast.success('Beneficiary added successfully!');
      setModal(false);
      setForm({ account_id: '', nickname: '' });
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to add beneficiary');
    } finally { setSaving(false); }
  };

  const removeBeneficiary = async (id) => {
    if (!confirm('Remove this beneficiary?')) return;
    try {
      await api.delete(`/beneficiaries/${id}`);
      toast.success('Beneficiary removed');
      load();
    } catch { toast.error('Failed to remove beneficiary'); }
  };

  if (loading) return <LoadingSpinner />;

  return (
    <div>
      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <h1 className="page-title">Beneficiaries</h1>
            <p className="page-subtitle">Manage saved accounts for quick transfers</p>
          </div>
          <button id="add-beneficiary-btn" className="btn btn-primary" onClick={() => setModal(true)}>
            <Plus size={16} /> Add Beneficiary
          </button>
        </div>
      </div>

      {beneficiaries.length === 0 ? (
        <EmptyState icon="👥" title="No beneficiaries" description="Add accounts you frequently transfer to for quick access." />
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '16px' }}>
          {beneficiaries.map(b => (
            <div key={b.id} className="card" style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
              <div style={{
                width: 48, height: 48, borderRadius: '50%',
                background: 'var(--grad-primary)', display: 'flex',
                alignItems: 'center', justifyContent: 'center',
                fontWeight: 700, fontSize: '18px', flexShrink: 0,
              }}>
                {b.account_holder_name?.[0]?.toUpperCase() || '?'}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: '15px' }}>
                  {b.nickname || b.account_holder_name}
                </div>
                <div style={{ fontSize: '12px', color: 'var(--txt-muted)', fontFamily: 'monospace' }}>
                  {b.account_number}
                </div>
                <div style={{ fontSize: '11px', color: 'var(--txt-muted)', marginTop: '2px' }}>
                  {b.account_type} · {b.account_holder_name}
                </div>
              </div>
              <button className="btn btn-danger btn-sm" onClick={() => removeBeneficiary(b.id)} title="Remove">
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      )}

      {showModal && (
        <div className="modal-overlay" onClick={() => setModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="modal-title">Add Beneficiary</h2>
              <button className="modal-close" onClick={() => setModal(false)}><X size={20} /></button>
            </div>
            <form onSubmit={addBeneficiary}>
              <div className="form-group">
                <label htmlFor="bene-account-id">Account ID</label>
                <input id="bene-account-id" type="number" className="form-control"
                  placeholder="Enter the account ID to save"
                  value={form.account_id} onChange={e => setForm({ ...form, account_id: e.target.value })} required />
              </div>
              <div className="form-group">
                <label htmlFor="bene-nickname">Nickname (optional)</label>
                <input id="bene-nickname" type="text" className="form-control"
                  placeholder="e.g. Mom's Savings"
                  value={form.nickname} onChange={e => setForm({ ...form, nickname: e.target.value })} />
              </div>
              <div style={{ display: 'flex', gap: '12px' }}>
                <button type="button" className="btn btn-secondary" style={{ flex: 1 }} onClick={() => setModal(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary" style={{ flex: 2 }} disabled={saving}>
                  {saving ? <><Loader2 size={16} /> Saving…</> : 'Add Beneficiary'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default Beneficiaries;
