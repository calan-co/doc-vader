Feature: MVP package UAT

  Scenario: A clean consumer can discover and prompt a ready work item
    Given a clean consumer project with a ready work item
    When I install the packed Doc-Vader package
    Then the CLI reports its installed package version
    And the ready work item is discoverable
    And the ready work item prompt renders
