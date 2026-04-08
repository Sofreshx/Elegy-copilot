const {
  validateTauriBundleConfig,
  validateTauriNodeSidecarLayoutModel,
} = require('./tauri-node-sidecar-layout');

try {
  const layout = validateTauriNodeSidecarLayoutModel();
  const bundle = validateTauriBundleConfig();
  console.log(
    `[tauri-sidecar-layout] validated ${layout.validatedResourceCount} resource copy rule(s); `
    + `node=${layout.nodeRuntimeRelativePath}; server=${layout.serverEntrypoint}; `
    + `gateway=${layout.gatewayEntrypoint}; workflow=${layout.workflowSidecarEntrypoint}; `
    + `pglite=${layout.pgliteTargetDist}; status=${layout.status}; packaging=${layout.packaging}; `
    + `updateMode=${layout.updateMode}; bundleTarget=${bundle.bundleTarget}.`,
  );
} catch (error) {
  const detail = error instanceof Error ? error.message : String(error);
  console.error(`[tauri-sidecar-layout] ${detail}`);
  process.exit(1);
}
