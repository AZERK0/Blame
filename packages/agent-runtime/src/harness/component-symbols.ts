import type { SgNode } from "@ast-grep/napi";

export function componentElementBodyRange(node: SgNode, byteOffset: number) {
  if (!isContainerElement(node)) return undefined;
  const children = node.children();
  const start = children.find((child) =>
    ["start_tag", "script_start_tag", "style_start_tag"].includes(
      String(child.kind()),
    ),
  );
  const end = [...children]
    .reverse()
    .find((child) =>
      ["end_tag", "script_end_tag", "style_end_tag"].includes(
        String(child.kind()),
      ),
    );
  if (!start || !end) return undefined;
  return [nodeEnd(start, byteOffset), nodeStart(end, byteOffset)] as [
    number,
    number,
  ];
}

export function componentElementName(node: SgNode) {
  const tag = node
    .children()
    .flatMap((child) => [child, ...child.children()])
    .find((child) => child.kind() === "tag_name")
    ?.text()
    .trim();
  if (!tag) return undefined;
  const opening = node.children()[0]?.text() ?? "";
  const id = opening.match(/\bid\s*=\s*["']([^"']+)["']/u)?.[1];
  return id ? `${tag}#${id}` : tag;
}

function isContainerElement(node: SgNode) {
  return ["element", "script_element", "style_element"].includes(
    String(node.kind()),
  );
}

function nodeStart(node: SgNode, byteOffset: number) {
  return byteOffset + node.range().start.index;
}

function nodeEnd(node: SgNode, byteOffset: number) {
  return byteOffset + node.range().end.index;
}
