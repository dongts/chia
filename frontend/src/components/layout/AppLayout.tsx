import { useState, useEffect } from "react";
import { Link, Outlet, useNavigate, useLocation } from "react-router-dom";
import { Bell, User, LogOut, ChevronDown, Menu, X, Download, Sprout } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useNotifications } from "@/hooks/useNotifications";
import { useInstallPrompt } from "@/hooks/useInstallPrompt";
import { listGroups } from "@/api/groups";
import type { GroupListItem } from "@/types";
import { cn } from "@/lib/utils";
import { formatAmount } from "@/utils/currency";

export default function AppLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { unreadCount, markAllRead } = useNotifications();
  const { canInstall, showBanner, showIOSInstructions, install, dismissBanner } = useInstallPrompt();
  const [groups, setGroups] = useState<GroupListItem[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);

  useEffect(() => {
    listGroups().then(setGroups).catch(() => {});
  }, [location.pathname]);

  function handleLogout() {
    logout();
    navigate("/");
  }

  function handleNotifClick() {
    setNotifOpen((v) => !v);
    if (unreadCount > 0) markAllRead();
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Install banner — Android: install button, iOS: instructions */}
      {showBanner && (
        <div className="bg-green-600 text-white px-4 py-3 flex items-center justify-between gap-3 z-50">
          <div className="flex items-center gap-3 min-w-0">
            <Sprout size={20} className="flex-shrink-0" />
            {showIOSInstructions ? (
              <p className="text-sm font-medium">
                Install Chia: tap{" "}
                <span className="inline-flex items-center justify-center w-6 h-6 border border-white/50 rounded align-middle mx-0.5">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg>
                </span>
                {" "}then <strong>"Add to Home Screen"</strong>
              </p>
            ) : (
              <p className="text-sm font-medium truncate">Install Chia for a better experience</p>
            )}
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {!showIOSInstructions && (
              <button
                onClick={async () => { await install(); }}
                className="bg-white text-green-700 font-semibold text-sm px-4 py-1.5 rounded-lg hover:bg-green-50 transition-colors"
              >
                Install
              </button>
            )}
            <button onClick={dismissBanner} className="text-white/70 hover:text-white p-1">
              <X size={18} />
            </button>
          </div>
        </div>
      )}

      <div className="flex flex-1">
        {/* Mobile sidebar overlay */}
        {sidebarOpen && (
          <div
            className="fixed inset-0 bg-black/40 z-20 md:hidden"
            onClick={() => setSidebarOpen(false)}
          />
        )}

        {/* Sidebar */}
        <aside
          className={cn(
            "fixed top-0 left-0 h-full w-64 bg-white border-r border-gray-200 z-30 flex flex-col transition-transform duration-200",
            "md:translate-x-0 md:static md:z-auto",
            sidebarOpen ? "translate-x-0" : "-translate-x-full"
          )}
        >
          <div className="flex items-center justify-between p-4 border-b border-gray-200">
            <Link to="/dashboard" className="flex items-center gap-2 text-green-600 font-bold text-xl">
              <Sprout size={22} />
              Chia
            </Link>
            <button className="md:hidden" onClick={() => setSidebarOpen(false)}>
              <X size={20} className="text-gray-500" />
            </button>
          </div>

          <nav className="flex-1 p-4 overflow-y-auto">
            <Link
              to="/dashboard"
              onClick={() => setSidebarOpen(false)}
              className={cn(
                "flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium mb-4",
                location.pathname === "/dashboard"
                  ? "bg-green-50 text-green-700"
                  : "text-gray-600 hover:bg-gray-100"
              )}
            >
              Dashboard
            </Link>

            {groups.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide px-3 mb-2">
                  Groups
                </p>
                <ul className="space-y-1">
                  {groups.map((g) => (
                    <li key={g.id}>
                      <Link
                        to={`/groups/${g.id}`}
                        onClick={() => setSidebarOpen(false)}
                        className={cn(
                          "flex items-center justify-between px-3 py-2 rounded-lg text-sm",
                          location.pathname.startsWith(`/groups/${g.id}`)
                            ? "bg-green-50 text-green-700 font-medium"
                            : "text-gray-600 hover:bg-gray-100"
                        )}
                      >
                        <span className="truncate">{g.name}</span>
                        <span
                          className={cn(
                            "text-xs font-medium ml-2",
                            g.my_balance >= 0 ? "text-green-600" : "text-red-500"
                          )}
                        >
                          {g.my_balance >= 0 ? "+" : ""}
                          {formatAmount(g.my_balance, g.currency_code)}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </nav>

          <div className="p-4 border-t border-gray-200 space-y-1">
            {/* Install app button — always visible in sidebar if install is possible */}
            {canInstall && (
              showIOSInstructions ? (
                <div className="px-3 py-2 rounded-lg text-xs text-green-700 bg-green-50 w-full">
                  <p className="font-medium flex items-center gap-1.5 mb-0.5">
                    <Download size={14} /> Install App
                  </p>
                  <p className="text-green-600">
                    Tap the share button then "Add to Home Screen"
                  </p>
                </div>
              ) : (
                <button
                  onClick={async () => { await install(); }}
                  className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-green-700 bg-green-50 hover:bg-green-100 w-full font-medium transition-colors"
                >
                  <Download size={16} />
                  Install App
                </button>
              )
            )}
            <Link
              to="/profile"
              onClick={() => setSidebarOpen(false)}
              className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-gray-600 hover:bg-gray-100"
            >
              <User size={16} />
              {user?.display_name ?? "Profile"}
            </Link>
            <button
              onClick={handleLogout}
              className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-gray-600 hover:bg-gray-100 w-full"
            >
              <LogOut size={16} />
              Sign out
            </button>
          </div>
        </aside>

        {/* Main area */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Header */}
          <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
            <div className="flex items-center justify-between px-4 py-3">
              <div className="flex items-center gap-3">
                <button
                  className="md:hidden text-gray-500 hover:text-gray-700"
                  onClick={() => setSidebarOpen(true)}
                >
                  <Menu size={22} />
                </button>
                <Link to="/dashboard" className="md:hidden flex items-center gap-1 text-green-600 font-bold text-lg">
                  <Sprout size={18} />
                  Chia
                </Link>
              </div>

              <div className="flex items-center gap-2 ml-auto">
                {/* Install button in header — mobile only, shown if banner was dismissed */}
                {canInstall && !showBanner && (
                  <button
                    onClick={async () => { await install(); }}
                    className="md:hidden p-2 rounded-lg text-green-600 hover:bg-green-50"
                    title="Install Chia"
                  >
                    <Download size={20} />
                  </button>
                )}

                {/* Notifications */}
                <div className="relative">
                  <button
                    onClick={handleNotifClick}
                    className="relative p-2 rounded-lg text-gray-500 hover:bg-gray-100"
                  >
                    <Bell size={20} />
                    {unreadCount > 0 && (
                      <span className="absolute top-1 right-1 w-4 h-4 bg-red-500 rounded-full text-white text-xs flex items-center justify-center leading-none">
                        {unreadCount > 9 ? "9+" : unreadCount}
                      </span>
                    )}
                  </button>
                  {notifOpen && (
                    <div className="absolute right-0 top-full mt-1 w-72 bg-white border border-gray-200 rounded-xl shadow-lg z-50 overflow-hidden">
                      <div className="px-4 py-2 border-b border-gray-100 flex items-center justify-between">
                        <span className="text-sm font-semibold text-gray-700">Notifications</span>
                        <button
                          onClick={() => setNotifOpen(false)}
                          className="text-gray-400 hover:text-gray-600"
                        >
                          <X size={14} />
                        </button>
                      </div>
                      <div className="max-h-64 overflow-y-auto">
                        <p className="px-4 py-6 text-sm text-gray-400 text-center">
                          You're all caught up!
                        </p>
                      </div>
                    </div>
                  )}
                </div>

                {/* Profile */}
                <Link
                  to="/profile"
                  className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-gray-600 hover:bg-gray-100"
                >
                  <div className="w-7 h-7 rounded-full bg-green-100 text-green-700 flex items-center justify-center text-xs font-bold">
                    {user?.display_name?.[0]?.toUpperCase() ?? "?"}
                  </div>
                  <span className="hidden sm:inline">{user?.display_name}</span>
                  <ChevronDown size={14} className="hidden sm:inline text-gray-400" />
                </Link>
              </div>
            </div>
          </header>

          {/* Content */}
          <main className="flex-1 p-4 md:p-6 max-w-5xl w-full mx-auto">
            <Outlet />
          </main>
        </div>
      </div>
    </div>
  );
}
