import RepositoryGitPanel from '../Project/RepositoryGitPanel';

interface SessionGitPanelProps {
  repoPath: string | null;
}

export default function SessionGitPanel({ repoPath }: SessionGitPanelProps) {
  return <RepositoryGitPanel repoPath={repoPath} mode="session" />;
}
