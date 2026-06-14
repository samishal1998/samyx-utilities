# Layer 1: XML JSON Validation

Layer 1 schemas validate the JSON structure produced by `fast-xml-parser` from XML documents.

## Overview

```
XML String → fast-xml-parser → JSON → Layer 1 Schema → Validated JSON
```

Layer 1 does NOT transform data - it validates that the JSON matches the expected XML structure.

## XML to JSON Mapping

### fast-xml-parser Configuration

Layer 1 schemas expect JSON from fast-xml-parser with these options:

```typescript
import { XMLParser } from 'fast-xml-parser';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  // Recommended:
  parseAttributeValue: false,  // Keep attributes as strings
  trimValues: true,
});
```

### Mapping Rules

| XML Construct | JSON Representation |
|---------------|---------------------|
| Element | Object property with element name |
| Attribute | Property with `@_` prefix |
| Text content | `#text` property |
| Namespace prefix | Preserved in property name |
| Repeated elements | Array |

### Example

XML:
```xml
<domain:chkData xmlns:domain="urn:ietf:params:xml:ns:domain-1.0">
  <domain:cd>
    <domain:name avail="1">example.com</domain:name>
    <domain:reason>Available</domain:reason>
  </domain:cd>
  <domain:cd>
    <domain:name avail="0">taken.com</domain:name>
    <domain:reason lang="en">Already registered</domain:reason>
  </domain:cd>
</domain:chkData>
```

JSON (from fast-xml-parser):
```json
{
  "domain:chkData": {
    "@_xmlns:domain": "urn:ietf:params:xml:ns:domain-1.0",
    "domain:cd": [
      {
        "domain:name": {
          "@_avail": "1",
          "#text": "example.com"
        },
        "domain:reason": "Available"
      },
      {
        "domain:name": {
          "@_avail": "0",
          "#text": "taken.com"
        },
        "domain:reason": {
          "@_lang": "en",
          "#text": "Already registered"
        }
      }
    ]
  }
}
```

## Generated Schema Structure

### File Naming

```
{namespace-prefix}.{element-name}.layer1.ts
```

Examples:
- `domain.check.layer1.ts`
- `epp.epp.layer1.ts`
- `host.create.layer1.ts`

### Schema Pattern

```typescript
// domain.check.layer1.ts
import { z } from 'zod';

export const DomainCheckXml = z.object({
  "domain:name": z.array(z.string().min(1).max(255)).min(1),
}).brand<"domain:check">();

export type DomainCheckXml = z.infer<typeof DomainCheckXml>;
```

### Naming Convention

| XSD | TypeScript Identifier |
|-----|----------------------|
| `domain:check` | `DomainCheckXml` |
| `epp:epp` | `EppEppXml` |
| `host:create` | `HostCreateXml` |

## Schema Features

### Attributes

XSD:
```xml
<xs:attribute name="avail" type="xs:boolean" use="required"/>
<xs:attribute name="lang" type="xs:language" default="en"/>
```

Generated:
```typescript
z.object({
  "@_avail": z.union([z.literal('true'), z.literal('false'), z.literal('1'), z.literal('0')]),
  "@_lang": z.string().default("en").optional(),
})
```

### Text Content with Attributes (simpleContent)

XSD:
```xml
<xs:complexType name="checkNameType">
  <xs:simpleContent>
    <xs:extension base="xs:string">
      <xs:attribute name="avail" type="xs:boolean" use="required"/>
    </xs:extension>
  </xs:simpleContent>
</xs:complexType>
```

Generated:
```typescript
z.object({
  "@_avail": z.union([z.literal('true'), z.literal('false'), z.literal('1'), z.literal('0')]),
  "#text": z.string(),
})
```

### Choice (Union)

XSD:
```xml
<xs:choice>
  <xs:element name="check" type="checkType"/>
  <xs:element name="create" type="createType"/>
</xs:choice>
```

Generated:
```typescript
z.union([
  z.object({ "epp:check": CheckTypeXml }),
  z.object({ "epp:create": CreateTypeXml }),
])
```

### Sequence with Choice

XSD:
```xml
<xs:sequence>
  <xs:choice>
    <xs:element name="a" type="xs:string"/>
    <xs:element name="b" type="xs:string"/>
  </xs:choice>
  <xs:element name="c" type="xs:string"/>
</xs:sequence>
```

