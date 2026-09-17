import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const url = process.argv[2];
const target = process.env.AUTH_URL_FILE ?? "/data/run/auth-url.txt";

if (!url) {
  console.error("auth-capture requires a URL");
  process.exitCode = 2;
} else {
  await mkdir(dirname(target), { recursive: true });
  const temporary = `${target}.tmp-${process.pid}`;
  await writeFile(temporary, `${url}\n`, { mode: 0o600 });
  await rename(temporary, target);
}
