'use client';
import { useState, useEffect } from 'react';
import Sidebar from '@/components/Sidebar';
import Topbar from '@/components/Topbar';
import ToastContainer from '@/components/ToastContainer';
import MesasPanel from '@/components/panels/MesasPanel';
import CajaPanel from '@/components/panels/CajaPanel';
import BarPanel from '@/components/panels/BarPanel';
import ClientesPanel from '@/components/panels/ClientesPanel';
import TorneosPanel from '@/components/panels/TorneosPanel';
import ReportesPanel from '@/components/panels/ReportesPanel';
import DashboardPanel from '@/components/panels/DashboardPanel';
import ConfigPanel from '@/components/panels/ConfigPanel';
import LoginScreen from '@/components/LoginScreen';
import { AuthProvider, useAuth } from '@/lib/auth-context';

function AppContent() {
  const { user, loading } = useAuth();
  const [activePanel, setActivePanel] = useState('mesas');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [toasts, setToasts] = useState([]);

  const showToast = (message, type = 'info') => {
    const id = Date.now();
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 4000);
  };

  if (loading) {
    return (
      <div style={{ display:'flex', alignItems:'center', justifyContent:'center', minHeight:'100vh', background:'var(--bg-base)' }}>
        <div style={{ textAlign:'center', padding: '24px' }}>
          <img 
            src="/logo-largo.png" 
            alt="YoY IA Billar" 
            fetchpriority="high"
            loading="eager"
            style={{ 
              width: 260, 
              height: 'auto', 
              objectFit: 'contain',
              animation: 'pulse 1.6s infinite ease-in-out', 
              margin: '0 auto 24px',
              display: 'block',
              filter: 'drop-shadow(0 0 15px rgba(205,127,50,0.2))'
            }} 
          />
          <p style={{ color:'var(--text-secondary)', fontSize: 10, letterSpacing:'0.2em', textTransform:'uppercase', fontWeight: 600 }}>Iniciando sistema...</p>
        </div>
      </div>
    );
  }

  if (!user) return <LoginScreen showToast={showToast} />;

  const panels = {
    dashboard: <DashboardPanel showToast={showToast} onNavigate={setActivePanel} />,
    mesas:     <MesasPanel showToast={showToast} />,
    caja:      <CajaPanel showToast={showToast} />,
    bar:       <BarPanel showToast={showToast} />,
    clientes:  <ClientesPanel showToast={showToast} />,
    torneos:   <TorneosPanel showToast={showToast} />,
    reportes:  <ReportesPanel showToast={showToast} />,
    config:    <ConfigPanel showToast={showToast} />,
  };

  return (
    <div className="app-wrapper">
      {/* Sensor de hover invisible en el borde izquierdo */}
      <div 
        onMouseEnter={() => setSidebarOpen(true)}
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          bottom: 0,
          width: 12,
          zIndex: 1050,
          background: 'transparent',
          cursor: 'pointer'
        }}
      />

      <Sidebar
        activePanel={activePanel}
        onNavigate={(panel) => {
          setActivePanel(panel);
          setSidebarOpen(false);
        }}
        open={sidebarOpen}
        onMouseEnter={() => setSidebarOpen(true)}
        onMouseLeave={() => setSidebarOpen(false)}
        user={user}
      />
      <div className="main-content">
        <Topbar
          user={user}
          activePanel={activePanel}
          onToggleSidebar={() => setSidebarOpen(p => !p)}
          showToast={showToast}
          onNavigate={(panel) => {
            setActivePanel(panel);
            setSidebarOpen(false);
          }}
        />
        <div className="page-content">
          {panels[activePanel] || panels.dashboard}
        </div>
      </div>
      <ToastContainer toasts={toasts} />
    </div>
  );
}

export default function Home() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}
