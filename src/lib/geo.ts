/**
 * Browser geolocation helpers.
 *
 * Coordinates are always optional here. Roughly half of users deny the
 * permission, GPS is unreliable indoors and in dense lanes, and in Hospet a
 * landmark genuinely beats a pin. Everything that uses this must still work
 * when it returns nothing.
 *
 * Deliberately no reverse geocoding: turning lat/lng into an area name via
 * Google or Mapbox costs per call. Instead each zone stores a centre point and
 * we pick the nearest one — pure arithmetic, no API, no bill.
 */

export interface Coords { lat: number; lng: number; accuracyM: number }

export type GeoError =
  | 'UNSUPPORTED' | 'DENIED' | 'UNAVAILABLE' | 'TIMEOUT'

export const GEO_MESSAGE: Record<GeoError, string> = {
  UNSUPPORTED: 'This browser cannot share location. Please pick your area below.',
  DENIED: 'Location is blocked. Allow it in your browser settings, or just pick your area below.',
  UNAVAILABLE: "Couldn't get a location fix. Please pick your area below.",
  TIMEOUT: 'Location is taking too long. Please pick your area below.',
}

export function getCurrentCoords(timeoutMs = 10000): Promise<Coords> {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) { reject('UNSUPPORTED' as GeoError); return }

    navigator.geolocation.getCurrentPosition(
      (p) => resolve({
        lat: p.coords.latitude,
        lng: p.coords.longitude,
        accuracyM: p.coords.accuracy,
      }),
      (err) => {
        reject((err.code === err.PERMISSION_DENIED ? 'DENIED'
          : err.code === err.TIMEOUT ? 'TIMEOUT'
          : 'UNAVAILABLE') as GeoError)
      },
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 60000 },
    )
  })
}

/** Great-circle distance in metres. */
export function distanceM(a: Coords | LatLng, b: LatLng): number {
  const R = 6371000
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(s))
}

export interface LatLng { lat: number; lng: number }
export interface ZoneCentre extends LatLng { id: string; name: string; radius_m: number | null }

export interface NearestZone { id: string; name: string; distanceM: number; withinRadius: boolean }

/**
 * Nearest zone by centre point. Returns null when no zone has coordinates yet,
 * in which case the customer just picks from the dropdown as before.
 */
export function nearestZone(at: LatLng, zones: ZoneCentre[]): NearestZone | null {
  const placed = zones.filter((z) => Number.isFinite(z.lat) && Number.isFinite(z.lng))
  if (placed.length === 0) return null

  let best: NearestZone | null = null
  for (const z of placed) {
    const d = distanceM(at, z)
    if (!best || d < best.distanceM) {
      best = {
        id: z.id,
        name: z.name,
        distanceM: d,
        withinRadius: z.radius_m == null ? true : d <= z.radius_m,
      }
    }
  }
  return best
}

/** A map link the rider can tap. Uses a pin when we have one, text otherwise. */
export function mapsLink(args: {
  lat?: number | null; lng?: number | null; landmark?: string | null; line1?: string | null
}): string {
  if (Number.isFinite(args.lat) && Number.isFinite(args.lng)) {
    return `https://www.google.com/maps/search/?api=1&query=${args.lat},${args.lng}`
  }
  const q = `${args.landmark ?? ''} ${args.line1 ?? ''} Hospet`.trim()
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`
}

/** What the zone resolver needs to know about each active zone. */
export interface ZoneLike { id: string; name: string; lat: number | null; lng: number | null; radius_m: number | null; is_active: boolean }

/**
 * The delivery area for a point, mirroring resolve_zone() in the database:
 *
 *   1. the nearest active zone with a centre, if the point is inside its
 *      radius (no radius = unlimited);
 *   2. else, when no zone has a centre and exactly one is active, that one —
 *      a one-store town works before anyone draws a map;
 *   3. else null: outside every area, or ambiguous.
 *
 * With no point at all (permission denied, skipped) only rule 2 applies.
 */
export function pickZone(at: LatLng | null, zones: ZoneLike[]): ZoneLike | null {
  const active = zones.filter((z) => z.is_active)
  const placed = active.filter((z) => z.lat != null && z.lng != null)
  if (at && placed.length > 0) {
    const near = nearestZone(at, placed.map((z) => ({ id: z.id, name: z.name, lat: z.lat as number, lng: z.lng as number, radius_m: z.radius_m })))
    if (near?.withinRadius) return active.find((z) => z.id === near.id) ?? null
    return null
  }
  if (placed.length === 0 && active.length === 1) return active[0] ?? null
  return null
}

/** Whether the browser will hand over a position without prompting. */
export async function geoPermission(): Promise<'granted' | 'denied' | 'prompt' | 'unknown'> {
  try {
    if (!('permissions' in navigator)) return 'unknown'
    const s = await navigator.permissions.query({ name: 'geolocation' })
    return s.state
  } catch { return 'unknown' }
}
