export const meta = {
  purpose:
    "One table in full: columns with types, nullability, defaults and comments; primary key, unique and check constraints; foreign keys in both directions; indexes with size and how often each was used; row estimate and size. Optionally a few sample rows.",
  params: {
    table: "'schema.table' or just 'table' (searched in every schema; several matches come back as candidates)",
    sample: "number of sample rows to include, default 0",
  },
  returns:
    "{table, kind, rows, size, columns:[{name, type, notNull, default, comment}], primaryKey, constraints:[{name, type, def}], foreignKeys:[{name, def}], referencedBy:[{table, def}], indexes:[{name, def, size, scans}], sample?} or {candidates:[...]}",
  example: 'await scripts.run("describe", { table: "tools.uses", sample: 2 })',
};

export default async function ({ pg }, { table, sample = 0 }) {
  if (!table) throw new Error("describe needs `table`");
  const [a, b] = String(table).replace(/"/g, "").split(".");
  const [schema, name] = b ? [a, b] : [null, a];
  const found = await pg.sql(
    `select n.nspname as schema, c.relname as name, c.oid::bigint as oid, c.relkind as kind
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where c.relkind in ('r','p','v','m','f') and c.relname = ${pg.lit(name)} ${schema ? `and n.nspname = ${pg.lit(schema)}` : "and n.nspname not in ('pg_catalog','information_schema','pg_toast')"}`,
  );
  if (!found.rows.length) {
    const like = await pg.sql(`select n.nspname || '.' || c.relname as name from pg_class c join pg_namespace n on n.oid = c.relnamespace where c.relkind in ('r','p','v','m','f') and c.relname ilike ${pg.lit(`%${name}%`)} and n.nspname not in ('pg_catalog','information_schema','pg_toast') order by 1`, { max: 20 });
    return { error: `no table named ${table}`, similar: like.rows.map((r) => r.name) };
  }
  if (found.rows.length > 1) return { candidates: found.rows.map((r) => `${r.schema}.${r.name}`) };
  const t = found.rows[0];
  const qn = `${pg.ident(t.schema)}.${pg.ident(t.name)}`;
  const [meta, cols, cons, idx] = await Promise.all([
    pg.sql(`select c.reltuples::bigint as est, coalesce(s.n_live_tup, 0) as live, case when c.relkind in ('r','p','m') then pg_size_pretty(pg_total_relation_size(c.oid)) end as size, obj_description(c.oid) as comment, c.relkind as kind from pg_class c left join pg_stat_all_tables s on s.relid = c.oid where c.oid = ${t.oid}`),
    pg.sql(`select a.attname as name, format_type(a.atttypid, a.atttypmod) as type, a.attnotnull as notnull, pg_get_expr(d.adbin, d.adrelid) as def, col_description(a.attrelid, a.attnum) as comment from pg_attribute a left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum where a.attrelid = ${t.oid} and a.attnum > 0 and not a.attisdropped order by a.attnum`, { max: 500 }),
    pg.sql(`select conname as name, contype as type, pg_get_constraintdef(oid) as def, conrelid = ${t.oid} as own, conrelid::regclass::text as tbl from pg_constraint where conrelid = ${t.oid} or confrelid = ${t.oid} order by contype, conname`, { max: 200 }),
    pg.sql(`select i.indexrelid::regclass::text as name, pg_get_indexdef(i.indexrelid) as def, pg_size_pretty(pg_relation_size(i.indexrelid)) as size, coalesce(s.idx_scan, 0) as scans from pg_index i left join pg_stat_all_indexes s on s.indexrelid = i.indexrelid where i.indrelid = ${t.oid} order by pg_relation_size(i.indexrelid) desc`, { max: 100 }),
  ]);
  const m = meta.rows[0];
  const own = cons.rows.filter((c) => c.own);
  const kindName = { r: "table", p: "partitioned table", v: "view", m: "matview", f: "foreign table" }[m.kind];
  const out = {
    table: `${t.schema}.${t.name}`,
    kind: kindName,
    rows: Math.max(m.live, m.est),
    size: m.size,
    comment: m.comment,
    columns: cols.rows.map((c) => ({ name: c.name, type: c.type, notNull: c.notnull === "t" || c.notnull === true, default: c.def, comment: c.comment })),
    primaryKey: own.find((c) => c.type === "p")?.def ?? null,
    constraints: own.filter((c) => c.type === "u" || c.type === "c").map((c) => ({ name: c.name, type: c.type === "u" ? "unique" : "check", def: c.def })),
    foreignKeys: own.filter((c) => c.type === "f").map((c) => ({ name: c.name, def: c.def })),
    referencedBy: cons.rows.filter((c) => !c.own && c.type === "f").map((c) => ({ table: c.tbl, def: c.def })),
    indexes: idx.rows,
  };
  if (cons.total > 200) out.note = "constraints truncated";
  if (sample > 0 && ["table", "partitioned table", "matview", "view"].includes(kindName)) out.sample = (await pg.sql(`select * from ${qn} limit ${Math.min(20, Number(sample))}`)).rows;
  return out;
}
