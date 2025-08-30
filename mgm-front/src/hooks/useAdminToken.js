import { useState } from 'react';

const LS_KEY = 'mgm_admin_token';

export function useAdminToken() {
  const [token, setToken] = useState(() => localStorage.getItem(LS_KEY) || '');

  const saveToken = t => {
    localStorage.setItem(LS_KEY, t);
    setToken(t);
  };

  const clearToken = () => {
    localStorage.removeItem(LS_KEY);
    setToken('');
  };

  return { token, saveToken, clearToken };
}
