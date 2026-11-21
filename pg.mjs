// A client for PostgreSQL through the `psql` command: any SQL (queries and statements), EXPLAIN,
// and the connection details, for one database. It reads and acts (INSERT/UPDATE/DELETE, DDL,
// CREATE INDEX, VACUUM, ANALYZE): whatever the connection's role can do. Nothing is wrapped in a
// read-only transaction.
//
// The connection: DATABASE_URL (postgres://user:password@host:port/db?sslmode=...), or libpq's own
// PG* environment variables when it is not set. The URL is split into PGHOST, PGPORT, PGUSER,
// PGDATABASE and PGPASSWORD for the child process, so the password is never in argv. The model
// sees host, port, database and user only; the password and URL are scrubbed from every error.
import { execFile } from "node:child_process";

const SENTINEL = "\u0001NULL\u0001";

/** DATABASE_URL -> {env, target, secrets}. Throws (without the URL) when it is malformed. */
export function connection(url, base = process.env) {
  const env = {};
  const secrets = [];
  let target = { host: base.PGHOST ?? "local socket", port: Number(base.PGPORT ?? 5432), database: base.PGDATABASE ?? base.PGUSER ?? null, user: base.PGUSER ?? null };
  if (url) {
    let u;
    try {
      u = new URL(url);
    } catch {
      throw new Error("DATABASE_URL is not a valid postgres:// URL (the value is not shown)");
    }
    if (!/^postgres(ql)?:$/.test(u.protocol)) throw new Error("DATABASE_URL must start with postgres:// or postgresql://");
    const dec = (s) => decodeURIComponent(s);
    if (u.hostname) env.PGHOST = dec(u.hostname).replace(/^\[|\]$/g, "");
    if (u.port) env.PGPORT = u.port;
    if (u.username) env.PGUSER = dec(u.username);
    if (u.password) {
      env.PGPASSWORD = dec(u.password);
      secrets.push(env.PGPASSWORD, u.password);
    }
    const db = dec(u.pathname.replace(/^\//, ""));
    if (db) env.PGDATABASE = db;
    const q = { sslmode: "PGSSLMODE", sslrootcert: "PGSSLROOTCERT", connect_timeout: "PGCONNECT_TIMEOUT", options: "PGOPTIONS", application_name: "PGAPPNAME", host: "PGHOST" };
    for (const [k, v] of u.searchParams) if (q[k]) env[q[k]] = v;
    secrets.push(url);
    target = { host: env.PGHOST ?? target.host, port: Number(env.PGPORT ?? 5432), database: env.PGDATABASE ?? env.PGUSER ?? target.database, user: env.PGUSER ?? target.user };
  }
  return { env, target, secrets: secrets.filter((s) => s && s.length > 3) };
}

/** RFC 4180 CSV into rows of strings; a NULL arrives as SENTINEL. */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let f = "";
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') {
        if (text[i + 1] === '"') (f += '"'), i++;
        else q = false;
      } else f += c;
    } else if (c === '"') q = true;
    else if (c === ",") (row.push(f), (f = ""));
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(f);
      rows.push(row);
      row = [];
      f = "";
    } else f += c;
  }
  if (f !== "" || row.length) (row.push(f), rows.push(row));
  return rows;
}

const value = (s) => {
  if (s === SENTINEL) return null;
  if (/^-?\d{1,15}$/.test(s)) return Number(s);
  if (/^-?\d{1,12}\.\d{1,6}$/.test(s)) return Number(s);
  return s;
};

const TAG = /^(INSERT \d+ \d+|UPDATE \d+|DELETE \d+|MERGE \d+|COPY \d+|SELECT \d+|CREATE [A-Z ]+|ALTER [A-Z ]+|DROP [A-Z ]+|VACUUM|ANALYZE|CLUSTER|REINDEX|TRUNCATE TABLE|REFRESH MATERIALIZED VIEW|GRANT|REVOKE|COMMENT|BEGIN|COMMIT|ROLLBACK|SET|RESET|DO|CALL|LOCK TABLE|EXPLAIN)$/;

export function make({ settings, push }) {
  return makePg({ url: settings.DATABASE_URL ?? process.env.DATABASE_URL ?? null, push });
}

