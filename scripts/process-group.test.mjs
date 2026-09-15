import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtempSync, readFileSync, existsSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { runInProcessGroup } from "./process-group.mjs";

const PID = 4242;
const SELF = 999;

/** Fake spawn/kill: records calls; `onKill` decides how the fake child reacts to a signal. */
function harness({ onKill = () => {} } = {}) {
  const child = new EventEmitter();
  child.pid = PID;
  const spawns = [];
  const kills = [];
  const signalSource = new EventEmitter();
  const opts = {
    spawnImpl: (cmd, options) => {
      spawns.push({ cmd, options });
      return child;
    },
    kill: (pid, signal) => {
      kills.push([pid, signal]);
      onKill(pid, signal, child);
    },
    signalSource,
    selfPid: SELF,
    log: () => {},
  };
  return { child, spawns, kills, signalSource, opts };
}

test("spawns a detached shell (own process group) and resolves on exit 0 without killing anything", async () => {
  const h = harness();
  const done = runInProcessGroup("npx remotion render", { ...h.opts, cwd: "/repo", timeout: 1000 });
  setImmediate(() => h.child.emit("exit", 0, null));
  await done;
  assert.equal(h.spawns[0].cmd, "npx remotion render");
  assert.equal(h.spawns[0].options.detached, true);
  assert.equal(h.spawns[0].options.shell, true);
  assert.equal(h.spawns[0].options.cwd, "/repo");
  assert.deepEqual(h.kills, []);
  assert.equal(h.signalSource.listenerCount("SIGINT"), 0);
  assert.equal(h.signalSource.listenerCount("SIGTERM"), 0);
});

test("timeout kills the whole process group: SIGTERM, then SIGKILL after the grace period", async () => {
  // The leader exits on SIGTERM; grandchildren may not — the group is still swept with SIGKILL.
  const h = harness({
    onKill: (pid, signal, child) => {
      if (signal === "SIGTERM") setImmediate(() => child.emit("exit", null, "SIGTERM"));
    },
  });
  await assert.rejects(
    runInProcessGroup("npx remotion render", { ...h.opts, timeout: 20, killGraceMs: 20 }),
    /timed out .*process group killed/
  );
  assert.deepEqual(h.kills, [
    [-PID, "SIGTERM"],
    [-PID, "SIGKILL"],
  ]);
  assert.equal(h.signalSource.listenerCount("SIGTERM"), 0);
});

test("timeout still settles when the leader ignores SIGTERM and only SIGKILL ends it", async () => {
  const h = harness({
    onKill: (pid, signal, child) => {
      if (signal === "SIGKILL") setImmediate(() => child.emit("exit", null, "SIGKILL"));
    },
  });
  await assert.rejects(runInProcessGroup("stubborn", { ...h.opts, timeout: 10, killGraceMs: 10 }), /timed out/);
  assert.deepEqual(h.kills, [
    [-PID, "SIGTERM"],
    [-PID, "SIGKILL"],
  ]);
});

test("a failing command rejects and its group is swept", async () => {
  const h = harness();
  const done = runInProcessGroup("ffmpeg -i missing.mp4", { ...h.opts, timeout: 1000 });
  setImmediate(() => h.child.emit("exit", 1, null));
  await assert.rejects(done, /exit code 1/);
  assert.deepEqual(h.kills, [[-PID, "SIGKILL"]]);
});

test("SIGTERM/SIGINT to the pipeline are forwarded to the group, then re-raised", async () => {
  const h = harness();
  const done = runInProcessGroup("npx remotion render", { ...h.opts, timeout: 1000 });
  h.signalSource.emit("SIGTERM", "SIGTERM");
  assert.deepEqual(h.kills, [
    [-PID, "SIGKILL"],
    [SELF, "SIGTERM"],
  ]);
  assert.equal(h.signalSource.listenerCount("SIGINT"), 0);
  h.child.emit("exit", null, "SIGKILL");
  await assert.rejects(done, /SIGKILL/);
});

test("spawn errors reject", async () => {
  const h = harness();
  h.opts.spawnImpl = () => {
    throw new Error("EAGAIN");
  };
  await assert.rejects(runInProcessGroup("anything", h.opts), /EAGAIN/);
});

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === "EPERM";
  }
}

async function waitFor(predicate, ms) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (predicate()) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return predicate();
}

test(
  "real process: a timed-out command's grandchild is killed too (not just the shell)",
  { skip: process.platform === "win32" && "process groups are POSIX-only" },
  async () => {
    const tmp = mkdtempSync(join(tmpdir(), "pgroup-test-"));
    const pidFile = join(tmp, "grandchild.pid");
    try {
      await assert.rejects(
        runInProcessGroup(`sleep 30 & echo $! > "${pidFile}"; sleep 30`, {
          timeout: 400,
          killGraceMs: 100,
          log: () => {},
        }),
        /timed out/
      );
      assert.ok(await waitFor(() => existsSync(pidFile), 1000), "grandchild pid recorded");
      const grandchild = Number(readFileSync(pidFile, "utf8").trim());
      assert.ok(grandchild > 0);
      assert.ok(await waitFor(() => !isAlive(grandchild), 3000), `grandchild ${grandchild} still alive`);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  }
);
