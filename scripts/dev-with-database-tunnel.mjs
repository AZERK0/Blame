import { spawn } from "node:child_process";
import net from "node:net";
import process from "node:process";

const databaseTunnel = {
  destination: "ubuntu@server.raphael-charpentier.fr",
  localPort: 13307,
  remotePort: 13307,
};

const developmentArguments = [
  "exec",
  "turbo",
  "run",
  "dev",
  "--filter=@blame/api",
  "--filter=@blame/desktop",
  ...process.argv.slice(2),
];

const childProcesses = new Set();
const processErrors = new WeakMap();
let receivedSignal;

function startProcess(command, argumentsList) {
  const childProcess = spawn(command, argumentsList, { stdio: "inherit" });
  childProcesses.add(childProcess);
  childProcess.once("error", (error) => processErrors.set(childProcess, error));
  childProcess.once("exit", () => childProcesses.delete(childProcess));
  return childProcess;
}

function stopProcesses(signal = "SIGTERM") {
  for (const childProcess of childProcesses) {
    if (childProcess.exitCode === null && childProcess.signalCode === null) {
      childProcess.kill(signal);
    }
  }
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function canConnectToDatabase() {
  return new Promise((resolve) => {
    const socket = net.createConnection({
      host: "127.0.0.1",
      port: databaseTunnel.localPort,
    });
    const finish = (isConnected) => {
      socket.destroy();
      resolve(isConnected);
    };
    socket.setTimeout(500);
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
    socket.once("timeout", () => finish(false));
  });
}

async function waitForDatabaseTunnel(tunnelProcess) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const processError = processErrors.get(tunnelProcess);
    if (processError) {
      throw new Error(`Impossible de lancer SSH : ${processError.message}`);
    }
    if (tunnelProcess.exitCode !== null) {
      throw new Error("Le tunnel SSH vers la base Blame a été interrompu");
    }
    if (await canConnectToDatabase()) {
      await wait(100);
      if (tunnelProcess.exitCode === null) return;
    }
    await wait(200);
  }
  throw new Error("La base Blame reste inaccessible via le tunnel SSH");
}

function waitForProcessExit(childProcess, source) {
  return new Promise((resolve) => {
    childProcess.once("error", (error) =>
      resolve({ code: 1, error, signal: null, source }),
    );
    childProcess.once("exit", (code, signal) =>
      resolve({ code, signal, source }),
    );
  });
}

function installSignalHandlers() {
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.once(signal, () => {
      receivedSignal = signal;
      stopProcesses(signal);
    });
  }
}

function resolveExitCode(result) {
  if (receivedSignal === "SIGINT") return 130;
  if (receivedSignal === "SIGTERM") return 143;
  if (result.signal) return 1;
  return result.code ?? 1;
}

function startDatabaseTunnel() {
  return startProcess("ssh", [
    "-N",
    "-T",
    "-o",
    "BatchMode=yes",
    "-o",
    "ConnectTimeout=10",
    "-o",
    "ExitOnForwardFailure=yes",
    "-o",
    "ServerAliveInterval=30",
    "-o",
    "ServerAliveCountMax=3",
    "-L",
    `127.0.0.1:${databaseTunnel.localPort}:127.0.0.1:${databaseTunnel.remotePort}`,
    databaseTunnel.destination,
  ]);
}

async function runDevelopment() {
  installSignalHandlers();
  const tunnelProcess = startDatabaseTunnel();
  await waitForDatabaseTunnel(tunnelProcess);
  console.log(
    `Base Blame accessible sur 127.0.0.1:${databaseTunnel.localPort}`,
  );
  const pnpmExecutable = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
  const developmentProcess = startProcess(pnpmExecutable, developmentArguments);
  const result = await Promise.race([
    waitForProcessExit(tunnelProcess, "tunnel"),
    waitForProcessExit(developmentProcess, "development"),
  ]);
  if (result.source === "tunnel" && !receivedSignal) {
    console.error("Le tunnel SSH Blame a été interrompu");
  }
  stopProcesses();
  process.exitCode = resolveExitCode(result);
}

runDevelopment().catch((error) => {
  stopProcesses();
  if (!receivedSignal) console.error(error.message);
  process.exitCode = receivedSignal === "SIGINT" ? 130 : 1;
});
