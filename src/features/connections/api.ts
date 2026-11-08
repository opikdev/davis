import { invoke } from "@tauri-apps/api/core"

import type { OpenedTable } from "@/features/data"
import type { Project } from "@/features/projects"

export type SslMode = "disable" | "prefer" | "require"

export type DatabaseKind = "postgres" | "mysql"

export type ConnectedTable = {
  schema: string
  table: string
}

export type DatabaseConnection = {
  id: string
  kind: DatabaseKind
  name: string
  host: string
  port: number
  database: string
  user: string
  ssl: SslMode
  tables: ConnectedTable[]
}

export type DatabaseLogin = {
  kind: DatabaseKind
  host: string
  port: number
  database: string
  user: string
  password: string
  ssl: SslMode
}

export type DatabaseTableInfo = {
  schema: string
  table: string
  estimatedRows: number | null
}

// The default schema adds nothing to a name: Postgres's is "public", and a
// MySQL database is its own schema.
export function tableLabel(
  connection: DatabaseConnection,
  { schema, table }: ConnectedTable
) {
  const defaultSchema =
    connection.kind === "mysql" ? connection.database : "public"
  return schema === defaultSchema
    ? `${connection.name}.${table}`
    : `${connection.name}.${schema}.${table}`
}

export function databaseSupport(kind: DatabaseKind) {
  return invoke<boolean>("database_support", { kind })
}

export function installDatabaseSupport(kind: DatabaseKind) {
  return invoke<void>("install_database_support", { kind })
}

export function testDatabase(login: DatabaseLogin) {
  return invoke<DatabaseTableInfo[]>("test_database", { login })
}

export function addDatabase(
  project: string,
  connection: DatabaseConnection,
  password: string
) {
  return invoke<Project>("add_database", { project, connection, password })
}

export function reconnectDatabase(
  project: string,
  id: string,
  password: string
) {
  return invoke<Project>("reconnect_database", { project, id, password })
}

export function removeDatabaseTable(
  project: string,
  id: string,
  { schema, table }: ConnectedTable
) {
  return invoke<Project>("remove_database_table", {
    project,
    id,
    schema,
    table,
  })
}

export function openDatabaseTable(
  project: string,
  id: string,
  { schema, table }: ConnectedTable
) {
  return invoke<OpenedTable>("open_database_table", {
    project,
    connection: id,
    schema,
    table,
  })
}
