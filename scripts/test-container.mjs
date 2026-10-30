import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import * as OTPAuth from "otpauth";
const image = process.env.NODEPASS_TEST_IMAGE ?? "nodepass:local";
if (!/^nodepass:(?:local|ci)$/.test(image))
  throw new Error("Use an explicitly local test image");
const suffix = randomBytes(5).toString("hex"),
  prefix = "nodepass-acceptance-" + suffix,
  network = prefix + "-net",
  secrets = prefix + "-secrets",
  data = prefix + "-data",
  db = prefix + "-db",
  app = prefix + "-app";
const created = { network: false, volumes: [], containers: [] },
  checks = [];
const run = (args, optional = false) =>
  new Promise((resolve, reject) => {
    const child = spawn("docker", args, { stdio: ["ignore", "pipe", "pipe"] }),
      out = [],
      err = [];
    child.stdout.on("data", (c) => out.push(c));
    child.stderr.on("data", (c) => err.push(c));
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0 || optional
        ? resolve({
            code,
            output: Buffer.concat(out).toString(),
            error: Buffer.concat(err).toString(),
          })
        : reject(
            new Error(
              "Docker acceptance command failed: " +
                args.slice(0, 2).join(" ") +
                " (" +
                code +
                ") " +
                Buffer.concat(err).toString().slice(0, 500),
            ),
          ),
    );
  });
const check = (ok, name) => {
  if (!ok) throw new Error("Container acceptance failed: " + name);
  checks.push(name);
  console.log("Verified " + name);
};
const node = (code, user = "65532", env = []) =>
  run([
    "run",
    "--rm",
    "--user",
    user,
    "--network",
    network,
    "-v",
    secrets + ":/run/secrets:ro",
    "-v",
    data + ":/app/data",
    ...env,
    image,
    "-e",
    code,
  ]);
const environment = [
  "-e",
  "PUBLIC_URL=https://vault.acceptance.test",
  "-e",
  "DB_HOST=" + db,
  "-e",
  "DB_NAME=nodepass",
  "-e",
  "DB_USER=nodepass",
  "-e",
  "DB_PASSWORD_FILE=/run/secrets/db-password-app",
  "-e",
  "DEPLOYMENT_KEY_FILE=/run/secrets/deployment-key",
  "-e",
  "SETUP_TOKEN_FILE=/run/secrets/setup-token",
];
let cookie = "",
  csrf = "",
  token,
  base = "";
