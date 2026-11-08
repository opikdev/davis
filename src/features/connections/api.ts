import { invoke } from "@tauri-apps/api/core"

import type { OpenedTable } from "@/features/data"
import type { Project } from "@/features/projects"

export type SslMode = "disable" | "prefer" | "require"

export type ConnectedTable = {
  schema: string
  table: string
}

export type DatabaseConnection = {
  id: string
  name: string
  host: string
  port: number
  database: string
  user: string
  ssl: SslMode
  tables: ConnectedTable[]
}

export type DatabaseLogin = {
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

export function tableLabel(
  connection: DatabaseConnection,
  { schema, table }: ConnectedTable
) {
  return schema === "public"
    ? `${connection.name}.${table}`
    : `${connection.name}.${schema}.${table}`
}

export function postgresSupport() {
  return invoke<boolean>("postgres_support")
}

export function installPostgresSupport() {
  return invoke<void>("install_postgres_support")
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
