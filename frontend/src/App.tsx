import { useEffect } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
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
import Profile from "@/pages/Profile";
import NotFound from "@/pages/NotFound";

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAuthStore();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="w-8 h-8 border-2 border-green-600 border-t-transparent rounded-full animate-spin" />
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
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="w-8 h-8 border-2 border-green-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return <>{children}</>;
}

export default function App() {
  return (
    <BrowserRouter>
      <AppInitializer>
        <Routes>
          {/* Public routes */}
          <Route element={<PublicLayout />}>
            <Route path="/" element={<Landing />} />
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Register />} />
          </Route>

          {/* Join route (needs auth, shown in public-style layout) */}
          <Route
            path="/join/:inviteCode"
            element={
              <RequireAuth>
                <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
                  <JoinGroup />
                </div>
              </RequireAuth>
            }
          />

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
            <Route path="/profile" element={<Profile />} />
          </Route>

          {/* 404 */}
          <Route path="*" element={<NotFound />} />
        </Routes>
      </AppInitializer>
    </BrowserRouter>
  );
}
