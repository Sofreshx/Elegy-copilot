import SteppedWizard from '../../components/SteppedWizard';
import { useStoreValue } from '../../lib/store';
import { navigationStore } from '../../stores/navigation';
import { sessionWizardStore } from './sessionWizardStore';
import ProjectStep from './steps/ProjectStep';
import ObjectiveStep from './steps/ObjectiveStep';
import IsolationStep from './steps/IsolationStep';
import LaunchStep from './steps/LaunchStep';

const WIZARD_STEPS = [
  { id: 'project', label: 'Project', description: 'Choose a repository' },
  { id: 'objective', label: 'Objective', description: 'Define the goal' },
  { id: 'isolation', label: 'Isolation', description: 'Pick an environment' },
  { id: 'launch', label: 'Launch', description: 'Review and launch' },
];

function isStepValid(state: ReturnType<typeof sessionWizardStore.getState>, index: number): boolean {
  switch (index) {
    case 0:
      return state.selectedProject !== null || (state.useCustomRepo && state.customRepoPath.trim().length > 0);
    case 1:
    case 2:
    case 3:
      return true;
    default:
      return true;
  }
}

export default function SessionWizard() {
  const state = useStoreValue(sessionWizardStore);

  const stepsWithValidity = WIZARD_STEPS.map((step, i) => ({
    ...step,
    isValid: isStepValid(state, i),
  }));

  function handleStepChange(index: number) {
    sessionWizardStore.setStep(index);
  }

  async function handleComplete() {
    try {
      const session = await sessionWizardStore.launch();
      if (session.sessionId) {
        navigationStore.selectSession(session.sessionId);
      }
      navigationStore.closeWizard();
      sessionWizardStore.reset();
    } catch {
      // launchError is already set in the store
    }
  }

  function handleCancel() {
    navigationStore.closeWizard();
    sessionWizardStore.reset();
  }

  return (
    <div className="session-wizard" data-testid="session-wizard">
      <SteppedWizard
        steps={stepsWithValidity}
        activeStepIndex={state.step}
        onStepChange={handleStepChange}
        onComplete={handleComplete}
        onCancel={handleCancel}
        completeLabel={state.launching ? 'Launching…' : 'Launch Session'}
        testId="session-wizard-stepped"
      >
        {state.step === 0 ? <ProjectStep state={state} /> : null}
        {state.step === 1 ? <ObjectiveStep state={state} /> : null}
        {state.step === 2 ? <IsolationStep state={state} /> : null}
        {state.step === 3 ? <LaunchStep state={state} /> : null}
      </SteppedWizard>
    </div>
  );
}
