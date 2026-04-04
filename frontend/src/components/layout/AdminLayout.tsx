import { useState, useEffect } from "react";
import { Link, Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  LayoutDashboard, Users, Layers, Settings, ArrowLeft, ShieldOff, Menu,
} from "lucide-react";
import client from "@/api/client";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { path: "/admin", label: "Dashboard", icon: LayoutDashboard, exact: true },
  { path: "/admin/users", label: "Users", icon: Users },
  { path: "/admin/groups", label: "Groups", icon: Layers },
  { path: "/admin/config", label: "System Config", icon: Settings },
];

export default function AdminLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const [isSuperadmin, setIsSuperadmin] = useState<boolean | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    client.get("/admin/me").then(() => setIsSuperadmin(true)).catch(() => setIsSuperadmin(false));
  }, []);

  if (isSuperadmin === null) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!isSuperadmin) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 text-center bg-surface">
        <div className="w-16 h-16 rounded-2xl bg-error-container/20 flex items-center justify-center">
          <ShieldOff size={28} className="text-error" />
        </div>
        <div>
          <h2 className="text-xl font-bold text-on-surface">Access Denied</h2>
          <p className="text-on-surface-variant text-sm mt-1">You don't have permission to access this page.</p>
        </div>
      </div>
    );
  }

  function isActive(path: string, exact?: boolean) {
    return exact ? location.pathname === path : location.pathname.startsWith(path);
  }

  return (
    <div className="min-h-screen bg-surface flex">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div className="fixed inset-0 bg-black/50 z-40 md:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      {/* Sidebar */}
      <aside className={cn(
        "fixed md:sticky top-0 left-0 h-screen w-60 bg-surface-container-lowest border-r border-outline-variant/15 flex flex-col z-50 transition-transform md:translate-x-0",
        sidebarOpen ? "translate-x-0" : "-translate-x-full"
      )}>
        <div className="p-4 border-b border-outline-variant/15">
          <h1 className="text-lg font-bold text-on-surface">Admin Panel</h1>
          <p className="text-xs text-on-surface-variant">System management</p>
        </div>

        <nav className="flex-1 p-3 space-y-1">
          {NAV_ITEMS.map(({ path, label, icon: Icon, exact }) => (
            <Link
              key={path}
              to={path}
              onClick={() => setSidebarOpen(false)}
              className={cn(
                "flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors",
                isActive(path, exact)
                  ? "bg-primary-container/20 text-primary"
                  : "text-on-surface-variant hover:bg-surface-container hover:text-on-surface"
              )}
            >
              <Icon size={18} />
              {label}
            </Link>
          ))}
        </nav>

        <div className="p-3 border-t border-outline-variant/15">
          <button
            onClick={() => navigate("/dashboard")}
            className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-on-surface-variant hover:bg-surface-container hover:text-on-surface transition-colors w-full"
          >
            <ArrowLeft size={18} />
            Back to App
          </button>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-h-screen">
        {/* Mobile header */}
        <header className="md:hidden sticky top-0 z-30 bg-surface-container-lowest/80 backdrop-blur-lg border-b border-outline-variant/15 px-4 py-3 flex items-center gap-3">
          <button onClick={() => setSidebarOpen(true)} className="p-1.5 rounded-lg hover:bg-surface-container">
            <Menu size={20} className="text-on-surface" />
          </button>
          <h1 className="text-lg font-bold text-on-surface">Admin Panel</h1>
        </header>

        <main className="flex-1 p-4 md:p-8 max-w-6xl">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
