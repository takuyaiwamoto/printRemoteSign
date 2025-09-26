#!/usr/bin/env node
import { spawn } from 'node:child_process';

const tasks = [
  {
    name: 'led-bridge',
    command: 'npm',
    args: ['--prefix', 'server', 'run', 'led-bridge'],
  },
  {
    name: 'receiver',
    command: 'npm',
    args: ['--prefix', 'electron-receiver', 'start'],
  },
];

const children = new Map();
let shuttingDown = false;

function spawnTask(task) {
  const child = spawn(task.command, task.args, {
    stdio: 'inherit',
    env: process.env,
  });
  children.set(task.name, child);

  child.on('exit', (code, signal) => {
    if (shuttingDown) return;
    console.log(`\n[dev-start] ${task.name} exited (code=${code ?? 'null'}, signal=${signal ?? 'null'})`);
    shuttingDown = true;
    stopAll();
    const exitCode = typeof code === 'number' ? code : 1;
    process.exit(exitCode);
  });

  child.on('error', (err) => {
    console.error(`\n[dev-start] failed to start ${task.name}:`, err);
    shuttingDown = true;
    stopAll();
    process.exit(1);
  });
}

function stopAll() {
  if (!children.size) return;
  for (const [name, child] of children.entries()) {
    if (child.killed) continue;
    console.log(`[dev-start] stopping ${name}`);
    child.kill('SIGTERM');
  }
}

process.on('SIGINT', () => {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log('\n[dev-start] caught SIGINT, shutting down');
  stopAll();
  setTimeout(() => process.exit(0), 500);
});

process.on('SIGTERM', () => {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log('\n[dev-start] caught SIGTERM, shutting down');
  stopAll();
  setTimeout(() => process.exit(0), 500);
});

for (const task of tasks) {
  spawnTask(task);
}
