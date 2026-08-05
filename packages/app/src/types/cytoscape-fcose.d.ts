declare module "cytoscape-fcose" {
  import type cytoscape from "cytoscape"

  const register: (cy: typeof cytoscape) => void
  export default register
}
