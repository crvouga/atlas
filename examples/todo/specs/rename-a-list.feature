Feature: Rename a list
  The name of a list can change after it is created.

  Scenario: Renames the weekend list
    Given a list named Weekend chores
    When the customer renames it to Saturday
    Then the list is called Saturday
