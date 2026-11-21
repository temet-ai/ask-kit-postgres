export const meta = {
  purpose:
    "The slowest statements from pg_stat_statements: calls, total, mean and max time, rows and blocks read, with the normalised query text. Says so when the extension is not installed or not loaded. Pair with pg.explain to see why one is slow.",
  params: {
    by: "'total' (default, where the time goes), 'mean' (slowest per call) or 'max'",
    minCalls: "ignore statements called fewer times, default 1",
    match: "only statements whose text contains this, optional",
    max: "rows, default 15",
  },
  returns: "{available, reason?, by, statements:[{queryid, calls, totalMs, meanMs, maxMs, rows, sharedRead, query}], statsReset}",
  example: 'await scripts.run("slow", { by: "mean" })',
};

export default async function ({ pg }, { by = "total", minCalls = 1, match, max = 15 }) {
  const ext = await pg.sql("select extversion from pg_extension where extname = 'pg_stat_statements'");
  if (!ext.rows.length) return { available: false, reason: "the pg_stat_statements extension is not installed in this database (CREATE EXTENSION pg_stat_statements; it also needs shared_preload_libraries)" };
  const probe = await pg.sql("select 1 from pg_stat_statements limit 1").then(() => null, (e) => e.message);
  if (probe) return { available: false, reason: probe.includes("shared_preload_libraries") ? "pg_stat_statements is installed but not in shared_preload_libraries (restart needed)" : probe };
  const cols = (await pg.sql("select column_name from information_schema.columns where table_name = 'pg_stat_statements' and column_name in ('total_exec_time','total_time')")).rows.map((r) => r.column_name);
  const p = cols.includes("total_exec_time") ? "_exec" : "";
  const order = { total: `total${p}_time`, mean: `mean${p}_time`, max: `max${p}_time` }[by] ?? `total${p}_time`;
  const r = await pg.sql(
    `select queryid::text as queryid, calls, round(total${p}_time::numeric, 1) as total_ms, round(mean${p}_time::numeric, 1) as mean_ms, round(max${p}_time::numeric, 1) as max_ms, rows,
            shared_blks_read as shared_read, left(regexp_replace(query, '\\s+', ' ', 'g'), 400) as query
       from pg_stat_statements
      where dbid = (select oid from pg_database where datname = current_database()) and calls >= ${Number(minCalls) || 1}
        and query not ilike '%pg_stat_statements%' ${match ? `and query ilike ${pg.lit(`%${match}%`)}` : ""}
      order by ${order} desc limit ${Math.min(100, Number(max) || 15)}`,
    { max: 100 },
  );
  const reset = await pg.sql("select to_char(stats_reset, 'YYYY-MM-DD HH24:MI') as at from pg_stat_statements_info").then((x) => x.rows[0]?.at ?? null, () => null);
  return {
    available: true,
    by,
    statements: r.rows.map((s) => ({ queryid: s.queryid, calls: s.calls, totalMs: s.total_ms, meanMs: s.mean_ms, maxMs: s.max_ms, rows: s.rows, sharedRead: s.shared_read, query: s.query })),
    statsReset: reset,
  };
}
