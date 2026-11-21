"use client"

// LOCATION_DEACTIVATE_REFUSED (contract 4.4): every reason in details.reasons, in plain words, in the server's order.
// Stock lines with how to clear them, the assignments with a link to that section, and the open stock requests and
// stock takes, each linked.

import Link from "next/link"
import { formatStockLine, type DeactivateRefusalItem } from "@/lib/locations"

export const ASSIGNMENTS_ANCHOR = "location-assignments"

// One full stop at the end, whether the line has one or not.
function sentence(text: string): string {
  return text.endsWith(".") ? text : `${text}.`
}

export function DeactivateRefused({ locationName, items }: { locationName: string; items: DeactivateRefusalItem[] }) {
  return (
    <div role="alert" data-testid="deactivate-refused" className="space-y-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm">
      <p className="font-medium text-destructive">{locationName} can&apos;t be deactivated:</p>
      <ul className="list-disc space-y-2 pl-5">
        {items.map((item) => (
          <li key={item.reason} data-reason={item.reason}>
            {item.reason === "HAS_STOCK" ? (
              <>
                <p>{sentence(item.text)}</p>
                {item.lines.length > 0 && (
                  <ul className="mt-1 list-[circle] pl-5 text-muted-foreground">
                    {item.lines.map((line) => (
                      <li key={line.ingredientId}>{formatStockLine(line)}</li>
                    ))}
                  </ul>
                )}
                {item.total > item.shown && <p className="mt-1 text-muted-foreground">The {item.shown} largest are shown.</p>}
                <p className="mt-1">{item.howToClear}</p>
              </>
            ) : item.reason === "ASSIGNED" ? (
              <>
                <ul className="list-none space-y-0.5">
                  {(item.lines.length > 0 ? item.lines : [item.text]).map((line) => (
                    <li key={line}>{sentence(line)}</li>
                  ))}
                </ul>
                <p className="mt-1">
                  <a href={`#${ASSIGNMENTS_ANCHOR}`} className="underline">
                    Change the assignments
                  </a>{" "}
                  first.
                </p>
              </>
            ) : item.reason === "OPEN_STOCK_REQUESTS" || item.reason === "OPEN_STOCK_TAKES" ? (
              <p>
                {item.text}
                {item.ids.length > 0 ? ": " : "."}
                {item.ids.map((id, index) => (
                  <span key={id}>
                    {index > 0 && ", "}
                    <Link
                      href={item.reason === "OPEN_STOCK_REQUESTS" ? `/inventory/stock-requests/${id}` : `/inventory/stock-takes/${id}`}
                      className="underline"
                    >
                      #{id}
                    </Link>
                  </span>
                ))}
                {item.ids.length > 0 && "."}
              </p>
            ) : (
              <p>{sentence(item.text)}</p>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
