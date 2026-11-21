import { NavLink, Outlet, Route, Routes, Link, Navigate, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
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
import ProfilePage from './pages/ProfilePage';
import LoginPage from './pages/LoginPage';
import NoQualificationPage from './pages/NoQualificationPage';

interface NavItem {
  to: string;
  label: string;
  end?: boolean;
}

type TabIconName = 'home' | 'projects' | 'demands' | 'me';

interface TabItem extends NavItem {
  icon: TabIconName;
}

const NAV: NavItem[] = [
  { to: '/', label: '概览', end: true },
  { to: '/projects', label: '项目' },
  { to: '/demands', label: '需求' },
  { to: '/me', label: '我的' },
];

const TAB_NAV: TabItem[] = [
  { to: '/', label: '概览', end: true, icon: 'home' },
  { to: '/projects', label: '项目', icon: 'projects' },
  { to: '/demands', label: '需求', icon: 'demands' },
  { to: '/me', label: '我的', icon: 'me' },
];

function TabIcon({ name }: { name: TabIconName }) {
  if (name === 'home') {
    return (
      <svg className="tabbar__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M4 10.5 12 4l8 6.5" />
        <path d="M6 9.5V20h12V9.5" />
      </svg>
    );
  }
  if (name === 'projects') {
    return (
      <svg className="tabbar__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="4" y="4" width="7" height="7" rx="1.5" />
        <rect x="13" y="4" width="7" height="7" rx="1.5" />
        <rect x="4" y="13" width="7" height="7" rx="1.5" />
        <rect x="13" y="13" width="7" height="7" rx="1.5" />
      </svg>
    );
  }
  if (name === 'demands') {
    return (
      <svg className="tabbar__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M9 6h11M9 12h11M9 18h11" />
        <path d="M4.5 5.5 5.5 6.5 7.5 4.5M4.5 11.5 5.5 12.5 7.5 10.5M4.5 17.5 5.5 18.5 7.5 16.5" />
      </svg>
    );
  }
  return (
    <svg className="tabbar__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5 20c1.2-3.2 3.8-5 7-5s5.8 1.8 7 5" />
    </svg>
  );
}

function MobileTabBar() {
  const { user } = useAuth();
  const location = useLocation();
  if (!user || location.pathname === '/login') return null;
  return (
    <nav className="tabbar" aria-label="主导航">
      {TAB_NAV.map((item) => (
        <NavLink key={item.to} to={item.to} end={item.end} className="tabbar__item">
          <TabIcon name={item.icon} />
          <span>{item.label}</span>
        </NavLink>
      ))}
    </nav>
  );
}

function Header() {
  const { user, logout } = useAuth();
  return (
    <header className="site-header">
      <div className="site-header__inner">
        <Link className="brand" to="/">
          SSE_Market
          <span className="brand__mono">developer</span>
        </Link>
        <nav className="site-nav">
          {NAV.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end}>
              {item.label}
            </NavLink>
          ))}
        </nav>
        {user ? (
          <div className="row" style={{ gap: 6 }}>
            <Link className="user-chip" to="/me">
              <Avatar name={displayName(user)} src={user.avatar} />
              <span className="user-chip__name">{displayName(user)}</span>
            </Link>
            <button type="button" className="btn btn-ghost btn-sm header-logout" onClick={() => logout()}>
              退出
            </button>
          </div>
        ) : (
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
        <span>软件工程学院 · 项目 / 申请 / 需求撮合</span>
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
      <MobileTabBar />
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
