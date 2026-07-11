const designSystemCollectionShape = {
  id: "string",
  name: "string",
  modeNames: "string[]",
  varCount: "number",
  colorVarCount: "number",
  floatVarCount: "number",
  isPrimitive: "boolean",
  isAlias: "boolean"
};

const designSystemSnapshotShape = {
  target: "string",
  collections: "DesignSystemCollection[]",
  textStyles: "object[]",
  effectStyles: "object[]",
  paintStyles: "object[]"
};

const figmaDataInputShape = {
  target: "string",
  variables: "FigmaVariable[]",
  collections: "FigmaVariableCollection[]",
  textStyles: "object[]",
  effectStyles: "object[]",
  paintStyles: "object[]"
};

module.exports = {
  designSystemCollectionShape,
  designSystemSnapshotShape,
  figmaDataInputShape
};
