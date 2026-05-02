// Frontend-side type for parsed Steam inventory items.
// Server side has its own version in apps/server/src/lib/steam.ts.
// Kept here because both apps/web inventory picker pages import it via a relative path.

export type InventoryItem = {
  asset_id:    string
  class_id:    string
  name:        string
  icon_url:    string
  wear:        string | null
  rarity:      string | null
  type:        string | null
  tradable:    boolean
  marketable:  boolean
}
