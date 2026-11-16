// Una sola ejecución e2e a la vez: dos a la vez duplican memoria y CPU y se estrangulan entre sí.
// El bloqueo es un fichero con el pid del dueño; si ese proceso ya no existe, se considera huérfano.
// Los procesos hijos heredan E2E_LOCK_PID y no vuelven a pedirlo (e2e-fast → e2e-sandbox).
import { closeSync, openSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";

const LOCK_FILE = "/tmp/erp-e2e.lock";

export function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function lockOwner() {
  try {
    return Number(readFileSync(LOCK_FILE, "utf8").trim()) || 0;
  } catch {
    return 0;
  }
}

/** true si este proceso (o el padre que lo lanzó) tiene el bloqueo; si otro lo tiene, explica y devuelve false. */
export function acquireE2eLock(label) {
  const inherited = Number(process.env.E2E_LOCK_PID);
  if (inherited && lockOwner() === inherited && pidAlive(inherited)) return true;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const fd = openSync(LOCK_FILE, "wx");
      writeFileSync(fd, String(process.pid));
      closeSync(fd);
      process.env.E2E_LOCK_PID = String(process.pid);
      process.on("exit", () => {
        if (lockOwner() === process.pid) unlinkSync(LOCK_FILE);
      });
      return true;
    } catch {
      const owner = lockOwner();
      if (owner && pidAlive(owner)) {
        console.error(`${label}: ya hay unos e2e en marcha (pid ${owner}). Espera a que terminen o detenlos con: kill ${owner}`);
        return false;
      }
      try {
        unlinkSync(LOCK_FILE); // Huérfano: el proceso que lo creó ya no existe.
      } catch {
        // Otro lo ha borrado a la vez.
      }
    }
  }
  return false;
}
