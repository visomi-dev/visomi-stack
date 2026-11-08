const siblings = new Set([
  'Element',
  'Template',
  'IfBlock',
  'ForLoopBlock',
  'SwitchBlock',
  'DeferredBlock',
  'JSXElement',
  'JSXFragment',
  'JSXExpressionContainer',
]);
const literalElements = new Set(['pre', 'code', 'textarea', 'script', 'style']);

function isLiteralElement(node) {
  const name = node.type === 'Element' ? node.name : node.openingElement?.name?.name;

  return typeof name === 'string' && literalElements.has(name.toLowerCase());
}

function range(node) {
  return node.range ?? [node.sourceSpan.start.offset, node.sourceSpan.end.offset];
}

export default {
  meta: {
    type: 'layout',
    docs: { description: 'Separate multiline sibling template elements and blocks with a blank line.' },
    fixable: 'whitespace',
    schema: [],
    messages: { missing: 'Separate sibling template elements with a blank line.' },
  },
  create(context) {
    const source = context.sourceCode;

    function check(node, children) {
      if (isLiteralElement(node) || source.getAncestors(node).some(isLiteralElement)) {
        return;
      }

      const elements = (children ?? []).filter((child) => siblings.has(child.type));

      for (let index = 1; index < elements.length; index++) {
        const previousEnd = range(elements[index - 1])[1];
        const nextStart = range(elements[index])[0];
        const gap = source.text.slice(previousEnd, nextStart);

        // Inline text and comments retain their spacing and association with nearby elements.
        if (!/^[\t \r\n]+$/.test(gap) || !gap.includes('\n') || /\n[\t \r]*\n/.test(gap)) {
          continue;
        }

        context.report({
          loc: source.getLocFromIndex(nextStart),
          messageId: 'missing',
          fix: (fixer) => fixer.insertTextAfterRange([previousEnd, previousEnd], gap.includes('\r\n') ? '\r\n' : '\n'),
        });
      }
    }

    const children = (node) => check(node, node.children);

    return {
      Program: (node) => check(node, node.templateNodes),
      Element: children,
      Template: children,
      IfBlockBranch: children,
      ForLoopBlock: children,
      ForLoopBlockEmpty: children,
      SwitchBlockCaseGroup: children,
      DeferredBlock: children,
      DeferredBlockPlaceholder: children,
      DeferredBlockLoading: children,
      DeferredBlockError: children,
      AstroFragment: children,
      JSXElement: children,
      JSXFragment: children,
    };
  },
};
