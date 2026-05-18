import { describe, it, expect } from 'vitest';
import { parseProtoText, decodeWithSchema } from '../src/lib/proto-loader.js';

const PROTO = `
syntax = "proto3";
package example;
message GetUserRequest  { string email = 1; }
message GetUserResponse { int32 id = 1; string name = 2; }
service UserService {
  rpc GetUser   (GetUserRequest)  returns (GetUserResponse);
  rpc ListUsers (GetUserRequest)  returns (GetUserResponse);
}
`;

describe('parseProtoText', () => {
  it('extracts URL map', () => {
    const { urlMap } = parseProtoText(PROTO);
    expect(urlMap).toHaveProperty('/example.UserService/GetUser');
    expect(urlMap).toHaveProperty('/example.UserService/ListUsers');
  });

  it('stores fully qualified type names', () => {
    const { urlMap } = parseProtoText(PROTO);
    const e = urlMap['/example.UserService/GetUser'];
    expect(e.requestType).toBe('example.GetUserRequest');
    expect(e.responseType).toBe('example.GetUserResponse');
  });

  it('returns usable root', () => {
    const { root } = parseProtoText(PROTO);
    expect(() => root.lookupType('example.GetUserRequest')).not.toThrow();
  });
});

describe('decodeWithSchema', () => {
  it('decodes binary using schema', () => {
    const { root } = parseProtoText(PROTO);
    const T = root.lookupType('example.GetUserResponse');
    const encoded = T.encode({ id: 42, name: 'Jan' }).finish();
    const result = decodeWithSchema(encoded, 'example.GetUserResponse', root);
    expect(result.id).toBe(42);
    expect(result.name).toBe('Jan');
  });
});
