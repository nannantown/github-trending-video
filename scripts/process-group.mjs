/**
 * Run a shell command as the leader of its own process group, time-boxed.
 *
 * Why not execSync's `timeout`: it signals only the direct child (the shell /
 * npx). The remotion / Chrome / ffmpeg grandchildren survive, and because they
 * inherited the step's stdout, GitHub Actions keeps waiting for them until the
 * job limit — which also skips everything after the pipeline (e.g. the
 * performance-history commit). Here the child is spawned `detached` (its own
 * process group) and a timeout signals the whole group: SIGTERM first, then
 * SIGKILL after a grace period, and only then does the promise reject.
 *
 * While the child runs, SIGINT / SIGTERM received by this process are
 * forwarded to the group (a detached group no longer receives the terminal's
 * or the runner's signals) and then re-raised with the default behaviour.
 *
 * POSIX only (process groups); the pipeline runs on ubuntu-latest / macOS.
 */

import { spawn } from "child_process";

export const DEFAULT_KILL_GRACE_MS = 5000;
const FORWARDED_SIGNALS = ["SIGINT", "SIGTERM"];

/**
 * @param {string} cmd shell command
 * @param {object} [opts]
 * @param {string} [opts.cwd]
 * @param {number} [opts.timeout]      ms; 0 = no timeout
 * @param {number} [opts.killGraceMs]  ms between SIGTERM and SIGKILL of the group
 * @returns {Promise<void>} resolves on exit code 0; rejects on failure, spawn error or timeout
 */
export function runInProcessGroup(
  cmd,
  {
    cwd,
    timeout = 0,
    killGraceMs = DEFAULT_KILL_GRACE_MS,
    spawnImpl = spawn,
    kill = (pid, signal) => process.kill(pid, signal),
    signalSource = process,
    selfPid = process.pid,
    log = console.log,
  } = {}
) {
  return new Promise((resolve, reject) => {
    log(`\n>>> ${cmd}\n`);

    let child;
    try {
      child = spawnImpl(cmd, { cwd, shell: true, stdio: "inherit", detached: true });
    } catch (err) {
      reject(err);
      return;
    }

    let settled = false;
    let timedOut = false;
    let exited = false;
    let swept = false;
    let timer = null;
    let graceTimer = null;

    const killGroup = (signal) => {
      if (!child.pid) return;
      try {
        kill(-child.pid, signal);
      } catch {
        // ESRCH: nothing left in the group
      }
    };
    const cleanup = () => {
      clearTimeout(timer);
      clearTimeout(graceTimer);
      for (const s of FORWARDED_SIGNALS) signalSource.removeListener(s, onParentSignal);
    };
    const settle = (fn, value) => {
      if (settled) return;
      settled = true;
      cleanup();
      fn(value);
    };
    function onParentSignal(signal) {
      killGroup("SIGKILL");
      cleanup();
      kill(selfPid, signal); // no listener left → the default action (terminate)
    }
    for (const s of FORWARDED_SIGNALS) signalSource.on(s, onParentSignal);

    const timeoutError = () =>
      new Error(`timed out after ${Math.round(timeout / 1000)}s (process group killed): ${cmd}`);

    if (timeout > 0) {
      timer = setTimeout(() => {
        timedOut = true;
        killGroup("SIGTERM");
        graceTimer = setTimeout(() => {
          killGroup("SIGKILL");
          swept = true;
          if (exited) settle(reject, timeoutError());
        }, killGraceMs);
      }, timeout);
    }

    child.once("error", (err) => {
      killGroup("SIGKILL");
      settle(reject, err);
    });
    child.once("exit", (code, signal) => {
      exited = true;
      if (timedOut) {
        // Wait for the grace-period SIGKILL sweep so no grandchild survives.
        if (swept) settle(reject, timeoutError());
        return;
      }
      if (code === 0) {
        settle(resolve);
        return;
      }
      killGroup("SIGKILL"); // don't leave helpers of a failed command behind
      settle(reject, new Error(`command failed (${signal ?? `exit code ${code}`}): ${cmd}`));
    });
  });
}
