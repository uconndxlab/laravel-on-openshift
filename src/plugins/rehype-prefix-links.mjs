import { visit } from 'unist-util-visit';

export function rehypePrefixLinks(base) {
  return (tree) => {
    visit(tree, 'element', (node) => {
      if (
        node.tagName === 'a' &&
        typeof node.properties?.href === 'string'
      ) {
        const href = node.properties.href;
        if (href.startsWith('/') && !href.startsWith('//') && !href.startsWith(base)) {
          node.properties.href = base + href;
        }
      }
    });
  };
}
