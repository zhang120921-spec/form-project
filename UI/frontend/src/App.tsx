import { BrowserRouter, HashRouter, Routes, Route, Navigate } from "react-router-dom";
import { StoreProvider } from "@/hooks/useStore";
import { AuthProvider, useAuth } from "@/hooks/useAuth";
import { ToastProvider } from "@/hooks/useToast";
import { PendingCountsProvider } from "@/hooks/usePendingCounts";
import Shell from "@/components/Shell";
import ErrorBoundary from "@/components/ErrorBoundary";
import AuthPage from "@/pages/AuthPage";
import OverviewPage from "@/pages/OverviewPage";
import RankingsPage from "@/pages/RankingsPage";
import RoundsPage from "@/pages/RoundsPage";
import LogRoundPage from "@/pages/LogRoundPage";
import ProfilePage from "@/pages/ProfilePage";
import FriendsPage from "@/pages/FriendsPage";
import SandbagPage from "@/pages/SandbagPage";
import FairMatchPage from "@/pages/FairMatchPage";
import PublicProfilePage from "@/pages/PublicProfilePage";

// Use HashRouter for file:// protocol (standalone single-file build),
// BrowserRouter for normal dev/preview server usage.
const Router = typeof window !== "undefined" && window.location.protocol === "file:"
  ? HashRouter
  : BrowserRouter;

function Protected({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (!user) return <Navigate to="/auth" replace />;
  return <>{children}</>;
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/auth" element={<AuthPage />} />
      <Route
        path="/*"
        element={
          <Protected>
            <Shell>
              <div className="route-scroll" style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
                <Routes>
                  <Route path="/" element={<OverviewPage />} />
                  <Route path="/rankings" element={<RankingsPage />} />
                  <Route path="/rounds" element={<RoundsPage />} />
                  <Route path="/log" element={<LogRoundPage />} />
                  <Route path="/profile" element={<ProfilePage />} />
                  <Route path="/friends" element={<FriendsPage />} />
                  <Route path="/leaderboard" element={<Navigate to="/rankings" replace />} />
                  <Route path="/player/:id" element={<PublicProfilePage />} />
                  <Route path="/sandbag" element={<SandbagPage />} />
                  <Route path="/fairmatch" element={<FairMatchPage />} />
                  <Route path="*" element={<Navigate to="/" replace />} />
                </Routes>
              </div>
            </Shell>
          </Protected>
        }
      />
    </Routes>
  );
}

export default function App() {
  return (
    <Router>
      <StoreProvider>
        <AuthProvider>
          <ToastProvider>
            <PendingCountsProvider>
              <ErrorBoundary>
                <AppRoutes />
              </ErrorBoundary>
            </PendingCountsProvider>
          </ToastProvider>
        </AuthProvider>
      </StoreProvider>
    </Router>
  );
}
