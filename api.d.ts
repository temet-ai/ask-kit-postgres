interface PgResult {
  columns: string[];
  rows: Record<string, any>[]; // at most `max` rows; numbers up to 15 digits are JS numbers, NULL is null, the rest strings, booleans "t"/"f"
  total: number; // rows the query produced
  complete: boolean; // false when `rows` was cut at `max`
  tag?: string; // command tag for a statement that returns no rows, e.g. "UPDATE 3"
}

declare const pg: {
  target: string; // "user@host:port/database": the only connection detail you may quote; the password is never available

  // Server details: {host, port, database, user, version, versionNum, replica, readOnlyDefault}.
  info(): Promise<{ host: string; port: number; database: string; user: string; version: string; versionNum: number; replica: boolean; readOnlyDefault: boolean }>;

  // One SQL statement through psql. A query returns its rows (cap `max`, default 200; use count(*) or
  // aggregates in SQL for totals, `total` only counts what was returned by the query). A write returns
  // {tag}. Throws on a SQL error with Postgres' message (read it: it names the missing column and often
  // suggests the right one). timeoutMs defaults to 100000 (statement_timeout).
  // Runs whatever the role may run: INSERT/UPDATE/DELETE, DDL and CREATE INDEX too. Not read-only.
  sql(query: string, o?: { max?: number; timeoutMs?: number }): Promise<PgResult>;

  // Several statements separated by `;`, each run on its own (CREATE INDEX CONCURRENTLY, VACUUM, ANALYZE
  // work). Stops at the first error and throws. Returns {ok, output}: psql's command tags.
  // Put BEGIN; ... COMMIT; in the string for atomicity.
  exec(statements: string, o?: { timeoutMs?: number }): Promise<{ ok: boolean; output: string }>;

  // EXPLAIN as text. analyze: true runs the query for real (with BUFFERS): a write inside it happens.
  // settings: more EXPLAIN options, e.g. ["VERBOSE", "SETTINGS"]. Returns {plan, lines}.
  explain(query: string, o?: { analyze?: boolean; settings?: string[]; timeoutMs?: number }): Promise<{ plan: string; lines: number }>;

  // Escape what you put in SQL text: lit("o'brien") -> 'o''brien'; ident("My Table") -> "My Table".
  lit(s: string | number): string;
  ident(s: string): string;
};

declare const scripts: {
  list(): { name: string; purpose: string; params: Record<string, string>; returns: string; draft: boolean }[];
  show(name: string): string;
  run(name: string, params?: Record<string, unknown>): Promise<any>;
  draft(name: string, source: string): { name: string; file: string };
};

// Toolkit (also tk.*)
declare function shape(x: unknown, depth?: number): unknown;
declare function pick<T>(rows: T | T[], ...keys: string[]): any;
declare function table(rows: object[], cols?: string[], o?: { width?: number }): string;
declare function top<T>(rows: T[], key: string | ((r: T) => number), n?: number): T[];
declare function groupBy<T>(rows: T[], key: string | ((r: T) => string)): Record<string, T[]>;
declare function countBy<T>(rows: T[], key: string | ((r: T) => string)): Record<string, number>;
declare function clip(s: string | null, max?: number): string | null;
