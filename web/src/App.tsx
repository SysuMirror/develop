import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { NavLink, Outlet, Route, Routes, Link, Navigate, useLocation } from 'react-router-dom';
import { useAuth } from './auth';
import { Avatar, Skeleton, displayName } from './ui';
import HomePage from './pages/HomePage';
import ProjectsPage from './pages/ProjectsPage';
import ProjectFormPage from './pages/ProjectFormPage';
import ProjectDetailPage from './pages/ProjectDetailPage';
import DemandNewPage from './pages/DemandNewPage';
import ApplyPage from './pages/ApplyPage';
import DemandsPage from './pages/DemandsPage';
import DemandDetailPage from './pages/DemandDetailPage';
import DemandEditPage from './pages/DemandEditPage';
import GuidePage from './pages/GuidePage';
import ProfilePage from './pages/ProfilePage';
import LoginPage from './pages/LoginPage';
import NoQualificationPage from './pages/NoQualificationPage';

interface NavItem {
  to: string;
  label: string;
  end?: boolean;
}

type NavIconName = 'home' | 'projects' | 'demands' | 'guide' | 'me';

interface MobileNavItem extends NavItem {
  icon: NavIconName;
}

const NAV: NavItem[] = [
  { to: '/', label: '概览', end: true },
  { to: '/projects', label: '项目' },
  { to: '/demands', label: '需求' },
  { to: '/guide', label: '上手' },
  { to: '/me', label: '我的' },
];

const MOBILE_NAV: MobileNavItem[] = [
  { to: '/', label: '概览', end: true, icon: 'home' },
  { to: '/projects', label: '项目', icon: 'projects' },
  { to: '/demands', label: '需求', icon: 'demands' },
  { to: '/guide', label: '上手', icon: 'guide' },
  { to: '/me', label: '我的', icon: 'me' },
];

function NavIcon({ name }: { name: NavIconName }) {
  if (name === 'home') {
    return (
      <svg className="mobile-menu__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M4 10.5 12 4l8 6.5" />
        <path d="M6 9.5V20h12V9.5" />
      </svg>
    );
  }
  if (name === 'projects') {
    return (
      <svg className="mobile-menu__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="4" y="4" width="7" height="7" rx="1.5" />
        <rect x="13" y="4" width="7" height="7" rx="1.5" />
        <rect x="4" y="13" width="7" height="7" rx="1.5" />
        <rect x="13" y="13" width="7" height="7" rx="1.5" />
      </svg>
    );
  }
  if (name === 'demands') {
    return (
      <svg className="mobile-menu__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M9 6h11M9 12h11M9 18h11" />
        <path d="M4.5 5.5 5.5 6.5 7.5 4.5M4.5 11.5 5.5 12.5 7.5 10.5M4.5 17.5 5.5 18.5 7.5 16.5" />
      </svg>
    );
  }
  if (name === 'guide') {
    return (
      <svg className="mobile-menu__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M5 5.5A2.5 2.5 0 0 1 7.5 3H19v15H7.5A2.5 2.5 0 0 0 5 20.5z" />
        <path d="M5 20.5V5.5" />
        <path d="M9 7.5h6M9 11h4" />
      </svg>
    );
  }
  return (
    <svg className="mobile-menu__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5 20c1.2-3.2 3.8-5 7-5s5.8 1.8 7 5" />
    </svg>
  );
}

function MiscIcon() {
  return (
    <svg className="mobile-nav__icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <circle cx="6" cy="12" r="1.6" />
      <circle cx="12" cy="12" r="1.6" />
      <circle cx="18" cy="12" r="1.6" />
    </svg>
  );
}

