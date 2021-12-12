export default (name: "streets" | "no-streets") => {
  let result;
  // @ts-ignore
  /*
  if (isProduction) {
    if (name === "streets") {
      result = `/tiles/${name}-{s}`;
    } else {
      result = `/tiles/${name}`;
    }
  */
  if (name === "streets") {
    result = "https://{s}.tile.openstreetmap.org";
  } else {
    result = "https://tiles.wmflabs.org/osm-no-labels";
  }
  result += "/{z}/{x}/{y}.png";
  return result;
};
