import { useEffect, useState } from 'react';
import DesignList from '../components/DesignList.jsx';
import { useUserStore } from '../lib/userStore.js';
import { createCartLink } from '../lib/checkoutFlow';

export default function MisDisenos() {
  const { email, setEmail, token, setToken } = useUserStore();
  const [jobs, setJobs] = useState([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const t = params.get('token');
    const e = params.get('email');
    if (t) setToken(t);
    if (e) setEmail(e);
  }, [setEmail, setToken]);

  async function fetchJobs() {
    if (!email || !token) return;
    setBusy(true);
    setErr('');
    try {
      const res = await fetch(`/api/user/jobs?email=${encodeURIComponent(email)}&token=${encodeURIComponent(token)}&page=1&page_size=20`);
      if (res.status === 401 || res.status === 403) {
        setErr('Acceso no autorizado');
        setToken('');
        return;
      }
      const data = await res.json();
      if (res.ok) setJobs(data.jobs || []);
      else setErr(data.message || 'Error al cargar');
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (email && token) fetchJobs();
  }, [email, token]);

  async function handleSendLink() {
    if (!email) return;
    setBusy(true);
    setErr('');
    try {
      const res = await fetch('/api/user/login-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      if (!res.ok) {
        const data = await res.json();
        setErr(data.message || 'Error');
      } else {
        alert('Revisa tu email o consola para el link de acceso.');
      }
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function handleAddToCart(jobId) {
    try {
      const cart = await createCartLink('', jobId);
      const url = cart.checkout_url || cart.cart_url;
      if (url) window.open(url, '_blank');
    } catch (e) {
      console.error(e);
    }
  }

  return (
    <div>
      <h1>Mis diseños</h1>
      {!token && (
        <div>
          <input
            type="email"
            placeholder="tu@email"
            value={email}
            onChange={e => setEmail(e.target.value)}
          />
          <button type="button" onClick={handleSendLink} disabled={busy}>
            Enviar link
          </button>
        </div>
      )}
      {token && (
        <div>
          <button type="button" onClick={fetchJobs} disabled={busy}>
            Ver mis diseños
          </button>
        </div>
      )}
      {err && <p className="errorText">{err}</p>}
      {busy && <p>Cargando…</p>}
      <DesignList jobs={jobs} onAddToCart={handleAddToCart} />
    </div>
  );
}
