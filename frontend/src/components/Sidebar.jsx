import React from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import {
  LayoutDashboard, CreditCard, ArrowLeftRight,
  Users, BookUser, ShieldCheck, LogOut, Banknote
} from 'lucide-react';

const NavItem = ({ to, icon: Icon, label }) => (
  <NavLink
    to={to}
    className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
  >
    <Icon size={18} />
    {label}
  </NavLink>
);

const Sidebar = () => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const initials = user?.name?.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2) || 'U';

  return (
    <aside className="sidebar">
      <div className="sidebar-logo">
        <div className="sidebar-logo-icon">🏦</div>
        <div className="sidebar-logo-text">
          MiniBanking
          <span>Digital Finance</span>
        </div>
      </div>

      <div className="nav-section-label">Main</div>
      <NavItem to="/dashboard"     icon={LayoutDashboard}  label="Dashboard" />
      <NavItem to="/accounts"      icon={CreditCard}        label="Accounts" />
      <NavItem to="/transactions"  icon={ArrowLeftRight}    label="Transactions" />
      <NavItem to="/beneficiaries" icon={BookUser}          label="Beneficiaries" />
      <NavItem to="/customers"     icon={Users}             label="Customers" />

      {user?.role === 'ADMIN' && (
        <>
          <div className="nav-section-label">Admin</div>
          <NavItem to="/admin/customers"    icon={Users}       label="Customers" />
          <NavItem to="/admin/transactions" icon={ShieldCheck} label="All Transactions" />
        </>
      )}

      <div className="sidebar-footer">
        <div className="user-card" onClick={handleLogout} title="Logout">
          <div className="user-avatar">{initials}</div>
          <div className="user-info">
            <div className="user-name">{user?.name || 'User'}</div>
            <div className="user-role">{user?.role || 'CUSTOMER'}</div>
          </div>
          <LogOut size={16} color="var(--txt-muted)" />
        </div>
      </div>
    </aside>
  );
};

export default Sidebar;
