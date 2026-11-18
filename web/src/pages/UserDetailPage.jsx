import { Link, useParams } from 'react-router-dom';
import { useApi } from '../hooks.js';
import {
  APPLY_STATUS,
  APPLY_TYPE,
  DEMAND_STATUS,
  ROLE,
  Avatar,
  Badge,
  Empty,
  Skeleton,
  StatusBadge,
  TimeAgo,
  displayName,
} from '../ui.jsx';

// developer 为 null 说明资料只来自缓存，UniSSO 的资格字段还没拿到。
const QUALIFICATION_LABEL = { true: '开发者', false: '未获得开发者资格', null: '资格未知' };

export default function UserDetailPage() {
  const { id } = useParams();
  const { data, loading, error } = useApi(`/users/${id}`);

  if (loading) {
    return (
      <div>
        <Skeleton rows={6} />
      </div>
    );
  }
  if (error) {
    return (
      <div className="notice notice-error">
        {error.message} · <Link to="/users">返回用户列表</Link>
      </div>
    );
  }

  return (
    <div>
      <Link className="btn-link" to="/users">
        ← 用户列表
      </Link>

      <div className="page-head" style={{ marginTop: 10 }}>
        <div className="row" style={{ gap: 14 }}>
          <Avatar name={displayName(data)} src={data.avatar} size="lg" />
          <div>
            <div className="row" style={{ gap: 8 }}>
              <h1 className="page-title">{displayName(data)}</h1>
              <Badge tone={data.developer ? 'green' : 'gray'}>{QUALIFICATION_LABEL[data.developer]}</Badge>
            </div>
            <p className="page-sub" style={{ marginTop: 2 }}>
              {data.email || '未提供邮箱'}
            </p>
          </div>
        </div>
      </div>

      <div className="section-head">
        <h2>参与项目</h2>
        <span className="faint">{data.projects.length} 个</span>
      </div>
      {data.projects.length === 0 ? (
        <Empty title="还没有参与项目" hint="可以在项目页提交加入申请。" />
      ) : (
        <div className="panel">
          <div className="list">
            {data.projects.map((project) => (
              <div className="list__row" key={project.projectId}>
                <div className="grow">
                  <Link to={`/projects/${project.projectId}`}>{project.title}</Link>
                  <div className="faint">
                    加入于 <TimeAgo value={project.joinedAt} />
                  </div>
                </div>
                <StatusBadge map={ROLE} value={project.role} />
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="section-head">
        <h2>发出的申请</h2>
        <span className="faint">{data.applies.length} 条</span>
      </div>
      {data.applies.length === 0 ? (
        <Empty title="没有申请记录" hint="申请记录会保留最近 20 条。" />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>项目</th>
                <th>类型</th>
                <th>状态</th>
                <th className="right">时间</th>
              </tr>
            </thead>
            <tbody>
              {data.applies.map((apply) => (
                <tr key={apply.id}>
                  <td>
                    <Link to={`/projects/${apply.project_id}`}>{apply.project_title}</Link>
                  </td>
                  <td>
                    <StatusBadge map={APPLY_TYPE} value={apply.type} />
                  </td>
                  <td>
                    <StatusBadge map={APPLY_STATUS} value={apply.status} />
                  </td>
                  <td className="right">
                    <TimeAgo value={apply.created_at} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="section-head">
        <h2>接下的需求</h2>
        <span className="faint">{data.demands.length} 条</span>
      </div>
      {data.demands.length === 0 ? (
        <Empty title="还没有接单记录" hint="去需求页看看有哪些待接单的任务。" />
      ) : (
        <div className="panel">
          <div className="list">
            {data.demands.map((demand) => (
              <div className="list__row" key={demand.id}>
                <div className="grow">
                  <Link to={`/projects/${demand.project_id}`}>{demand.title}</Link>
                  <div className="faint">
                    {demand.project_title} · <TimeAgo value={demand.created_at} />
                  </div>
                </div>
                <StatusBadge map={DEMAND_STATUS} value={demand.status} />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
