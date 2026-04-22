module.exports = {
  exampleFigmaData: {
    target: "fixture-file",
    variables: [
      {
        id: "v1",
        name: "color/brand/500",
        resolvedType: "COLOR",
        valuesByMode: {
          m1: { r: 0.231, g: 0.51, b: 0.964, a: 1 }
        }
      },
      {
        id: "v2",
        name: "space/4",
        resolvedType: "FLOAT",
        valuesByMode: {
          m1: 16
        }
      },
      {
        id: "v3",
        name: "typography/body/md/size",
        resolvedType: "FLOAT",
        valuesByMode: {
          m1: 14
        }
      },
      {
        id: "v4",
        name: "color/bg/brand",
        resolvedType: "COLOR",
        valuesByMode: {
          m2: { type: "VARIABLE_ALIAS", id: "v1" },
          m3: { type: "VARIABLE_ALIAS", id: "v1" }
        }
      },
      {
        id: "v5",
        name: "spacing/component/md",
        resolvedType: "FLOAT",
        valuesByMode: {
          m2: { type: "VARIABLE_ALIAS", id: "v2" },
          m3: { type: "VARIABLE_ALIAS", id: "v2" }
        }
      }
    ],
    collections: [
      {
        id: "c1",
        name: "Primitives",
        modes: [{ id: "m1", modeId: "m1", name: "Value" }],
        variableIds: ["v1", "v2", "v3"]
      },
      {
        id: "c2",
        name: "Semantics",
        modes: [
          { id: "m2", modeId: "m2", name: "Light" },
          { id: "m3", modeId: "m3", name: "Dark" }
        ],
        variableIds: ["v4", "v5"]
      }
    ],
    textStyles: [{ name: "body/md" }],
    effectStyles: [{ name: "elevation/100" }]
  }
};
