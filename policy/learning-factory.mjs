/**
 * ForgeOS — learning factory
 * Proposals only; durable knowledge remains project-local.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { evaluatePromotionCandidate } from './ephemeral-factory.mjs';
import { getProjectDir } from './project-adapter.mjs';

export const LEARNING_TYPES = [
  'operational_lesson',
  'playbook_improvement',
  'capability_evolution',
  'architectural_decision',
];

export const THRESHOLDS = {
  operational_lesson: { minEvidence: 1 },
  playbook_improvement: { minSimilarFailures: 2 },
  capability_evolution: { minSuccessfulEphemeralUses: 3 },
  architectural_decision: { humanReview: 'high' },
};

export const PROTECTED_TARGETS = [
  '.cursor/agents/registry.yaml',
  '.cursor/hooks.json',
  '.cursor/hooks/',
  '.cursor/policy/',
  '.cursor/agents/',
  '.cursor/skills/',
  'docs/agents/RUNTIME_LAW.md',
  '.agent-os/',
];

export function getProposalsDir(projectDir = getProjectDir()) {
  return path.join(projectDir, 'docs/agents/learning/proposals');
}

export function getLessonsDir(projectDir = getProjectDir()) {
  return path.join(projectDir, 'docs/runbooks/lessons');
}

export function getAdrDir(projectDir = getProjectDir()) {
  return path.join(projectDir, 'docs/adr');
}

export function isProtectedTarget(targetPath) {
  const p = String(targetPath || '').replace(/\\/g, '/');
  return PROTECTED_TARGETS.some((t) => p === t || p.startsWith(t));
}

export function generateProposalId() {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const hash = crypto.randomBytes(2).toString('hex');
  return `LP-${date}-${hash}`;
}

export function classifyReviewRisk(proposal) {
  const text = JSON.stringify(proposal).toLowerCase();
  const highRisk = ['production', 'security', 'registry', 'hooks', 'policy', 'credential', 'deploy'];
  const hits = highRisk.filter((t) => text.includes(t));
  if (hits.length >= 2) return 'high';
  if (hits.length === 1) return 'medium';
  return 'low';
}

export function evaluateLearningQuality(proposal) {
  const evidence = proposal.evidence?.length || 0;
  const type = proposal.type || 'operational_lesson';
  const threshold = THRESHOLDS[type] || {};
  if (type === 'operational_lesson') return evidence >= (threshold.minEvidence || 1) ? 'sufficient' : 'insufficient';
  if (type === 'playbook_improvement') return (proposal.frequency || 0) >= (threshold.minSimilarFailures || 2) ? 'sufficient' : 'insufficient';
  if (type === 'capability_evolution') return (proposal.ephemeral_uses || 0) >= (threshold.minSuccessfulEphemeralUses || 3) ? 'sufficient' : 'insufficient';
  return 'requires_human';
}

export function createLearningProposal(input, projectDir = getProjectDir()) {
  const proposal = {
    proposal_id: input.proposal_id || generateProposalId(),
    type: input.type || 'operational_lesson',
    status: 'pending',
    created_at: new Date().toISOString(),
    task_id: input.task_id || null,
    title: input.title || 'Untitled learning proposal',
    summary: input.summary || '',
    evidence: input.evidence || [],
    suggested_targets: input.suggested_targets || [],
    project_id: input.project_id || null,
  };
  if (proposal.suggested_targets.some(isProtectedTarget)) {
    proposal.auto_apply_allowed = false;
    proposal.review_risk = 'high';
  } else {
    proposal.auto_apply_allowed = classifyReviewRisk(proposal) === 'low';
    proposal.review_risk = classifyReviewRisk(proposal);
  }
  const dir = getProposalsDir(projectDir);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${proposal.proposal_id}.yaml`);
  fs.writeFileSync(file, stringifyProposal(proposal), 'utf8');
  return { ok: true, proposal, path: file };
}

function stringifyProposal(p) {
  const lines = [`proposal_id: ${p.proposal_id}`, `type: ${p.type}`, `status: ${p.status}`, `created_at: ${p.created_at}`, `title: ${p.title}`, `summary: ${p.summary}`, `review_risk: ${p.review_risk}`, `auto_apply_allowed: ${p.auto_apply_allowed}`];
  if (p.task_id) lines.push(`task_id: ${p.task_id}`);
  if (p.evidence?.length) {
    lines.push('evidence:');
    for (const e of p.evidence) lines.push(`  - ${e}`);
  }
  return lines.join('\n') + '\n';
}

export function acceptLearningProposal(proposalId, projectDir = getProjectDir()) {
  const file = path.join(getProposalsDir(projectDir), `${proposalId}.yaml`);
  if (!fs.existsSync(file)) return { ok: false, errors: ['proposal not found'] };
  const content = fs.readFileSync(file, 'utf8');
  if (content.includes('suggested_targets') && PROTECTED_TARGETS.some((t) => content.includes(t))) {
    return { ok: false, errors: ['cannot auto-apply to protected targets'] };
  }
  const typeMatch = content.match(/^type:\s*(\S+)/m);
  const type = typeMatch?.[1] || 'operational_lesson';
  if (type === 'operational_lesson') {
    const lessonsDir = getLessonsDir(projectDir);
    fs.mkdirSync(lessonsDir, { recursive: true });
    const lessonFile = path.join(lessonsDir, `${proposalId}.md`);
    fs.writeFileSync(lessonFile, `# ${proposalId}\n\nAccepted learning proposal.\n\n${content}\n`, 'utf8');
  }
  if (type === 'architectural_decision') {
    const adrDir = getAdrDir(projectDir);
    fs.mkdirSync(adrDir, { recursive: true });
    fs.writeFileSync(path.join(adrDir, `ADR-PROPOSAL-${proposalId}.md`), `# ADR Proposal ${proposalId}\n\n${content}\n`, 'utf8');
  }
  fs.writeFileSync(file, content.replace(/status:\s*\S+/, 'status: accepted'), 'utf8');
  return { ok: true, proposal_id: proposalId };
}

export function rejectLearningProposal(proposalId, reason = 'human_rejected', projectDir = getProjectDir()) {
  const file = path.join(getProposalsDir(projectDir), `${proposalId}.yaml`);
  if (!fs.existsSync(file)) return { ok: false, errors: ['proposal not found'] };
  let content = fs.readFileSync(file, 'utf8');
  content = content.replace(/status:\s*\S+/, 'status: rejected');
  fs.writeFileSync(file, content + `\nrejection_reason: ${reason}\n`, 'utf8');
  return { ok: true, proposal_id: proposalId };
}

export function processTaskForLearning(taskId, options = {}, projectDir = getProjectDir()) {
  const proposals = [];
  if (options.signals?.verification_failed) {
    proposals.push(
      createLearningProposal({
        task_id: taskId,
        type: 'operational_lesson',
        title: `Verification issues on ${taskId}`,
        summary: options.signals.summary || 'Task completed with verification issues',
        evidence: options.signals.evidence || [`task:${taskId}`],
        project_id: options.project_id,
      }, projectDir)
    );
  }
  if (options.ephemeral_history?.length >= 3) {
    const promo = evaluatePromotionCandidate(options.ephemeral_history);
    if (promo.candidate) {
      proposals.push(
        createLearningProposal({
          task_id: taskId,
          type: 'capability_evolution',
          title: `Capability evolution signal for ${taskId}`,
          summary: promo.reason,
          ephemeral_uses: options.ephemeral_history.length,
          evidence: [`ephemeral_uses:${options.ephemeral_history.length}`],
        }, projectDir)
      );
    }
  }
  return { ok: true, proposals: proposals.map((p) => p.proposal) };
}
