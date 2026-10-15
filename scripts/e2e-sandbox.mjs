#!/usr/bin/env node
// Ejecuta los e2e aislados para que nunca puedan tumbar el servidor.
//
// Los e2e levantan `next dev` (Turbopack), Postgres y Chromium. En un host compartido eso puede
// agotar la RAM: el OOM killer acababa matando el servicio desde el que se lanzaban (pm2-root,
// con la UI de sesiones) y systemd lo reiniciaba entero. Aquí todo el árbol de procesos corre en
// un scope de systemd propio con límites duros: si se pasa de memoria muere solo el test.
//
// Uso: node scripts/e2e-sandbox.mjs <comando> [args...]
// Variables:
//   E2E_MEMORY_MAX   límite duro de memoria del scope (por defecto 3584M = 3,5 GB)
//   E2E_CPU_QUOTA    CPU máxima (por defecto 200% = 2 núcleos)
//   E2E_SANDBOX=off  sin aislamiento (CI o contenedores sin systemd; también si CI está definida)
import { spawn, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const [command, ...args] = process.argv.slice(2);
if (!command) {
  console.error("e2e-sandbox: indica el comando a ejecutar.");
  process.exit(2);
}

const memoryMax = process.env.E2E_MEMORY_MAX ?? "3584M";
const cpuQuota = process.env.E2E_CPU_QUOTA ?? "200%";
const sandboxOff = process.env.E2E_SANDBOX === "off" || Boolean(process.env.CI) || process.env.E2E_SANDBOXED === "1";

// Memoria contenida también dentro del scope: heap de V8 acotado (next dev, Playwright) y
// Turbopack liberando de RAM lo que ya ha guardado en su caché de disco (next.config.ts).
// En CI (máquina dedicada) se deja el entorno tal cual.
const env = sandboxOff && process.env.E2E_SANDBOXED !== "1"
  ? process.env
  : {
      ...process.env,
      E2E_SANDBOXED: "1",
      E2E_LOW_MEMORY: "1",
      NODE_OPTIONS: [process.env.NODE_OPTIONS, "--max-old-space-size=1536"].filter(Boolean).join(" "),
    };

function bytesOf(value) {
  const match = /^(\d+(?:\.\d+)?)([KMGT]?)$/i.exec(value.trim());
  if (!match) return null;
  const power = { "": 0, K: 1, M: 2, G: 3, T: 4 }[match[2].toUpperCase()];
  return Math.floor(Number(match[1]) * 1024 ** power);
}

function run(executable, executableArgs, onDone) {
  const child = spawn(executable, executableArgs, { env, stdio: "inherit" });
  let stopping = false;
  const stop = (signal) => {
    if (stopping) return;
    stopping = true;
    child.kill(signal);
    // Si no termina por las buenas, se fuerza.
    setTimeout(() => child.kill("SIGKILL"), 10_000).unref();
  };
  process.on("SIGINT", () => stop("SIGINT"));
  process.on("SIGTERM", () => stop("SIGTERM"));
  process.on("SIGHUP", () => stop("SIGTERM"));
  child.on("exit", (code, signal) => onDone(code, signal));
}

if (sandboxOff) {
  run(command, args, (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
} else {
  if (spawnSync("systemd-run", ["--version"], { stdio: "ignore" }).status !== 0) {
    console.error(
      "e2e-sandbox: no hay systemd-run, así que no se pueden limitar memoria y CPU.\n" +
        "Para no arriesgar el servidor no se ejecutan los e2e. En CI o contenedores usa E2E_SANDBOX=off.",
    );
    process.exit(1);
  }
  const memoryBytes = bytesOf(memoryMax);
  if (!memoryBytes) {
    console.error(`e2e-sandbox: E2E_MEMORY_MAX no válido (${memoryMax}). Ejemplos: 3G, 2500M.`);
    process.exit(2);
  }
  const unit = `erp-e2e-${process.pid}`;
  // MemoryHigh (85 %) hace que el kernel recupere memoria y frene el scope antes de llegar al
  // límite duro; MemorySwapMax=0 evita que el exceso se vaya a swap y ralentice todo el host.
  const systemdArgs = [
    "--scope", "--quiet", "--collect", `--unit=${unit}`,
    "-p", `MemoryMax=${memoryBytes}`,
    "-p", `MemoryHigh=${Math.floor(memoryBytes * 0.85)}`,
    "-p", "MemorySwapMax=0",
    "-p", `CPUQuota=${cpuQuota}`,
    "-p", "TasksMax=2048",
    "--nice=10",
    "--",
    command,
    ...args,
  ];
  console.log(`e2e-sandbox: scope ${unit} · memoria máx. ${memoryMax} · CPU ${cpuQuota}`);
  // El scope desaparece al terminar: el pico se lee mientras corre.
  // El cgroup cuenta también la caché de disco (reclamable): se informa aparte de la memoria real.
  let peak = 0;
  let peakAnon = 0;
  const sampler = setInterval(() => {
    try {
      const dir = `/sys/fs/cgroup/system.slice/${unit}.scope`;
      peak = Math.max(peak, Number(readFileSync(`${dir}/memory.peak`, "utf8")) || 0);
      const anon = /^anon (\d+)$/m.exec(readFileSync(`${dir}/memory.stat`, "utf8"))?.[1];
      peakAnon = Math.max(peakAnon, Number(anon) || 0);
    } catch {
      // Aún no creado o ya terminado.
    }
  }, 1_000);
  run("systemd-run", systemdArgs, (code, signal) => {
    clearInterval(sampler);
    const gb = (bytes) => (bytes / 1024 ** 3).toFixed(2);
    if (peak > 0) console.log(`e2e-sandbox: pico de memoria real ${gb(peakAnon)} GB · con caché de disco ${gb(peak)} GB · límite ${memoryMax}`);
    // Detiene el scope entero: ningún next dev, Chromium o worker queda huérfano.
    spawnSync("systemctl", ["stop", `${unit}.scope`], { stdio: "ignore" });
    if (signal === "SIGKILL" || code === 137) {
      console.error(
        `e2e-sandbox: los e2e superaron el límite de ${memoryMax} y se han detenido (el resto del servidor no se ha visto afectado).\n` +
          "Ejecuta menos specs a la vez o sube E2E_MEMORY_MAX si el host tiene memoria libre.",
      );
    }
    process.exit(code ?? 1);
  });
}
