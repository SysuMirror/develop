import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { ReactNode } from 'react';
import { qs } from '../api';
import { useApi, useDebounced } from '../hooks';
import { Avatar, Empty, Pager, Skeleton, displayName } from '../ui';
import type { UserListPage } from '../types';

export default function UsersPage() {
  const [term, setTerm] = useState('');
  const [page, setPage] = useState(1);
  const q = useDebounced(term);
  const pageSize = 20;
  const { data, loading, error } = useApi<UserListPage>(`/users${qs({ q, page, pageSize })}`);
  const items = data?.items ?? [];

  let content: ReactNode;
  if (loading) {
    content = <Skeleton rows={5} />;
  } else if (error) {
    content = <div className="notice notice-error">{error.message}</div>;
  } else if (items.length === 0) {
    content = <Empty title="没有匹配的用户" hint="换个关键词试试。" />;
  } else {
    content = (
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>用户</th>
              <th className="right">参与项目</th>
              <th className="right">担任 Leader</th>
              <th className="right">操作</th>
            </tr>
          </thead>
          <tbody>
            {items.map((user) => (
              <tr key={user.id}>
                <td>
                  <div className="row" style={{ gap: 8 }}>
                    <Avatar name={displayName(user)} src={user.avatar} />
                    <span className="cell-title">{displayName(user)}</span>
                  </div>
                </td>
                <td className="right">{user.projectCount}</td>
                <td className="right">{user.leadCount}</td>
                <td className="right">
                  <Link className="btn btn-secondary btn-sm" to={`/users/${user.id}`}>
                    查看
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="page-title">用户</h1>
          <p className="page-sub">所有参与过项目的统一身份用户，资料实时取自 UniSSO 目录。</p>
        </div>
      </div>

      <div className="toolbar">
        <div className="search">
          <input
            className="input"
            placeholder="搜索姓名或用户名"
            value={term}
            onChange={(event) => {
              setTerm(event.target.value);
              setPage(1);
            }}
          />
        </div>
      </div>

      {data?.directoryStale ? (
        <div className="notice notice-info">UniSSO 目录暂时不可用，查不到的人显示为「未知用户」。</div>
      ) : null}

      {content}
      <Pager page={data?.page ?? page} pageSize={data?.pageSize ?? pageSize} total={data?.total ?? 0} onPage={setPage} />
    </div>
  );
}