Generated (base props spread into each union member):
```typescript
z.union([
  z.object({
    "ns:c": z.string(),
    "ns:a": z.string(),
  }),
  z.object({
    "ns:c": z.string(),
    "ns:b": z.string(),
  }),
])
```

### Arrays (maxOccurs > 1)

XSD:
```xml
<xs:element name="name" type="xs:string" maxOccurs="unbounded"/>
<xs:element name="status" type="statusType" minOccurs="0" maxOccurs="11"/>
```

Generated:
```typescript
"domain:name": z.array(z.string()).min(1),
"domain:status": z.array(StatusTypeXml).optional(),
```

### Optional Elements (minOccurs="0")

XSD:
```xml
<xs:element name="reason" type="xs:string" minOccurs="0"/>
```

Generated:
```typescript
"domain:reason": z.string().optional(),
```

### Element References

XSD:
```xml
<xs:element ref="domain:check"/>
```

Generated (imports, not inlines):
```typescript
import { DomainCheckXml } from './domain.check.layer1.js';

z.object({
  "domain:check": DomainCheckXml,
})
```

### Enumerations

XSD:
```xml
<xs:simpleType name="statusValueType">
  <xs:restriction base="xs:token">
    <xs:enumeration value="ok"/>
    <xs:enumeration value="pending"/>
    <xs:enumeration value="failed"/>
  </xs:restriction>
</xs:simpleType>
```

Generated:
```typescript
z.enum(["ok", "pending", "failed"])
```

### Patterns (Regex)

XSD:
```xml
<xs:simpleType name="roidType">
  <xs:restriction base="xs:token">
    <xs:pattern value="(\w|_){1,80}-\w{1,8}"/>
  </xs:restriction>
</xs:simpleType>
```

Generated:
```typescript
z.string().regex(/(\w|_){1,80}-\w{1,8}/)
```

### Mixed Content

XSD:
```xml
<xs:complexType name="mixedMsgType" mixed="true">
  <xs:sequence>
    <xs:any processContents="skip" minOccurs="0" maxOccurs="unbounded"/>
  </xs:sequence>
</xs:complexType>
```

Generated:
```typescript
z.object({
  "#text": z.string().optional(),
})
```

## Branding

All element schemas are branded with their QName:

```typescript
export const DomainCheckXml = z.object({...}).brand<"domain:check">();
```

This enables:
- Type discrimination at compile time
- Runtime type identification
- Prevents accidental type confusion

Usage:
```typescript
function processCheck(data: DomainCheckXml) {
  // TypeScript knows this is specifically domain:check data
}
```

## Usage Examples

### Basic Validation

```typescript
import { XMLParser } from 'fast-xml-parser';
import { DomainChkDataXml } from './generated/epp-core';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
});

const xml = `<domain:chkData>...</domain:chkData>`;
const json = parser.parse(xml);

// Validate
const result = DomainChkDataXml.safeParse(json['domain:chkData']);

if (result.success) {
  console.log(result.data);
} else {
  console.error(result.error.issues);
}
```

### With EPP Response

```typescript
import { EppEppXml } from './generated/epp-core';

const eppResponse = parser.parse(xmlString);
const validated = EppEppXml.parse(eppResponse['epp:epp']);

// Type-safe access
if ('epp:response' in validated) {
  const response = validated['epp:response'];
  const resultCode = response['epp:result'][0]['@_code'];
}
```

### Type Inference

```typescript
import { DomainCheckXml } from './generated/epp-core';

// Type is inferred from schema
type DomainCheck = typeof DomainCheckXml._type;

// Or use the exported type
const data: DomainCheckXml = {
  "domain:name": ["example.com", "test.com"],
};
```

## Error Handling

Zod provides detailed error messages:

```typescript
try {
  DomainChkDataXml.parse(invalidJson);
} catch (e) {
  if (e instanceof z.ZodError) {
    for (const issue of e.issues) {
      console.log(`Path: ${issue.path.join('.')}`);
      console.log(`Message: ${issue.message}`);
    }
  }
}
```

## Limitations

Layer 1 validates structure but does NOT:
- Transform data types (booleans stay as `"true"`/`"1"` strings)
- Remove namespace prefixes
- Flatten nested structures
- Handle XML serialization

These are Layer 2 responsibilities. See [Layer 2 Documentation](./layer2-codecs.md).
