import { useState, useEffect } from "react";
import { Link, Outlet, useNavigate, useLocation } from "react-router-dom";
import {
  Bell, User, LogOut, Menu, X, Download, Sprout,
  LayoutGrid, Wallet, Check,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import LanguageSwitcher from "@/components/LanguageSwitcher";
import { Trans, useTranslation } from "react-i18next";
import { useNotifications } from "@/hooks/useNotifications";
import { useInstallPrompt } from "@/hooks/useInstallPrompt";
import { listGroups } from "@/api/groups";
import type { GroupListItem } from "@/types";
import type { Notification } from "@/types";
import { cn } from "@/lib/utils";
import type { TFunction } from "i18next";
import { formatAmount, formatCurrency, formatNumber } from "@/utils/currency";
import { formatRelativeTime } from "@/utils/date";

function getNotificationText(notification: Notification, t: TFunction, currencyCode?: string): string {
  const { type, data } = notification;
  const money = (v: unknown) =>
    v == null || v === "" ? "" : currencyCode ? formatCurrency(String(v), currencyCode) : formatAmount(String(v));
  const description = String(data.description ?? "—");
  switch (type) {
    case "expense_added":
    case "expense_updated":
    case "expense_deleted":
      return t(`notification.${type}`, { description });
    case "settlement_recorded":
    case "settlement_confirmed":
      return t(`notification.${type}`, { amount: money(data.amount) });
    case "distribution_recorded":
      return t("notification.distribution_recorded", {
        from: String(data.from ?? "—"),
        total: money(data.total),
        recipient_count: formatNumber(Number(data.recipient_count ?? 0)),
      });
    default:
      return data.description
        ? String(data.description)
        : type.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  }
}

export default function AppLayout() {
  const { t } = useTranslation("common");
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { notifications, unreadCount, markRead, markAllRead } = useNotifications();
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
  }

  function handleNotifItemClick(notification: Notification) {
    if (!notification.read) {
      markRead(notification.id);
    }
    // Take the user to the group the notification is about
    if (notification.group_id && groups.some((g) => g.id === notification.group_id)) {
      setNotifOpen(false);
      navigate(`/groups/${notification.group_id}`);
    }
  }

  return (
    <div className="min-h-screen bg-surface flex flex-col">
      {/* Install banner */}
      {showBanner && (
        <div className="bg-gradient-to-r from-primary to-secondary text-on-primary px-4 py-3 flex items-center justify-between gap-3 z-50">
          <div className="flex items-center gap-3 min-w-0">
            <Sprout size={20} className="flex-shrink-0" />
            {showIOSInstructions ? (
              <p className="text-sm font-medium">
                <Trans
                  t={t}
                  i18nKey="install_ios"
                  components={{
                    b: <strong />,
                    icon: (
                      <span className="inline-flex items-center justify-center w-6 h-6 border border-white/50 rounded align-middle mx-0.5" aria-label="Share">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg>
                      </span>
                    ),
                  }}
                />
              </p>
            ) : (
              <p className="text-sm font-medium truncate">{t("install_banner")}</p>
            )}
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {!showIOSInstructions && (
              <button
                onClick={async () => { await install(); }}
                className="bg-white text-primary font-semibold text-sm px-4 py-1.5 rounded-full hover:bg-primary-container/30 transition-colors"
              >
                {t("install")}
              </button>
            )}
            <button aria-label={t("close", { ns: "common" })} onClick={dismissBanner} className="text-white/70 hover:text-white p-2.5 -m-1.5 rounded-full">
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
            "fixed top-0 left-0 h-full w-[240px] bg-surface-container-lowest z-30 flex flex-col transition-transform duration-200",
            "md:translate-x-0 md:static md:z-auto",
            sidebarOpen ? "translate-x-0" : "-translate-x-full"
          )}
        >
          {/* Logo */}
          <div className="flex items-center justify-between px-5 pt-6 pb-4">
            <Link to="/dashboard" onClick={() => setSidebarOpen(false)} className="flex items-center gap-2">
              <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
                <Sprout size={16} className="text-on-primary" />
              </div>
              <div>
                <span className="font-bold text-on-surface text-base">Chia</span>
                <p className="text-[10px] text-outline uppercase tracking-wider leading-none">{t("split_expenses")}</p>
              </div>
            </Link>
            <button aria-label={t("close", { ns: "common" })} className="md:hidden text-on-surface-variant hover:text-on-surface" onClick={() => setSidebarOpen(false)}>
              <X size={20} />
            </button>
          </div>

          {/* Main nav */}
          <nav className="flex-1 px-3 py-2 overflow-y-auto">
            <Link
              to="/dashboard"
              onClick={() => setSidebarOpen(false)}
              className={cn(
                "flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium mb-1 transition-colors",
                location.pathname === "/dashboard"
                  ? "bg-primary-container/20 text-primary"
                  : "text-on-surface-variant hover:bg-surface-container"
              )}
            >
              <LayoutGrid size={18} />
              {t("dashboard")}
            </Link>

            <Link
              to="/profile"
              onClick={() => setSidebarOpen(false)}
              className={cn(
                "flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium mb-1 transition-colors",
                location.pathname === "/profile"
                  ? "bg-primary-container/20 text-primary"
                  : "text-on-surface-variant hover:bg-surface-container"
              )}
            >
              <User size={18} />
              {t("profile")}
            </Link>

            {/* Groups list */}
            {groups.length > 0 && (
              <div className="mt-4 pt-4 border-t border-outline-variant/10">
                <p className="text-[10px] font-semibold text-outline uppercase tracking-wider px-3 mb-2">
                  {t("groups")}
                </p>
                <ul className="space-y-0.5">
                  {groups.map((g) => (
                    <li key={g.id}>
                      <Link
                        to={`/groups/${g.id}`}
                        onClick={() => setSidebarOpen(false)}
                        className={cn(
                          "flex items-center justify-between px-3 py-2 rounded-xl text-sm transition-colors",
                          location.pathname.startsWith(`/groups/${g.id}`)
                            ? "bg-primary-container/20 text-primary font-medium"
                            : "text-on-surface-variant hover:bg-surface-container"
                        )}
                      >
                        <span className="truncate">{g.name}</span>
                        <span
                          className={cn(
                            "text-xs font-semibold ml-2 tabular-nums whitespace-nowrap flex-shrink-0",
                            g.my_balance >= 0 ? "text-primary" : "text-error"
                          )}
                        >
                          {g.my_balance >= 0 ? "+" : ""}
                          {formatCurrency(g.my_balance, g.currency_code)}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </nav>

          {/* Bottom actions */}
          <div className="px-3 py-4 space-y-0.5">
            {canInstall && !showIOSInstructions && (
              <button
                onClick={async () => { await install(); }}
                className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-primary bg-primary-container/15 hover:bg-primary-container/25 w-full font-medium transition-colors"
              >
                <Download size={18} />
                {t("install_app")}
              </button>
            )}
            <button
              onClick={handleLogout}
              className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-error hover:bg-error-container/15 w-full transition-colors"
            >
              <LogOut size={18} />
              {t("log_out")}
            </button>
          </div>
        </aside>

        {/* Main area */}
        <div className="flex-1 flex flex-col min-w-0 pb-16 md:pb-0">
          {/* Top bar — glass effect */}
          <header className="bg-surface-container-lowest/80 glass-blur sticky top-0 z-10">
            <div className="flex items-center justify-between px-4 md:px-6 py-3">
              {/* Left: hamburger (mobile) + logo */}
              <div className="flex items-center gap-3">
                <button aria-label={t("menu", { ns: "common" })}
                  className="md:hidden text-on-surface-variant hover:text-on-surface"
                  onClick={() => setSidebarOpen(true)}
                >
                  <Menu size={22} />
                </button>
                <Link to="/dashboard" className="md:hidden flex items-center gap-1.5">
                  <div className="w-7 h-7 bg-primary rounded-lg flex items-center justify-center">
                    <Sprout size={14} className="text-on-primary" />
                  </div>
                  <span className="font-bold text-on-surface">Chia</span>
                </Link>
              </div>

              {/* Right: actions */}
              <div className="flex items-center gap-1 ml-auto">
                {canInstall && !showBanner && (
                  <button
                    onClick={async () => { await install(); }}
                    className="md:hidden p-2 rounded-xl text-primary hover:bg-primary-container/20"
                    title={t("install_app")} aria-label={t("install_app")}
                  >
                    <Download size={20} />
                  </button>
                )}

                {/* Notifications */}
                <div className="relative">
                  <button
                    onClick={handleNotifClick}
                    className="relative p-2 rounded-xl text-on-surface-variant hover:bg-surface-container"
                  >
                    <Bell size={20} />
                    {unreadCount > 0 && (
                      <span className="absolute top-1 right-1 w-4 h-4 bg-error rounded-full text-on-error text-[10px] flex items-center justify-center leading-none font-bold">
                        {unreadCount > 9 ? "9+" : unreadCount}
                      </span>
                    )}
                  </button>
                  {notifOpen && (
                    <div className="fixed inset-x-4 top-16 sm:absolute sm:inset-x-auto sm:right-0 sm:top-full sm:mt-2 sm:w-80 bg-surface-container-lowest rounded-2xl shadow-editorial-xl z-50 overflow-hidden">
                      <div className="px-5 py-3 flex items-center justify-between">
                        <span className="text-sm font-bold text-on-surface">{t("notifications")}</span>
                        <div className="flex items-center gap-1">
                          {unreadCount > 0 && (
                            <button
                              onClick={() => markAllRead()}
                              className="text-xs text-primary hover:text-primary-dim font-medium px-2 py-1 rounded-lg hover:bg-primary-container/20 transition-colors flex items-center gap-1"
                            >
                              <Check size={12} />
                              {t("mark_all_read")}
                            </button>
                          )}
                          <button aria-label={t("close", { ns: "common" })}
                            onClick={() => setNotifOpen(false)}
                            className="text-outline hover:text-on-surface-variant p-1 rounded-lg hover:bg-surface-container"
                          >
                            <X size={14} />
                          </button>
                        </div>
                      </div>
                      <div className="max-h-72 overflow-y-auto px-3 pb-3">
                        {notifications.length === 0 ? (
                          <p className="py-8 text-sm text-outline text-center">
                            {t("all_caught_up")}
                          </p>
                        ) : (
                          <div className="space-y-1">
                            {notifications.map((n) => (
                              <button
                                key={n.id}
                                onClick={() => handleNotifItemClick(n)}
                                className={cn(
                                  "w-full text-left px-3 py-2.5 rounded-xl transition-colors flex items-start gap-3",
                                  n.read
                                    ? "hover:bg-surface-container/50"
                                    : "bg-primary-container/10 hover:bg-primary-container/20"
                                )}
                              >
                                {/* Unread dot */}
                                <div className="mt-1.5 flex-shrink-0">
                                  {!n.read ? (
                                    <span className="block w-2 h-2 rounded-full bg-primary" />
                                  ) : (
                                    <span className="block w-2 h-2" />
                                  )}
                                </div>
                                <div className="min-w-0 flex-1">
                                  <p className={cn(
                                    "text-sm leading-snug",
                                    n.read ? "text-on-surface-variant" : "text-on-surface font-medium"
                                  )}>
                                    {getNotificationText(n, t, groups.find((g) => g.id === n.group_id)?.currency_code)}
                                  </p>
                                  <p className="text-[11px] text-outline mt-0.5">
                                    {formatRelativeTime(n.created_at, (k) => t(k))}
                                  </p>
                                </div>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>

                {/* Language */}
                <LanguageSwitcher compact />

                {/* Profile avatar */}
                <Link
                  to="/profile"
                  className="flex items-center gap-2 p-1.5 rounded-xl hover:bg-surface-container transition-colors"
                >
                  <div className="w-8 h-8 rounded-full bg-primary-container/40 text-primary flex items-center justify-center text-xs font-bold">
                    {user?.display_name?.[0]?.toUpperCase() ?? "?"}
                  </div>
                  <span className="hidden md:inline text-sm font-medium text-on-surface">{user?.display_name}</span>
                </Link>
              </div>
            </div>
          </header>

          {/* Content */}
          <main className="flex-1 px-4 md:px-8 py-6 max-w-6xl w-full mx-auto">
            <Outlet />
          </main>
        </div>
      </div>

      {/* Mobile bottom navigation */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-surface-container-lowest/90 glass-blur z-20 border-t border-outline-variant/10">
        <div className="flex items-center justify-around px-2 py-2">
          <Link
            to="/dashboard"
            className={cn(
              "flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-xl min-w-[60px] transition-colors",
              location.pathname === "/dashboard"
                ? "text-primary bg-primary-container/20"
                : "text-on-surface-variant"
            )}
          >
            <LayoutGrid size={20} />
            <span className="text-[10px] font-medium">{t("dashboard")}</span>
          </Link>
          {groups.length > 0 ? (
            <Link
              to={`/groups/${groups[0].id}`}
              className={cn(
                "flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-xl min-w-[60px] transition-colors",
                location.pathname.startsWith("/groups/")
                  ? "text-primary bg-primary-container/20"
                  : "text-on-surface-variant"
              )}
            >
              <Wallet size={20} />
              <span className="text-[10px] font-medium">{t("groups")}</span>
            </Link>
          ) : (
            <Link
              to="/dashboard"
              className="flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-xl min-w-[60px] text-on-surface-variant"
            >
              <Wallet size={20} />
              <span className="text-[10px] font-medium">{t("groups")}</span>
            </Link>
          )}
          <Link
            to="/profile"
            className={cn(
              "flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-xl min-w-[60px] transition-colors",
              location.pathname === "/profile"
                ? "text-primary bg-primary-container/20"
                : "text-on-surface-variant"
            )}
          >
            <User size={20} />
            <span className="text-[10px] font-medium">{t("profile")}</span>
          </Link>
        </div>
      </nav>
    </div>
  );
}
