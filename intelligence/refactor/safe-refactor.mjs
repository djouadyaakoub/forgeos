/**
 * Safe refactor workflow — behavior-preserving
 */
export function planSafeRefactor(scope, options = {}) {
  return {
    capability: 'safe-refactor',
    scope,
    workflow: [
      { step: 'baseline', actions: ['capture_test_results', 'record_behavior_notes'], status: 'pending' },
      { step: 'refactor', actions: ['apply_structural_changes_only'], status: 'pending', behavior_change_allowed: false },
      { step: 'tests', actions: ['run_unit_tests', 'run_integration_tests'], status: 'pending' },
      { step: 'comparison', actions: ['diff_behavior', 'verify_public_interfaces'], status: 'pending' },
      { step: 'verification', actions: options.verification || ['build', 'test'], status: 'pending' },
    ],
    goals: ['same_behavior', 'better_structure', 'lower_complexity'],
    explicit_behavior_change_requires_task: true,
  };
}
