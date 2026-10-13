# Cart
module cart {
  var items: int
  var paid: bool
  action add = items' = items + 1
  action pay = paid' = true
}
