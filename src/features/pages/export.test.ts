import { expect, test } from "vitest"

import { paginate } from "@/features/pages/export"

const rows = [
  { top: 60, bottom: 160 },
  { top: 170, bottom: 460 },
  { top: 470, bottom: 760 },
  { top: 770, bottom: 1000 },
]

test("a short Page stays on one sheet", () => {
  expect(paginate(rows.slice(0, 2), 790, 480)).toEqual([
    { top: 0, bottom: 480 },
  ])
})

test("sheets break between rows, never through one", () => {
  expect(paginate(rows, 790, 1020)).toEqual([
    { top: 0, bottom: 770 },
    { top: 770, bottom: 1020 },
  ])
})

test("a row taller than a sheet gets a sheet of its own", () => {
  const tall = [
    { top: 60, bottom: 160 },
    { top: 170, bottom: 1400 },
    { top: 1410, bottom: 1500 },
  ]

  expect(paginate(tall, 790, 1520)).toEqual([
    { top: 0, bottom: 170 },
    { top: 170, bottom: 1410 },
    { top: 1410, bottom: 1520 },
  ])
})
