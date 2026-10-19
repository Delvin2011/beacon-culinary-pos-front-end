"use client"

import { ChevronLeft, ChevronRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { formatInt, type ReportPage } from "@/lib/reports"

const PAGE_SIZES = [50, 100, 200]

interface ReportPagingProps {
  page: ReportPage
  rowCount: number
  // 0-based page number and page size; both go in the URL and the request.
  onChange: (page: number, size: number) => void
  disabled?: boolean
  error?: string | null
}

// Server-side paging (page.paged). The totals row always covers every row, not just this page.
export function ReportPaging({ page, rowCount, onChange, disabled = false, error }: ReportPagingProps) {
  const pageCount = Math.max(1, Math.ceil(page.totalRows / Math.max(1, page.size)))
  const first = page.totalRows === 0 ? 0 : page.number * page.size + 1
  const last = page.number * page.size + rowCount
  const sizes = PAGE_SIZES.includes(page.size) ? PAGE_SIZES : [...PAGE_SIZES, page.size].sort((a, b) => a - b)

  return (
    <div className="space-y-1">
      <nav aria-label="Pages" className="flex flex-wrap items-center justify-between gap-3 text-sm">
        <p className="text-muted-foreground">
          Rows {formatInt(first)}–{formatInt(last)} of {formatInt(page.totalRows)} · totals cover every row
        </p>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Rows per page</span>
          <Select value={String(page.size)} onValueChange={(value) => onChange(0, Number(value))} disabled={disabled}>
            <SelectTrigger className="h-8 w-[84px]" aria-label="Rows per page">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {sizes.map((size) => (
                <SelectItem key={size} value={String(size)}>
                  {size}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            size="sm"
            variant="outline"
            className="h-8 px-2"
            disabled={disabled || page.number <= 0}
            onClick={() => onChange(page.number - 1, page.size)}
            aria-label="Previous page"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="whitespace-nowrap text-xs">
            Page {formatInt(page.number + 1)} of {formatInt(pageCount)}
          </span>
          <Button
            size="sm"
            variant="outline"
            className="h-8 px-2"
            disabled={disabled || page.number + 1 >= pageCount}
            onClick={() => onChange(page.number + 1, page.size)}
            aria-label="Next page"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </nav>
      {error && (
        <p role="alert" className="text-right text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}
