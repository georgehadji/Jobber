#!/usr/bin/env node
/**
 * provision-workspace.mjs — build one hosted-tier tenant workspace from the
 * data contract (docs/HOSTED-APP-PLAN.md §2.2).
 *
 *   /srv/workler/workspaces/{uid}/
 *     *.mjs, lib/, modes/*.md, templates/, providers/, …   hardlinks (system layer)
 *     node_modules -> ../../checkout/node_modules            symlink
 *     cv.md  config/  data/  reports/  output/  …            real dirs (user layer)
 *
 * Hardlinks, not symlinks, for the system layer: every script resolves its
 * root from `import.meta.url` (dirname(fileURLToPath(import.meta.url))), and
 * Node's ESM loader resolves a symlinked entry point to its REAL path — a
 * symlinked openai-eval.mjs would read the checkout's cv.md, not the
 * tenant's. A hardlink IS a real path in the workspace, so this problem
 * doesn't exist. node_modules stays a symlink because package resolution
 * walks up from the importing file's real (workspace) location.
 *
 * SYSTEM_PATHS / USER_PATHS are imported from update-system.mjs, not
 * restated — the same list the auto-updater already maintains and tests
 * (validate-system-paths-coverage.mjs) against every tracked file in the repo.
 *
 * Idempotent: re-run on every deploy. A hardlink already in place needs no
 * refresh (it shares the checkout file's inode, so editing the checkout
 * edits it too); this only adds links for files newly added to SYSTEM_PATHS.
 *
 * `--workspaces-root` (or WORKLER_WORKSPACES_ROOT) MUST be on the same
 * filesystem/volume as the checkout — a hardlink cannot cross that boundary
 * (EXDEV). On Windows in particular, the OS temp dir is routinely a
 * different drive than the checkout; provision into a directory next to it
 * instead (the default, `.workspaces/` beside this script, already is).
 *
 * Usage:
 *   node provision-workspace.mjs <uid> [--checkout <dir>] [--workspaces-root <dir>]
 *
 * // ponytail: a stale hardlink for a file REMOVED from SYSTEM_PATHS is never
 * // cleaned up here — harmless (an orphan file, not a security issue) but a
 * // reconciling `--prune` pass would be tidier once tenants churn for real.
 */

import { existsSync, lstatSync, mkdirSync, readdirSync, linkSync, symlinkSync, realpathSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { SYSTEM_PATHS, USER_PATHS } from './update-system.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));

function stripTrailingSlash(p) {
  return p.endsWith('/') ? p.slice(0, -1) : p;
}

/** Hardlink one SYSTEM_PATHS entry (file or directory tree) into the workspace. */
function linkSystemEntry(checkoutRoot, workspace, entry) {
  const rel = stripTrailingSlash(entry);
  const src = join(checkoutRoot, rel);
  if (!existsSync(src)) return; // optional/absent in this checkout — skip quietly
  (function linkOne(srcPath, relPath) {
    const st = lstatSync(srcPath);
    const dest = join(workspace, relPath);
    if (st.isDirectory()) {
      mkdirSync(dest, { recursive: true });
      for (const name of readdirSync(srcPath)) linkOne(join(srcPath, name), join(relPath, name));
    } else if (st.isFile()) {
      mkdirSync(dirname(dest), { recursive: true });
      try {
        linkSync(srcPath, dest);
      } catch (e) {
        if (e.code !== 'EEXIST') throw e;
      }
    }
    // symlinks inside the checkout (there shouldn't be any under tracked
    // system paths) are neither followed nor linked — skipped by omission.
  })(src, rel);
}

/** Ensure one USER_PATHS entry exists as a REAL (non-linked) path — directories
 *  only; files are left for the app to write on first use, never fabricated. */
function ensureUserEntry(workspace, entry) {
  const rel = stripTrailingSlash(entry);
  const isDir = entry.endsWith('/');
  const dest = join(workspace, rel);
  mkdirSync(isDir ? dest : dirname(dest), { recursive: true });
}

function linkNodeModules(checkoutRoot, workspace) {
  const src = join(checkoutRoot, 'node_modules');
  const dest = join(workspace, 'node_modules');
  if (!existsSync(src) || existsSync(dest)) return;
  try {
    symlinkSync(src, dest, process.platform === 'win32' ? 'junction' : 'dir');
  } catch (e) {
    if (e.code !== 'EEXIST') throw e;
  }
}

/**
 * Build (or refresh) one tenant workspace.
 *
 * @param {string} uid Tenant id — must already be a safe path segment (the
 *   caller mints it, e.g. from the account row; never taken raw from a URL).
 * @param {{ checkoutRoot?: string, workspacesRoot?: string }} [opts]
 * @returns {string} Absolute path to the provisioned workspace.
 */
export function provisionWorkspace(uid, opts = {}) {
  if (!uid || /[\\/]|^\.\.?$/.test(uid)) throw new Error(`unsafe workspace id: ${uid}`);
  const checkoutRoot = resolve(opts.checkoutRoot ?? ROOT);
  const workspacesRoot = resolve(opts.workspacesRoot ?? process.env.WORKLER_WORKSPACES_ROOT ?? join(checkoutRoot, '.workspaces'));
  const workspace = join(workspacesRoot, uid);

  mkdirSync(workspace, { recursive: true });
  for (const entry of SYSTEM_PATHS) linkSystemEntry(checkoutRoot, workspace, entry);
  linkNodeModules(checkoutRoot, workspace);
  for (const entry of USER_PATHS) ensureUserEntry(workspace, entry);
  mkdirSync(join(workspace, '.workler', 'transcripts'), { recursive: true });

  return workspace;
}

/**
 * Whether `workspace` sits inside `workspacesRoot` and resolves there for
 * real (no symlink escape) — the tenancy boundary's other half from
 * lib/hosted-capabilities.mjs's confinePath, one level up (workspace vs.
 * workspaces-root, not path vs. workspace).
 *
 * @param {string} workspace
 * @param {string} workspacesRoot
 * @returns {boolean}
 */
export function isWithinWorkspacesRoot(workspace, workspacesRoot) {
  const root = resolve(workspacesRoot);
  let real;
  try {
    real = realpathSync(workspace);
  } catch {
    return false;
  }
  return real === root || real.startsWith(root + (process.platform === 'win32' ? '\\' : '/'));
}

let invokedPath;
try { invokedPath = process.argv[1] && realpathSync(process.argv[1]); } catch { invokedPath = null; }
if (invokedPath && import.meta.url === pathToFileURL(invokedPath).href) {
  const argv = process.argv.slice(2);
  const uid = argv[0];
  if (!uid || uid.startsWith('--')) {
    process.stderr.write('usage: node provision-workspace.mjs <uid> [--checkout <dir>] [--workspaces-root <dir>]\n');
    process.exit(2);
  }
  const flag = (name) => {
    const i = argv.indexOf(name);
    return i === -1 ? undefined : argv[i + 1];
  };
  try {
    const workspace = provisionWorkspace(uid, {
      checkoutRoot: flag('--checkout'),
      workspacesRoot: flag('--workspaces-root'),
    });
    process.stdout.write(workspace + '\n');
  } catch (e) {
    process.stderr.write(`provision failed: ${e.message}\n`);
    process.exit(1);
  }
}
