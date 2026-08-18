import { NavLink, useLocation } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { usePendingCounts } from "@/hooks/usePendingCounts";
import { t, useLang, toggleLang } from "@/lib/i18n";
import { useState } from "react";
import styles from "./Shell.module.css";

const NAV = [
  { to: "/", label: "Overview", short: "Overview", icon: "◐", end: true },
  { to: "/rankings", label: "Rankings", short: "Rankings", icon: "☰" },
  { to: "/rounds", label: "Rounds", short: "Rounds", icon: "◷" },
  { to: "/log", label: "Log Round", short: "Log", icon: "✎" },
  { to: "/fairmatch", label: "Fair Match", short: "Match", icon: "⚖" },
  { to: "/friends", label: "Friends", short: "Friends", icon: "♡" },
  { to: "/profile", label: "Profile", short: "Profile", icon: "◉" },
];

function pageTitle(pathname: string): string {
  const match = NAV.find((n) => (n.end ? pathname === n.to : pathname.startsWith(n.to)));
  return match ? t(match.label) : "FORM";
}

export default function Shell({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuth();
  const location = useLocation();
  const lang = useLang();
  const [drawer, setDrawer] = useState(false);
  const { attestationsCount, friendRequestsCount } = usePendingCounts();

  if (!user) return <>{children}</>;

  const closeDrawer = () => setDrawer(false);

  const badges: Record<string, number> = {
    "/friends": friendRequestsCount,
    "/profile": attestationsCount,
  };

  const navItems = NAV.map((n) => (
    <NavLink
      key={n.to}
      to={n.to}
      end={n.end}
      onClick={closeDrawer}
      className={({ isActive }) =>
        `${styles.navItem} ${isActive ? styles.navActive : ""}`
      }
    >
      <span className={styles.navIcon}>{n.icon}</span>
      <span className={styles.navLabel}>{t(n.label)}</span>
      {badges[n.to] > 0 && (
        <span className={styles.navBadge} aria-label={t("{n} need your attention", { n: badges[n.to] })}>
          {badges[n.to]}
        </span>
      )}
    </NavLink>
  ));

  return (
    <div className={styles.shell}>
      {/* ── Sidebar (desktop) ── */}
      <aside className={styles.sidebar}>
        <div className={styles.brand}>
          <span className={styles.logo}>FORM</span>
          <span className={styles.brandSub}>{t("Know where you stand")}</span>
        </div>
        <nav className={styles.nav}>{navItems}</nav>
        <div className={styles.sidebarFooter}>
          <div className={styles.userChip}>
            <span className={styles.avatar}>{user.displayName.charAt(0).toUpperCase()}</span>
            <div className={styles.userMeta}>
              <span className={styles.userName}>{user.displayName}</span>
              <span className={styles.userEmail}>{user.email}</span>
            </div>
          </div>
          <div className={styles.footActions}>
            <button onClick={toggleLang} className={styles.iconBtn} title={t("Switch language")}>
              {lang === "en" ? "中文" : "EN"}
            </button>
            <button onClick={logout} className={styles.iconBtn} title={t("Sign out")} aria-label={t("Sign out")}>→</button>
          </div>
        </div>
      </aside>

      {/* ── Mobile drawer ── */}
      {drawer && <div className={styles.overlay} onClick={closeDrawer} />}
      <aside className={`${styles.drawer} ${drawer ? styles.drawerOpen : ""}`}>
        <div className={styles.drawerHead}>
          <span className={styles.logo}>FORM</span>
          <button className={styles.iconBtn} onClick={closeDrawer} aria-label={t("Close menu")}>✕</button>
        </div>
        <nav className={styles.nav}>{navItems}</nav>
      </aside>

      {/* ── Main ── */}
      <div className={styles.main}>
        <header className={styles.topbar}>
          <button className={styles.menuBtn} onClick={() => setDrawer(true)} aria-label="Menu">
            ☰
          </button>
          <span className={styles.pageTitle}>{pageTitle(location.pathname)}</span>
          <div className={styles.topActions}>
            <button onClick={toggleLang} className={styles.iconBtn} title={t("Switch language")}>
              {lang === "en" ? "中文" : "EN"}
            </button>
            <NavLink to="/profile" className={styles.avatarBtn} title={t("Profile")}>
              {user.displayName.charAt(0).toUpperCase()}
              {attestationsCount > 0 && <span className={styles.bnBadge} />}
            </NavLink>
          </div>
        </header>
        {/* key={lang} remounts the page tree so every t() call re-evaluates on toggle */}
        <div className={styles.content} key={lang}>{children}</div>

        {/* ── Bottom nav (mobile) ── */}
        <nav className={styles.bottomNav}>
          {NAV.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.end}
              className={({ isActive }) =>
                `${styles.bnItem} ${isActive ? styles.bnActive : ""}`
              }
            >
              <span className={styles.bnIconWrap}>
                <span className={styles.bnIcon}>{n.icon}</span>
                {badges[n.to] > 0 && <span className={styles.bnBadge} />}
              </span>
              <span className={styles.bnLabel}>{t(n.short)}</span>
            </NavLink>
          ))}
        </nav>
      </div>
    </div>
  );
}

