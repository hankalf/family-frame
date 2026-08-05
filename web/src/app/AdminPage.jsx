import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import MembersSection from './admin/MembersSection.jsx';
import FeedsSection from './admin/FeedsSection.jsx';
import DisplaySection from './admin/DisplaySection.jsx';
import AppointmentsSection from './admin/AppointmentsSection.jsx';

export default function AdminPage() {
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-1.5">
        <SubTab to="/app/admin" end>
          Members
        </SubTab>
        <SubTab to="/app/admin/feeds">Calendar feeds</SubTab>
        <SubTab to="/app/admin/appointments">Appointments</SubTab>
        <SubTab to="/app/admin/display">Display</SubTab>
      </div>

      <Routes>
        <Route index element={<MembersSection />} />
        <Route path="feeds" element={<FeedsSection />} />
        <Route path="appointments" element={<AppointmentsSection />} />
        <Route path="display" element={<DisplaySection />} />
        <Route path="*" element={<Navigate to="/app/admin" replace />} />
      </Routes>
    </div>
  );
}

function SubTab({ to, end, children }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        [
          'rounded-lg px-3 py-1.5 text-sm font-medium transition',
          isActive
            ? 'bg-sky-500/15 text-sky-300'
            : 'text-slate-400 hover:bg-slate-900 hover:text-slate-200',
        ].join(' ')
      }
    >
      {children}
    </NavLink>
  );
}
