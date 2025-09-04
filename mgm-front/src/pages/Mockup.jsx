import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useOrderFlow } from '../store/orderFlow';

export default function Mockup() {
  const navigate = useNavigate();
  const { preview_png_dataurl, master_png_dataurl, mode, width_cm, height_cm, bleed_mm, rotate_deg } = useOrderFlow();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [links, setLinks] = useState(null);

  if (!preview_png_dataurl) {
    return (
      <div style={{ padding: 32 }}>
        <p>No hay imagen para mostrar.</p>
        <button onClick={() => navigate('/')}>Volver</button>
      </div>
    );
  }

  async function handleCreateShopifyProduct() {
    setLoading(true); setError(null);
    try {
      const mod = await fetch('/api/moderate-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image_dataurl: master_png_dataurl })
      }).then(r => r.json());
      if (!mod.allow) { setError('La imagen contiene contenido no permitido.'); setLoading(false); return; }

      const payload = {
        mode,
        width_cm: Number(width_cm),
        height_cm: Number(height_cm),
        bleed_mm: Number(bleed_mm),
        rotate_deg: Number(rotate_deg),
        image_dataurl: master_png_dataurl
      };
      const res = await fetch('/api/shopify/create-product', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (!res.ok || !data?.ok) throw new Error(data?.message || 'Error al crear el producto');
      setLinks({ product: data.productUrl, checkout: data.checkoutUrl });
    } catch (e) {
      setError(e?.message || 'Error inesperado');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ padding: 24 }}>
      <div className="mockup-frame" style={{position:'relative', width: 680, aspectRatio:'49 / 42', background:'#eee', overflow:'hidden', borderRadius:16}}>
        <img src="/mockups/mousepad_base.png" alt="" style={{position:'absolute', inset:0, width:'100%', height:'100%', objectFit:'cover'}}/>
        <img src={preview_png_dataurl} alt="" style={{position:'absolute', inset:'var(--padInset, 24px)', width:'calc(100% - 48px)', height:'calc(100% - 48px)', objectFit:'cover', borderRadius:12}}/>
        {mode === 'Glasspad' && (
          <div style={{position:'absolute', inset:'var(--padInset, 24px)', borderRadius:12, pointerEvents:'none', zIndex:5, background:'rgba(255,255,255,.28)', backdropFilter:'blur(2px) saturate(1.03)', WebkitBackdropFilter:'blur(2px) saturate(1.03)'}}/>
        )}
      </div>
      <div style={{marginTop:16, display:'flex', gap:8}}>
        {!links && (
          <>
            <button onClick={() => navigate('/')}>Atrás</button>
            <button onClick={handleCreateShopifyProduct} disabled={loading}>{loading ? 'Creando...' : 'Avanzar y comprar'}</button>
          </>
        )}
        {links && (
          <>
            <a href={links.product} target="_blank" rel="noopener noreferrer">Ver producto</a>
            <a href={links.checkout} target="_blank" rel="noopener noreferrer">Ir a checkout</a>
          </>
        )}
      </div>
      {error && <p className="errorText">{error}</p>}
    </div>
  );
}
