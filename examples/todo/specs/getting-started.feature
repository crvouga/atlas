Feature: Name a list
  A new person names their first list, or skips and keeps the default name.

  Background:
    Given the welcome screen says "Plan your day"

  Rule: The list cannot be created without a name
    The name field starts empty, so "Create list" stays disabled.

    Scenario: Type a name
      When they tap "Get started"
      Then they see "Name your list"
      And "Create list" is disabled
      When they type "Weekend chores" into the list name
      Then "Create list" is enabled

  Rule: Creating the list opens it
    Scenario: Create a named list
      When they tap "Get started"
      And they type "Weekend chores" into the list name
      And they tap "Create list"
      Then the list is named "Weekend chores"
      And the list says "Nothing to do yet"
      And the list says "All changes synced"

  Rule: Skipping keeps the default name
    Scenario: Skip naming
      When they tap "Get started"
      And they tap "Skip for now"
      Then the list is named "My todos"
      And the list says "Nothing to do yet"
