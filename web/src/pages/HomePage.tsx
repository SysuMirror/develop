import { Link } from 'react-router-dom';

interface EntryProps {
  to: string;
  title: string;
  desc: string;
}

function Entry({ to, title, desc }: EntryProps) {
  return (
    <Link className="entry-card" to={to}>
      <h2 className="entry-card__title">{title}</h2>
      <p className="entry-card__desc">{desc}</p>
      <span className="entry-card__more">进入 →</span>
    </Link>
  );
}

export default function HomePage() {
  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="page-title">概览</h1>
          <p className="page-sub">平台分成四块：概览、项目、需求、我的。从下面任意一张卡片进入。</p>
        </div>
      </div>

      <div className="entry-grid">
        <Entry to="/" title="概览" desc="平台四块内容的总览与说明。" />
        <Entry
          to="/projects"
          title="项目"
          desc="浏览全部项目、发起新项目；进入详情可审批加入申请、移除成员、转让或删除项目。"
        />
        <Entry to="/demands" title="需求" desc="看需求风向，发布需求、接单、标记完成。" />
        <Entry to="/me" title="我的" desc="待我审批、我发出的申请、我参与的项目与个人资料。" />
      </div>
    </div>
  );
}