const request = async (path, method = "GET", body, extra = {}) => {
  const response = await fetch(base + path, {
    method,
    headers: {
      origin: "https://vault.acceptance.test",
      "x-forwarded-proto": "https",
      ...(cookie ? { cookie } : {}),
      ...(csrf ? { "x-csrf-token": csrf } : {}),
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...extra,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(20000),
  });
  const set = response.headers.get("set-cookie");
  if (set) cookie = set.split(";")[0];
  const value = response.status === 204 ? {} : await response.json();
  if (value.csrf) csrf = value.csrf;
  return { response, value };
};
const wait = async (fn, timeout = 90000) => {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    try {
      if (await fn()) return;
    } catch {
      /* The container may still be starting. */
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("Container readiness deadline exceeded");
};
try {
  await run(["network", "create", network]);
  created.network = true;
  for (const name of [secrets, data]) {
    await run(["volume", "create", name]);
    created.volumes.push(name);
  }
  await run([
    "run",
    "--rm",
    "--user",
    "0",
    "-v",
    secrets + ":/secrets",
    image,
    "packages/server/dist/server/src/cli.js",
    "init-secrets",
    "--directory",
    "/secrets",
    "--container-owners",
  ]);
  const metadata = JSON.parse(
    (
      await node(
        "const fs=require('node:fs');process.stdout.write(JSON.stringify(['deployment-key','setup-token','db-password-app','db-password','db-root-password'].map(name=>{const s=fs.statSync('/run/secrets/'+name);return{name,uid:s.uid,mode:s.mode&511};})));",
        "0",
      )
    ).output,
  );
  check(
    metadata.every(
      (item) =>
        item.mode === 384 &&
        item.uid ===
          (["db-password", "db-root-password"].includes(item.name)
            ? 999
            : 65532),
    ),
    "secret file owners and 0600 permissions",
  );
  token = (
    await node(
      "process.stdout.write(require('node:fs').readFileSync('/run/secrets/setup-token','utf8').trim());",
    )
  ).output;
  await run([
    "run",
    "--detach",
    "--name",
    db,
    "--network",
    network,
    "-v",
    secrets + ":/run/secrets:ro",
    "-e",
    "MARIADB_DATABASE=nodepass",
    "-e",
    "MARIADB_USER=nodepass",
    "-e",
    "MARIADB_ROOT_HOST=%",
    "-e",
    "MARIADB_PASSWORD_FILE=/run/secrets/db-password",
    "-e",
    "MARIADB_ROOT_PASSWORD_FILE=/run/secrets/db-root-password",
    "mariadb:11.8@sha256:f16d7a344413e519dff518f27bdb221388f84b0d274c97c4fb5f2cb0dc1b34fa",
  ]);
  created.containers.push(db);
  await wait(
    async () =>
      (
        await run(
          ["exec", db, "healthcheck.sh", "--connect", "--innodb_initialized"],
          true,
        )
      ).code === 0,
  );
  const net = JSON.parse(
      (await run(["network", "inspect", network])).output,
    )[0],
    gateway = net.IPAM.Config[0].Gateway;
  await run([
    "run",
    "--detach",
    "--name",
    app,
    "--network",
    network,
    "--init",
    "--read-only",
    "--cap-drop",
    "ALL",
    "--security-opt",
    "no-new-privileges:true",
    "--pids-limit",
    "128",
    "--memory",
    "768m",
    "--tmpfs",
    "/tmp:size=64m,mode=1777",
    "-v",
    secrets + ":/run/secrets:ro",
    "-v",
    data + ":/app/data",
    "-p",
    "127.0.0.1::3000",
    ...environment,
    "-e",
    "TRUST_PROXY=1",
    "-e",
    "TRUSTED_PROXIES=" + gateway,
    image,
  ]);
  created.containers.push(app);
  const inspect = JSON.parse((await run(["inspect", app])).output)[0];
  base =
    "http://127.0.0.1:" + inspect.NetworkSettings.Ports["3000/tcp"][0].HostPort;
  await wait(async () => {
    const r = await fetch(base + "/health/live");
    return r.status === 200;
  });
  check(
    inspect.Config.User === "65532:65532" &&
      inspect.HostConfig.ReadonlyRootfs &&
      inspect.HostConfig.CapDrop.includes("ALL"),
    "nonroot read-only runtime with dropped capabilities",
  );
  check(
    (await request("/health/ready")).response.status === 503,
    "separate setup readiness",
  );
  const password =
    "saffron glacier telescope " + randomBytes(10).toString("hex") + "!";
  check(
    (
      await request(
        "/api/v1/setup/fresh",
        "POST",
        { login: "admin", name: "Container admin", password },
        { "x-setup-token": token },
      )
    ).response.ok,
    "fresh installation from production image",
  );
  const login = await request("/api/v1/auth/login", "POST", {
    login: "admin",
    password,
  });
  check(
    login.value.phase === "enroll" &&
      /; secure/i.test(login.response.headers.get("set-cookie")),
    "Secure HttpOnly login with mandatory administrator factor",
  );
  const started = await request("/api/v1/auth/totp/start", "POST", {});
  check(
    (
      await request("/api/v1/auth/totp/enroll", "POST", {
        challenge: started.value.challenge,
        code: new OTPAuth.TOTP({ secret: started.value.secret }).generate(),
      })
    ).value.phase === "ready",
    "TOTP enrollment in production container",
  );
  const account = await request("/api/v1/accounts", "POST", {
    name: "Container acceptance account",
    password: "synthetic container secret",
    categoryId: 1,
    clientId: 1,
    userGroupId: 1,
  });
  check(account.response.status === 201, "encrypted account write");
  const saved = await request("/api/v1/backups", "POST", {});
  check(
    saved.response.ok && /\.npb$/.test(saved.value.name),
    "encrypted production backup",
  );
  await run(["restart", app]);
  base =
    "http://127.0.0.1:" +
    JSON.parse((await run(["inspect", app])).output)[0].NetworkSettings.Ports[
      "3000/tcp"
    ][0].HostPort;
  await wait(
    async () => (await request("/health/ready")).response.status === 200,
  );
  check(
    (
      await request(
        "/api/v1/accounts/" + account.value.id + "/secret",
        "POST",
        {},
      )
    ).value.password === "synthetic container secret",
    "restart unlocks the vault without the legacy master password",
  );
  await run([
    "exec",
    app,
    "/nodejs/bin/node",
    "-e",
    "try{require('node:fs').writeFileSync('/app/forbidden-write','x');process.exit(1);}catch(error){if(error.code!=='EROFS')process.exit(1);}",
  ]);
  check(true, "application filesystem rejects writes");
  await run(["stop", db]);
  check(
    (await fetch(base + "/health/live")).status === 200 &&
      (await request("/health/ready")).response.status === 503,
    "database outage keeps liveness and fails readiness",
  );
  await run(["start", db]);
  await wait(
    async () => (await request("/health/ready")).response.status === 200,
  );
  await node(
    "(async()=>{const mysql=require('mysql2/promise'),fs=require('node:fs'),c=await mysql.createConnection({host:process.env.DB_HOST,user:'root',password:fs.readFileSync('/run/secrets/db-root-password','utf8').trim()});try{await c.query('CREATE DATABASE nodepass_restore');await c.query(\"GRANT ALL PRIVILEGES ON nodepass_restore.* TO 'nodepass'@'%'\");}finally{await c.end();}})().catch(()=>process.exit(1));",
    "0",
    ["-e", "DB_HOST=" + db],
  );
  const restoredEnv = environment.map((item) =>
    item === "DB_NAME=nodepass" ? "DB_NAME=nodepass_restore" : item,
  );
  await run([
    "run",
    "--rm",
    "--read-only",
    "--tmpfs",
    "/tmp:size=64m,mode=1777",
    "--network",
    network,
    "-v",
    secrets + ":/run/secrets:ro",
    "-v",
    data + ":/app/data",
    ...restoredEnv,
    image,
    "packages/server/dist/server/src/cli.js",
    "restore",
    "--file",
    "/app/data/backups/" + saved.value.name,
  ]);
  await node(
    "(async()=>{const{loadConfig}=await import('./packages/server/dist/server/src/config.js'),{database}=await import('./packages/server/dist/server/src/db.js'),{Vault}=await import('./packages/server/dist/server/src/security/vault.js');const config=loadConfig(),db=database(config),vault=new Vault(db,config.deploymentKey);try{await vault.load();const row=await db('Account').first();if(await vault.decrypt(row.pass,row.key,'Account/'+row.id+'/pass')!=='synthetic container secret'||(await db('nodepass_sessions')).length)throw new Error('Invalid restore');}finally{vault.destroy();await db.destroy();}})().catch(()=>process.exit(1));",
    "65532",
    restoredEnv,
  );
  check(true, "CLI restore decrypts accounts and revokes copied sessions");
  // Discover the actual catalogue order; information_schema does not promise alphabetical order.
  // Hold a metadata read lock on its final table so earlier DROP statements can complete.
  // Only this test's generated application/database containers and volumes are involved.
  const recovery = await request("/api/v1/auth/recovery", "POST", {});
  check(
    recovery.response.ok && recovery.value.codes?.length > 1,
    "restore confirmation recovery factor",
  );
  const currentAccount = await request("/api/v1/accounts/" + account.value.id);
  check(
    (
      await request("/api/v1/accounts/" + account.value.id, "PATCH", {
        name: "Preserve after interrupted restore",
        categoryId: 1,
        clientId: 1,
        userGroupId: 1,
        version: currentAccount.value.version,
      })
    ).response.ok,
    "pre-restore recovery marker",
  );
  const restoreJob = await request("/api/v1/backup-restores", "POST", {
    name: saved.value.name,
  });
  check(restoreJob.response.status === 202, "web restore job creation");
  const sourceKey = (
    await node(
      "process.stdout.write(require('node:fs').readFileSync('/run/secrets/deployment-key','utf8').trim());",
    )
  ).output;
  check(
    (
      await request(
        "/api/v1/backup-restores/" + restoreJob.value.id + "/check",
        "POST",
        { key: sourceKey },
      )
    ).response.status === 202,
    "web restore authenticates source before deletion",
  );
  const restoreStatus = () =>
    request(
      "/api/v1/backup-restores/" + restoreJob.value.id + "/status",
      "GET",
      undefined,
      { "x-backup-job-token": restoreJob.value.statusToken },
    );
  await wait(async () => (await restoreStatus()).value.state === "ready");
  const authorization = await request(
    "/api/v1/backup-restores/" + restoreJob.value.id + "/confirm",
    "POST",
    { code: recovery.value.codes[0] },
  );
  check(
    authorization.response.ok && authorization.value.authorization,
    "fresh job-specific restore confirmation",
  );
  const targetTables = JSON.parse(
    (
      await node(
        "(async()=>{const{loadConfig}=await import('./packages/server/dist/server/src/config.js'),{database}=await import('./packages/server/dist/server/src/db.js'),{inspectTarget}=await import('./packages/server/dist/server/src/migration/restore-validation.js');const db=database(loadConfig());try{process.stdout.write(JSON.stringify((await inspectTarget(db)).filter(row=>row.kind==='BASE TABLE').map(row=>row.table)));}finally{await db.destroy();}})().catch(()=>process.exit(1));",
        "65532",
        environment,
      )
    ).output,
  );
  check(
    targetTables.length > 1 &&
      new Set(targetTables).size === targetTables.length,
    "distinct restore interruption probe and blocker tables",
  );
  const blocker = prefix + "-blocker";
  await run([
    "run",
    "--detach",
    "--rm",
    "--name",
    blocker,
    "--network",
    network,
    "-v",
    secrets + ":/run/secrets:ro",
    ...environment,
    "-e",
    "NODEPASS_RESTORE_BLOCK_TABLE=" + targetTables.at(-1),
    image,
    "-e",
    "(async()=>{const{loadConfig}=await import('./packages/server/dist/server/src/config.js'),{database}=await import('./packages/server/dist/server/src/db.js');const db=database(loadConfig()),trx=await db.transaction();await trx(process.env.NODEPASS_RESTORE_BLOCK_TABLE).select('*').limit(1);console.log('BLOCKER_READY');const timer=setInterval(()=>{},1000);process.on('SIGTERM',async()=>{clearInterval(timer);await trx.rollback();await db.destroy();});})().catch(()=>process.exit(1));",
  ]);
  created.containers.push(blocker);
  await wait(async () =>
    (await run(["logs", blocker])).output.includes("BLOCKER_READY"),
  );
  check(
    (
      await request(
        "/api/v1/backup-restores/" + restoreJob.value.id + "/commit",
        "POST",
        {
          confirmation: restoreJob.value.confirmation,
          authorization: authorization.value.authorization,
        },
      )
    ).response.status === 202,
    "destructive restore accepts the exact confirmation",
  );
  await wait(async () => (await restoreStatus()).value.step === "replacing");
  await wait(
    async () =>
      (
        await node(
          "(async()=>{const{loadConfig}=await import('./packages/server/dist/server/src/config.js'),{database}=await import('./packages/server/dist/server/src/db.js');const db=database(loadConfig());try{process.stdout.write((await db.schema.hasTable(process.env.NODEPASS_RESTORE_PROBE_TABLE))?'present':'dropped');}finally{await db.destroy();}})().catch(()=>process.exit(1));",
          "65532",
          [
            ...environment,
            "-e",
            "NODEPASS_RESTORE_PROBE_TABLE=" + targetTables[0],
          ],
        )
      ).output === "dropped",
  );
  check(
    (await request("/health/ready")).response.status === 503,
    "restore maintenance blocks readiness after partial deletion",
  );
  await run(["kill", "--signal", "KILL", app]);
  await run(["stop", blocker]);
  await run(["start", app]);
  base =
    "http://127.0.0.1:" +
    JSON.parse((await run(["inspect", app])).output)[0].NetworkSettings.Ports[
      "3000/tcp"
    ][0].HostPort;
  await wait(
    async () => (await request("/health/ready")).response.status === 200,
  );
  check(
    (await restoreStatus()).value.error === "rolledBack",
    "container restart rolls an interrupted web restore back from its journal",
  );
  check(
    (await request("/api/v1/auth/session")).response.status === 401,
    "crash recovery revokes original sessions",
  );
  check(
    (await request("/api/v1/auth/login", "POST", { login: "admin", password }))
      .value.phase === "verify",
    "restored administrator still requires a factor",
  );
  check(
    (
      await request("/api/v1/auth/totp/verify", "POST", {
        code: recovery.value.codes[1],
      })
    ).value.phase === "ready",
    "restored recovery factor completes a fresh login",
  );
  check(
    (await request("/api/v1/accounts/" + account.value.id)).value.name ===
      "Preserve after interrupted restore",
    "safety snapshot preserves writes newer than the imported backup",
  );
  const missing = await run(["run", "--rm", image], true);
  check(missing.code !== 0, "missing deployment secrets fail closed");
  check(
    (await request("/api/v1/auth/logout", "POST", {})).response.status ===
      204 && (await request("/api/v1/accounts")).response.status === 401,
    "logout revokes the server-side session",
  );
} finally {
  for (const name of created.containers.reverse())
    await run(["rm", "--force", "--volumes", name], true);
  for (const name of created.volumes) await run(["volume", "rm", name], true);
  if (created.network) await run(["network", "rm", network], true);
  await mkdir("output/security", { recursive: true });
  await writeFile(
    "output/security/container-acceptance.json",
    JSON.stringify(
      { testedAt: new Date().toISOString(), image, checks },
      null,
      2,
    ),
  );
}
