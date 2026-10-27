import React, { Component, type ErrorInfo, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';

class AppErrorBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Espaço Angélica do Carmo: erro ao iniciar a interface.', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24, background: '#FBF7F2', color: '#49382E', fontFamily: 'system-ui, sans-serif', textAlign: 'center' }}>
          <div>
            <h1 style={{ fontSize: '1.5rem', marginBottom: 12 }}>Espaço Angélica do Carmo</h1>
            <p>O site encontrou um erro ao carregar esta página. Atualize o navegador; se continuar, envie-nos uma captura do erro no console para corrigirmos a causa.</p>
            <button onClick={() => window.location.reload()} style={{ marginTop: 12, padding: '10px 18px', borderRadius: 999, border: 0, background: '#D4AF37', color: '#3C2F00', fontWeight: 700 }}>Tentar novamente</button>
          </div>
        </main>
      );
    }
    return this.props.children;
  }
}

const rootElement = document.getElementById('root');
if (rootElement) {
  createRoot(rootElement).render(
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  );
}
