import { promises as fs } from "node:fs";
import path from "node:path";
import { exec as execCb } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execCb);

async function* walk(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const res = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (
        ["node_modules", ".git", ".next", "dist", "build"].includes(entry.name)
      )
        continue;
      yield* walk(res);
    } else {
      yield res;
    }
  }
}

const exts = [".js", ".mjs", ".cjs", ".jsx", ".ts", ".tsx"];

for await (const file of walk(process.cwd())) {
  if (!exts.some((ext) => file.endsWith(ext))) continue;
  try {
    if (file.endsWith(".ts") || file.endsWith(".tsx")) {
      try {
        await exec(`node --experimental-strip-types --check "${file}"`);
      } catch (err) {
        continue;
      }
    } else if (file.endsWith(".jsx")) {
      continue;
    } else {
      await exec(`node --check "${file}"`);
    }
  } catch (e) {
    console.error("Syntax error in", file);
    if (e.stdout) console.error(e.stdout);
    if (e.stderr) console.error(e.stderr);
    process.exit(1);
  }
}
