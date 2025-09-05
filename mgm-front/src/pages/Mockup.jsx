import { useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { useFlow } from '@/state/flow';
import { createJobAndProduct } from '@/lib/shopify';

export default function Mockup() {
  const flow = useFlow();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);

  if (!flow.mockupUrl) {
    return (
      <div style={{ padding: 32 }}>
        <p>No hay imagen para mostrar.</p>
        <button onClick={() => navigate('/')}>Volver</button>
      </div>
    );
  }

  async function handle(mode: 'checkout' | 'cart') {
    try {
      setBusy(true);
      const res = await createJobAndProduct(mode, flow);
      if (mode === 'checkout' && res.checkoutUrl) {
        window.location.assign(res.checkoutUrl);
      }
      if (mode === 'cart' && res.cartUrl) {
        window.open(res.cartUrl, '_blank', 'noopener,noreferrer');
        flow.reset();
        navigate('/');
      }
    } catch (e) {
      alert(e?.message || 'Error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ padding: 32, textAlign: 'center' }}>
      <img
        src={flow.mockupUrl}
        width={540}
        height={540}
        style={{ maxWidth: '100%', height: 'auto' }}
        alt="Mockup"
      />
      <div style={{ marginTop: 16, display: 'flex', gap: 12, justifyContent: 'center' }}>
        <button disabled={busy} onClick={() => { flow.reset(); navigate('/'); }}>Volver</button>
        <button disabled={busy} onClick={() => handle('checkout')}>Comprar directo</button>
        <button disabled={busy} onClick={() => handle('cart')}>Agregar al carrito y seguir</button>
      </div>
    </div>
  );
}
