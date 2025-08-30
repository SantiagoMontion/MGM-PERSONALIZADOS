import { useEffect, useState } from 'react';

const EMAIL_KEY = 'customer_email';
const TOKEN_KEY = 'user_token';

export function useUserStore() {
  const [email, setEmail] = useState(() => {
    try {
      return localStorage.getItem(EMAIL_KEY) || '';
    } catch {
      return '';
    }
  });
  const [token, setToken] = useState(() => {
    try {
      return localStorage.getItem(TOKEN_KEY) || '';
    } catch {
      return '';
    }
  });

  useEffect(() => {
    try {
      if (email) localStorage.setItem(EMAIL_KEY, email);
      else localStorage.removeItem(EMAIL_KEY);
    } catch {}
  }, [email]);

  useEffect(() => {
    try {
      if (token) localStorage.setItem(TOKEN_KEY, token);
      else localStorage.removeItem(TOKEN_KEY);
    } catch {}
  }, [token]);

  return { email, setEmail, token, setToken };
}

export default useUserStore;
