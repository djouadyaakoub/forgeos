/**
 * Deployment failure classification and retry policy
 */
export const FAILURE_TYPES = {
  BUILD_FAILED: 'BUILD_FAILED',
  DEPLOY_FAILED: 'DEPLOY_FAILED',
  HEALTH_CHECK_FAILED: 'HEALTH_CHECK_FAILED',
  SMOKE_TEST_FAILED: 'SMOKE_TEST_FAILED',
  CONFIGURATION_FAILED: 'CONFIGURATION_FAILED',
  PLATFORM_FAILED: 'PLATFORM_FAILED',
  VERIFICATION_FAILED: 'VERIFICATION_FAILED',
  POLICY_BLOCK: 'POLICY_BLOCK',
};

const DEFAULT_RETRY = {
  max_attempts: 2,
  retryable: ['transient_platform_failure', 'network_timeout', 'PLATFORM_FAILED'],
  non_retryable: ['configuration_failure', 'policy_block', 'missing_approval', 'POLICY_BLOCK', 'BUILD_FAILED'],
};

export function classifyDeploymentFailure(reason = '') {
  const r = String(reason).toUpperCase();
  if (r.includes('BUILD')) return FAILURE_TYPES.BUILD_FAILED;
  if (r.includes('HEALTH')) return FAILURE_TYPES.HEALTH_CHECK_FAILED;
  if (r.includes('SMOKE')) return FAILURE_TYPES.SMOKE_TEST_FAILED;
  if (r.includes('CONFIG')) return FAILURE_TYPES.CONFIGURATION_FAILED;
  if (r.includes('POLICY') || r.includes('APPROVAL') || r.includes('BLOCK')) return FAILURE_TYPES.POLICY_BLOCK;
  if (r.includes('PLATFORM') || r.includes('TIMEOUT')) return FAILURE_TYPES.PLATFORM_FAILED;
  if (r.includes('VERIFY') || r.includes('ARTIFACT')) return FAILURE_TYPES.VERIFICATION_FAILED;
  if (r.includes('DEPLOY')) return FAILURE_TYPES.DEPLOY_FAILED;
  return FAILURE_TYPES.DEPLOY_FAILED;
}

export function getRetryPolicy(context = {}) {
  return { ...DEFAULT_RETRY, ...context.retry };
}

export function shouldRetry(failureType, attempt, policy = DEFAULT_RETRY) {
  if (attempt >= policy.max_attempts) return { retry: false, reason: 'max_attempts_exceeded' };
  if (policy.non_retryable.some((n) => failureType.includes(n) || n === failureType)) {
    return { retry: false, reason: 'non_retryable_failure' };
  }
  if (policy.retryable.some((r) => failureType.includes(r) || r === failureType)) {
    return { retry: true, reason: 'retryable_failure', attempt: attempt + 1 };
  }
  return { retry: false, reason: 'unknown_failure_type' };
}

export function diagnoseFailure(failureType, context = {}) {
  return {
    failure_type: failureType,
    diagnose: [
      'Review deployment evidence',
      'Check build artifacts',
      'Verify environment configuration',
      'Consult platform status',
    ],
    rollback_eligible: ['HEALTH_CHECK_FAILED', 'SMOKE_TEST_FAILED', 'DEPLOY_FAILED'].includes(failureType),
    escalate_to: failureType === FAILURE_TYPES.POLICY_BLOCK ? 'human_approval' : 'architect',
    context: { environment: context.environment },
  };
}
