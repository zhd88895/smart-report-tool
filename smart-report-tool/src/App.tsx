import { useEffect } from 'react';
import { AppRouter } from './router';
import { useAuthStore } from './stores/authStore';
import ErrorBoundary from './components/ErrorBoundary';

function App() {
  const initAuth = useAuthStore((state) => state.initAuth);

  useEffect(() => {
    initAuth();
  }, [initAuth]);

  return (
    <ErrorBoundary>
      <AppRouter />
    </ErrorBoundary>
  );
}

export default App;