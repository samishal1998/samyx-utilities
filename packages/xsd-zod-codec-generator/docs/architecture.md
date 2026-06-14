# Architecture

This document explains the two-layer architecture of xsd-zod-codec-generator.

## Overview

The generator produces Zod schemas in two layers:

```
┌─────────────────────────────────────────────────────────────────┐
│                        Your Application                          │
└─────────────────────────────────────────────────────────────────┘
                              ↕
┌─────────────────────────────────────────────────────────────────┐
│  Layer 2: Codecs (z.codec)                                      │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  Clean TypeScript Types                                  │   │
│  │  { domains: [{ name: "example.com", available: true }] } │   │
│  └─────────────────────────────────────────────────────────┘   │
│                         ↕ decode/encode                         │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  fast-xml-parser (XMLParser / XMLBuilder)               │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                              ↕
┌─────────────────────────────────────────────────────────────────┐
│  Layer 1: XML JSON Validation                                   │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  XML JSON Shape                                          │   │
│  │  { "domain:cd": [{ "domain:name": { "@_avail": "1",     │   │
│  │                                      "#text": "ex.com" }}]}│   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                              ↕
┌─────────────────────────────────────────────────────────────────┐
│                        XML String                                │
│  <domain:chkData><domain:cd><domain:name avail="1">...          │
└─────────────────────────────────────────────────────────────────┘
```

## Layer 1: XML JSON Validation

**Status: Implemented**

Layer 1 validates the JSON structure that `fast-xml-parser` produces from XML.

### Purpose

- Validate XML structure at runtime
- Catch schema violations early
- Provide type safety for XML JSON handling
- Serve as foundation for Layer 2 codecs

### Characteristics

| Aspect | Layer 1 Behavior |
|--------|------------------|
| Input | JSON from `fast-xml-parser` |
| Output | Validated JSON (same shape) |
| Keys | Namespace-prefixed (`"domain:name"`) |
| Attributes | `@_` prefix (`"@_avail"`) |
| Text content | `#text` property |
| Branding | `.brand<"ns:element">()` |
| Location | `generated/*/elements/*.layer1.ts` |

### Example

XSD:
```xml
<xs:element name="chkData" type="domain:chkDataType"/>
<xs:complexType name="chkDataType">
  <xs:sequence>
    <xs:element name="cd" type="domain:checkType" maxOccurs="unbounded"/>
  </xs:sequence>
</xs:complexType>
<xs:complexType name="checkType">
  <xs:sequence>
    <xs:element name="name" type="domain:checkNameType"/>
  </xs:sequence>
</xs:complexType>
<xs:complexType name="checkNameType">
  <xs:simpleContent>
    <xs:extension base="xs:string">
      <xs:attribute name="avail" type="xs:boolean" use="required"/>
    </xs:extension>
  </xs:simpleContent>
</xs:complexType>
```

Generated Layer 1:
```typescript
// domain.chkData.layer1.ts
export const DomainChkDataXml = z.object({
  "domain:cd": z.array(z.object({
    "domain:name": z.object({
      "@_avail": z.union([z.literal('true'), z.literal('false'), z.literal('1'), z.literal('0')]),
      "#text": z.string(),
    }),
  })).min(1),
}).brand<"domain:chkData">();
```

Usage:
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
const validated = DomainChkDataXml.parse(json['domain:chkData']);
```

## Layer 2: Codecs

**Status: Planned**

Layer 2 provides full bidirectional XML ↔ TypeScript transformation using Zod 4's `z.codec()`.

### Purpose

- Clean TypeScript interfaces (no XML artifacts)
- Bidirectional: parse XML → types, serialize types → XML
- Handle XML namespaces internally
- Type-safe XML round-tripping

### Characteristics

| Aspect | Layer 2 Behavior |
|--------|------------------|
| Input | XML string |
| Output | Clean TypeScript types |
| Keys | No prefixes (`name`, not `domain:name`) |
| Attributes | Flattened or nested cleanly |
| Text content | Direct value, not `#text` |
| Serialization | Handles xmlns declarations |
| Location | `generated/*/codecs/*.codec.ts` |

