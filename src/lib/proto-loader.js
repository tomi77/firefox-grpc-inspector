import protobuf from 'protobufjs';

export function parseProtoText(text) {
  const root = new protobuf.Root();
  const result = protobuf.parse(text, root, { keepCase: true });

  for (const imp of (result.imports ?? [])) {
    const def = protobuf.common[imp];
    if (def) root.addJSON(def.nested);
  }

  const urlMap = {};

  function walk(ns, prefix) {
    if (!ns.nested) return;
    for (const [name, obj] of Object.entries(ns.nested)) {
      const fullName = prefix ? `${prefix}.${name}` : name;
      if (obj instanceof protobuf.Service) {
        for (const [methodName, method] of Object.entries(obj.methods)) {
          urlMap[`/${fullName}/${methodName}`] = {
            requestType:  resolveType(method.requestType,  prefix, root),
            responseType: resolveType(method.responseType, prefix, root),
            serviceName: name,
            methodName,
          };
        }
      }
      if (obj.nested) walk(obj, fullName);
    }
  }

  walk(root, '');
  return { root, urlMap };
}

function resolveType(typeName, pkg, root) {
  if (typeName.startsWith('.')) return typeName.slice(1);
  if (!pkg) return typeName;
  const parts = pkg.split('.');
  for (let i = parts.length; i > 0; i--) {
    const candidate = parts.slice(0, i).join('.') + '.' + typeName;
    if (root.lookup(candidate)) return candidate;
  }
  return typeName;
}

export function decodeWithSchema(bytes, typeName, root) {
  const T = root.lookupType(typeName);
  return T.toObject(T.decode(bytes), { longs: String, enums: String, defaults: false });
}
