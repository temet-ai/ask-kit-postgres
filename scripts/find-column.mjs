export const meta = {
  purpose:
    "Which tables hold something: columns whose name matches a word (or all of several), and tables whose name or comment matches. For 'which table has a session_id column', 'where is X stored'. Exact column name first, then partial matches.",
  params: {
    words: "one or more words, e.g. 'session_uuid' or 'email' or 'lesson body'. A column matches when its name contains any word; with `all` it must contain every word",
    all: "true to require every word in the column name",
    schema: "only this schema, optional",
    max: "rows, default 80",
  },
  returns: "{columns:[{table, column, type, exact}], tables:[{name, kind, comment}], total, complete}",
  example: 'await scripts.run("find-column", { words: "session_uuid" })',
};

export default async function ({ pg }, { words, all = false, schema, max = 80 }) {
  const ws = String(words ?? "").split(/[\s,]+/).filter(Boolean);
  if (!ws.length) throw new Error("find-column needs `words`");
  const sch = schema ? `n.nspname = ${pg.lit(schema)}` : "n.nspname not in ('pg_catalog','information_schema','pg_toast')";
  const colMatch = ws.map((w) => `a.attname ilike ${pg.lit(`%${w.replace(/_/g, "\\_")}%`)}`).join(all ? " and " : " or ");
  const exact = ws.map((w) => `lower(a.attname) = ${pg.lit(w.toLowerCase())}`).join(" or ");
  const cols = await pg.sql(
    `select n.nspname || '.' || c.relname as "table", a.attname as "column", format_type(a.atttypid, a.atttypmod) as type, (${exact}) as exact,
            case c.relkind when 'v' then 'view' when 'm' then 'matview' else 'table' end as kind
       from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
      where a.attnum > 0 and not a.attisdropped and c.relkind in ('r','p','v','m','f') and not c.relispartition and ${sch} and (${colMatch})
      order by exact desc, "table", a.attnum`,
    { max },
  );
  const tw = ws.map((w) => `(n.nspname || '.' || c.relname) ilike ${pg.lit(`%${w}%`)} or coalesce(obj_description(c.oid), '') ilike ${pg.lit(`%${w}%`)}`).join(all ? ") and (" : " or ");
  const tabs = await pg.sql(
    `select n.nspname || '.' || c.relname as name, case c.relkind when 'v' then 'view' when 'm' then 'matview' else 'table' end as kind, obj_description(c.oid) as comment
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where c.relkind in ('r','p','v','m','f') and not c.relispartition and ${sch} and ((${tw})) order by 1`,
    { max: 30 },
  );
  return {
    columns: cols.rows.map((r) => ({ table: r.table, column: r.column, type: r.type, exact: r.exact === "t" || r.exact === true, kind: r.kind })),
    tables: tabs.rows,
    total: cols.total,
    complete: cols.complete,
  };
}
