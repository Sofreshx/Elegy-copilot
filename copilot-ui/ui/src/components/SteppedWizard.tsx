import { ReactNode } from 'react';

interface WizardStep {
  id: string;
  label: string;
  description?: string;
  isValid?: boolean;
}

interface SteppedWizardProps {
  steps: WizardStep[];
  activeStepIndex: number;
  onStepChange: (index: number) => void;
  onComplete: () => void;
  onCancel: () => void;
  completeLabel?: string;
  children: ReactNode;
  testId?: string;
}

export default function SteppedWizard({
  steps,
  activeStepIndex,
  onStepChange,
  onComplete,
  onCancel,
  completeLabel = 'Complete',
  children,
  testId = 'stepped-wizard',
}: SteppedWizardProps) {
  const isFirstStep = activeStepIndex === 0;
  const isLastStep = activeStepIndex === steps.length - 1;
  const currentStep = steps[activeStepIndex];
  const canAdvance = currentStep?.isValid !== false;

  function handleStepClick(index: number) {
    if (index < activeStepIndex) {
      onStepChange(index);
    }
  }

  function handleStepKeyDown(e: React.KeyboardEvent, index: number) {
    if ((e.key === 'Enter' || e.key === ' ') && index < activeStepIndex) {
      e.preventDefault();
      onStepChange(index);
    }
  }

  function handleBack() {
    if (!isFirstStep) {
      onStepChange(activeStepIndex - 1);
    }
  }

  function handleNext() {
    if (!isLastStep && canAdvance) {
      onStepChange(activeStepIndex + 1);
    }
  }

  function handleComplete() {
    if (canAdvance) {
      onComplete();
    }
  }

  return (
    <div className="stepped-wizard" data-testid={testId}>
      <nav className="stepped-wizard-strip" data-testid={`${testId}-strip`} aria-label="Wizard steps">
        {steps.map((step, index) => {
          const isActive = index === activeStepIndex;
          const isCompleted = index < activeStepIndex;
          const isFuture = index > activeStepIndex;

          let stepClass = 'stepped-wizard-step';
          if (isActive) stepClass += ' stepped-wizard-step-active';
          if (isCompleted) stepClass += ' stepped-wizard-step-completed';
          if (isFuture) stepClass += ' stepped-wizard-step-future';

          return (
            <div key={step.id} className="stepped-wizard-step-wrapper">
              {index > 0 ? (
                <div
                  className={`stepped-wizard-connector ${isCompleted ? 'stepped-wizard-connector-done' : ''}`}
                  aria-hidden="true"
                />
              ) : null}
              <div
                className={stepClass}
                data-testid={`${testId}-step-${index}`}
                role={isCompleted ? 'button' : undefined}
                tabIndex={isCompleted ? 0 : undefined}
                onClick={() => handleStepClick(index)}
                onKeyDown={(e) => handleStepKeyDown(e, index)}
                aria-current={isActive ? 'step' : undefined}
              >
                <span className="stepped-wizard-indicator" aria-hidden="true">
                  {isCompleted ? '✓' : index + 1}
                </span>
                <div className="stepped-wizard-step-text">
                  <span className="stepped-wizard-step-label">{step.label}</span>
                  {step.description ? (
                    <span className="stepped-wizard-step-desc">{step.description}</span>
                  ) : null}
                </div>
              </div>
            </div>
          );
        })}
      </nav>

      <div className="stepped-wizard-content" data-testid={`${testId}-content`}>
        {children}
      </div>

      <footer className="stepped-wizard-footer" data-testid={`${testId}-footer`}>
        <button
          type="button"
          className="button button-ghost button-sm"
          data-testid={`${testId}-cancel`}
          onClick={onCancel}
        >
          Cancel
        </button>

        <div className="stepped-wizard-footer-end">
          {!isFirstStep ? (
            <button
              type="button"
              className="button button-secondary button-sm"
              data-testid={`${testId}-back`}
              onClick={handleBack}
            >
              Back
            </button>
          ) : null}

          {isLastStep ? (
            <button
              type="button"
              className="button button-primary button-sm"
              data-testid={`${testId}-complete`}
              disabled={!canAdvance}
              onClick={handleComplete}
            >
              {completeLabel}
            </button>
          ) : (
            <button
              type="button"
              className="button button-primary button-sm"
              data-testid={`${testId}-next`}
              disabled={!canAdvance}
              onClick={handleNext}
            >
              Next
            </button>
          )}
        </div>
      </footer>
    </div>
  );
}
