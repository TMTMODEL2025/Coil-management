import { useState } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { SignInView } from './components/SignInView';
import { AppShell } from './components/AppShell';
import { DashboardView } from './components/DashboardView';
import { LocationManagementView } from './components/LocationManagementView';
import { UserManagementView } from './components/UserManagementView';
import { SystemSettingsView } from './components/SystemSettingsView';
import { PhaseRoadmapView } from './components/PhaseRoadmapView';
import { Warehouse3DView } from './components/warehouse3d/Warehouse3DView';
import { SapImportCenterView } from './components/sapImport/SapImportCenterView';
import { InboundReceivingView } from './components/inbound/InboundReceivingView';
import type { NavSectionId } from './types/wms';

function WmsRouter() {
  const { firebaseUser, profile, loading } = useAuth();
  const [activeSection, setActiveSection] = useState<NavSectionId>('dashboard');
  const [focusLocationCode3D, setFocusLocationCode3D] = useState<string | null>(null);

  const handleOpenLocationIn3D = (locationCode: string) => {
    setFocusLocationCode3D(locationCode);
    setActiveSection('warehouse-3d');
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0F172A] text-slate-200 flex items-center justify-center p-6">
        <div className="text-center space-y-2">
          <div className="text-sm font-semibold tracking-wide text-white">
            TMT Steel Coil WMS
          </div>
          <div className="text-xs text-slate-400">กำลังตรวจสอบสิทธิ์การเข้าใช้งาน...</div>
        </div>
      </div>
    );
  }

  if (!firebaseUser || !profile) {
    return <SignInView />;
  }

  return (
    <AppShell activeSection={activeSection} onSelectSection={setActiveSection}>
      {activeSection === 'dashboard' && <DashboardView onNavigate={setActiveSection} />}
      {activeSection === 'warehouse-3d' && (
        <Warehouse3DView
          onNavigate={setActiveSection}
          initialFocusLocationCode={focusLocationCode3D}
          onConsumedFocus={() => setFocusLocationCode3D(null)}
        />
      )}
      {activeSection === 'inbound' && (
        <InboundReceivingView
          onNavigate={setActiveSection}
          onOpenLocationIn3D={handleOpenLocationIn3D}
        />
      )}
      {activeSection === 'sap-import' && <SapImportCenterView />}
      {activeSection === 'locations' && <LocationManagementView />}
      {activeSection === 'users' && <UserManagementView />}
      {activeSection === 'settings' && <SystemSettingsView />}
      {activeSection !== 'dashboard' &&
        activeSection !== 'warehouse-3d' &&
        activeSection !== 'inbound' &&
        activeSection !== 'sap-import' &&
        activeSection !== 'locations' &&
        activeSection !== 'users' &&
        activeSection !== 'settings' && (
          <PhaseRoadmapView section={activeSection} onNavigate={setActiveSection} />
        )}
    </AppShell>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <WmsRouter />
    </AuthProvider>
  );
}
