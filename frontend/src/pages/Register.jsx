import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import toast from 'react-hot-toast';
import { Loader2 } from 'lucide-react';

const Register = () => {
  const { register } = useAuth();
  const navigate     = useNavigate();
  const [form, setForm]       = useState({ name: '', email: '', phone: '', password: '', confirmPassword: '' });
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (form.password !== form.confirmPassword) {
      return toast.error('Passwords do not match');
    }
    setLoading(true);
    try {
      await register({ name: form.name, email: form.email, phone: form.phone, password: form.password });
      toast.success('Account created! Welcome aboard 🎉');
      navigate('/dashboard');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Registration failed');
    } finally {
      setLoading(false);
    }
  };

  const update = (field) => (e) => setForm({ ...form, [field]: e.target.value });

  return (
    <div className="auth-page">
      <div className="auth-bg" />
      <div className="auth-card" style={{ maxWidth: '480px' }}>
        <div className="auth-logo">
          <div className="auth-logo-icon">🏦</div>
          <h1 className="auth-title">Create Account</h1>
          <p className="auth-subtitle">Join Mini Banking System</p>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="grid-2">
            <div className="form-group">
              <label htmlFor="reg-name">Full Name</label>
              <input id="reg-name" type="text" className="form-control" placeholder="Ananya Sharma"
                value={form.name} onChange={update('name')} required />
            </div>
            <div className="form-group">
              <label htmlFor="reg-phone">Phone</label>
              <input id="reg-phone" type="tel" className="form-control" placeholder="9876543210"
                value={form.phone} onChange={update('phone')} />
            </div>
          </div>

          <div className="form-group">
            <label htmlFor="reg-email">Email Address</label>
            <input id="reg-email" type="email" className="form-control" placeholder="you@example.com"
              value={form.email} onChange={update('email')} required />
          </div>

          <div className="grid-2">
            <div className="form-group">
              <label htmlFor="reg-pw">Password</label>
              <input id="reg-pw" type="password" className="form-control" placeholder="Min 6 chars"
                value={form.password} onChange={update('password')} required minLength={6} />
            </div>
            <div className="form-group">
              <label htmlFor="reg-cpw">Confirm Password</label>
              <input id="reg-cpw" type="password" className="form-control" placeholder="Repeat password"
                value={form.confirmPassword} onChange={update('confirmPassword')} required />
            </div>
          </div>

          <button id="register-submit" type="submit" className="btn btn-primary btn-full btn-lg" disabled={loading}>
            {loading ? <><Loader2 size={18} /> Creating account…</> : 'Create Account'}
          </button>
        </form>

        <div className="auth-link">
          Already have an account? <Link to="/login">Sign in</Link>
        </div>
      </div>
    </div>
  );
};

export default Register;
