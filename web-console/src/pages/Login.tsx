import { useState, type FormEvent } from 'react';
import { signIn } from '../lib/api';

export default function Login() {
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr('');
    try { await signIn(email.trim(), pw); }
    catch (e: any) { setErr(e.message ?? 'Sign-in failed'); }
    finally { setBusy(false); }
  }

  return (
    <div className="center">
      <form className="card login col" onSubmit={submit}>
        <div className="brand">🏆 RFR Console</div>
        <p className="muted" style={{ marginTop: -6 }}>Organizer sign-in — use your Roll for Rating account.</p>
        <div className="field"><label>Email</label><input value={email} onChange={(e) => setEmail(e.target.value)} type="email" autoFocus /></div>
        <div className="field"><label>Password</label><input value={pw} onChange={(e) => setPw(e.target.value)} type="password" /></div>
        {err && <div style={{ color: 'var(--red)', fontSize: 13 }}>{err}</div>}
        <button disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
      </form>
    </div>
  );
}
