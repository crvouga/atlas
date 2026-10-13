Feature: Work the list
  The list syncs to a server and keeps working when the sync drops. Editing the list and syncing happen independently.

  Background:
    Given a list named "Weekend chores"
    And the list says "All changes synced"

  Rule: What is on the list
    Scenario: Add a todo
      When they add "Water the plants"
      Then the list says "1 left"
      And "Water the plants" is open

    Scenario Outline: Add several todos
      When they add "<todo>"
      Then "<todo>" is open

      Examples:
        | todo             |
        | Water the plants |
        | Buy coffee       |

    Scenario: Finish every todo and clear them
      Given the list has "Water the plants"
      When they tap "Mark all done"
      Then the list says "All done!"
      When they tap "Clear completed"
      Then the list says "Nothing to do yet"

  Rule: The sync can drop
    Changes wait on the device. The app retries after 30 seconds.

    Scenario: Keep working through an outage
      Given the list has "Water the plants"
      When the sync fails
      Then they see "Offline"
      And they see "Changes are kept on this device"
      When they add "Buy coffee"
      Then "Buy coffee" is not synced yet
      When 30 seconds pass
      Then they see "All changes synced"
      And "Buy coffee" is open

  Rule: Starting over
    Scenario: Throw the list away
      Given the list has "Water the plants"
      When they tap "Start over"
      Then they see "Plan your day"

    Scenario: Start over while offline
      When the sync fails
      And they tap "Start over"
      Then they see "Plan your day"
      When they tap "Get started"
      And they type "Weekend chores" into the list name
      And they tap "Create list"
      Then the list is named "Weekend chores"
      And the list says "Nothing to do yet"
      And the list says "All changes synced"
