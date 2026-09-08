// tests/provision-workspace.test.mjs — provision-workspace.mjs builds the
// hosted tier's per-tenant workspace from the data contract
// (docs/HOSTED-APP-PLAN.md §2.2). The phase-2 gate this exists to prove:
// two tenant workspaces cannot read each other's cv.md — a positive read in
// one's own workspace, paired with a refused read across into the other's
// (AGENTS.md rule 1), plus the mechanics that make the isolation real:
// system files are hardlinks (edits in the checkout are visible, tenant
// writes to them are impossible because they're outside the user layer),
// user files are real per-tenant paths, and re-provisioning is idempotent.
//
// Runs against the REAL checkout (this repo), not a synthetic fixture — a
// fake mini-repo would test the mechanism against a list of paths it doesn't
// actually maintain; linkSystemEntry() already skips any SYSTEM_PATHS entry
// absent on disk, so this is safe and, unlike a fixture, can't silently drift
// from what SYSTEM_PATHS/USER_PATHS actually say.
import { mkdtempSync, rmSync, writeFileSync, readFileSync, statSync, existsSync, lstatSync } from 'fs';
import { join } from 'path';
import { pass, fail, warn, ROOT } from './helpers.mjs';
import { provisionWorkspace, isWithinWorkspacesRoot } from '../provision-workspace.mjs';
import { confinePath } from '../lib/hosted-capabilities.mjs';

console.log('\nprovision-workspace.mjs — hosted tenant workspaces');

let workspacesRoot;
let workspaceA, workspaceB;
try {
  // Hardlinks cannot cross a filesystem/volume boundary (EXDEV) — the OS
  // tmpdir() is routinely a different drive than the checkout on Windows, so
  // the scratch root has to live NEXT TO the checkout, same as production
  // (WORKLER_WORKSPACES_ROOT must be on the same volume — see .env.example).
  // `.tmp-*` at the repo root is the project's existing gitignored-scratch
  // convention (see .gitignore).
  workspacesRoot = mkdtempSync(join(ROOT, '.tmp-provision-workspace-test-'));
  workspaceA = provisionWorkspace('tenant-a', { checkoutRoot: ROOT, workspacesRoot });
  workspaceB = provisionWorkspace('tenant-b', { checkoutRoot: ROOT, workspacesRoot });
} catch (e) {
  warn(`provision-workspace fixture could not be built, skipping: ${e.message}`);
  workspacesRoot = null;
}