export function makePg({ url, push = () => {}, psql = "psql" }) {
  const conn = connection(url);
  const scrub = (s) => {
    let t = String(s ?? "");
    for (const x of conn.secrets) t = t.split(x).join("***");
    return t;
  };
  const target = `${conn.target.user ?? "?"}@${conn.target.host}:${conn.target.port}/${conn.target.database ?? "?"}`;

  const run = (args, { input, timeoutMs = 120_000, pgoptions } = {}) =>
    new Promise((resolve) => {
      const env = { ...process.env, ...conn.env, PGAPPNAME: conn.env.PGAPPNAME ?? "ask-kit", PGCONNECT_TIMEOUT: conn.env.PGCONNECT_TIMEOUT ?? "10", PAGER: "cat", NO_COLOR: "1" };
      delete env.DATABASE_URL;
      if (pgoptions) env.PGOPTIONS = [env.PGOPTIONS, pgoptions].filter(Boolean).join(" ");
      const child = execFile(psql, ["-X", "-v", "ON_ERROR_STOP=1", ...args], { env, timeout: timeoutMs, maxBuffer: 256 << 20, encoding: "utf8" }, (err, stdout, stderr) => {
        if (err?.code === "ENOENT") return resolve({ code: 127, out: "", err: "psql is not installed (the PostgreSQL client)" });
        resolve({ code: err ? (typeof err.code === "number" ? err.code : 1) : 0, out: stdout ?? "", err: scrub(stderr).slice(0, 4000), timedOut: !!err?.killed });
      });
      if (input != null) child.stdin.end(input);
      else child.stdin.end();
    });

  const note = (kind, detail, started, r) => push({ kind, detail: String(detail).replace(/\s+/g, " ").slice(0, 200), ms: Date.now() - started, code: r.code, size: r.out.length, db: target });
  const fail = (what, r) => {
    const msg = (r.err || r.out || "").trim().replace(/^psql: error: /, "");
    return new Error(`${what}: ${r.timedOut ? "timed out. " : ""}${msg.slice(0, 1500)}`);
  };

  return {
    /** host, port, database and user, never the password. */
    target,

    /** A SQL string literal: lit("o'brien") is 'o''brien'. Use it for every value you put in a query. */
    lit: (s) => `'${String(s).replace(/'/g, "''")}'`,

    /** A quoted identifier: ident("My Table") is "My Table". */
    ident: (s) => `"${String(s).replace(/"/g, '""')}"`,
    info: async () => {
      const started = Date.now();
      const r = await run(["--csv", "-P", `null=${SENTINEL}`, "-c", "select current_database() db, current_user usr, inet_server_addr()::text server_addr, inet_server_port() port, version() version, current_setting('server_version_num')::int version_num, pg_is_in_recovery() replica, current_setting('default_transaction_read_only') read_only"], { timeoutMs: 30_000 });
      note("pg.info", "info", started, r);
      if (r.code !== 0) throw fail("pg.info", r);
      const [h, v] = parseCsv(r.out);
      const o = Object.fromEntries(h.map((k, i) => [k, value(v[i])]));
      return { host: conn.target.host, port: conn.target.port, database: o.db, user: o.usr, version: String(o.version).split(" on ")[0], versionNum: o.version_num, replica: o.replica === "t", readOnlyDefault: o.read_only === "on" };
    },

    /**
     * Run one query that returns rows. Returns {columns, rows, total, complete, tag?}. At most o.max rows
     * (default 200) come back; `total` is how many the query produced and `complete` whether all are in `rows`.
     * Numbers up to 15 digits become JS numbers, NULL is null, everything else is a string. Throws on a SQL error.
     * A statement that returns no rows (INSERT, CREATE INDEX, ...) works here too: its command tag is in `tag`.
     */
    async sql(query, o = {}) {
      const max = o.max ?? 200;
      const started = Date.now();
      const r = await run(["--csv", "-P", `null=${SENTINEL}`, "-c", query], { timeoutMs: o.timeoutMs ?? 120_000, pgoptions: `-c statement_timeout=${o.timeoutMs ?? 100_000}` });
      note("pg.sql", query, started, r);
      if (r.code !== 0) throw fail("pg.sql", r);
      const text = r.out.trimEnd();
      if (TAG.test(text)) return { columns: [], rows: [], total: 0, complete: true, tag: text };
      const all = parseCsv(r.out);
      const columns = all.shift() ?? [];
      const total = all.length;
      const rows = all.slice(0, max).map((cells) => Object.fromEntries(columns.map((c, i) => [c, value(cells[i] ?? "")])));
      return { columns, rows, total, complete: total <= max };
    },

    /**
     * Run statements that change things, separated by `;`, each on its own (so CREATE INDEX CONCURRENTLY
     * and VACUUM work). Stops at the first error and throws. Returns {ok, output} with psql's command tags.
     * Use explicit BEGIN; ... COMMIT; in the string when you want them atomic.
     */
    async exec(statements, o = {}) {
      const started = Date.now();
      const r = await run(["-f", "-", "-b"], { input: statements, timeoutMs: o.timeoutMs ?? 600_000 });
      note("pg.exec", statements, started, r);
      if (r.code !== 0) throw fail("pg.exec", r);
      return { ok: true, output: scrub(r.out).trim().slice(0, 4000) };
    },

    /** EXPLAIN a query (text plan). o.analyze runs it for real, with buffers: a write inside it happens. o.settings adds EXPLAIN options, e.g. ["VERBOSE"]. */
    async explain(query, o = {}) {
      const opts = [...(o.analyze ? ["ANALYZE", "BUFFERS"] : []), ...(o.settings ?? [])].join(", ");
      const started = Date.now();
      const r = await run(["-At", "-c", `EXPLAIN ${opts ? `(${opts}) ` : ""}${query}`], { timeoutMs: o.timeoutMs ?? 300_000 });
      note("pg.explain", query, started, r);
      if (r.code !== 0) throw fail("pg.explain", r);
      return { plan: r.out.trim(), lines: r.out.trim().split("\n").length };
    },
  };
}
