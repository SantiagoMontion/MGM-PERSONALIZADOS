import { useEffect } from 'react';

const COMPANY = import.meta.env.PUBLIC_COMPANY_NAME || 'MGM Gamers';
const CONTACT = import.meta.env.PUBLIC_CONTACT_EMAIL || 'info@example.com';
const ADDRESS = import.meta.env.PUBLIC_ADDRESS || 'Dirección no disponible';
const LEGAL_VERSION = import.meta.env.PUBLIC_LEGAL_VERSION || '2025-01-01';

export default function LegalLayout({ title, description, canonical, children }) {
  useEffect(() => {
    document.title = title;
    let meta = document.querySelector('meta[name="description"]');
    if (!meta) {
      meta = document.createElement('meta');
      meta.name = 'description';
      document.head.appendChild(meta);
    }
    if (description) meta.content = description;
    let link = document.querySelector('link[rel="canonical"]');
    if (!link) {
      link = document.createElement('link');
      link.rel = 'canonical';
      document.head.appendChild(link);
    }
    if (canonical) link.href = window.location.origin + canonical;
  }, [title, description, canonical]);

  return (
    <main>
      <h1>{title}</h1>
      <p>Última actualización: {LEGAL_VERSION}</p>
      <p>
        {COMPANY} · {ADDRESS} · {CONTACT}
      </p>
      {children}
    </main>
  );
}
