# List
module list {
  var items: int
  var synced: bool
  action add = items' = items + 1
  action sync = synced' = true
}
