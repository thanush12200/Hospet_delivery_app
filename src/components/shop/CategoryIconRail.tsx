import { Box, Stack, Typography } from '@mui/material'
import { categoryIcon } from '@/constants/categoryIcons'
import type { Category } from '@/types/db'

/** Horizontal icon strip under the header — the primary way people navigate. */
export function CategoryIconRail({
  categories, selected, onSelect,
}: {
  categories: Category[]
  selected: string | null
  onSelect: (id: string | null) => void
}) {
  const items = [{ id: null as string | null, name: 'All' }, ...categories]

  return (
    <Box
      sx={{
        display: 'flex', gap: 2.5, px: 2, py: 1.5,
        overflowX: 'auto', bgcolor: '#fff',
        borderBottom: '1px solid', borderColor: 'divider',
        '&::-webkit-scrollbar': { display: 'none' },
        scrollbarWidth: 'none',
      }}
    >
      {items.map((c) => {
        const active = selected === c.id
        return (
          <Stack
            key={c.id ?? 'all'}
            alignItems="center"
            spacing={0.5}
            onClick={() => onSelect(c.id)}
            sx={{ cursor: 'pointer', minWidth: 56, flexShrink: 0 }}
          >
            <Box
              sx={{
                width: 52, height: 52, borderRadius: '50%',
                display: 'grid', placeItems: 'center', fontSize: 24,
                bgcolor: active ? 'primary.main' : '#F4F5F7',
                border: '2px solid',
                borderColor: active ? 'primary.dark' : '#E9EBEF',
                boxShadow: active ? '0 4px 10px rgba(229,35,31,0.3)' : 'none',
                transition: 'background-color .15s',
              }}
            >
              {c.id === null ? '🛒' : categoryIcon(c.name)}
            </Box>
            <Typography
              variant="caption"
              sx={{
                fontWeight: active ? 700 : 500,
                color: active ? 'primary.main' : 'text.secondary',
                textAlign: 'center', lineHeight: 1.15, fontSize: 11,
              }}
            >
              {c.name}
            </Typography>
          </Stack>
        )
      })}
    </Box>
  )
}
