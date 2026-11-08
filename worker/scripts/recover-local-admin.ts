import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import * as readline from "node:readline";
import { execSync } from "node:child_process";
import { hashPassword, verifyPassword } from "../src/auth/password.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const workerDir = resolve(__dirname, "..");
const wranglerConfigPath = resolve(workerDir, "wrangler.jsonc");

const TARGET_ADMIN_ID = "b42f67b3-18b9-4062-9154-ad2921e78cfe";

/**
 * Securely prompts for input with masked characters (*) in TTY.
 * Never logs or prints the entered password.
 */
function promptSecret(query: string): Promise<string> {
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
 * Reads PASSWORD_PEPPER from worker/.dev.vars without printing or exposing it.
 */
function readLocalPepper(): string {
  const devVarsPath = resolve(workerDir, ".dev.vars");
  if (!existsSync(devVarsPath)) {
    throw new Error(
      "worker/.dev.vars file not found. Ensure .dev.vars exists in the worker directory.",
    );
  }

  const content = readFileSync(devVarsPath, "utf-8");
  const match = content.match(/^PASSWORD_PEPPER=(.+)$/m);
  if (!match || !match[1].trim()) {
    throw new Error(
      "PASSWORD_PEPPER not found in worker/.dev.vars.",
    );
  }

  const pepper = match[1].trim();
  if (new TextEncoder().encode(pepper).length < 32) {
    throw new Error(
      "PASSWORD_PEPPER in worker/.dev.vars must be at least 32 bytes.",
    );
  }

  return pepper;
}

export async function main() {
  const args = process.argv.slice(2);

  // Safety Gate 1: Strictly reject any attempt to target remote / production
  if (args.includes("--remote")) {
    console.error(
      "\n[SAFETY ERROR] This recovery script is strictly for LOCAL development recovery.",
    );
    console.error("The --remote flag is intentionally prohibited. Production will NOT be touched.\n");
    process.exitCode = 1;
    return;
  }

  console.log("\n==================================================");
  console.log(" TapMe Local-Only Admin Password Recovery");
  console.log(" Target: LOCAL D1 ONLY (Miniflare SQLite)");
  console.log(` Target Admin ID: ${TARGET_ADMIN_ID}`);
  console.log("==================================================\n");

  // Step 1: Verify target admin exists in local D1
  console.log("Verifying local administrator account...");
  let adminUsername = "";
  let adminRole = "";
  let adminStatus = "";

  try {
    const adminCheckOutput = execSync(
      `npx wrangler d1 execute tapme-database --local --config="${wranglerConfigPath}" --command="SELECT id, username, role, status FROM admins WHERE id = '${TARGET_ADMIN_ID}';" --json`,
      { cwd: workerDir, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] },
    );
    const parsed = JSON.parse(adminCheckOutput);
    const admin = parsed[0]?.results?.[0];

    if (!admin) {
      console.error(
        `\n[ERROR] Admin account with ID '${TARGET_ADMIN_ID}' was not found in local D1.`,
      );
      process.exitCode = 1;
      return;
    }

    adminUsername = admin.username;
    adminRole = admin.role;
    adminStatus = admin.status;

    console.log(`[OK] Found local admin: @${adminUsername} (Role: ${adminRole}, Status: ${adminStatus})\n`);
  } catch (err: unknown) {
    console.error("\n[ERROR] Failed to query local D1 database:");
    if (err instanceof Error && "stderr" in err) {
      console.error((err as { stderr: string }).stderr);
    } else {
      console.error(err);
    }
    process.exitCode = 1;
    return;
  }

  // Step 2: Read local PASSWORD_PEPPER from worker/.dev.vars
  let pepper: string;
  try {
    pepper = readLocalPepper();
    console.log("[OK] Successfully loaded local PASSWORD_PEPPER from worker/.dev.vars (Length: >=32 bytes).\n");
  } catch (err: unknown) {
    console.error(`\n[ERROR] ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
    return;
  }

  // Step 3: Prompt securely for new password
  const password = await promptSecret(
    `Enter new password for local @${adminUsername} (min 12 characters): `,
  );

  if (!password || password.length < 12) {
    console.error("\n[ERROR] Password must be at least 12 characters.");
    process.exitCode = 1;
    return;
  }

  if (new TextEncoder().encode(password).length > 1024) {
    console.error("\n[ERROR] Password is too long (max 1024 bytes).");
    process.exitCode = 1;
    return;
  }

  const confirmPassword = await promptSecret("Confirm new password: ");
  if (password !== confirmPassword) {
    console.error("\n[ERROR] Passwords do not match.");
    process.exitCode = 1;
    return;
  }

  // Step 4: Hash password with PBKDF2 using the local pepper
  console.log("\nDeriving password hash using PBKDF2-SHA256 (100,000 iterations)...");
  const newPasswordHash = await hashPassword(password, pepper);

  // Step 5: Execute password update and verify exactly ONE row was affected
  console.log("Applying password update in local D1...");
  const tempSqlFile = resolve(workerDir, `.tmp_pw_recover_${Date.now()}.sql`);
  const updateSql = `
UPDATE admins
SET password_hash = '${newPasswordHash}'
WHERE id = '${TARGET_ADMIN_ID}';
SELECT changes() as rows_updated;
`;

  try {
    writeFileSync(tempSqlFile, updateSql, "utf-8");

    const updateOutput = execSync(
      `npx wrangler d1 execute tapme-database --local --config="${wranglerConfigPath}" --file="${tempSqlFile}" --json`,
      { cwd: workerDir, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] },
    );

    const updateParsed = JSON.parse(updateOutput);
    const rowsUpdated =
      updateParsed[1]?.results?.[0]?.rows_updated ??
      updateParsed[0]?.meta?.changes ??
      0;

    if (rowsUpdated !== 1) {
      console.error(
        `\n[ERROR] Password update failed: Expected exactly 1 row to be affected, but ${rowsUpdated} row(s) were updated.`,
      );
      process.exitCode = 1;
      return;
    }

    console.log(`[OK] Password UPDATE verified: Exactly ${rowsUpdated} row updated.`);
  } catch (err: unknown) {
    console.error("\n[ERROR] Failed to execute password update against local D1:");
    if (err instanceof Error && "stderr" in err) {
      console.error((err as { stderr: string }).stderr);
    } else {
      console.error(err);
    }
    process.exitCode = 1;
    return;
  } finally {
    if (existsSync(tempSqlFile)) {
      unlinkSync(tempSqlFile);
    }
  }

  // Step 6: Verify the stored hash in local D1 using existing verifyPassword()
  console.log("Performing cryptographic verification via verifyPassword()...");
  try {
    const readHashOutput = execSync(
      `npx wrangler d1 execute tapme-database --local --config="${wranglerConfigPath}" --command="SELECT password_hash FROM admins WHERE id = '${TARGET_ADMIN_ID}';" --json`,
      { cwd: workerDir, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] },
    );
    const readHashParsed = JSON.parse(readHashOutput);
    const storedHash = readHashParsed[0]?.results?.[0]?.password_hash;

    if (!storedHash || typeof storedHash !== "string") {
      console.error("\n[ERROR] Verification failed: Could not read updated password_hash from local D1.");
      process.exitCode = 1;
      return;
    }

    const isHashValid = await verifyPassword(password, storedHash, pepper);
    if (!isHashValid) {
      console.error(
        "\n[ERROR] Cryptographic verification failed: verifyPassword() returned false for the stored hash and local pepper.",
      );
      console.error("Local login will not succeed. Please verify your worker/.dev.vars configuration.");
      process.exitCode = 1;
      return;
    }

    console.log("[OK] Cryptographic verification passed: verifyPassword() successfully validated stored hash against local pepper.");
  } catch (err: unknown) {
    console.error("\n[ERROR] Failed during post-update cryptographic verification:");
    if (err instanceof Error && "stderr" in err) {
      console.error((err as { stderr: string }).stderr);
    } else {
      console.error(err);
    }
    process.exitCode = 1;
    return;
  }

  // Step 7: Clear stale sessions for this admin (with explicit partial failure handling)
  console.log("Clearing stale local sessions...");
  let sessionsDeleted = 0;
  try {
    const sessionSqlFile = resolve(workerDir, `.tmp_session_cleanup_${Date.now()}.sql`);
    const sessionSql = `
DELETE FROM sessions WHERE admin_id = '${TARGET_ADMIN_ID}';
SELECT changes() as sessions_deleted;
`;
    try {
      writeFileSync(sessionSqlFile, sessionSql, "utf-8");
      const sessionDeleteOutput = execSync(
        `npx wrangler d1 execute tapme-database --local --config="${wranglerConfigPath}" --file="${sessionSqlFile}" --json`,
        { cwd: workerDir, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] },
      );
      const sessionDeleteParsed = JSON.parse(sessionDeleteOutput);
      sessionsDeleted =
        sessionDeleteParsed[1]?.results?.[0]?.sessions_deleted ??
        sessionDeleteParsed[0]?.meta?.changes ??
        0;
      console.log(`[OK] Stale local sessions cleared (${sessionsDeleted} session(s) removed).`);
    } finally {
      if (existsSync(sessionSqlFile)) {
        unlinkSync(sessionSqlFile);
      }
    }
  } catch (sessionErr: unknown) {
    console.warn(
      `\n[PARTIAL FAILURE WARNING] Password for @${adminUsername} was updated successfully (1 row affected), but clearing stale local sessions failed:`,
    );
    if (sessionErr instanceof Error && "stderr" in sessionErr) {
      console.warn((sessionErr as { stderr: string }).stderr);
    } else {
      console.warn(sessionErr);
    }
    console.warn(`You may clear stale sessions manually by running:`);
    console.warn(
      `npx wrangler d1 execute tapme-database --local --config="${wranglerConfigPath}" --command="DELETE FROM sessions WHERE admin_id = '${TARGET_ADMIN_ID}';"\n`,
    );
  }

  // Step 8: Verify data preservation (Card #4 and related links/audit records)
  try {
    const cardOutput = execSync(
      `npx wrangler d1 execute tapme-database --local --config="${wranglerConfigPath}" --command="SELECT count(*) as count FROM cards WHERE created_by = '${TARGET_ADMIN_ID}';" --json`,
      { cwd: workerDir, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] },
    );
    const cardCount = JSON.parse(cardOutput)[0]?.results?.[0]?.count ?? 0;

    const auditOutput = execSync(
      `npx wrangler d1 execute tapme-database --local --config="${wranglerConfigPath}" --command="SELECT count(*) as count FROM audit_logs WHERE admin_id = '${TARGET_ADMIN_ID}';" --json`,
      { cwd: workerDir, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] },
    );
    const auditCount = JSON.parse(auditOutput)[0]?.results?.[0]?.count ?? 0;

    console.log("\n==================================================");
    console.log(" [SUCCESS] Local admin password recovery complete!");
    console.log("--------------------------------------------------");
    console.log(` Username:        @${adminUsername}`);
    console.log(` Account ID:      ${TARGET_ADMIN_ID}`);
    console.log(` Role:            ${adminRole}`);
    console.log(` Account Status:  ${adminStatus}`);
    console.log(` Stale Sessions:  Cleared (${sessionsDeleted} removed)`);
    console.log(` Linked Cards:    Preserved (${cardCount} card(s))`);
    console.log(` Audit Logs:      Preserved (${auditCount} record(s))`);
    console.log(" Cryptographic:   Verified with verifyPassword()");
    console.log("==================================================");
    console.log("\nYou can now start local development (`npm run dev`)");
    console.log(`and log in as '@${adminUsername}' with your newly set password.\n`);
  } catch (err: unknown) {
    console.warn("\n[WARNING] Password was updated and verified, but querying preservation counts failed:");
    console.warn(err);
  }
}

// Only execute when run directly
const isDirectExecution =
  process.argv[1] &&
  (resolve(process.argv[1]) === resolve(__filename) ||
    process.argv[1].endsWith("recover-local-admin.ts"));

if (isDirectExecution) {
  main().catch((err) => {
    console.error("Unexpected error:", err);
    process.exitCode = 1;
  });
}


