import React from 'react';

export default function DesignList({ jobs = [], onAddToCart }) {
  if (!jobs.length) {
    return (
      <p>
        Todavía no tenés diseños, ¡creá uno! <a href="/">Ir al editor</a>
      </p>
    );
  }

  return (
    <table>
      <thead>
        <tr>
          <th>Mockup</th>
          <th>Nombre</th>
          <th>Medida</th>
          <th>Material</th>
          <th>Fecha</th>
          <th>Estado</th>
          <th>Acciones</th>
        </tr>
      </thead>
      <tbody>
        {jobs.map(job => (
          <tr key={job.job_id}>
            <td>{job.preview_url && (<img src={job.preview_url} alt={job.design_name} style={{ width: 80 }} />)}</td>
            <td>{job.design_name || '-'}</td>
            <td>
              {job.w_cm}×{job.h_cm}
            </td>
            <td>{job.material}</td>
            <td>{job.created_at ? new Date(job.created_at).toLocaleDateString() : ''}</td>
            <td>{job.status}</td>
            <td>
              {job.shopify_product_url && (
                <a href={job.shopify_product_url} target="_blank" rel="noopener noreferrer">
                  Ver en tienda
                </a>
              )}{' '}
              {job.cart_url ? (
                <a href={job.cart_url} target="_blank" rel="noopener noreferrer">
                  Agregar al carrito
                </a>
              ) : (
                <button type="button" onClick={() => onAddToCart?.(job.job_id)}>
                  Agregar al carrito
                </button>
              )}{' '}
              {job.preview_url && (
                <a href={job.preview_url} target="_blank" rel="noopener noreferrer">
                  Ver mockup
                </a>
              )}
              {!job.legal_version && (
                <span style={{ display: 'block', color: 'red' }}>
                  Acepta términos antes de comprar
                </span>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
