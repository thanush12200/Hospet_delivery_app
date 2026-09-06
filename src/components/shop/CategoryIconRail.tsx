import GridViewOutlinedIcon from '@mui/icons-material/GridViewOutlined'
import type { Category } from '@/types/db'

export function CategoryIconRail({ categories, selected, onSelect }: {
  categories: Category[]; selected: string | null; onSelect: (id: string | null) => void
}) {
  return <nav className="category-rail" aria-label="Product categories">
    <button onClick={() => onSelect(null)} aria-current={selected === null ? 'page' : undefined}><GridViewOutlinedIcon /> All essentials</button>
    {categories.map((c) => <button key={c.id} onClick={() => onSelect(c.id)} aria-current={selected === c.id ? 'page' : undefined}>{c.name}</button>)}
  </nav>
}
