// Test-only stand-ins for the Radix Select and the ingredient search popover, so jsdom can read and choose options.
// Use with vi.mock("@/components/ui/select", () => selectMock) and
// vi.mock("@/components/inventory/ingredient-search-select", () => ingredientSearchMock).
import { Children, isValidElement, type ReactElement, type ReactNode } from "react"

type SelectProps = { value?: string; onValueChange?: (value: string) => void; disabled?: boolean; children?: ReactNode }

// The <option>s inside SelectContent, wherever it sits among the children.
function optionsIn(children: ReactNode): ReactNode[] {
  const found: ReactNode[] = []
  Children.forEach(children, (child) => {
    if (!isValidElement(child)) return
    const element = child as ReactElement<{ children?: ReactNode; value?: string; __item?: boolean }>
    if ((element.type as { __item?: boolean }).__item) found.push(element)
    else found.push(...optionsIn(element.props.children))
  })
  return found
}

function Select({ value, onValueChange, disabled, children }: SelectProps) {
  return (
    <select data-testid="mock-select" value={value ?? ""} disabled={disabled} onChange={(event) => onValueChange?.(event.target.value)}>
      <option value="">—</option>
      {optionsIn(children)}
    </select>
  )
}

function SelectItem({ value, children }: { value: string; children?: ReactNode }) {
  return <option value={value}>{children}</option>
}
SelectItem.__item = true

const Nothing = () => null
const PassThrough = ({ children }: { children?: ReactNode }) => <>{children}</>

export const selectMock = {
  Select,
  SelectItem,
  SelectTrigger: Nothing,
  SelectValue: Nothing,
  SelectContent: PassThrough,
}

type IngredientOptionLike = { id: number; name: string }

function IngredientSearchSelect({ options, value, onSelect }: { options: IngredientOptionLike[]; value: number | null; onSelect: (o: IngredientOptionLike) => void }) {
  return (
    <select
      data-testid="ingredient-select"
      value={value ?? ""}
      onChange={(event) => {
        const chosen = options.find((option) => option.id === Number(event.target.value))
        if (chosen) onSelect(chosen)
      }}
    >
      <option value="">—</option>
      {options.map((option) => (
        <option key={option.id} value={option.id}>
          {option.name}
        </option>
      ))}
    </select>
  )
}

export const ingredientSearchMock = { IngredientSearchSelect }
