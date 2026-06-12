import { NavLink, useLocation } from 'react-router-dom';

export const PAGE_META = {
  '/': {
    title: 'Admin Dashboard',
    subtitle: 'Live sales, stock levels, and revenue trends for your fishery.',
  },
  '/inventory': {
    title: 'Inventory & Pricing',
    subtitle: 'Current stock in kg and RM/kg pricing. Open the Stock ledger tab for all movements.',
  },
  '/sales': {
    title: 'Sales Records',
    subtitle: 'Record counter sales by weight or ringgit total — stock deducts automatically.',
  },
  '/credit': {
    title: 'Credit & Collections',
    subtitle: 'Track restaurant buyers and outstanding balances — credit sales and pre-orders.',
  },
  '/reports': {
    title: 'Monthly Reports',
    subtitle: 'Sales and collection report by month — who paid and who still owes (print / PDF).',
  },
  '/users': {
    title: 'Customer Accounts',
    subtitle: 'Registered customer accounts.',
  },
  '/settings': {
    title: 'System Settings',
    subtitle: 'Store profile, admin account, and mobile recipe API configuration.',
  },
};

export function PageHeader({ title, subtitle, action }) {
  return (
    <div className="flex flex-wrap justify-between items-start gap-4 mb-6">
      <div>
        <h2 className="text-2xl font-bold text-slate-900 tracking-tight">{title}</h2>
        {subtitle && <p className="text-slate-500 text-sm mt-1 max-w-2xl leading-relaxed">{subtitle}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

export function StatCard({ label, value, hint, tone = 'blue' }) {
  const tones = {
    blue: 'border-blue-100 bg-gradient-to-br from-white to-blue-50/80',
    emerald: 'border-emerald-100 bg-gradient-to-br from-white to-emerald-50/80',
    purple: 'border-purple-100 bg-gradient-to-br from-white to-purple-50/80',
    orange: 'border-orange-100 bg-gradient-to-br from-white to-orange-50/80',
    slate: 'border-slate-200 bg-white',
  };
  const valueColors = {
    blue: 'text-blue-700',
    emerald: 'text-emerald-600',
    purple: 'text-purple-700',
    orange: 'text-orange-600',
    slate: 'text-slate-800',
  };
  return (
    <div className={`rounded-2xl border p-5 shadow-sm ${tones[tone] || tones.blue}`}>
      <p className="text-xs font-bold uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`text-2xl font-black mt-2 ${valueColors[tone] || valueColors.blue}`}>{value}</p>
      {hint && <p className="text-xs text-slate-500 mt-2">{hint}</p>}
    </div>
  );
}

export function AlertBanner({ variant = 'info', title, children }) {
  const styles = {
    info: 'bg-blue-50 border-blue-200 text-blue-900',
    warning: 'bg-amber-50 border-amber-200 text-amber-900',
    danger: 'bg-red-50 border-red-200 text-red-900',
    success: 'bg-emerald-50 border-emerald-200 text-emerald-900',
  };
  return (
    <div className={`rounded-xl border px-4 py-3 mb-6 ${styles[variant] || styles.info}`}>
      {title && <p className="font-bold text-sm">{title}</p>}
      {children && <div className={`text-sm mt-1 ${title ? 'opacity-90' : ''}`}>{children}</div>}
    </div>
  );
}

export function StatusBadge({ status }) {
  const key = (status || '').toLowerCase();
  let cls = 'bg-slate-100 text-slate-700';
  if (key.includes('stock') && !key.includes('out') && !key.includes('low')) {
    cls = 'bg-emerald-100 text-emerald-800';
  } else if (key.includes('low')) {
    cls = 'bg-amber-100 text-amber-800';
  } else if (key.includes('out') || key.includes('spoil') || key.includes('wastage')) {
    cls = 'bg-red-100 text-red-800';
  }
  return (
    <span className={`inline-flex py-1 px-2.5 rounded-full text-xs font-bold ${cls}`}>
      {status || '—'}
    </span>
  );
}

export function AdminCard({ children, className = '' }) {
  return (
    <div className={`bg-white rounded-2xl shadow-sm border border-slate-100/80 ${className}`}>
      {children}
    </div>
  );
}

const SidebarLink = ({ to, icon, label }) => (
  <NavLink
    to={to}
    end={to === '/'}
    className={({ isActive }) =>
      `flex items-center gap-3 px-4 py-3 rounded-xl transition-all font-semibold text-sm ${
        isActive
          ? 'bg-[#4379EE] text-white shadow-lg shadow-blue-900/30'
          : 'text-slate-400 hover:bg-slate-800/60 hover:text-white'
      }`
    }
  >
    <span className="text-lg">{icon}</span>
    {label}
  </NavLink>
);

export function AdminDashboardShell({ children, storeInfo, currentUser, onLogout }) {
  const location = useLocation();
  const meta = PAGE_META[location.pathname] || PAGE_META['/'];
  const clock = new Date().toLocaleString('en-MY', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <div className="flex h-screen bg-[#F0F2F8] font-sans text-slate-900 overflow-hidden print:h-auto print:min-h-0 print:overflow-visible print:block">
      <aside className="w-[268px] bg-[#1E2640] text-white flex flex-col z-20 print:hidden shrink-0">
        <div className="px-6 py-5 border-b border-slate-700/50">
          <div className="flex items-center gap-3">
            <img
              src="/app-icon.png"
              alt="Boon Hua Fishery"
              className="w-11 h-11 rounded-xl shadow-lg object-cover"
            />
            <div>
              <h1 className="text-base font-black leading-tight">{storeInfo.storeName || 'Boon Hua Fishery'}</h1>
              <p className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider">Admin Portal</p>
            </div>
          </div>
          {storeInfo.address && (
            <p className="text-[10px] text-slate-500 mt-3 leading-snug line-clamp-2">{storeInfo.address}</p>
          )}
          {storeInfo.phone && (
            <p className="text-[10px] text-slate-400 mt-2">{storeInfo.phone}</p>
          )}
        </div>

        <nav className="flex-1 px-3 py-5 space-y-1 overflow-y-auto">
          <p className="px-4 text-[10px] text-slate-500 font-bold mb-2 uppercase tracking-widest">Admin</p>
          <SidebarLink to="/" icon="📊" label="Dashboard" />
          <SidebarLink to="/inventory" icon="📦" label="Inventory" />
          <SidebarLink to="/sales" icon="💰" label="Sales" />
          <SidebarLink to="/credit" icon="📋" label="Collections" />
          <SidebarLink to="/reports" icon="📄" label="Monthly Report" />
          <p className="px-4 text-[10px] text-slate-500 font-bold mb-2 mt-4 uppercase tracking-widest">System</p>
          <SidebarLink to="/users" icon="👥" label="Customers" />
          <SidebarLink to="/settings" icon="⚙️" label="Settings" />
        </nav>

        <div className="p-4 border-t border-slate-700/40">
          <p className="text-[10px] text-slate-500 text-center mb-3">Admin Only</p>
          <button
            type="button"
            onClick={onLogout}
            className="w-full py-2.5 bg-red-500/90 hover:bg-red-500 text-white rounded-xl text-sm font-bold transition-all"
          >
            Sign out
          </button>
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-w-0 overflow-hidden print:overflow-visible print:h-auto">
        <header className="bg-white border-b border-slate-200/80 px-8 py-4 print:hidden shrink-0">
          <div className="flex flex-wrap justify-between items-start gap-4">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-[#4379EE] mb-1">Boon Hua Fishery</p>
              <h2 className="text-xl font-bold text-slate-900">{meta.title}</h2>
              <p className="text-sm text-slate-500 mt-0.5">{meta.subtitle}</p>
            </div>
            <div className="text-right text-xs text-slate-500 space-y-1">
              <p className="font-semibold text-slate-700">{clock}</p>
              {(storeInfo.openingTime || storeInfo.closingTime) && (
                <p>
                  Hours: {storeInfo.openingTime || '—'} – {storeInfo.closingTime || '—'}
                </p>
              )}
              <p className="text-slate-400">{currentUser?.email}</p>
            </div>
          </div>
        </header>

        <main className="flex-1 min-w-0 p-6 md:p-8 overflow-y-auto overflow-x-hidden print:p-4 print:overflow-visible print:h-auto print:max-h-none">
          {children}
        </main>
      </div>
    </div>
  );
}

export function generateSaleReference(saleDate) {
  const day = (saleDate || new Date().toISOString().slice(0, 10)).replace(/-/g, '');
  const seq = Math.floor(100 + Math.random() * 900);
  return `BH-${day}-${seq}`;
}
