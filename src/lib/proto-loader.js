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

// Reflection-based decode — avoids protobufjs codegen (new Function) which is blocked by CSP
// in Firefox extension pages. Uses protobuf.Reader + Type.fieldsById directly, never calling
// field.resolve() (which would trigger generateConstructor → new Function via parent.ctor).
const SCALAR_READERS = {
  double:   r => r.double(),
  float:    r => r.float(),
  int32:    r => r.int32(),
  uint32:   r => r.uint32(),
  sint32:   r => r.sint32(),
  fixed32:  r => r.fixed32(),
  sfixed32: r => r.sfixed32(),
  int64:    r => r.int64().toString(),
  uint64:   r => r.uint64().toString(),
  sint64:   r => r.sint64().toString(),
  fixed64:  r => r.fixed64().toString(),
  sfixed64: r => r.sfixed64().toString(),
  bool:     r => r.bool(),
  string:   r => r.string(),
};

export function decodeWithSchema(bytes, typeName, root) {
  const T = root.lookupType(typeName);
  return reflectiveDecode(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes), T, root);
}

// Resolve a field's composite type without calling field.resolve() (which touches parent.ctor).
function lookupFieldType(field, root) {
  if (field.resolvedType) return field.resolvedType;
  if (SCALAR_READERS[field.type] || field.type === 'bytes') return null;
  try {
    const ns = field.declaringField ? field.declaringField.parent : field.parent;
    return ns.lookupTypeOrEnum(field.type);
  } catch {
    return null;
  }
}

function reflectiveDecode(bytes, type, root) {
  const r = protobuf.Reader.create(bytes);
  const msg = {};
  while (r.pos < r.len) {
    const tag      = r.uint32();
    const fieldId  = tag >>> 3;
    const wireType = tag & 7;
    const field    = type.fieldsById[fieldId];
    if (!field) { r.skipType(wireType); continue; }

    if (field.map) {
      const entryBytes = r.bytes();
      const entry = decodeMapEntry(entryBytes, field, root);
      (msg[field.name] ??= {})[entry.key] = entry.value;
      continue;
    }

    const scalarRead = SCALAR_READERS[field.type];

    // Packed repeated scalars (proto3 default for numeric types, wire type 2)
    if (wireType === 2 && field.repeated && scalarRead && field.type !== 'string') {
      const end = r.uint32() + r.pos;
      const arr = (msg[field.name] ??= []);
      while (r.pos < end) arr.push(scalarRead(r));
      continue;
    }

    const resolvedType = lookupFieldType(field, root);
    let val;
    if (resolvedType instanceof protobuf.Enum) {
      const v = r.int32();
      val = resolvedType.valuesById[v] ?? v;
    } else if (scalarRead) {
      val = scalarRead(r);
    } else if (field.type === 'bytes') {
      val = Array.from(r.bytes());
    } else {
      val = reflectiveDecode(r.bytes(), resolvedType, root);
    }

    if (field.repeated) (msg[field.name] ??= []).push(val);
    else msg[field.name] = val;
  }
  return msg;
}

function decodeMapEntry(entryBytes, mapField, root) {
  const r = protobuf.Reader.create(entryBytes);
  let key = '', value = null;
  while (r.pos < r.len) {
    const tag = r.uint32();
    const fid = tag >>> 3;
    const wt  = tag & 7;
    if (fid === 1) {
      key = String((SCALAR_READERS[mapField.keyType] ?? (rx => rx.string()))(r));
    } else if (fid === 2) {
      const scalarRead = SCALAR_READERS[mapField.type];
      const resolvedVal = lookupFieldType(mapField, root);
      if (resolvedVal instanceof protobuf.Enum) {
        const v = r.int32();
        value = resolvedVal.valuesById[v] ?? v;
      } else if (scalarRead) {
        value = scalarRead(r);
      } else if (mapField.type === 'bytes') {
        value = Array.from(r.bytes());
      } else if (resolvedVal) {
        value = reflectiveDecode(r.bytes(), resolvedVal, root);
      } else {
        r.skipType(wt);
      }
    } else {
      r.skipType(wt);
    }
  }
  return { key, value };
}
