@domain:developer-tools
Feature: Combine test reports in layers
  When the team investigates the app, the team wants completed test runs to
  contribute to one report, so useful evidence stays available as the app changes.

  Rule: The current specs form the complete outline of the report

    Scenario: An earlier test run fills a current spec
      Given a current spec has a completed test run from an earlier version of the app
      When the team opens the report
      Then that test run contributes its recorded outcome
      And the team can see which version of the app it checked

    Scenario: A spec without evidence stays visible
      Given a current spec has no completed test run in any report layer
      When the team opens the report
      Then that spec remains in the outline
      And no passing outcome is invented for it

  Rule: Report layers combine across versions of the app and report parameters
    No counter-example: combining evidence always retains the origin and report parameters of each contributing result.

    Scenario: Different report parameters contribute together
      Given one test run checked a phone and another checked a tablet
      When the team opens the report
      Then both recorded outcomes contribute with their report parameters

    Scenario: A newer result replaces only the matching result
      Given an earlier report layer contains checks for joining and leaving
      And a later report layer repeats only the joining check with the same report parameters
      When the team opens the report
      Then the later joining result and the earlier leaving result contribute
      And the earlier joining result remains available in its report layer

    Scenario: Equal-time conflicting results remain conservative
      Given two report layers record opposite outcomes for the same check and report parameters at the same time
      When the team opens the report
      Then the failed outcome is shown
      And both report layers remain available

  Rule: Potentially outdated evidence remains useful and visibly qualified
    No counter-example: uncertainty changes the qualification, never the recorded outcome.

    Scenario: A changed spec keeps its earlier outcome with a warning
      Given a spec changed after its completed test run
      When the team opens the report
      Then the earlier recorded outcome remains visible
      And it is marked potentially outdated

    Scenario: A change elsewhere does not remove a completed result
      Given a completed test run checked an unchanged spec
      And another part of the app changed
      When the team opens the report
      Then the completed result remains visible
      And uncertainty about related changes is visible without claiming the result was rerun

  Rule: A missing or running result never erases a completed result
    No counter-example: an unfinished result can never replace a completed result.

    Scenario: A newer unfinished run leaves earlier evidence visible
      Given an earlier report layer has a completed result
      And a newer report layer has not completed that check
      When the team opens the report
      Then the earlier completed result remains visible with its original outcome
      And it cannot be mistaken for the unfinished run's outcome
