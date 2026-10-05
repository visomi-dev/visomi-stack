const userFacingProperties = new Set([
  'ariaDescription',
  'ariaLabel',
  'cancelLabel',
  'caption',
  'confirmLabel',
  'emptyMessage',
  'error',
  'failureMessage',
  'heading',
  'hint',
  'label',
  'legend',
  'loadingLabel',
  'message',
  'notice',
  'placeholder',
  'submitLabel',
  'summary',
  'successMessage',
  'tooltip',
]);

const userFacingStateNames = new Set(['error', 'errorMessage', 'notice', 'successMessage', 'verificationNotice']);

function isLocalized(node) {
  return (
    node.type === 'TaggedTemplateExpression' &&
    node.tag.type === 'Identifier' &&
    node.tag.name === '$localize' &&
    /^:@@[A-Za-z][\w.-]*:/.test(node.quasi.quasis[0]?.value.raw ?? '')
  );
}

function isStaticCopy(node) {
  if (node.type === 'Literal') {
    return typeof node.value === 'string' && node.value.trim().length > 0;
  }

  if (node.type === 'TemplateLiteral') {
    return node.expressions.length === 0 && node.quasis[0]?.value.cooked?.trim().length > 0;
  }

  return (
    node.type === 'TaggedTemplateExpression' &&
    node.tag.type === 'Identifier' &&
    node.tag.name === '$localize' &&
    node.quasi.expressions.length === 0 &&
    node.quasi.quasis[0]?.value.cooked?.trim().length > 0
  );
}

function propertyName(node) {
  if (!node.computed && node.key.type === 'Identifier') {
    return node.key.name;
  }

  return node.key.type === 'Literal' && typeof node.key.value === 'string' ? node.key.value : undefined;
}

function memberName(node) {
  if (node.type !== 'MemberExpression') {
    return undefined;
  }

  if (!node.computed && node.property.type === 'Identifier') {
    return node.property.name;
  }

  return node.property.type === 'Literal' && typeof node.property.value === 'string' ? node.property.value : undefined;
}

function owningStateName(node) {
  const property = node.type === 'Identifier' ? node.name : memberName(node);

  return property && userFacingStateNames.has(property) ? property : undefined;
}

const rule = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Require Angular $localize for static user-facing TypeScript copy',
    },
    schema: [],
    messages: {
      useLocalize: 'Static user-facing copy must use $localize with a custom @@ message ID.',
    },
  },
  create(context) {
    function reportIfUnlocalized(node) {
      if (isStaticCopy(node) && !isLocalized(node)) {
        context.report({ node, messageId: 'useLocalize' });
      }
    }

    return {
      Property(node) {
        if (userFacingProperties.has(propertyName(node)) && !isLocalized(node.value)) {
          reportIfUnlocalized(node.value);
        }
      },
      CallExpression(node) {
        if (memberName(node.callee) !== 'set' || !owningStateName(node.callee.object)) {
          return;
        }

        const value = node.arguments[0];

        if (value && value.type !== 'SpreadElement') {
          reportIfUnlocalized(value);
        }
      },
    };
  },
};

export default rule;
