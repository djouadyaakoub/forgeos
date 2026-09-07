/** Built-in minimum completion semantics, not an execution or authorization registry. */
export function completionSemantics(id) {
  if (['documentation-sync','documentation-drift'].includes(id)) return {classification:'FINDING_RESOLUTION_REQUIRED',automatic:true,
    reason:'Fresh documentation findings and scoped evidence; legacy existence tasks cannot discharge remaining findings.'};
  if (['health-check','smoke-test'].includes(id)) return {classification:'COMMAND_IS_SEMANTIC',automatic:true,
    reason:'Only explicitly configured project commands, fresh evidence and no remaining assessment findings.'};
  if (['structure-audit','codebase-organization','dependency-audit','architecture-guard','cross-cutting-design','release-readiness','artifact-verification',
    'deployment-discovery','deployment-plan','deployment-build','deployment-execute','deployment-verify','rollback-plan','rollback-execute','environment-discovery',
    'test-coverage-strategy','safe-refactor','reproduce-bug','release-notes'].includes(id)) return {classification:'COMPOSITE_REQUIRED',automatic:false,
    reason:'Current marker/command contract does not bind all required analysis, expected effects or artifact assertions; keep PARTIAL/UNKNOWN.'};
  return {classification:'NO_AUTOMATIC_SATISFACTION',automatic:false,
    reason:'Analysis, research or human judgment is not established by an arbitrary file or runtime completion.'};
}