function MobileNav() {
  const { user } = useAuth();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    setOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      btnRef.current?.focus();
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  if (!user || location.pathname === '/login') return null;

  return (
    <div className="mobile-nav" ref={wrapRef}>
      <button
        ref={btnRef}
        type="button"
        className="mobile-nav__btn"
        aria-label="导航菜单"
        aria-expanded={open}
        aria-controls="mobile-nav"
        onClick={() => setOpen((value) => !value)}
      >
        <MiscIcon />
      </button>
      {open && (
        <nav className="mobile-menu" id="mobile-nav" aria-label="主导航">
          {MOBILE_NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className="mobile-menu__item"
              onClick={() => setOpen(false)}
            >
              <NavIcon name={item.icon} />
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>
      )}
    </div>
  );
}

function Header() {
  const { user, logout } = useAuth();
  const location = useLocation();
  return (
    <header className="site-header">
      <div className="site-header__inner">
        <Link className="brand" to="/">
          SSE_Market
          <span className="brand__mono">developer</span>
        </Link>
        {/* 未登录时不显示业务导航：点了也只会被弹回登录页。 */}
        {user ? (
          <nav className="site-nav">
            {NAV.map((item) => (
              <NavLink key={item.to} to={item.to} end={item.end}>
                {item.label}
              </NavLink>
            ))}
          </nav>
        ) : (
          <span className="site-nav" />
        )}
        {user ? (
          <div className="row" style={{ gap: 6 }}>
            <Link className="user-chip" to="/me">
              <Avatar name={displayName(user)} src={user.avatar} />
              <span className="user-chip__name">{displayName(user)}</span>
            </Link>
            <MobileNav />
            <button type="button" className="btn btn-ghost btn-sm header-logout" onClick={() => logout()}>
              退出
            </button>
          </div>
        ) : location.pathname === '/login' ? null : (
          <Link className="btn btn-primary btn-sm" to="/login">
            登录
          </Link>
        )}
      </div>
    </header>
  );
}

function Footer() {
  return (
    <footer className="site-footer">
      <div className="site-footer__inner">
        <span>SSE_Market · 开发者平台</span>
        <span>软件工程学院 · 项目协作与需求发布</span>
      </div>
    </footer>
  );
}

function Layout() {
  return (
    <>
      <Header />
      <main className="page-main">
        <Outlet />
      </main>
      <Footer />
    </>
  );
}

function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) {
    return (
      <div>
        <Skeleton rows={5} />
      </div>
    );
  }
  if (!user) {
    const target = location.pathname + location.search;
    return <Navigate to={`/login?redirect=${encodeURIComponent(target)}`} replace />;
  }
  // 服务端已按资格拦截业务接口，这里只负责给出可操作的提示页。
  if (user.developer !== true) return <NoQualificationPage />;
  return <>{children}</>;
}

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route
          index
          element={
            <RequireAuth>
              <HomePage />
            </RequireAuth>
          }
        />
        <Route path="login" element={<LoginPage />} />
        <Route
          path="projects"
          element={
            <RequireAuth>
              <ProjectsPage />
            </RequireAuth>
          }
        />
        <Route
          path="projects/new"
          element={
            <RequireAuth>
              <ProjectFormPage />
            </RequireAuth>
          }
        />
        <Route
          path="projects/:id/edit"
          element={
            <RequireAuth>
              <ProjectFormPage />
            </RequireAuth>
          }
        />
        <Route
          path="projects/:id/demands/new"
          element={
            <RequireAuth>
              <DemandNewPage />
            </RequireAuth>
          }
        />
        <Route
          path="projects/:id/apply"
          element={
            <RequireAuth>
              <ApplyPage />
            </RequireAuth>
          }
        />
        <Route
          path="projects/:id"
          element={
            <RequireAuth>
              <ProjectDetailPage />
            </RequireAuth>
          }
        />
        <Route
          path="demands"
          element={
            <RequireAuth>
              <DemandsPage />
            </RequireAuth>
          }
        />
        <Route
          path="demands/:id/edit"
          element={
            <RequireAuth>
              <DemandEditPage />
            </RequireAuth>
          }
        />
        <Route
          path="demands/:id"
          element={
            <RequireAuth>
              <DemandDetailPage />
            </RequireAuth>
          }
        />
        <Route
          path="guide"
          element={
            <RequireAuth>
              <GuidePage />
            </RequireAuth>
          }
        />
        <Route
          path="me"
          element={
            <RequireAuth>
              <ProfilePage />
            </RequireAuth>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
