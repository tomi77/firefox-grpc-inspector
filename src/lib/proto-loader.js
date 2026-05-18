import protobuf from 'protobufjs';

export function parseProtoText(text) {
  const { root } = protobuf.parse(text, { keepCase: true });
  const urlMap = {};

  function walk(ns, prefix) {
    if (!ns.nested) return;
    for (const [name, obj] of Object.entries(ns.nested)) {
      const fullName = prefix ? `${prefix}.${name}` : name;
      if (obj instanceof protobuf.Service) {
        for (const [methodName, method] of Object.entries(obj.methods)) {
          urlMap[`/${fullName}/${methodName}`] = {
            requestType:  resolveType(method.requestType,  prefix),
            responseType: resolveType(method.responseType, prefix),
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

function resolveType(typeName, pkg) {
  if (typeName.startsWith('.')) return typeName.slice(1);
  return pkg ? `${pkg}.${typeName}` : typeName;
}

export function decodeWithSchema(bytes, typeName, root) {
  const T = root.lookupType(typeName);
  return T.toObject(T.decode(bytes), { longs: String, enums: String, defaults: false });
}
