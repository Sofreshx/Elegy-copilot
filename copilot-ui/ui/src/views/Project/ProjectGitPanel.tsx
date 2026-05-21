import { useStoreValue } from '../../lib/store';
import { projectOverviewStore } from './projectOverviewStore';
import RepositoryGitPanel from './RepositoryGitPanel';

export default function ProjectGitPanel() {
  const { projectInfo } = useStoreValue(projectOverviewStore);

  return <RepositoryGitPanel repoPath={projectInfo?.repoPath ?? null} mode="project" />;
}
