import { expect, test } from "vitest"

import { tableLabel, type DatabaseConnection } from "@/features/connections/api"

function connection(kind: DatabaseConnection["kind"]): DatabaseConnection {
  return {
    id: "c1",
    kind,
    name: "shop",
    host: "db.example.com",
    port: 5432,
    database: "shop_db",
    user: "reader",
    ssl: "prefer",
    tables: [],
  }
}

test("a table in the default schema is named after its database alone", () => {
  expect(
    tableLabel(connection("postgres"), { schema: "public", table: "orders" })
  ).toBe("shop.orders")
  expect(
    tableLabel(connection("mysql"), { schema: "shop_db", table: "orders" })
  ).toBe("shop.orders")
})

test("a table in another schema keeps the schema in its name", () => {
  expect(
    tableLabel(connection("postgres"), { schema: "sales", table: "orders" })
  ).toBe("shop.sales.orders")
})
