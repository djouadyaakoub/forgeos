/** Explicit preview/confirmation only. Never dispatches the approved command. */
import { readProjectText } from '../host/project-files.mjs';
import { previewExactApproval, issueExactApproval, revokeExactApproval } from '../policy/exact-approval.mjs';
import { classifyShellOperation } from '../policy/engine.mjs';

export function runExactApprovalCli(argv) {
  try {
    const flags = {};
    for (let i=0;i<argv.length;i++) {
      const key = argv[i];
      if (Object.hasOwn(flags,key)) throw new Error('duplicate_option');
      if (['--confirm-human','--json'].includes(key)) {flags[key]=true;continue;}
      if (!['--project','--file','--expires-at','--by','--confirm-fingerprint','--revoke'].includes(key)
        || !argv[i+1] || argv[i+1].startsWith('--')) throw new Error('invalid_approval_option');
      flags[key]=argv[++i];
    }
    const root = flags['--project'] || process.cwd();
    if (flags['--revoke']) {
      if (!flags['--confirm-human'] || flags['--file']) throw new Error('explicit_revocation_required');
      return revokeExactApproval(root,flags['--revoke']);
    }
    const input = JSON.parse(readProjectText(root,flags['--file']) || 'null');
    if (!input || Object.keys(input).some(k=>!['task_id','capability_id','operation_id','task_scope','event'].includes(k))) throw new Error('invalid_approval_request');
    const command = input.event?.tool_input?.command ?? input.event?.tool_input?.cmd ?? input.event?.tool_input?.argv?.join(' ');
    const action = classifyShellOperation(command);
    if (!action || action.tier < 3) throw new Error('not_a_tier3_request');
    const request = {...input,project_dir:root,action:action.operation,expires_at:flags['--expires-at']};
    const preview = previewExactApproval(request);
    if (!flags['--confirm-human']) return {ok:true,status:'APPROVAL_PREVIEW',preview,expires_at:request.expires_at||null,
      next:'Review the exact target/input, then repeat with --confirm-human --by ID --expires-at UTC --confirm-fingerprint BINDING.'};
    return {status:'APPROVED',...issueExactApproval({...request,approved_by:flags['--by'],confirmed:true,
      confirmation_fingerprint:flags['--confirm-fingerprint']})};
  } catch(e) { return {ok:false,status:'BLOCKED',reason:e.message}; }
}
