import { useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';

export default function Result() {
  const { jobId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();

  const previewUrl = location.state?.preview_url;
  const urls = {
    cart_url: location.state?.cart_url,
    checkout_url: location.state?.checkout_url || location.state?.cart_url,
    cart_plain: location.state?.cart_plain,
    checkout_plain: location.state?.checkout_plain,
  };
  const [disabled, setDisabled] = useState(false);
  const [added, setAdded] = useState(() => localStorage.getItem(`MGM_jobAdded:${jobId}`) === 'true');

  const cartUrl = added ? urls.cart_plain || urls.cart_url : urls.cart_url;
  const checkoutUrl = added ? urls.checkout_plain || urls.checkout_url : urls.checkout_url;

  function open(e, url, mark) {
    e.preventDefault();
    if (!url || disabled) return;
    setDisabled(true);
    window.open(url, '_blank', 'noopener,noreferrer');
    if (mark && !added) {
      localStorage.setItem(`MGM_jobAdded:${jobId}`, 'true');
      setAdded(true);
    }
    setTimeout(() => setDisabled(false), 500);
  }

  return (
    <div style={{ textAlign: 'center' }}>
      {previewUrl && (
        <img src={previewUrl} alt="preview" style={{ maxWidth: '300px' }} />
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '20px' }}>
        <a href={cartUrl || '#'} target="_blank" rel="noopener noreferrer">
          <button disabled={disabled} onClick={e => open(e, cartUrl, true)}>
            Agregar al carrito y seguir comprando
          </button>
        </a>
        <a href={checkoutUrl || '#'} target="_blank" rel="noopener noreferrer">
          <button disabled={disabled} onClick={e => open(e, checkoutUrl, true)}>
            Pagar ahora
          </button>
        </a>
        <a
          href={cartUrl || '#'}
          target="_blank"
          rel="noopener noreferrer"
          onClick={e => {
            open(e, cartUrl, true);
            navigate('/');
          }}
        >
          <button disabled={disabled}>Crear otro</button>
        </a>
      </div>
    </div>
  );
}
