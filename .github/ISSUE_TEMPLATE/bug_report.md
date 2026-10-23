name: Bug report
description: Something in apicovenant does not behave the way it should
labels: bug
body:
  - type: markdown
    attributes:
      value: |
        Thanks for taking the time to report this. A minimal OpenAPI document
        that reproduces the problem is worth a lot more than a long description.

  - type: textarea
    id: what-happened
    attributes:
      label: What happened?
      description: What did you observe?
    validations:
      required: true

  - type: textarea
    id: expected
    attributes:
      label: What did you expect instead?
    validations:
      required: true

  - type: textarea
    id: command
    attributes:
      label: Command
      description: The exact command you ran.
      render: shell
    validations:
      required: true

  - type: textarea
    id: spec
    attributes:
      label: OpenAPI document
      description: A reduced document that shows the problem. YAML or JSON.
      render: yaml

  - type: input
    id: version
    attributes:
      label: apicovenant version
      placeholder: 1.0.0
    validations:
      required: true

  - type: input
    id: node
    attributes:
      label: Node.js version
      placeholder: v24.0.0
    validations:
      required: true

  - type: textarea
    id: logs
    attributes:
      label: Output or error message
      render: shell
