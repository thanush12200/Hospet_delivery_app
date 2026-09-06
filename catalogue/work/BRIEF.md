# Catalogue research brief

You are filling in product content for FAA, a grocery delivery app in Hospet, Karnataka
(single store, sells at MRP, customers are Kannada/English speakers). Work through EVERY row
of your group CSV (`catalogue/work/group-<X>.csv`, columns: slug,name,name_kn,unit,category,brand)
and append one JSON object per row to `catalogue/work/group-<X>.jsonl`. Do not modify any other
file in the repo. Do not skip rows: if something cannot be found, still write the row with
`null` fields and a `notes` string saying what you tried.

Each row is a PRODUCT TYPE at a pack size, not a specific SKU (only the Nandini dairy rows are
branded). For each row produce:

```json
{
  "slug": "toor-dal-1-kg",
  "name": "Toor Dal", "unit": "1 kg", "category": "Dals & Pulses",
  "description": "1–2 plain sentences: what it is, how it is used in Karnataka kitchens, what the pack size suits. No health claims, no superlatives, no brand names in the sentence.",
  "suggested_brand": "the brand most commonly stocked for this pack size in Karnataka kirana/dark stores, or \"\" for loose/local items (rice, dal, produce)",
  "mrp_rupees": 165, "mrp_source": "URL or 'typical shelf price, Sept 2026' — an indicative MRP for that pack size in India; null if you truly cannot estimate",
  "image": {
    "file": "catalogue/images/raw/toor-dal-1-kg.jpg",
    "source_url": "direct image URL you downloaded",
    "page_url": "the page the image belongs to",
    "licence": "e.g. CC BY-SA 3.0 / CC BY 2.0 / CC0 / Public domain",
    "credit": "author or 'Open Food Facts contributors'"
  },
  "notes": ""
}
```

## Images: licence-safe only
Use ONLY sources with an explicit reuse licence. Never take images from Amazon, BigBasket,
JioMart, Flipkart, brand websites or Google Images.

1. **Open Food Facts** (packaged FOOD; CC BY-SA 3.0, credit "Open Food Facts contributors"):
   `https://world.openfoodfacts.org/cgi/search.pl?search_terms=<q>&search_simple=1&action=process&json=1&page_size=10&fields=code,product_name,brands,image_front_url,image_url,countries_tags`
   Prefer results with `en:india` in countries_tags and a clean front pack shot. page_url =
   `https://world.openfoodfacts.org/product/<code>`. Always send a User-Agent (fetch.sh does).
2. **Wikimedia Commons** (produce, loose staples, generic household items):
   `https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrsearch=<q>&gsrnamespace=6&gsrlimit=10&prop=imageinfo&iiprop=url|extmetadata&iiurlwidth=800&format=json`
   Use `thumburl` (800px) as source_url, `descriptionurl` as page_url, and read the licence
   from `extmetadata.LicenseShortName` and the author from `extmetadata.Artist` (strip HTML).
   Accept only CC0, Public domain, CC BY, CC BY-SA (any version). Reject NC/ND licences.
3. **Openverse** (fallback): `https://api.openverse.org/v1/images/?q=<q>&license_type=commercial&page_size=10`
   Use `url`, `foreign_landing_url`, `license` + `license_version`, `creator`.

Pick a photo that shows the item clearly on a plain background where possible (a bowl of
dal, a pile of tomatoes, a bar of soap). For packaged non-food (soap, detergent, toothpaste)
a generic product photo is fine; a recognisable brand pack is fine only from the sources above.
Portrait or square framing is better than wide. Download with:
`./catalogue/work/fetch.sh "<source_url>" catalogue/images/raw/<slug>.<jpg|png>`
It prints the type and width and fails on non-images or anything narrower than 300px; then
try the next candidate. Only reference a file that actually downloaded.

## Descriptions
Plain, short, factual, in English. Mention the local name where it helps
("Poha, called avalakki in Kannada"). Mention the pack size in context ("A 5 kg bag lasts a
small family about a month"). No medical or nutrition claims.

## MRP
An indicative maximum retail price for the pack size in India in 2026. Use a search
(WebSearch/WebFetch) of retailer listings for the suggested brand and pack size, or your own
knowledge when a search is not possible, and say which in mrp_source. The store will verify
every price before going live, so an honest estimate beats a blank.

## Working method
Do the rows in order. Append to the JSONL as you finish each row (one line per row) so partial
progress is never lost. At the end, print how many rows have an image and how many do not.