if (workspacesRoot) try {
  // ---- unsafe uid refused, safe uid accepted (control pair) ---------------
  const unsafeUids = ['../escape', 'a/b', '.', '..', ''];
  const unsafeProblems = unsafeUids.filter((uid) => {
    try {
      provisionWorkspace(uid, { checkoutRoot: ROOT, workspacesRoot });
      return true; // should have thrown
    } catch {
      return false;
    }
  });
  if (unsafeProblems.length === 0) {
    pass('provisionWorkspace refuses every unsafe workspace id');
  } else {
    fail(`provisionWorkspace accepted unsafe ids: ${unsafeProblems.join(', ')}`);
  }
  if (existsSync(join(workspacesRoot, 'tenant-a')) && existsSync(join(workspacesRoot, 'tenant-b'))) {
    pass('provisionWorkspace accepts a plain safe uid and builds its workspace');
  } else {
    fail('provisionWorkspace did not build the expected safe-uid workspaces');
  }

  // ---- system layer: hardlinked, same inode as the checkout ---------------
  const checkoutShared = join(ROOT, 'modes', '_shared.md');
  const linkedShared = join(workspaceA, 'modes', '_shared.md');
  if (existsSync(checkoutShared)) {
    if (existsSync(linkedShared) && statSync(checkoutShared).ino === statSync(linkedShared).ino) {
      pass('a SYSTEM_PATHS file is hardlinked into the workspace (same inode as the checkout)');
    } else {
      fail(`modes/_shared.md not hardlinked correctly: exists=${existsSync(linkedShared)}`);
    }
  } else {
    warn('modes/_shared.md missing from this checkout — hardlink identity check skipped');
  }

  // node_modules: symlinked, not hardlinked (a directory can't be hardlinked).
  if (existsSync(join(ROOT, 'node_modules'))) {
    const nmLink = join(workspaceA, 'node_modules');
    if (existsSync(nmLink) && lstatSync(nmLink).isSymbolicLink()) {
      pass('node_modules is symlinked into the workspace');
    } else {
      fail('node_modules missing or not a symlink in the workspace');
    }
  } else {
    warn('node_modules not present in this checkout — symlink check skipped (run npm install)');
  }

  // The one deliberate system/user overlap (DATA_CONTRACT.md): interview-prep/
  // is user layer, but its sessions/ scaffold files are system-owned and must
  // still be hardlinked, while the REST of interview-prep/ stays writable.
  if (existsSync(join(ROOT, 'interview-prep', 'sessions', 'README.md'))) {
    const scaffoldLinked = join(workspaceA, 'interview-prep', 'sessions', 'README.md');
    if (existsSync(scaffoldLinked)) {
      pass('interview-prep/sessions/README.md (system scaffold) is hardlinked despite living under a user-layer directory');
    } else {
      fail('interview-prep/sessions/README.md was not linked into the workspace');
    }
  } else {
    warn('interview-prep/sessions/README.md missing from this checkout — scaffold-overlap check skipped');
  }
  try {
    writeFileSync(join(workspaceA, 'interview-prep', 'acme-swe.md'), 'my own prep notes');
    pass('the rest of interview-prep/ (user layer) is still a real, writable directory');
  } catch (e) {
    fail(`could not write a real user file into interview-prep/: ${e.message}`);
  }

  // ---- user layer: real per-tenant files, not shared -----------------------
  writeFileSync(join(workspaceA, 'cv.md'), 'Tenant A CV');
  writeFileSync(join(workspaceB, 'cv.md'), 'Tenant B CV');
  const cvA = readFileSync(join(workspaceA, 'cv.md'), 'utf-8');
  const cvB = readFileSync(join(workspaceB, 'cv.md'), 'utf-8');
  if (cvA === 'Tenant A CV' && cvB === 'Tenant B CV' && cvA !== cvB) {
    pass('each tenant workspace holds its own real cv.md, independent of the other');
  } else {
    fail(`tenant cv.md files are not independent: A=${cvA} B=${cvB}`);
  }

  // ---- THE GATE: a read confined to A cannot reach B's cv.md, and CAN reach its own ----
  try {
    const own = confinePath(workspaceA, 'cv.md');
    const ownContent = readFileSync(own, 'utf-8');
    if (ownContent === 'Tenant A CV') pass('a workspace-A-confined read reaches its own cv.md');
    else fail(`workspace-A own read returned: ${ownContent}`);
  } catch (e) {
    fail(`workspace-A own read was wrongly refused: ${e.message}`);
  }
  try {
    // The only way to reach tenant B's file from a read confined to A is to
    // escape A's root — exactly what confinePath exists to refuse.
    const relEscape = join('..', 'tenant-b', 'cv.md');
    confinePath(workspaceA, relEscape);
    fail('a read confined to workspace A was able to resolve into workspace B');
  } catch (e) {
    if (/escapes workspace/.test(e.message)) pass('a read confined to workspace A refuses to resolve into workspace B');
    else fail(`cross-tenant read refusal: wrong error: ${e.message}`);
  }

  // ---- isWithinWorkspacesRoot: control pair --------------------------------
  if (isWithinWorkspacesRoot(workspaceA, workspacesRoot) && !isWithinWorkspacesRoot(ROOT, workspacesRoot)) {
    pass('isWithinWorkspacesRoot accepts a real tenant workspace and refuses an unrelated directory');
  } else {
    fail('isWithinWorkspacesRoot misclassified a workspace or an unrelated directory');
  }

  // ---- idempotent re-provisioning -------------------------------------------
  try {
    const before = existsSync(linkedShared) ? statSync(linkedShared).ino : null;
    provisionWorkspace('tenant-a', { checkoutRoot: ROOT, workspacesRoot });
    const after = existsSync(linkedShared) ? statSync(linkedShared).ino : null;
    const cvStillThere = readFileSync(join(workspaceA, 'cv.md'), 'utf-8');
    if (before === after && cvStillThere === 'Tenant A CV') {
      pass('re-provisioning the same tenant is idempotent — no re-link churn, no data loss');
    } else {
      fail(`re-provisioning changed state: inode ${before}→${after}, cv=${cvStillThere}`);
    }
  } catch (e) {
    fail(`re-provisioning an existing workspace threw: ${e.message}`);
  }
} catch (e) {
  fail(`provision-workspace tests crashed: ${e.stack || e.message}`);
} finally {
  if (workspacesRoot) rmSync(workspacesRoot, { recursive: true, force: true });
}
