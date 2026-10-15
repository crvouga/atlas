Feature: Share a list
  People keep one list and work through it together.

  Rule: A weekend list

    Scenario: Plans a weekend
      Given no list yet
      When the customer names the list
      And adds a todo
      And marks it done
      Then the list is clear and synced

    Scenario: Keeps working through a sync outage
      Given a list
      When sync fails
      And the customer adds a todo
      And the retry timer elapses
      Then the list is synced

    Scenario: Starts over
      Given a list with a todo
      When the customer throws the list away
      Then the app is back at the welcome

    Scenario: Starts over while offline
      Given a sync outage
      When the customer throws the list away
      And starts a new list
      Then the new list is synced
