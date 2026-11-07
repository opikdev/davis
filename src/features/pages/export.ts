import interFont from "@fontsource-variable/inter/files/inter-latin-wght-normal.woff2?inline"
import { domToCanvas } from "modern-screenshot"

import type { ExportFormat, ExportImage } from "@/features/pages/api"

export const SHEET_WIDTH = 1120
const SHEET_MARGIN = 24
const SCALE = 2
const A4_HEIGHT_PER_WIDTH = 595 / 842
const JPEG_QUALITY = 0.9

type Span = { top: number; bottom: number }

// Pages break between rows, so a chart never splits across two sheets.
export function paginate(rows: Span[], pageHeight: number, total: number) {
  const pages: Span[] = []
  let top = 0
  for (const row of rows) {
    if (row.bottom - top > pageHeight && row.top > top) {
      pages.push({ top, bottom: row.top })
      top = row.top
    }
  }
  return [...pages, { top, bottom: total }]
}

// The capture can't reach the app's own fonts, so Inter travels inside it.
const EMBEDDED_FONT = `@font-face{font-family:"Inter Variable";font-style:normal;font-weight:100 900;src:url(${interFont}) format("woff2")}`

function sliced(whole: HTMLCanvasElement, span: Span, isFirst: boolean) {
  const margin = isFirst ? 0 : SHEET_MARGIN * SCALE
  const height = (span.bottom - span.top) * SCALE
  const page = document.createElement("canvas")
  page.width = whole.width
  page.height = height + margin
  const painter = page.getContext("2d")
  if (!painter) throw new Error("This computer can't draw the export.")
  painter.fillStyle = "#ffffff"
  painter.fillRect(0, 0, page.width, page.height)
  painter.drawImage(
    whole,
    0,
    span.top * SCALE,
    whole.width,
    height,
    0,
    margin,
    whole.width,
    height
  )
  return page
}

export async function captureSheet(
  sheet: HTMLElement,
  format: ExportFormat
): Promise<ExportImage[]> {
  const whole = await domToCanvas(sheet, {
    scale: SCALE,
    backgroundColor: "#ffffff",
    font: { cssText: EMBEDDED_FONT },
  })
  if (format === "png") {
    return [
      {
        data: whole.toDataURL("image/png"),
        width: whole.width,
        height: whole.height,
      },
    ]
  }
  const start = sheet.getBoundingClientRect().top
  const rows = [...sheet.querySelectorAll("[data-row]")].map((row) => {
    const { top, bottom } = row.getBoundingClientRect()
    return { top: top - start, bottom: bottom - start }
  })
  const total = whole.height / SCALE
  return paginate(rows, SHEET_WIDTH * A4_HEIGHT_PER_WIDTH, total).map(
    (span, index) => {
      const page = sliced(whole, span, index === 0)
      return {
        data: page.toDataURL("image/jpeg", JPEG_QUALITY),
        width: page.width,
        height: page.height,
      }
    }
  )
}