### Planned Example

```typescript
// domain.chkData.codec.ts
import { z } from 'zod';
import { XMLParser, XMLBuilder } from 'fast-xml-parser';
import { DomainChkDataXml } from '../elements/domain.chkData.layer1.js';

// Clean TypeScript interface
export interface DomainCheckResult {
  domains: Array<{
    name: string;
    available: boolean;
    reason?: string;
  }>;
}

const parserOptions = {
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
};

const builderOptions = {
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
};

export const DomainChkDataCodec = z.codec<string, DomainCheckResult>({
  decode: (xml: string): DomainCheckResult => {
    const parser = new XMLParser(parserOptions);
    const json = parser.parse(xml);

    // Validate with Layer 1
    const validated = DomainChkDataXml.parse(json['domain:chkData']);

    // Transform to clean types
    return {
      domains: validated['domain:cd'].map(cd => ({
        name: cd['domain:name']['#text'],
        available: cd['domain:name']['@_avail'] === 'true' ||
                   cd['domain:name']['@_avail'] === '1',
        reason: cd['domain:reason']?.['#text'],
      })),
    };
  },

  encode: (data: DomainCheckResult): string => {
    const xmlJson = {
      'domain:chkData': {
        '@_xmlns:domain': 'urn:ietf:params:xml:ns:domain-1.0',
        'domain:cd': data.domains.map(d => ({
          'domain:name': {
            '@_avail': d.available ? '1' : '0',
            '#text': d.name,
          },
          ...(d.reason && {
            'domain:reason': { '#text': d.reason },
          }),
        })),
      },
    };

    const builder = new XMLBuilder(builderOptions);
    return builder.build(xmlJson);
  },
});

// Usage
const result = DomainChkDataCodec.decode(xmlString);
// result: { domains: [{ name: "example.com", available: true }] }

const xml = DomainChkDataCodec.encode(result);
// xml: <domain:chkData xmlns:domain="...">...</domain:chkData>
```

## Why Two Layers?

### Separation of Concerns

| Layer | Responsibility |
|-------|---------------|
| Layer 1 | XML structure validation |
| Layer 2 | Domain type transformation |

### Flexibility

- Use Layer 1 alone if you need raw XML JSON access
- Use Layer 2 for clean application interfaces
- Layer 2 builds on Layer 1 (reuses validation)

### Debuggability

- Layer 1 catches structural XML errors
- Layer 2 errors indicate transformation issues
- Clear separation helps identify problem source

### Performance

- Layer 1 can be used for quick validation
- Layer 2 adds transformation overhead only when needed
- Caching can be applied at either layer

## Data Flow

### XML → TypeScript (Decode)

```
XML String
    │
    ▼
fast-xml-parser.parse()
    │
    ▼
XML JSON (with @_, #text, prefixes)
    │
    ▼
Layer 1 Zod Schema (.parse())
    │
    ▼
Validated XML JSON
    │
    ▼
Layer 2 decode transform
    │
    ▼
Clean TypeScript Type
```

### TypeScript → XML (Encode)

```
Clean TypeScript Type
    │
    ▼
Layer 2 encode transform
    │
    ▼
XML JSON (with @_, #text, prefixes, xmlns)
    │
    ▼
fast-xml-parser.build()
    │
    ▼
XML String
```

## File Organization

```
generated/
└── my-pack/
    ├── index.ts              # Re-exports everything
    ├── schema-meta.ts        # Namespace mappings, element list
    ├── elements/             # Layer 1
    │   ├── domain.check.layer1.ts
    │   ├── domain.create.layer1.ts
    │   └── ...
    └── codecs/               # Layer 2 (planned)
        ├── domain.check.codec.ts
        ├── domain.create.codec.ts
        └── ...
```

## See Also

- [Layer 1 Documentation](./layer1-xml-validation.md)
- [Layer 2 Documentation](./layer2-codecs.md)
- [XSD Support Matrix](./xsd-support.md)
