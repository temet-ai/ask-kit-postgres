export const meta = {
  purpose:
    "How big things are: the database (and the others on the server), the largest tables with their table, index and TOAST parts, the largest indexes with how often each was scanned (unused ones flagged), and the total per schema.",
  params: { schema: "only this schema, optional", max: "rows per list, default 15" },
  returns:
    "{database:{name, size, bytes}, databases:[{name, size}], schemas:[{schema, size, tables}], tables:[{name, total, table, indexes, toast, rows, bytes}], indexes:[{name, table, size, scans, unused}]}",
  example: 'await scripts.run("size", {})',
};

export default async function ({ pg }, { schema, max = 15 }) {
  const sch = schema ? `n.nspname = ${pg.lit(schema)}` : "n.nspname not in ('pg_catalog','information_schema','pg_toast')";
  const n = Math.min(100, Number(max) || 15);
  const [db, dbs, schemas, tables, indexes] = await Promise.all([
    pg.sql("select current_database() as name, pg_size_pretty(pg_database_size(current_database())) as size, pg_database_size(current_database()) as bytes"),
    pg.sql("select datname as name, pg_size_pretty(pg_database_size(oid)) as size from pg_database where not datistemplate order by pg_database_size(oid) desc", { max: 30 }),
    pg.sql(`select n.nspname as schema, pg_size_pretty(sum(pg_total_relation_size(c.oid))::bigint) as size, count(*) as tables from pg_class c join pg_namespace n on n.oid = c.relnamespace where c.relkind in ('r','p','m') and not c.relispartition and ${sch} group by 1 order by sum(pg_total_relation_size(c.oid)) desc`, { max: 40 }),
    pg.sql(
      `select n.nspname || '.' || c.relname as name, pg_size_pretty(pg_total_relation_size(c.oid)) as total, pg_size_pretty(pg_table_size(c.oid) - coalesce(pg_total_relation_size(nullif(c.reltoastrelid, 0)), 0)) as "table",
              pg_size_pretty(pg_indexes_size(c.oid)) as indexes, pg_size_pretty(coalesce(pg_total_relation_size(nullif(c.reltoastrelid, 0)), 0)) as toast,
              greatest(coalesce(s.n_live_tup, 0), c.reltuples::bigint) as rows, pg_total_relation_size(c.oid) as bytes
         from pg_class c join pg_namespace n on n.oid = c.relnamespace left join pg_stat_all_tables s on s.relid = c.oid
        where c.relkind in ('r','p','m') and not c.relispartition and ${sch} order by pg_total_relation_size(c.oid) desc limit ${n}`,
      { max: n },
    ),
    pg.sql(
      `select i.indexrelid::regclass::text as name, i.indrelid::regclass::text as "table", pg_size_pretty(pg_relation_size(i.indexrelid)) as size, coalesce(s.idx_scan, 0) as scans,
              (coalesce(s.idx_scan, 0) = 0 and not i.indisunique and not i.indisprimary) as unused
         from pg_index i join pg_class c on c.oid = i.indexrelid join pg_namespace n on n.oid = c.relnamespace left join pg_stat_all_indexes s on s.indexrelid = i.indexrelid
        where ${sch} order by pg_relation_size(i.indexrelid) desc limit ${n}`,
      { max: n },
    ),
  ]);
  return {
    database: db.rows[0],
    databases: dbs.rows,
    schemas: schemas.rows,
    tables: tables.rows,
    indexes: indexes.rows.map((i) => ({ ...i, unused: i.unused === "t" || i.unused === true })),
  };
}
