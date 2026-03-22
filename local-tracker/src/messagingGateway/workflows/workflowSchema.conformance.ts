/**
 * Compile-time conformance assertions.
 * These ensure the Zod-inferred types remain assignable to the shared contract interfaces.
 * If the contracts diverge from the Zod schemas, this file will produce a TypeScript error.
 */
import type {
  WorkflowStep as ContractStep,
  WorkflowDefinition as ContractDefinition,
  WorkflowStepResult as ContractStepResult,
  WorkflowRunResult as ContractRunResult,
} from '@elegy-copilot/contracts';

import type { WorkflowStep, WorkflowDefinition, WorkflowStepResult, WorkflowRunResult } from './workflowSchema';

// Compile-time assignability checks (these are erased at runtime)
const _stepConformance: ContractStep = {} as WorkflowStep;
const _definitionConformance: ContractDefinition = {} as WorkflowDefinition;
const _stepResultConformance: ContractStepResult = {} as WorkflowStepResult;
const _runResultConformance: ContractRunResult = {} as WorkflowRunResult;

// Suppress unused variable warnings
void _stepConformance;
void _definitionConformance;
void _stepResultConformance;
void _runResultConformance;
