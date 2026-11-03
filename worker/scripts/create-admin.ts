import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import * as readline from "node:readline";
import { execSync } from "node:child_process";
import { hashPassword } from "../src/auth/password.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const workerDir = resolve(__dirname, "..");

export function prompt(query: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((res) => {
    rl.question(query, (ans) => {
      rl.close();
      res(ans.trim());
    });
  });
}

export function promptSecret(query: string): Promise<string> {
  return new Promise((res) => {
    process.stdout.write(query);
    const stdin = process.stdin;

    if (stdin.isTTY) {
      stdin.setRawMode(true);
      stdin.resume();
      stdin.setEncoding("utf8");

      let input = "";
      const onData = (data: string) => {
        for (const char of data) {
          if (char === "\r" || char === "\n" || char === "\u0004") {
            stdin.setRawMode(false);
            stdin.pause();
            stdin.removeListener("data", onData);
            process.stdout.write("\n");
            res(input);
            return;
          } else if (char === "\u0003") {
            stdin.setRawMode(false);
            stdin.pause();
            stdin.removeListener("data", onData);
            process.stdout.write("\n");
            process.exitCode = 1;
            return;
          } else if (char === "\u007f" || char === "\b") {
            if (input.length > 0) {
              input = input.slice(0, -1);
              process.stdout.write("\b \b");
            }
          } else if (char.charCodeAt(0) >= 32) {
            input += char;
            process.stdout.write("*");
          }
        }
      };
      stdin.on("data", onData);
    } else {
      const rl = readline.createInterface({
        input: stdin,
        output: process.stdout,
      });
      rl.question("", (ans) => {
        rl.close();
        res(ans);
      });
    }
  });
}

/**
 * Reads local .dev.vars content from standard locations.
 */
export function readDevVars(): string | null {
  const candidates = [
    resolve(workerDir, ".dev.vars"),
    resolve(process.cwd(), ".dev.vars"),
    resolve(process.cwd(), "worker", ".dev.vars"),
  ];

  for (const devVarsPath of candidates) {
    try {
      const normalized = devVarsPath.replace(/^\/([a-zA-Z]:)/, "$1");
      if (existsSync(normalized)) {
        return readFileSync(normalized, "utf-8");
      }
    } catch {
      // Continue checking other candidates
    }
  }

  return null;
}

/**
 * Resolves PASSWORD_PEPPER secret.
 * In remote mode (--remote), reading .dev.vars is strictly prohibited to prevent
 * accidentally using local development secrets for production environments.
 */
export function getPepper(
  isRemote: boolean,
  devVarsReader: () => string | null = readDevVars,
): string {
  // 1. Check environment variable (supported in both local and remote)
  if (process.env.PASSWORD_PEPPER && process.env.PASSWORD_PEPPER.trim().length >= 32) {
    return process.env.PASSWORD_PEPPER.trim();
  }

  // 2. Only read .dev.vars for local development. Strictly prohibited for remote execution.
  if (!isRemote) {
    const content = devVarsReader();
    if (content) {
      const match = content.match(/^PASSWORD_PEPPER=(.+)$/m);
      if (match && match[1].trim().length >= 32) {
        return match[1].trim();
      }
    }
  }

  return "";
}

