export const meta = {
  purpose:
    "What the database is doing right now: running queries with their age and wait events, sessions idle in a transaction, who blocks whom, ungranted locks, and connections counted by application and state versus max_connections. Other databases on the server are included.",
  params: {
    minSeconds: "only queries/transactions older than this, default 0",
    all: "true to list idle sessions too (default: counts only)",
  },
  returns:
    "{connections:{total, max, byAppState:[{app, state, n}]}, running:[{pid, db, user, app, state, seconds, txSeconds, wait, query}], idleInTransaction:[...], blocked:[{pid, blockedBy:[pid], seconds, wait, query}], locksWaiting:[{pid, mode, relation}]}",
  example: 'await scripts.run("activity", {})',
};

export default async function ({ pg }, { minSeconds = 0, all = false }) {
  const q = `select pid, datname as db, usename as "user", application_name as app, state,
       round(extract(epoch from now() - query_start)::numeric, 1) as seconds,
       round(extract(epoch from now() - xact_start)::numeric, 1) as tx_seconds,
       coalesce(wait_event_type || ':' || wait_event, '') as wait, pg_blocking_pids(pid)::text as blocked_by, left(regexp_replace(query, '\\s+', ' ', 'g'), 300) as query
     from pg_stat_activity where pid <> pg_backend_pid() and backend_type = 'client backend'`;
  const [rows, counts, max, locks] = await Promise.all([
    pg.sql(`${q} order by query_start nulls last`, { max: 500 }),
    pg.sql(`select application_name as app, coalesce(state, '') as state, count(*) as n from pg_stat_activity where backend_type = 'client backend' and pid <> pg_backend_pid() group by 1, 2 order by n desc`, { max: 100 }),
    pg.sql(`select current_setting('max_connections')::int as max`),
    pg.sql(`select l.pid, l.mode, l.relation::regclass::text as relation from pg_locks l where not l.granted order by l.pid`, { max: 50 }),
  ]);
  const old = (r) => (r.seconds ?? 0) >= minSeconds;
  const row = (r) => ({ pid: r.pid, db: r.db, user: r.user, app: r.app, state: r.state, seconds: r.seconds, txSeconds: r.tx_seconds, wait: r.wait || undefined, query: r.query });
  const blockedBy = (r) => String(r.blocked_by ?? "{}").replace(/[{}]/g, "").split(",").filter(Boolean).map(Number);
  return {
    connections: { total: rows.total, max: max.rows[0]?.max, byAppState: counts.rows },
    running: rows.rows.filter((r) => r.state === "active" && r.app !== "ask-kit" && old(r)).sort((a, b) => b.seconds - a.seconds).map(row),
    idleInTransaction: rows.rows.filter((r) => /idle in transaction/.test(r.state) && (r.tx_seconds ?? 0) >= minSeconds).sort((a, b) => b.tx_seconds - a.tx_seconds).map(row),
    blocked: rows.rows.filter((r) => blockedBy(r).length).map((r) => ({ pid: r.pid, blockedBy: blockedBy(r), seconds: r.seconds, wait: r.wait, query: r.query })),
    locksWaiting: locks.rows,
    ...(all ? { idle: rows.rows.filter((r) => r.state === "idle").map(row) } : {}),
  };
}
