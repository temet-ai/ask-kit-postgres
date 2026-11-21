export const meta = {
  purpose:
    "Which tables (and views) exist, with row estimates and sizes, largest first. Filter by words that must all appear in the schema-qualified name, or by schema. Row counts are the planner's estimates (n_live_tup); count(*) for an exact one.",
  params: {
    words: "words that must all appear in schema.table, e.g. 'lesson' or 'session memory'; optional",
    schema: "only this schema, optional (system schemas are hidden unless named)",
    kind: "'table' (default, includes partitioned), 'view', or 'all'",
    max: "rows, default 60",
  },
  returns: "{database, total, complete, tables:[{name, kind, rows, size, bytes, lastAnalyze, comment}]}",
  example: 'await scripts.run("tables", { words: "lesson" })',
};

export default async function ({ pg }, { words, schema, kind = "table", max = 60 }) {
  const ws = String(words ?? "").split(/\s+/).filter(Boolean);
  const kinds = kind === "all" ? "'r','p','v','m','f'" : kind === "view" ? "'v','m'" : "'r','p','f'";
  const where = [
    `c.relkind in (${kinds})`,
    schema ? `n.nspname = ${pg.lit(schema)}` : "n.nspname not in ('pg_catalog','information_schema','pg_toast') and n.nspname not like 'pg_temp%'",
    ...ws.map((w) => `(n.nspname || '.' || c.relname) ilike ${pg.lit(`%${w}%`)}`),
    "not c.relispartition",
  ].join(" and ");
  const r = await pg.sql(
    `select n.nspname || '.' || c.relname as name,
            case c.relkind when 'r' then 'table' when 'p' then 'partitioned' when 'v' then 'view' when 'm' then 'matview' else 'foreign' end as kind,
            greatest(coalesce(s.n_live_tup, 0), case when c.reltuples < 0 then 0 else c.reltuples::bigint end) as rows,
            case when c.relkind in ('r','p','m') then pg_size_pretty(pg_total_relation_size(c.oid)) end as size,
            case when c.relkind in ('r','p','m') then pg_total_relation_size(c.oid) end as bytes,
            to_char(greatest(s.last_analyze, s.last_autoanalyze), 'YYYY-MM-DD') as last_analyze,
            obj_description(c.oid) as comment
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
       left join pg_stat_all_tables s on s.relid = c.oid
      where ${where}
      order by bytes desc nulls last, name`,
    { max },
  );
  return { database: pg.target, total: r.total, complete: r.complete, tables: r.rows.map((t) => ({ name: t.name, kind: t.kind, rows: t.rows, size: t.size, bytes: t.bytes, lastAnalyze: t.last_analyze, comment: t.comment })) };
}
