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

const NAV: NavItem[] = [
  { to: '/', label: '概览', end: true },
  { to: '/projects', label: '项目' },
  { to: '/demands', label: '需求' },
  { to: '/me', label: '我的' },
];

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
              {displayName(user)}
            </Link>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => logout()}>
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
