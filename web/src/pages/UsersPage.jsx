import { useState } from 'react';
import { Link } from 'react-router-dom';
import { qs } from '../api.js';
import { useApi, useDebounced } from '../hooks.js';
import { Avatar, Empty, Pager, Skeleton } from '../ui.jsx';

export default function DevelopersPage() {
  const [term, setTerm] = useState('');
  const [page, setPage] = useState(1);
  const q = useDebounced(term);
  const pageSize = 20;
  const { data, loading, error } = useApi(`/developers${qs({ q, page, pageSize })}`);
  const items = data?.items ?? [];

  let content;
  if (loading) {
    content = <Skeleton rows={5} />;
  } else if (error) {
    content = <div className="notice notice-error">{error.message}</div>;
  } else if (items.length === 0) {
    content = <Empty title="没有匹配的开发者" hint="换个关键词试试。" />;
  } else {
    content = (
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>开发者</th>
              <th className="right">参与项目</th>
              <th className="right">担任 Leader</th>
              <th className="right">操作</th>
            </tr>
          </thead>
          <tbody>
            {items.map((developer) => (
              <tr key={developer.id}>
                <td>
                  <div className="row" style={{ gap: 8 }}>
                    <Avatar name={developer.name} src={developer.avatar} />
                    <span className="cell-title">{developer.name}</span>
                  </div>
                </td>
                <td className="right">{developer.projectCount}</td>
                <td className="right">{developer.leadCount}</td>
                <td className="right">
                  <Link className="btn btn-secondary btn-sm" to={`/developers/${developer.id}`}>
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
          <h1 className="page-title">开发者</h1>
          <p className="page-sub">所有通过统一身份登录过的开发者，以及他们参与的项目。</p>
        </div>
      </div>

      <div className="toolbar">
        <div className="search">
          <input
            className="input"
            placeholder="搜索开发者姓名"
            value={term}
            onChange={(event) => {
              setTerm(event.target.value);
              setPage(1);
            }}
          />
        </div>
      </div>

      {content}
      <Pager page={data?.page ?? page} pageSize={data?.pageSize ?? pageSize} total={data?.total ?? 0} onPage={setPage} />
    </div>
  );
}
