/**
 * PET-Digital v1.2.0 — banco D1 simulado para testes locais.
 *
 * O quê: imita a parte da API do Cloudflare D1 usada pelo Worker (prepare/bind/first/all/run/batch).
 * Como: usa o SQLite que já vem no Node 22 (`node:sqlite`), sem instalar nada.
 * Quando: somente nos testes e no servidor local; em produção o Worker continua usando o D1 real.
 */
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

class Statement {
  constructor(db, sql, params = []) { this.db = db; this.sql = sql; this.params = params; }
  bind(...params) { return new Statement(this.db, this.sql, params.map(v => (v === undefined ? null : typeof v === 'boolean' ? Number(v) : v))); }
  async first(column) {
    const row = this.db.prepare(this.sql).get(...this.params);
    if (!row) return null;
    const plain = { ...row };
    return column ? plain[column] ?? null : plain;
  }
  async all() {
    const rows = this.db.prepare(this.sql).all(...this.params).map(r => ({ ...r }));
    return { success: true, results: rows, meta: {} };
  }
  async run() {
    const info = this.db.prepare(this.sql).run(...this.params);
    return { success: true, meta: { changes: Number(info.changes), last_row_id: Number(info.lastInsertRowid) } };
  }
  _runSync() {
    const stmt = this.db.prepare(this.sql);
    if (/^\s*select/i.test(this.sql)) return { success: true, results: stmt.all(...this.params).map(r => ({ ...r })) };
    const info = stmt.run(...this.params);
    return { success: true, meta: { changes: Number(info.changes) } };
  }
}

export class D1Sqlite {
  constructor(file = ':memory:') {
    this.db = new DatabaseSync(file);
    this.db.exec('PRAGMA foreign_keys = ON;');
  }
  prepare(sql) { return new Statement(this.db, sql); }
  /** Como no D1: todas as instruções do lote valem juntas ou nenhuma vale. */
  async batch(statements) {
    this.db.exec('BEGIN');
    try {
      const results = statements.map(s => s._runSync());
      this.db.exec('COMMIT');
      return results;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
  async exec(sql) { this.db.exec(sql); return { count: 1 }; }
  /** Consulta direta, usada pelos testes para conferir o que foi gravado. */
  query(sql, ...params) { return this.db.prepare(sql).all(...params).map(r => ({ ...r })); }
}

/**
 * Cria um banco novo e aplica as migrations de uma instalação nova:
 * 0001 (esquema), 0003 (segurança) e 0004 (endurecimento). A 0002 só serve para bases antigas.
 */
export function createTestDatabase(migrationsDir, file = ':memory:') {
  const d1 = new D1Sqlite(file);
  const files = readdirSync(migrationsDir).filter(f => f.endsWith('.sql') && !f.startsWith('0002')).sort();
  for (const name of files) d1.db.exec(readFileSync(join(migrationsDir, name), 'utf8'));
  return d1;
}
