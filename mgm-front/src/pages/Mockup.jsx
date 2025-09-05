import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useOrderFlow } from '../store/orderFlow';
import SeoJsonLd from '../components/SeoJsonLd';
import { apiFetch } from '@/lib/api';
import { quickCheckRealNudity } from '@/lib/moderation';

const MAX_W = 720;
const MAX_H = 520;

export default function Mockup() {
  const navigate = useNavigate();
  const {
    preview_png_dataurl,
    master_png_dataurl,
    mode,
    width_cm,
    height_cm,
    bleed_mm,
    rotate_deg,
  } = useOrderFlow();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [links, setLinks] = useState(null);
  const [dim, setDim] = useState(null);

  if (!preview_png_dataurl) {
    return (
      <div style={{ padding: 32 }}>
        <p>No hay imagen para mostrar.</p>
        <button onClick={() => navigate('/')}>Volver</button>
      </div>
    );
  }

  const handleImgLoad = (e) => {
    const el = e.currentTarget;
    const iw = el.naturalWidth || 1;
    const ih = el.naturalHeight || 1;
    const scale = Math.min(MAX_W / iw, MAX_H / ih, 1);
    const next = { w: Math.round(iw * scale), h: Math.round(ih * scale) };
    setDim(next);
    console.log('[mockup natural size]', iw, ih, '→', next);
  };

  async function handleCreateShopifyProduct() {
    setLoading(true);
    setError(null);
    try {
      const img = new Image();
      img.src = master_png_dataurl;
      await new Promise((resolve) => {
        img.onload = resolve;
        img.onerror = resolve;
      });
      if (await quickCheckRealNudity(img)) {
        setError('La imagen parece contener desnudez real.');
        setLoading(false);
        return;
      }

      const resp = await apiFetch('/api/moderate-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dataUrl: master_png_dataurl, filename: 'image.png' })
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        setError(`Bloqueado por moderación: ${err.reason || 'desconocido'}`);
        setLoading(false);
        return;
      }

      const payload = {
        mode,
        width_cm: Number(width_cm),
        height_cm: Number(height_cm),
        bleed_mm: Number(bleed_mm),
        rotate_deg: Number(rotate_deg),
        image_dataurl: master_png_dataurl,
      };
        const res = await apiFetch('/api/shopify/create-product', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      const data = await res.json();
      if (!res.ok || !data?.ok)
        throw new Error(data?.message || 'Error al crear el producto');
      setLinks({ product: data.productUrl, checkout: data.checkoutUrl });
    } catch (e) {
      setError(e?.message || 'Error inesperado');
    } finally {
      setLoading(false);
    }
  }

  const preview = preview_png_dataurl;
  const isGlasspad = mode === 'Glasspad';

  return (
    <div
      className="mockup-wrap"
      style={{ display: 'grid', placeItems: 'center', padding: '24px' }}
    >
      <SeoJsonLd
        title="Vista previa del producto — MGMGAMERS"
        canonical="https://www.mgmgamers.store/mockup"
        jsonLd={{
          '@context': 'https://schema.org',
          '@type': 'Product',
          name: 'Mousepad Personalizado',
          brand: 'MGMGAMERS',
          description:
            'Mousepad Profesionales Personalizados, Gamers, diseño y medida que quieras. Perfectos para gaming control y speed.',
          image: preview,
          offers: {
            '@type': 'Offer',
            priceCurrency: 'ARS',
            price: '0',
            availability: 'https://schema.org/InStock'
          }
        }}
      />
      <div
        className="mockup-frame"
        style={{
          position: 'relative',
          width: dim?.w ?? Math.min(MAX_W, 360),
          height: dim?.h ?? 'auto',
          background: '#f1f1f1',
          borderRadius: 16,
          padding: 12,
          boxShadow: '0 0 0 2px rgba(255,255,255,0.25) inset',
        }}
      >
        <img
          src="/mockups/mousepad_base.png"
          alt="Base de mousepad para vista previa"
          style={{
            position: 'absolute',
            inset: 12,
            width: 'calc(100% - 24px)',
            height: 'calc(100% - 24px)',
            objectFit: 'contain',
            borderRadius: 12,
          }}
        />

        <img
          src={preview}
          alt="Vista previa"
          onLoad={handleImgLoad}
          style={{
            display: 'block',
            width: '100%',
            height: 'auto',
            objectFit: 'contain',
            borderRadius: 12,
            imageRendering: 'auto',
          }}
        />

        {isGlasspad && (
          <div
            aria-hidden
            style={{
              position: 'absolute',
              inset: 12,
              borderRadius: 12,
              pointerEvents: 'none',
              background: 'rgba(255,255,255,.28)',
              backdropFilter: 'blur(2px) saturate(1.03)',
              WebkitBackdropFilter: 'blur(2px) saturate(1.03)',
            }}
          />
        )}
      </div>

      <div style={{ marginTop: 16, display: 'flex', gap: 24 }}>
        {!links && (
          <>
            <button onClick={() => navigate('/')}>Atrás</button>
            <button onClick={handleCreateShopifyProduct} disabled={loading}>
              {loading ? 'Creando...' : 'Avanzar y comprar'}
            </button>
          </>
        )}
        {links && (
          <>
            <a
              href={links.product}
              target="_blank"
              rel="noopener noreferrer"
            >
              Ver producto
            </a>
            <a
              href={links.checkout}
              target="_blank"
              rel="noopener noreferrer"
            >
              Ir a checkout
            </a>
          </>
        )}
      </div>
      {error && <p className="errorText">{error}</p>}
    </div>
  );
}