export async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    console.log(`
Usage:
  Local D1:  npm run create-admin
             npm run create-admin -- --local
  Remote D1: npm run create-admin -- --remote

Options:
  --local      Target local D1 database (miniflare, default)
  --remote     Target remote Cloudflare D1 database
  --username   Admin username (optional, will prompt if omitted)
  --help, -h   Show this help message
`);
    return;
  }

  const isRemote = args.includes("--remote");
  const targetFlag = isRemote ? "--remote" : "--local";
  const targetDesc = isRemote ? "REMOTE Cloudflare D1" : "LOCAL D1 (miniflare)";

  console.log(`\n========================================`);
  console.log(` TapMe First-Admin Initialization CLI `);
  console.log(` Target: ${targetDesc}`);
  console.log(`========================================\n`);

  // Step 1: Check existing admins count in D1
  console.log(`Checking if an administrator already exists in ${targetDesc}...`);
  try {
    const countOutput = execSync(
      `npx wrangler d1 execute tapme-database ${targetFlag} --command="SELECT count(*) as count FROM admins;" --json`,
      { cwd: workerDir, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] },
    );
    const parsed = JSON.parse(countOutput);
    const count = parsed[0]?.results?.[0]?.count ?? 0;

    if (count > 0) {
      console.error(
        `\n[ERROR] Setup aborted: The admins table is not empty (${count} admin account(s) already exist).`,
      );
      console.error(
        `Initial admin setup is strictly restricted to an empty database for security.\n`,
      );
      process.exitCode = 1;
      return;
    }
  } catch (err: unknown) {
    console.error(`\n[ERROR] Failed to query admins table via Wrangler D1:`);
    if (err instanceof Error && "stderr" in err) {
      console.error((err as { stderr: string }).stderr);
    } else {
      console.error(err);
    }
    process.exitCode = 1;
    return;
  }

  console.log(`[OK] admins table is empty. Ready to create initial main_admin.\n`);

  // Step 2: Resolve PASSWORD_PEPPER before prompting credentials or writing to D1
  let pepper = getPepper(isRemote);
  if (!pepper) {
    if (isRemote) {
      console.log(`[SECURITY] Remote D1 mode active: Reading .dev.vars is strictly prohibited.`);
      console.log(`Please provide the production PASSWORD_PEPPER secret (at least 32 characters).\n`);
    }
    pepper = await promptSecret(
      `Enter PASSWORD_PEPPER secret for ${targetDesc} (at least 32 characters): `,
    );
    if (!pepper || new TextEncoder().encode(pepper.trim()).length < 32) {
      console.error(
        `\n[ERROR] Setup aborted: PASSWORD_PEPPER must contain at least 32 bytes.`,
      );
      process.exitCode = 1;
      return;
    }
    pepper = pepper.trim();
  }

  // Step 3: Prompt for username
  let username = "";
  const usernameArgIdx = args.findIndex((a) => a === "--username");
  if (usernameArgIdx !== -1 && args[usernameArgIdx + 1]) {
    username = args[usernameArgIdx + 1].trim();
  } else {
    username = await prompt("Enter initial admin username (3-50 alphanumeric chars): ");
  }

  if (!/^[a-zA-Z0-9_.@-]{3,50}$/.test(username)) {
    console.error(
      `\n[ERROR] Invalid username. Must be 3-50 characters containing only letters, numbers, '.', '_', '-', or '@'.`,
    );
    process.exitCode = 1;
    return;
  }

  // Step 4: Prompt for password
  const password = await promptSecret("Enter admin password (min 12 characters): ");
  if (password.length < 12) {
    console.error(`\n[ERROR] Password must be at least 12 characters.`);
    process.exitCode = 1;
    return;
  }

  const confirmPassword = await promptSecret("Confirm admin password: ");
  if (password !== confirmPassword) {
    console.error(`\n[ERROR] Passwords do not match.`);
    process.exitCode = 1;
    return;
  }

  // Step 5: Hash password
  console.log(`\nHashing password using PBKDF2-SHA256 (100,000 iterations)...`);
  const passwordHash = await hashPassword(password, pepper);
  const adminId = crypto.randomUUID();

  // Step 6: Insert into D1 using atomic SQL guard
  const tempSqlFile = resolve(workerDir, `.tmp_init_admin_${Date.now()}.sql`);
  const sql = `INSERT INTO admins (id, username, password_hash, role, status)
SELECT '${adminId}', '${username}', '${passwordHash}', 'main_admin', 'active'
WHERE NOT EXISTS (SELECT 1 FROM admins LIMIT 1);
`;

  try {
    writeFileSync(tempSqlFile, sql, "utf-8");

    console.log(`Executing initial admin creation against ${targetDesc}...`);
    execSync(
      `npx wrangler d1 execute tapme-database ${targetFlag} --file="${tempSqlFile}" --json`,
      { cwd: workerDir, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] },
    );

    // Verify creation
    const verifyOutput = execSync(
      `npx wrangler d1 execute tapme-database ${targetFlag} --command="SELECT id, username, role, status, created_at FROM admins WHERE id = '${adminId}';" --json`,
      { cwd: workerDir, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] },
    );
    const verifyData = JSON.parse(verifyOutput);
    const created = verifyData[0]?.results?.[0];

    if (!created) {
      console.error(
        `\n[ERROR] Admin was not created. Another admin may have been registered concurrently.`,
      );
      process.exitCode = 1;
      return;
    }

    console.log(`\n========================================`);
    console.log(` [SUCCESS] Initial main_admin created!`);
    console.log(`----------------------------------------`);
    console.log(` ID:         ${created.id}`);
    console.log(` Username:   ${created.username}`);
    console.log(` Role:       ${created.role}`);
    console.log(` Status:     ${created.status}`);
    console.log(` Created At: ${created.created_at}`);
    console.log(`========================================\n`);
  } catch (err: unknown) {
    console.error(`\n[ERROR] Failed to execute admin insertion:`, err);
    process.exitCode = 1;
    return;
  } finally {
    if (existsSync(tempSqlFile)) {
      unlinkSync(tempSqlFile);
    }
  }
}

// Only run automatically when executed directly
const isDirectExecution =
  process.argv[1] &&
  (resolve(process.argv[1]) === resolve(__filename) ||
    process.argv[1].endsWith("create-admin.ts"));

if (isDirectExecution) {
  main().catch((err) => {
    console.error("Unexpected error:", err);
    process.exitCode = 1;
  });
}
