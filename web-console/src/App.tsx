import { NavLink, Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { useAuth } from './auth';
import { signOut } from './lib/api';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import TournamentManager from './pages/TournamentManager';
import LeagueManager from './pages/LeagueManager';
import Scoreboard from './pages/Scoreboard';
import type { ReactNode } from 'react';

export const BELT_COLOR: Record<string, string> = {
  white: '#d6d6da', blue: '#2f6fed', purple: '#7d3cc6', brown: '#7a4a23', black: '#111',
};

function Shell({ children }: { children: ReactNode }) {
  const nav = useNavigate();
  return (
    <div className="shell">
      <aside className="side">
        <div className="brand">🏆 RFR Console</div>
        <NavLink to="/" end>Dashboard</NavLink>
        <a href="https://rollforrating.com" target="_blank" rel="noreferrer">Marketing site ↗</a>
        <div style={{ marginTop: 24 }}>
          <button className="ghost sm" onClick={async () => { await signOut(); nav('/login'); }}>Sign out</button>
        </div>
      </aside>
      <main className="main">{children}</main>
    </div>
  );
}

export default function App() {
  const { session, loading } = useAuth();
  if (loading) return <div className="spin">Loading…</div>;

  if (!session) {
    return (
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  return (
    <Routes>
      <Route path="/login" element={<Navigate to="/" replace />} />
      {/* Full-screen scoreboard (no shell) */}
      <Route path="/t/:id/scoreboard" element={<Scoreboard />} />
      <Route path="/" element={<Shell><Dashboard /></Shell>} />
      <Route path="/t/:id" element={<Shell><TournamentManager /></Shell>} />
      <Route path="/l/:id" element={<Shell><LeagueManager /></Shell>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
