import { useEffect } from 'react';
import { AppRouter } from './router';
import { useAuthStore } from './stores/authStore';
import { initDatabase } from './services/db';

function App() {
  const initAuth = useAuthStore((state) => state.initAuth);

  useEffect(() => {
    initDatabase().then(() => {
      initAuth();
    });
  }, [initAuth]);

  return <AppRouter />;
}

export default App;
