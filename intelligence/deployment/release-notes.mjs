/**
 * Release notes — evidence-based only
 */
import { redactObject, redactString } from './redact.mjs';

export function generateReleaseNotes(options = {}) {
  const tasks = options.completed_tasks || [];
  const changes = options.changed_components || [];
  const userFacing = options.user_facing_changes || [];
  const breaking = options.breaking_changes || [];
  const migrations = options.migration_notes || [];
  const deployment = options.deployment_notes || [];
  const rollback = options.rollback_notes || [];

  const notes = {
    capability: 'release-notes',
    release_id: options.release_id || '',
    version: options.version || '',
    sections: [],
  };

  if (userFacing.length) {
    notes.sections.push({ title: 'User-facing changes', items: userFacing.map(redactString) });
  }
  if (breaking.length) {
    notes.sections.push({ title: 'Breaking changes', items: breaking.map(redactString) });
  }
  if (changes.length) {
    notes.sections.push({ title: 'Changed components', items: changes });
  }
  if (tasks.length) {
    notes.sections.push({ title: 'Completed tasks', items: tasks.map((t) => redactString(t.task_id || t)) });
  }
  if (migrations.length) {
    notes.sections.push({ title: 'Migration notes', items: migrations.map(redactString) });
  }
  if (deployment.length) {
    notes.sections.push({ title: 'Deployment notes', items: deployment.map(redactString) });
  }
  if (rollback.length) {
    notes.sections.push({ title: 'Rollback notes', items: rollback.map(redactString) });
  }

  if (!notes.sections.length) {
    notes.sections.push({ title: 'Summary', items: ['No documented changes with evidence'] });
  }

  return redactObject(notes);
}
