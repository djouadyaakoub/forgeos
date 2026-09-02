/**
 * Performance investigation — measure-first methodology
 */
export function planPerformanceInvestigation(target, options = {}) {
  return {
    capability: 'performance-investigation',
    target,
    workflow: [
      { step: 'measure', status: 'pending', required: true },
      { step: 'hypothesis', status: 'pending' },
      { step: 'profile', status: 'pending', tools: options.tools || ['builtin_profiler', 'benchmarks'] },
      { step: 'change', status: 'pending', guess_only: false },
      { step: 'measure_again', status: 'pending', required: true },
    ],
    law: 'No optimization by intuition alone when profiling is available',
    prohibited_without_measurement: ['premature_optimization', 'micro_benchmark_only'],
  };
}
