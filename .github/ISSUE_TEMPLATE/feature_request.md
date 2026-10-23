name: Feature request
description: Suggest a rule, a command or an improvement
labels: enhancement
body:
  - type: textarea
    id: problem
    attributes:
      label: What problem would this solve?
      description: Describe the situation, not the solution.
    validations:
      required: true

  - type: textarea
    id: proposal
    attributes:
      label: What would you like apicovenant to do?
    validations:
      required: true

  - type: textarea
    id: alternatives
    attributes:
      label: Alternatives you considered

  - type: dropdown
    id: area
    attributes:
      label: Which area does this belong to?
      options:
        - A new lint rule
        - The mock server
        - Recording and diffing
        - The report format
        - The command line interface
        - Documentation
        - Something else
