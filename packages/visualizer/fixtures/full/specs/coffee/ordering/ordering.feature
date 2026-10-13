Feature: Order a drink
  A customer picks a drink, pays, and picks it up.

  Rule: Paying for the order

    Scenario: Pays by card
      Given a drink in the cart
      When the customer pays by card
      Then the barista can start the drink

    Scenario: Pays with a wallet
      Given a drink in the cart
      When the customer pays with a wallet
      Then the order is paid

    Scenario: Card declined, then a wallet works
      Given a drink in the cart
      When the card is declined
      And the customer pays with a wallet
      Then the order is paid

    Scenario: Slow payment
      Given a drink in the cart
      When the payment takes longer than a minute
      Then the customer can check the payment again

    Scenario: Leaves checkout and comes back
      Given a drink in the cart
      When the customer closes checkout
      And the customer starts checkout again
      Then checkout is open

    Scenario: Drink left too long
      Given a finished drink
      When nobody picks it up
      Then the drink is thrown away and refunded
