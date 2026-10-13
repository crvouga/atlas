Feature: Loyalty stamps
  A regular earns a free drink. No layer has recorded this yet.

  Scenario: Tenth drink is free
    Given nine stamps
    When the customer orders
    Then the drink is free
