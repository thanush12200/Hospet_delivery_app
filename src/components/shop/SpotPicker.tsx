import { useState } from 'react'
import { Box, Typography } from '@mui/material'
import { PlaceSearch } from '@/components/shop/PlaceSearch'
import { useCustomer } from '@/store/customerContext'
import { pickZone, searchCentre, searchRadiusM } from '@/lib/geo'
import { HOSPET, RADIUS_M, type Place } from '@/lib/places'
import { setSpot } from '@/lib/spot'
import { BRAND } from '@/theme/brand'

/**
 * "Where in Hospet?": a place search limited to the delivery city. Picking a
 * result inside a delivery area remembers it as the delivery spot (so the
 * address form starts its pin there) and selects that area for pricing.
 * A result outside every area is refused with a note, not accepted.
 */
export function SpotPicker({ forSomeoneElse, onDone }: { forSomeoneElse: boolean; onDone: () => void }) {
  const customer = useCustomer()
  const [note, setNote] = useState<string | null>(null)

  function pick(p: Place) {
    const zone = pickZone({ lat: p.lat, lng: p.lng }, customer.zones)
    if (!zone) { setNote(`${p.name} is outside our delivery area right now. Try a place inside ${BRAND.city}.`); return }
    setSpot({ lat: p.lat, lng: p.lng, label: p.name, forSomeoneElse })
    setNote(null)
    customer.setSelectedZoneId(zone.id)
    onDone()
  }

  return (
    <Box>
      <PlaceSearch near={searchCentre(customer.zones, HOSPET)} radiusM={searchRadiusM(customer.zones, RADIUS_M)} onPick={pick} inline />
      {note && <Typography variant="caption" color="error.main" sx={{ display: 'block', mt: 1 }}>{note}</Typography>}
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
        A street, an area or a landmark is enough. You'll pin the exact door when you add the address.
      </Typography>
    </Box>
  )
}
