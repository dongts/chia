import { useEffect, lazy, Suspense } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";

const Admin = lazy(() => import("./pages/Admin"));
import { useAuthStore } from "@/store/authStore";

import PublicLayout from "@/components/layout/PublicLayout";
import AppLayout from "@/components/layout/AppLayout";

import Landing from "@/pages/Landing";
import Login from "@/pages/Login";
import Register from "@/pages/Register";
import JoinGroup from "@/pages/JoinGroup";
import Dashboard from "@/pages/Dashboard";
import GroupView from "@/pages/GroupView";
import AddExpense from "@/pages/AddExpense";
import EditExpense from "@/pages/EditExpense";
import GroupSettings from "@/pages/GroupSettings";
import GroupReports from "./pages/GroupReports";
import Profile from "@/pages/Profile";
import NotFound from "@/pages/NotFound";
import UpdatePrompt from "@/components/UpdatePrompt";

function RedirectIfAuth({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useAuthStore();
  // Also check localStorage as a fast path — covers cases where
  // initialize() hasn't completed or getMe() is still in flight
  const hasToken = !!localStorage.getItem("access_token");
  if (isAuthenticated || hasToken) return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
}

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAuthStore();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}

function AppInitializer({ children }: { children: React.ReactNode }) {
  const { initialize, isLoading } = useAuthStore();

  useEffect(() => {
    initialize();
  }, [initialize]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return <>{children}</>;
}

export default function App() {
  return (
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <UpdatePrompt />
      <AppInitializer>
        <Routes>
          {/* Public routes — redirect to dashboard if already logged in */}
          <Route element={<RedirectIfAuth><PublicLayout /></RedirectIfAuth>}>
            <Route path="/" element={<Landing />} />
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Register />} />
          </Route>

          {/* Join route — handles auth internally (guest/login/register) */}
          <Route path="/join/:inviteCode" element={<JoinGroup />} />

          {/* Protected app routes */}
          <Route
            element={
              <RequireAuth>
                <AppLayout />
              </RequireAuth>
            }
          >
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/groups/:groupId" element={<GroupView />} />
            <Route path="/groups/:groupId/add-expense" element={<AddExpense />} />
            <Route
              path="/groups/:groupId/expenses/:expenseId/edit"
              element={<EditExpense />}
            />
            <Route path="/groups/:groupId/settings" element={<GroupSettings />} />
            <Route path="/groups/:groupId/reports" element={<GroupReports />} />
            <Route path="/profile" element={<Profile />} />
            <Route
              path="/admin"
              element={
                <Suspense fallback={<div className="min-h-screen flex items-center justify-center bg-surface"><div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" /></div>}>
                  <Admin />
                </Suspense>
              }
            />
          </Route>

          {/* 404 */}
          <Route path="*" element={<NotFound />} />
        </Routes>
      </AppInitializer>
    </BrowserRouter>
  );
}
