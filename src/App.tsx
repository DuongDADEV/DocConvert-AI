import React, { useState } from 'react';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { Navbar } from './components/layout/Navbar';
import { Footer } from './components/layout/Footer';
import { UploadModal } from './components/upload/UploadModal';
import { LoadingSpinner } from './components/common/LoadingSpinner';

// Pages
import { LandingPage } from './pages/LandingPage';
import { LoginPage } from './pages/LoginPage';
import { RegisterPage } from './pages/RegisterPage';
import { DashboardPage } from './pages/DashboardPage';
import { DocumentsPage } from './pages/DocumentsPage';
import { PricingPage } from './pages/PricingPage';
import { AccountPage } from './pages/AccountPage';

function AppContent() {
  const { isAuthenticated, isLoading } = useAuth();
  const [currentTab, setCurrentTab] = useState<string>('landing');
  const [selectedDocId, setSelectedDocId] = useState<string | undefined>(undefined);
  const [isUploadOpen, setIsUploadOpen] = useState(false);

  // Synchronize landing/dashboard on initial load
  React.useEffect(() => {
    if (!isLoading) {
      if (isAuthenticated && currentTab === 'landing') {
        setCurrentTab('dashboard');
      } else if (!isAuthenticated && (currentTab === 'dashboard' || currentTab === 'documents' || currentTab === 'account')) {
        setCurrentTab('login');
      }
    }
  }, [isAuthenticated, isLoading]);

  const handleNavigate = (tab: string, docId?: string) => {
    setSelectedDocId(docId);
    // Protected route check
    if (!isAuthenticated && (tab === 'dashboard' || tab === 'documents' || tab === 'account')) {
      setCurrentTab('login');
    } else {
      setCurrentTab(tab);
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleUploadSuccess = (docId: string) => {
    setSelectedDocId(docId);
    setCurrentTab('documents');
  };

  if (isLoading) {
    return <LoadingSpinner message="Đang khởi tạo phiên làm việc bảo mật..." fullScreen />;
  }

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 font-sans text-slate-900 selection:bg-blue-600 selection:text-white">
      {/* Top Navigation */}
      <Navbar
        currentTab={currentTab}
        onNavigate={handleNavigate}
        onOpenUpload={() => setIsUploadOpen(true)}
      />

      {/* Main Page View */}
      <main className="flex-1">
        {currentTab === 'landing' && <LandingPage onNavigate={handleNavigate} />}
        {currentTab === 'login' && <LoginPage onNavigate={handleNavigate} />}
        {currentTab === 'register' && <RegisterPage onNavigate={handleNavigate} />}
        {currentTab === 'dashboard' && (
          <DashboardPage
            onNavigate={handleNavigate}
            onOpenUpload={() => setIsUploadOpen(true)}
          />
        )}
        {currentTab === 'documents' && (
          <DocumentsPage
            onOpenUpload={() => setIsUploadOpen(true)}
            selectedDocId={selectedDocId}
          />
        )}
        {currentTab === 'pricing' && <PricingPage onNavigate={handleNavigate} />}
        {currentTab === 'account' && <AccountPage onNavigate={handleNavigate} />}
      </main>

      {/* Global Footer */}
      <Footer />

      {/* Upload Modal (Global) */}
      <UploadModal
        isOpen={isUploadOpen}
        onClose={() => setIsUploadOpen(false)}
        onSuccess={handleUploadSuccess}
      />
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}
